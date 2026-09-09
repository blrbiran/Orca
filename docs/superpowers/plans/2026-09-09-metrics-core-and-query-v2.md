# 指标核心与查询（E2）实施计划 —— **v2**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⛔ **v1 作废，不要执行它**：`docs/superpowers/plans/2026-09-09-metrics-core-and-query.md`
> 被一席外派评审判 `Ready to implement? No`（7 Critical／9 Important／6 Minor），
> 其中 **C1 是四行会展开成 `/bin/rm -rf .` 的 shell**。
> v1 **已发布**，因此原文逐字保留 ＋ 追加 ERRATUM 1，**没有就地改**；本文是它的替代品。
> **本文自包含** —— 执行者不需要读 v1。

**Goal:** 造出 `orca metrics` —— 一件**纯只读**的事，从各目标仓库的 `.decisions/**` 与全局 corrections store 算出 A′ §4.4 的纠正率、修复率与积压，并交出一个 E3／E4 能直接消费、可逐字节 golden 比对的输出形状。

**Architecture:** 五层：`resolve.ts`（**纯**，零 fs／零时钟／零 git，负责把 correction 与它的 decision／overturned 对上号，归档查找靠注入的两个函数）→ `collect.ts`（fs ＋ git，仓库发现与读取，把 fs 接到 `resolve` 上）→ `compute.ts`（**纯**，观测集 → 指标对象）→ `report.ts`（渲染；耗时只走 stderr）→ `cli.ts` 的第六个子命令。

**Tech Stack:** TypeScript（ESM，相对 import **必须带 `.js` 后缀**）、zod ^3.23.8、vitest ^2.0.5、tsx、Node ^22。**不新增任何依赖。**

**Spec:** `docs/superpowers/specs/2026-09-08-metrics-core-and-query-design.md`
**上游 spec：** `docs/superpowers/specs/2026-08-29-decision-ledger-design.md`（A′，含 ERRATUM 1–5）
**外审报告：** `.superpowers/sdd/2026-09-09-metrics-core-e2/external-review.md`（含控制器复核表）

---

## v2 相对 v1 改了什么（**给第二席看的清单；每条都指向它修的那个发现**）

| # | 发现 | v1 的做法 | **v2 的做法** |
|---|---|---|---|
| **C1** | 四处 `/bin/rm -rf .` | `D=` 与 `rm` 分属不同代码块 | *** **每个变异步骤是【一个】自包含代码块**：`T=$(mktemp -d)` → clone → shasum → 跑 → `/bin/rm -rf "${T:?clone root unset}"`。**跨块引用变量在本文中被禁止。** *** |
| **C2** | `rejected` 分支不可达 ／ 夹具与 exit 0 互斥 | 宽容读取器用 `decisionEventSchema` 判决 | *** **宽容读取器对 `decision` 只认 `ev`，schema 判决全交给 `validateLine`** *** ⇒ rejected 与 malformed 从此是两件事 |
| **C3** | 变异 8／9 无落点 | 无夹具喂「扫不到的 decision」 | Task 4 与 Task 6 各加夹具；**「不进任何 kind 桶」的断言落在 compute 层** |
| **C4** | 变异 21 落不到观测路径 | 变异只换 `parse`→`safeParse` | 变异改成**让 `readCorrections` 直接调宽容读取器**；夹具**同时**补一行 JSON 合法／schema 不合法的行 |
| **C5** | tsc 直接不过 | `MetricsRejection` 未 re-export；接口缺字段 | `collect.ts` re-export；`Observations` 字段与实现**逐字对齐**（Task 5 Step 1 有一条机械核对步骤） |
| **C6** | 算不出 `deriveFixRunId` | `CorrectionObservation` 丢了四个字段 | *** **携带整行 `Correction`** ***；**并新增一条判据钉「`--json` 输出里不含 `because`／`by`」** |
| **C7** | 输出形状仍未定义 | 只写了一个嵌套类型 | *** **Task 6 Step 1 把 `MetricsReport` 12 个字段连同全部嵌套形状逐字写出** ***；`Observations` 加 `repos` |
| **I1** | 打乱判据空转 | `OBS` 里两个集合是 `[]` | `OBS` 塞 **2 条 unkeyable ＋ 2 条来自不同文件的 malformed ＋ 2 个 repos**，全部乱序给 |
| **I2** | 递归买回全扫 | 递归找 basename | *** **一层定点查**：`readdir(archive)` 取年份目录，逐个 `stat`（A′ §3.7.1 钉死 `<YYYY>` 一层） *** |
| **I3** | exit 6 挂全局标记 | `lastLineLooksTorn` 只来自 store | *** **`torn: boolean` 记进 `MalformedLine` 自身**；exit 6 ⟺ 存在至少一条 `torn === false` *** |
| **I4** | 不复用既有 helper | 自造 `captureStdout` | 用 `tests/scheduler/sandbox.ts:300` 的真签名（**async，返回 `{ result, stdout }`**）与 `tests/corrections/harness.ts:25` 的 `withCorrectionsDir`（**Rule 17 的约定写法**） |
| **I5** | 收尾丢了自己的约束 | Task 5／6／7 只有 add＋commit | **八个任务的收尾一律是同一段 checklist**，见下「每任务收尾（照抄，不许省）」 |
| **I6** | 管道过滤 rtk | `... \| awk '{print $2}'` | `git status --porcelain -z > 文件` ＋ python 按 NUL 切 |
| **I7** | 裁二理由站不住 | 月粒度焊死 | `computeMetrics(obs, { bucket: "month" })` **纯函数参数，默认 month，不加 CLI flag** |
| **I8** | 夹具实测判 downgraded | `undo.how = "git revert abc123"` | `"git revert abc123 -- src/foo.ts"`（**已现测 ⇒ `ok`**）；downgraded 那条单独用不可执行的 how 造 |
| **I9** | Task 4／5 缝切错 | Task 4 交付已知错的 stub | *** **倒置**：Task 4 ＝ 纯 `resolve`（自带变异 8／10），Task 5 ＝ 把 fs 接上去 *** |
| **M1** | `git diff` 看不见新文件 | 用 `git diff` 作观测面 | 用 `git status --porcelain -z` |
| **M2** | `ls-remote` 措辞过度 | 「唯一检测手段」 | 改成：`ls-remote` 给远端 sha；**判就地改要 `git diff <远端sha>..<本地sha> -- <文件>`** |
| **M3** | schema 失败那处 push 无变异 | 只变异 `catch` 那处 | 两处各一条变异 |
| **M4** | `_ms` 两条断言互斥 | 留给执行者 | 直接写成两条精确断言 |
| **M5** | 变异 15 要靠组合才红 | 一步 | **两步变异，两次都要看到红** |
| **M6** | `d(...)`／`c(...)` 未定义 | 占位 | **工厂逐字写出** |

---

## Global Constraints

**每个任务的验收都隐含包含本节。** 数值与措辞逐字抄自 spec。

1. *** **E2 一个字节都不写。** *** 不建新存储、不引入新写入方、**不取任何已有的锁**（spec §2、§5.1）。
2. *** **`compute.ts` 与 `resolve.ts` 必须是纯的：零 fs、零时钟、零 git。** *** `now` 由调用方注入（spec §4.3、§5）。
3. **不改台账 schema、不改 `CORRECTION_FIELDS`、不改 `src/corrections/store.ts` 的严格读**（spec §0、§5.3）。
4. **扫描耗时只走 stderr，永不进 `--json`**（spec §4.1、§6 第 3 条）。
5. **每个集合都有一条全序，一处都不许依赖 `readdir` 顺序**（spec §6 第 2 条）。
6. **顶层字段名写死在 `METRICS_FIELDS`**，序列化按它的顺序（spec §6 第 1 条）。
7. **积压年龄用挂钟**；单调钟只用于扫描耗时（`performance.now()`）。
8. **新增退出码 6** ＝「有非撕裂的坏行，但报告已整份打印」。既有码不动：`1` 输入错、`2` 台账 downgraded、`3` 未预料异常、`4` 锁被占、`5` 已落盘未提交。
9. *** **Rule 17：任何触碰 corrections store 的判据一律包在 `withCorrectionsDir` 里**（`tests/corrections/harness.ts:25`，它是本仓库为这件事立的约定写法）。 ***
10. **变异纪律**：只在 `git clone --local` 副本里做；副本只克隆已提交状态（要变异未提交改动必须先 `cat` 进副本并 `diff` 证明逐字节相同）；副本无 `node_modules` ⇒ `ln -s`；*** **变异前后各取 `shasum -a 256`，不等才算落上去** ***；🔴 **副本 remote 是路径式 ⇒ 绝不放在任何 `--root` 底下**。
11. *** **一条变异在被【看到】红之前不是判据，且必须确认红在【点名的那一条】上。** *** 红在别处 ＝ 假红。
12. **Rule 14：成本、耗时、条数只报工具给出的数，不许自估。**
13. *** **绝不过滤验证性跑** *** —— `rtk proxy … > 文件` 再整份 `cat`。**不许 `grep`／`tail`／`head`／管道**（管道还会吞退出码）。

### 🔴 每任务收尾（**八个任务逐字照抄这一段，不许省**）

```bash
# 1) 全量判据(整份读回,不过滤)
rtk proxy npm run verify > /tmp/verify-taskN.txt 2>&1; echo "VERIFY_RC=$?" >> /tmp/verify-taskN.txt
cat /tmp/verify-taskN.txt
# 2) Rule 17 活证据
ls ~/.orca 2>&1 || echo "ORCA_STILL_ABSENT"
# 3) 工作树(M1:git diff 看不见未跟踪文件,必须用 porcelain -z)
rtk proxy git status --porcelain -z > /tmp/pN.bin 2>/tmp/pN.err   # ⚠️ 不用 2>&1:stderr 文本会被当成一个「路径」
python3 -c "import sys;d=open('/tmp/pN.bin','rb').read().split(b'\0');print([x.decode() for x in d if x])"
# 4) 已发布状态(M2:ls-remote 只给远端 sha;判就地改要 diff)
git ls-remote origin refs/heads/main > /tmp/lsr.txt 2>&1; echo "RC=$?" >> /tmp/lsr.txt; cat /tmp/lsr.txt
# 5) 提交
git add "${FILES:?task files unset}"                  # ⚠️ 绝不写 <本任务的文件>:bash 把 < 当输入重定向
git commit -m "${SUBJECT:?commit subject unset}"
```

### 🔴 变异模板（**每个变异一个自包含代码块；C1 就是栽在跨块引用变量上**）

```bash
set -u
T=$(mktemp -d)
git clone --local . "$T/copy" >/dev/null 2>&1
ln -s "$PWD/node_modules" "$T/copy/node_modules"
# 副本只有已提交状态 ⇒ 把工作树里未提交的文件逐个 cat 进去并证明逐字节相同
for f in ${CHANGED:?changed files unset}; do          # ⚠️ 不写 <…>:bash 会把它当重定向
  mkdir -p "$T/copy/$(dirname "$f")"; cat "$f" > "$T/copy/$f"
  diff "$f" "$T/copy/$f" || { echo "COPY_DIFFERS: $f"; exit 1; }
done
shasum -a 256 "$T/copy/${TARGET:?mutation target unset}"   # 变异前
python3 - "$T/copy" <<'PY'
# …改码脚本:锚点必须整行,且 assert 命中数 == 1
PY
shasum -a 256 "$T/copy/${TARGET:?mutation target unset}"   # 变异后:两个 sha 不等才算落上去
(cd "$T/copy" && ./node_modules/.bin/vitest run "${SPEC:?spec file unset}" > /tmp/mN.txt 2>&1; echo "RC=$?" >> /tmp/mN.txt)
cat /tmp/mN.txt                                          # ⚠️ 读一眼:红在点名的那一条上吗?
/bin/rm -rf "${T:?clone root unset}"                     # ⚠️ :? 在变量为空时直接退出 —— 这一格是 C1 的护栏
```

⚠️ 🔴 *** **模板里一律用 `"${VAR:?msg}"`，绝不用 `<占位符>`。** *** bash 把 `<x>` 解析成
「从文件 `x` 输入重定向」＋ 一个输出重定向。**现测**：占位符文件**存在**时，
`echo … --root <夹具> --as-of X --json > out.json` 会**造出一个名叫 `--as-of` 的文件**
（`--` 开头的文件名是后续 glob 的参数注入隐患）；**不存在**时 `bash: 夹具: No such file or directory` 直接失败。
**两种都不是你要的。**（第二席 Minor 2；控制器复核成立，并把触发条件量准了 —— 席位只给了前一半。）
⚠️ *** **这一类是本文 Self-Review 的「Shell scan」按【变量未赋值】那一维【看不见】的** *** —— 那里根本没有变量。
⇒ **Shell scan 因此加第二问**：*** **这一段里有没有 `<` 或 `>` 出现在不是重定向的位置。** ***

⚠️ *** **`/bin/rm` 而不是 `rm`** *** —— 本机 `rm` 与 `cp` 都有 `-i` alias，普通 `rm -rf` 会**静默挂在提示上直到超时**，`cp` 会**静默拒绝覆盖**（用 `cat pristine > target`）。

---

## File Structure

| 文件 | 责任 | spec §5 的哪一层 |
|---|---|---|
| `src/metrics/types.ts` | 观测集类型、输出类型、`METRICS_FIELDS` | 跨层 |
| `src/metrics/highTier.ts` | 对 `DECISION_KINDS` 的**编译期穷尽分类** | compute 的输入常量 |
| `src/metrics/rejection.ts` | `MetricsRejection` | cli 的错误通道 |
| `src/metrics/lenientRead.ts` | 宽容行读取器 ＋ `malformed_lines`（**只给读侧**） | collect |
| 🆕 `src/metrics/resolve.ts` | *** **纯**：correction ↔ decision ↔ overturned 对号，归档查找靠注入的两个函数 *** | collect 的纯核 |
| `src/metrics/collect.ts` | 仓库发现、读文件、`--as-of` 过滤、**把 fs 接到 `resolve` 上** | collect |
| `src/metrics/compute.ts` | 观测集 → 指标对象。**零 fs／零时钟／零 git** | compute |
| `src/metrics/report.ts` | `--json` 与人读表格；**耗时走 stderr** | report |
| `src/cli.ts`（改） | `orca metrics` 第六个子命令 ＋ USAGE | cli |

**为什么把 `resolve.ts` 单独切出来（I9）**：v1 让 collect 任务先交付一个**明知是错的 stub**，
而那个 stub 的错误形状正是 spec §3.4.2 判定为「核心交付数字静默劣化」的那一个，且该任务的判据**结构上看不见它**。
⇒ 评审员没法单独否掉它。切出纯的 `resolve` 之后，归档查找**自带完整判据与变异，且零 fs**，
**与 spec §5 对 `compute` 的纯度纪律同构**。

---

## Task 1: 高位分类 —— 编译期穷尽，不是第二份白名单

**Files:** Create `src/metrics/highTier.ts`；Test `tests/metrics/highTier.test.ts`

**Interfaces:**
- Consumes: `DECISION_KINDS` / `DecisionKind` / `DecisionScope`（`src/ledger/types.ts`；现测 7 个 kind，含 `reconcile`）
- Produces: `KIND_TIER: Record<DecisionKind, "high" | "low">`、`isHighTier(scope, kind): boolean`、`KIND_ORDER: readonly DecisionKind[]`

- [ ] **Step 1: 写会失败的判据** —— `tests/metrics/highTier.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { DECISION_KINDS } from "../../src/ledger/types.js";
import { KIND_TIER, isHighTier } from "../../src/metrics/highTier.js";

describe("high-tier classification (E2 spec §3.6, A' §3.6 as corrected by A' ERRATUM 4)", () => {
  it("sorts reconcile high — the kind A' §3.6's six-name whitelist left at the bottom", () => {
    expect(KIND_TIER.reconcile).toBe("high");
    expect(isHighTier("repo", "reconcile")).toBe(true);
    expect(isHighTier("cross-repo", "reconcile")).toBe(true);
  });

  it("keeps A' §3.6's scope half: a file- or task-scoped decision sinks whatever its kind", () => {
    expect(isHighTier("file", "dependency")).toBe(false);
    expect(isHighTier("task", "reconcile")).toBe(false);
  });

  it("classifies every kind in DECISION_KINDS — no kind may be missing", () => {
    for (const kind of DECISION_KINDS) expect(KIND_TIER[kind]).toMatch(/^(high|low)$/);
    expect(Object.keys(KIND_TIER)).toHaveLength(DECISION_KINDS.length);
  });

  it("keeps the six A' already named high, so this is a widening and not a rewrite", () => {
    for (const kind of ["dependency", "interface", "scheduling", "abandon", "criteria", "boundary"] as const) {
      expect(KIND_TIER[kind]).toBe("high");
    }
  });
});
```

- [ ] **Step 2: 跑它，确认红**
`rtk proxy npx vitest run tests/metrics/highTier.test.ts > /tmp/t1.txt 2>&1; echo RC=$?; cat /tmp/t1.txt`
Expected: FAIL —— `Cannot find module '../../src/metrics/highTier.js'`
⚠️ **这次的红是「模块不存在」，只证明判据跑到了，不证明它承重。** 承重靠 Step 5。

- [ ] **Step 3: 实现** —— `src/metrics/highTier.ts`

```typescript
import { DECISION_KINDS } from "../ledger/types.js";
import type { DecisionKind, DecisionScope } from "../ledger/types.js";

/**
 * A' §3.6's high-tier set, as corrected by A' ERRATUM 4.
 *
 * 🔴 An exhaustive classification, NOT a second whitelist. A' §3.6 spells six
 * kinds out in prose; DECISION_KINDS has seven, and the seventh — reconcile,
 * whose own comment calls it "an order of magnitude riskier" — sank to the
 * bottom because nobody updated the prose. A seventh name copied into here
 * would buy exactly the same silence for the eighth kind.
 *
 * Keying a Record by DecisionKind makes adding a kind without classifying it a
 * COMPILE error. Same lever as REFERENCE_EVENT_SCHEMAS in ledger/schema.ts and
 * as CORRECTION_FIELDS' `satisfies` in corrections/fields.ts, whose comment
 * says the constraint is there because it "buys a compile error".
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
 * A' §3.6's rule verbatim: scope ∈ {cross-repo, repo} AND kind in the high
 * set. Both halves — dropping the scope half would promote every file-scoped
 * naming decision the ledger was told never to report.
 */
const HIGH_SCOPES: ReadonlySet<DecisionScope> = new Set<DecisionScope>(["cross-repo", "repo"]);

export function isHighTier(scope: DecisionScope, kind: DecisionKind): boolean {
  return HIGH_SCOPES.has(scope) && KIND_TIER[kind] === "high";
}

/** Declaration order, for the total order §6 item 2 requires on kind buckets. */
export const KIND_ORDER: readonly DecisionKind[] = DECISION_KINDS;
```

- [ ] **Step 4: 跑判据，确认绿**（4 条）

- [ ] **Step 5: 🔴 变异 15 —— M5 要求【两步】，两次都要看到红**

**第一步：只松开约束（`Record<DecisionKind,…>` → `Record<string,…>`）。**

```bash
set -u
T=$(mktemp -d); git clone --local . "$T/copy" >/dev/null 2>&1; ln -s "$PWD/node_modules" "$T/copy/node_modules"
mkdir -p "$T/copy/src/metrics"; cat src/metrics/highTier.ts > "$T/copy/src/metrics/highTier.ts"
diff src/metrics/highTier.ts "$T/copy/src/metrics/highTier.ts" || { echo COPY_DIFFERS; exit 1; }
shasum -a 256 "$T/copy/src/metrics/highTier.ts"
python3 - "$T/copy" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "src/metrics/highTier.ts"
t = p.read_text()
old = 'export const KIND_TIER: Record<DecisionKind, "high" | "low"> = {'
assert t.count(old) == 1, f"anchor hit {t.count(old)} times"
p.write_text(t.replace(old, 'export const KIND_TIER: Record<string, "high" | "low"> = {'))
PY
shasum -a 256 "$T/copy/src/metrics/highTier.ts"
(cd "$T/copy" && ./node_modules/.bin/tsc --noEmit -p tsconfig.json > /tmp/m15a.txt 2>&1; echo "TSC_RC=$?" >> /tmp/m15a.txt)
cat /tmp/m15a.txt
/bin/rm -rf "${T:?clone root unset}"
```

Expected: *** **`TSC_RC=0`** *** —— **松约束【自己】不红。M5 记的就是这个**：这一步的价值是**证明第二步的红确实来自约束**。

**第二步：在【未松约束】的副本上加第八个 kind。**
⚠️ *** **这是两个【独立副本】，不是同一个副本上的两处改动。** ***
第一步的价值是证明「松约束**自己**不红」；第二步的价值是证明「**不松**约束时加 kind 会红」。
**两步合起来才说明那个红来自约束。**
（第二席 I-4：v2 第一版这句写成「同一个副本里连着做两处改动」，而 `tsconfig.json` 现测无
`noUncheckedIndexedAccess` ⇒ 真那么做的话 `TSC_RC=0`，下面那条期望就是假的。**代码块本来是对的，错的是这句话。**）

```bash
set -u
T=$(mktemp -d); git clone --local . "$T/copy" >/dev/null 2>&1; ln -s "$PWD/node_modules" "$T/copy/node_modules"
mkdir -p "$T/copy/src/metrics"; cat src/metrics/highTier.ts > "$T/copy/src/metrics/highTier.ts"
diff src/metrics/highTier.ts "$T/copy/src/metrics/highTier.ts" || { echo COPY_DIFFERS; exit 1; }   # Global Constraint 10
shasum -a 256 "$T/copy/src/ledger/types.ts"
python3 - "$T/copy" <<'PY'
import sys, pathlib
root = pathlib.Path(sys.argv[1])
p = root / "src/ledger/types.ts"
t = p.read_text()
old = '  "reconcile",\n] as const;'
assert t.count(old) == 1, f"anchor hit {t.count(old)} times"
p.write_text(t.replace(old, '  "reconcile",\n  "fabricated",\n] as const;'))
PY
shasum -a 256 "$T/copy/src/ledger/types.ts"
(cd "$T/copy" && ./node_modules/.bin/tsc --noEmit -p tsconfig.json > /tmp/m15b.txt 2>&1; echo "TSC_RC=$?" >> /tmp/m15b.txt)
cat /tmp/m15b.txt
/bin/rm -rf "${T:?clone root unset}"
```

Expected: *** **`TSC_RC` 非 0，且报错逐字指向 `KIND_TIER` 缺少属性 `fabricated`。** ***
⚠️ **读一眼错在哪** —— 红在语法错或别的文件 ＝ 假红。

- [ ] **Step 6: 🔴 变异 14 —— `reconcile: "high"` 改成 `"low"`**

用同一段模板，锚点整行 `  reconcile: "high",`（`assert count == 1`），跑 `tests/metrics/highTier.test.ts`。
Expected: 红在 `sorts reconcile high …` 这一条上。红在别条 ⇒ 假红。

- [ ] **Step 7: 收尾** —— 照抄「每任务收尾」那五步。提交主题行：
`feat(metrics): classify every decision kind at compile time, not in a second whitelist`

---

## Task 2: 宽容读取器 —— **只认 `ev`，schema 判决交给 `validateLine`**

**Files:** Create `src/metrics/types.ts`、`src/metrics/lenientRead.ts`；Test `tests/metrics/lenientRead.test.ts`

🔴 **本任务是 C2 的落点。** v1 让宽容读取器自己用 `decisionEventSchema` 判决，于是一条真 rejected 的 decision
**先被判成坏行**，`collect` 里的 `rejected` 分支永远不成立（spec §8 第 3 条变异结构上不可能红），
且 §7 夹具里那条 rejected 会把命令推到 exit 6，与它自己的 `exit 0` 断言互斥。

**Interfaces:**
- Produces:
  - `MalformedLine { file: string; line: number; bytes: number; reason: string; torn: boolean }` ← 🔴 **`torn` 是 I3 的落点**
  - `LenientRead<T> { rows: T[]; malformed: MalformedLine[] }` ← **不再有全局 `lastLineLooksTorn`**
  - `readCorrectionsLeniently(file): Promise<LenientRead<Correction>>`
  - `readLedgerLeniently(file): Promise<LenientRead<LedgerRow>>`，`LedgerRow = { kind: "decision"; raw: string; value: unknown } | { kind: "overturned"; row: OverturnedEvent }`
    ⚠️ *** **`value: unknown`，不是 `DecisionEvent`** *** —— 读取器不做 schema 判决，那正是 C2 的全部内容

- [ ] **Step 1: 写会失败的判据** —— `tests/metrics/lenientRead.test.ts`

```typescript
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
import { readCorrectionsLeniently, readLedgerLeniently } from "../../src/metrics/lenientRead.js";

const tempDir = () => mkdtemp(join(tmpdir(), "orca-metrics-lenient-"));

const GOOD = JSON.stringify({
  id: "c_0000000000000001", projectKey: "github.com/biran/orca", decisionId: "orca-dev-1/1",
  kind: "wrong", because: "证据不对", at: "2026-09-01T00:00:00.000Z", by: "amy",
});
const GOOD2 = JSON.stringify({
  id: "c_0000000000000002", projectKey: "github.com/biran/orca", decisionId: "orca-dev-1/2",
  kind: "stale", because: "世界变了", at: "2026-09-02T00:00:00.000Z", by: "amy",
});
/** JSON 合法、schema 不合法 —— C4 要求的第二种夹具。 */
const JSON_OK_SCHEMA_BAD = JSON.stringify({ id: "c_x", projectKey: "k" });

describe("lenient read (E2 spec §5.2, §5.3)", () => {
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
    expect(read.malformed[0].torn).toBe(false);      // I3: 中间坏行不是撕裂
  });

  it("marks a torn LAST line torn, and a middle one not — they get different exit codes", async () => {
    const dir = await tempDir();
    const file = join(dir, "corrections.jsonl");
    await writeFile(file, `${GOOD}\n${GOOD2.slice(0, 40)}`);   // 无末尾换行的半行

    const read = await readCorrectionsLeniently(file);

    expect(read.rows.map((r) => r.id)).toEqual(["c_0000000000000001"]);
    expect(read.malformed).toHaveLength(1);
    expect(read.malformed[0].torn).toBe(true);
    expect(read.malformed[0].reason).toContain("still being written");
  });

  // 🔴 C4：JSON 合法但 schema 不合法的一行 —— 这是让变异 21 可被观测的那种夹具。
  it("a JSON-valid line that is not a correction is malformed, not silently kept", async () => {
    const dir = await tempDir();
    const file = join(dir, "corrections.jsonl");
    await writeFile(file, `${JSON_OK_SCHEMA_BAD}\n${GOOD}\n`);

    const read = await readCorrectionsLeniently(file);
    expect(read.rows).toHaveLength(1);
    expect(read.malformed).toHaveLength(1);
    expect(read.malformed[0].line).toBe(1);
    expect(read.malformed[0].reason).toContain("decisionId");
  });

  // 🔴 变异 21 的【正向对照】。「store.ts 没被改」是「什么都没发生」,不可能直接红。
  it("leaves store.ts strict: readCorrections still throws on a schema-invalid line", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "corrections.jsonl"), `${JSON_OK_SCHEMA_BAD}\n${GOOD}\n`);

    const error = await readCorrections(dir).then(
      () => { throw new Error("readCorrections accepted a schema-invalid line — the strict reader was loosened"); },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("the strict reader was loosened");
  });

  it("a missing file reads as empty, not as an error — a repo with no corrections is normal", async () => {
    const dir = await tempDir();
    const read = await readCorrectionsLeniently(join(dir, "corrections.jsonl"));
    expect(read.rows).toEqual([]);
    expect(read.malformed).toEqual([]);
  });

  // 🔴 C2：宽容读取器对 decision 只认 ev,不做 schema 判决。
  // 一条 schema 不合法的 decision 必须【穿过】读取器,由 validateLine 在 collect 里判 rejected。
  it("hands every ev=decision line through with its raw text, judging none of them", async () => {
    const dir = await tempDir();
    const file = join(dir, "run.jsonl");
    const bad = JSON.stringify({ ev: "decision", id: "orca-dev-1/9" });   // 缺一堆必填字段
    await writeFile(file, `${bad}\n`);

    const read = await readLedgerLeniently(file);
    expect(read.malformed).toEqual([]);                       // ← v1 会在这里报一条坏行 ⇒ 红
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0].kind).toBe("decision");
  });

  it("skips bound and superseded without calling them malformed", async () => {
    const dir = await tempDir();
    const file = join(dir, "run.jsonl");
    await writeFile(file, `${JSON.stringify({ ev: "bound", id: "orca-dev-1/1", taskId: "T1", runId: "r" })}\n`);

    const read = await readLedgerLeniently(file);
    expect(read.rows).toEqual([]);
    expect(read.malformed).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑它，确认红**（模块不存在）

- [ ] **Step 3: 实现** —— `src/metrics/types.ts`（本任务只写这一半，输出类型在 Task 6）

```typescript
/**
 * A line that could not be turned into a row. spec §5.2: excluded from the
 * computation, named in the output, and the report still prints in full.
 *
 * `bytes` rather than the text itself: a corrections line carries a person's
 * own words, and a metrics report is the kind of thing that gets pasted into a
 * chat. The length tells a truncated write from a garbage line without
 * republishing what someone wrote.
 *
 * 🔴 `torn` lives on the LINE, not on the read. spec §5.2 row 4 exempts a bad
 * LAST line with no trailing newline — that is the expected race of reading an
 * append-only file, not corruption. A single flag per read cannot express it:
 * with one torn tail in the store and one genuinely corrupt middle line in a
 * ledger, a per-read flag either suppresses the exit code the corrupt line has
 * to produce, or invents one for the tail that must not produce it.
 */
export interface MalformedLine {
  file: string;
  line: number;
  bytes: number;
  reason: string;
  torn: boolean;
}

export interface LenientRead<T> {
  rows: T[];
  malformed: MalformedLine[];
}
```

`src/metrics/lenientRead.ts`：

```typescript
import { readFile } from "node:fs/promises";
import type { z } from "zod";
import { correctionSchema } from "../corrections/schema.js";
import type { Correction } from "../corrections/schema.js";
import { overturnedEventSchema } from "../ledger/schema.js";
import type { DecisionEvent, OverturnedEvent } from "../ledger/schema.js";
import type { LenientRead, MalformedLine } from "./types.js";

/**
 * 🔴 NEW, and for the READ SIDE ONLY. src/corrections/store.ts's
 * readCorrections stays strict and is not touched (spec §0, §5.3).
 *
 * Why not loosen the existing one: readCorrections is called from inside the
 * store lock by recordCorrection and loadCorrection. A lenient reader there
 * would let the duplicate check skip a torn last line and then append after
 * it — §1.7's measured shape, made permanent. A locked writer must not
 * tolerate a tear; a read-only report must not die of one.
 */
type Outcome<T> = { ok: true; row: T } | { ok: false; reason: string } | { skip: true };

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
  parse: (value: unknown, line: string) => Outcome<T>,
): LenientRead<T> {
  if (raw === undefined) return { rows: [], malformed: [] };

  const rows: T[] = [];
  const malformed: MalformedLine[] = [];
  // split("\n") ends in "" when the file ends with a newline. Any other final
  // element is a line nobody terminated — a write in flight.
  const lastIndex = raw.lines.length - 1;

  for (let i = 0; i < raw.lines.length; i += 1) {
    const line = raw.lines[i];
    if (line.trim().length === 0) continue;
    const torn = i === lastIndex && !raw.endsWithNewline;

    const bad = (reason: string): void => {
      malformed.push({
        file,
        line: i + 1,
        bytes: Buffer.byteLength(line, "utf8"),
        reason: torn ? `unterminated last line, still being written: ${reason}` : reason,
        torn,
      });
    };

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      bad(`not valid JSON: ${(error as Error).message}`);
      continue;
    }

    const parsed = parse(value, line);
    if ("skip" in parsed) continue;
    if (parsed.ok) rows.push(parsed.row);
    else bad(parsed.reason);
  }

  return { rows, malformed };
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
 * 🔴 A `decision` line is recognised by its `ev` and handed through UNJUDGED,
 * with its raw text. The verdict belongs to validateLine, which is the only
 * thing that can tell A' §1.1's three states apart: a `rejected` decision is
 * not a legal record and stays out of the denominator, a `downgraded` one IS
 * legal and goes in, and neither is a MALFORMED LINE.
 *
 * Judging with decisionEventSchema here would collapse "rejected" into
 * "malformed": collect's rejected branch could never be reached, spec §8's
 * mutation 3 would have nowhere to land, and §7's fixture — which is required
 * to hold a rejected decision AND exit 0 — would exit 6 instead.
 *
 * `bound` and `superseded` are legal lines carrying neither number: skipped,
 * and NOT reported as malformed, or every ledger here would report seven bad
 * lines.
 */
export type LedgerRow =
  | { kind: "decision"; raw: string; value: unknown }
  | { kind: "overturned"; row: OverturnedEvent };

export async function readLedgerLeniently(file: string): Promise<LenientRead<LedgerRow>> {
  return readLeniently<LedgerRow>(file, await readLines(file), (value, line) => {
    // 第二席 Minor 6:一行 `null` 会让 `.ev` 抛 TypeError,整条命令崩 —— 而 §5.2
    // 要求【任何】坏行都被排除并报告。写法照抄 src/ledger/validateLine.ts 现成的那一道。
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, reason: "line is not a JSON object" };
    }
    const ev = (value as { ev?: unknown }).ev;
    if (ev === "decision") return { ok: true, row: { kind: "decision", raw: line, value } };
    if (ev === "overturned") {
      const result = overturnedEventSchema.safeParse(value);
      return result.success
        ? { ok: true, row: { kind: "overturned", row: result.data } }
        : { ok: false, reason: issuesOf(result.error) };
    }
    if (ev === "bound" || ev === "superseded") return { skip: true };
    return { ok: false, reason: `unknown ev: ${JSON.stringify(ev)}` };
  });
}
```

⚠️ **`DecisionEvent` 在本文件只用于类型导出，`value` 保持 `unknown`** —— 它的 schema 判决属于 `validateLine`（C2）。

- [ ] **Step 4: 跑判据，确认 7 条全绿**

- [ ] **Step 5: 🔴 变异 7（两处，M3 要求各一条）**

用变异模板，跑 `tests/metrics/lenientRead.test.ts`：

| | 锚点（整行，`assert count == 1`） | 期望红在 |
|---|---|---|
| **7a** | `      bad(\`not valid JSON: ${(error as Error).message}\`);` → 换成 `      ;` | `names a MIDDLE bad line …` |
| **7b** | `    else bad(parsed.reason);` → 换成 `    else ;` | `a JSON-valid line that is not a correction …` |

⚠️ **M3 的落点就是 7b** —— v1 只变异了 `catch` 那一处，schema 失败那一处**没有任何变异覆盖**。

- [ ] **Step 6: 🔴 变异 21 —— C4 的改法：让 `store.ts` 直接用宽容读取器**

```bash
set -u
T=$(mktemp -d); git clone --local . "$T/copy" >/dev/null 2>&1; ln -s "$PWD/node_modules" "$T/copy/node_modules"
for f in src/metrics/types.ts src/metrics/lenientRead.ts tests/metrics/lenientRead.test.ts; do
  mkdir -p "$T/copy/$(dirname "$f")"; cat "$f" > "$T/copy/$f"
  diff "$f" "$T/copy/$f" || { echo "COPY_DIFFERS: $f"; exit 1; }
done
shasum -a 256 "$T/copy/src/corrections/store.ts"
python3 - "$T/copy" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "src/corrections/store.ts"
t = p.read_text()
old = """  const rows: Correction[] = [];
  for (const raw of text.split("\\n")) {
    if (raw.trim().length === 0) continue;
    rows.push(correctionSchema.parse(JSON.parse(raw)));
  }
  return rows;"""
assert t.count(old) == 1, f"anchor hit {t.count(old)} times"
new = """  const { readCorrectionsLeniently } = await import("../metrics/lenientRead.js");
  return (await readCorrectionsLeniently(correctionsFile(dir))).rows;"""
p.write_text(t.replace(old, new))
PY
shasum -a 256 "$T/copy/src/corrections/store.ts"
(cd "$T/copy" && ./node_modules/.bin/vitest run tests/metrics/lenientRead.test.ts tests/corrections/store.test.ts > /tmp/m21.txt 2>&1; echo RC=$? >> /tmp/m21.txt)
cat /tmp/m21.txt
/bin/rm -rf "${T:?clone root unset}"
```

Expected: *** **红在 `leaves store.ts strict …` 上** ***（`readCorrections` 不再抛）。
⚠️ **同时确认 `tests/corrections/store.test.ts` 里的既有判据也红** —— 那是「既有判据也在守它」的证据。
⚠️ **v1 的变异（只把 `parse` 换 `safeParse`）在这条判据下照绿**，因为 `JSON.parse` 仍在外面：现测 `node -e 'JSON.parse("{ not json")'` ⇒ `SyntaxError`。**别退回那种写法。**

- [ ] **Step 7: 收尾**（照抄）。提交主题行：
`feat(metrics): read a torn store without dying of it, and leave the verdict to validateLine`

---

## Task 3: 仓库发现与四种坏情况

**Files:** Create `src/metrics/rejection.ts`、`src/metrics/discover.ts`；Test `tests/metrics/discover.test.ts`

🔴 **C5 的一半落点**：`MetricsRejection` 住在 `rejection.ts`，**判据直接从 `rejection.js` import 它**，
并且 `collect.ts` 在 Task 5 里会 `export { MetricsRejection } from "./rejection.js";` —— **两条路都通，不留一条断的。**

**Interfaces:**
- Produces: `MetricsRejection`；`KEY_MATCHES_MULTIPLE_PATHS`／`UNRESOLVED_PROJECT_KEYS`／`REPO_PATH_MISSING`；
  `DiscoveredRepo { projectKey; path }`、`UnkeyableRepo { path; reason }`；
  `discoverRepos(opts): Promise<{ repos: DiscoveredRepo[]; unkeyable: UnkeyableRepo[] }>`；
  `enforceIntegrityGate(repos, keysInStore): void`

- [ ] **Step 1: 写会失败的判据** —— `tests/metrics/discover.test.ts`

```typescript
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { MetricsRejection } from "../../src/metrics/rejection.js";
import {
  KEY_MATCHES_MULTIPLE_PATHS, REPO_PATH_MISSING, UNRESOLVED_PROJECT_KEYS,
  discoverRepos, enforceIntegrityGate,
} from "../../src/metrics/discover.js";

const execFileAsync = promisify(execFile);

/** ⚠️ 必须【显式加】URL 形状的 remote:git init 无 remote ⇒ TARGET_HAS_NO_REMOTE; */
/**    git clone --local 的 remote 是路径式 ⇒ TARGET_REMOTE_NOT_KEYABLE(spec §1.8)。 */
async function repoWithRemote(root: string, name: string, remote: string): Promise<string> {
  const path = join(root, name);
  await mkdir(join(path, ".decisions"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: path });
  await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: path });
  await writeFile(join(path, ".decisions", "orca-dev-1.jsonl"), "");
  return path;
}

describe("repo discovery (E2 spec §2.1, §2.1.1)", () => {
  it("scans --root for repos with .decisions/ and keys them by remote, in projectKey order", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    await repoWithRemote(root, "zzz", "https://github.com/biran/a.git");   // 目录名与 key 反序
    await repoWithRemote(root, "aaa", "git@github.com:biran/b.git");

    const found = await discoverRepos({ root, repos: [] });

    // §6 item 2:projectKey 字典序,不是 readdir 顺序 —— 夹具刻意让两者相反。
    expect(found.repos.map((r) => r.projectKey)).toEqual(["github.com/biran/a", "github.com/biran/b"]);
    expect(found.unkeyable).toEqual([]);
  });

  it("skips a repo it cannot key BUT names it — a --local clone must not kill the command", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    await repoWithRemote(root, "good", "https://github.com/biran/good.git");
    await repoWithRemote(root, "pathy", "/tmp/some/bare.git");

    const found = await discoverRepos({ root, repos: [] });

    expect(found.repos.map((r) => r.projectKey)).toEqual(["github.com/biran/good"]);
    expect(found.unkeyable).toHaveLength(1);
    expect(found.unkeyable[0].path).toContain("pathy");
    expect(found.unkeyable[0].reason).toContain("not a URL");   // 现测 projectKey.ts 的消息逐字含这一句
  });

  it("a repo with no remote at all is also named, not silently dropped", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    const path = join(root, "bare");
    await mkdir(join(path, ".decisions"), { recursive: true });
    await execFileAsync("git", ["init", "-q"], { cwd: path });

    const found = await discoverRepos({ root, repos: [] });
    expect(found.repos).toEqual([]);
    expect(found.unkeyable.map((u) => u.path)).toEqual([path]);
  });

  // spec §8 第 12 条点名「任选一个」在两边相同时会照绿。本判据断的是【抛出并列出两个路径】,
  // 不是条数,所以两边写什么都行 —— 但别把它误读成「条数不同才成立」。
  // (第二席 Minor 4:v2 第一版这里写着「夹具让两个路径的 decision 条数【不同】」,而 "" 与 "\n\n"
  //  现测【都是 0 条】—— 那句注释是假的,已删。)
  it("refuses when one projectKey maps to two paths, and lists both", async () => {
    const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
    const one = await repoWithRemote(root, "one", "https://github.com/biran/same.git");
    const two = await repoWithRemote(root, "two", "https://github.com/biran/same.git");
    await writeFile(join(one, ".decisions", "orca-dev-1.jsonl"), "");
    await writeFile(join(two, ".decisions", "orca-dev-1.jsonl"), "\n\n");

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

  it("the integrity gate refuses a store key that neither mechanism resolves, and names it", () => {
    expect(() =>
      enforceIntegrityGate([{ projectKey: "github.com/biran/a", path: "/a" }],
        ["github.com/biran/a", "github.com/biran/ghost"]),
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

- [ ] **Step 2: 跑它，确认红**（模块不存在）

- [ ] **Step 3: 实现 `src/metrics/rejection.ts`**

```typescript
/**
 * A named refusal `orca metrics` can make. Shape copied from
 * src/corrections/rejection.ts so the two subsystems answer the same way.
 *
 * Only exit code 1 — "the input is wrong and retrying will not help". This cut
 * takes no lock (spec §5.1) so there is no 4; it writes nothing so there is no
 * 5. Exit 6 is NOT a rejection: it means the report printed in full and some
 * lines were bad (spec §5.2), and the CLI returns it rather than throwing.
 */
export class MetricsRejection extends Error {
  readonly exitCode = 1 as const;
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MetricsRejection";
  }
}
```

- [ ] **Step 4: 实现 `src/metrics/discover.ts`**

```typescript
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CorrectRejection } from "../corrections/rejection.js";
import { projectKeyOf } from "../corrections/projectKey.js";
import { MetricsRejection } from "./rejection.js";

export const KEY_MATCHES_MULTIPLE_PATHS = "key-matches-multiple-paths";
export const UNRESOLVED_PROJECT_KEYS = "unresolved-project-keys";
export const REPO_PATH_MISSING = "repo-path-missing";

export interface DiscoveredRepo { projectKey: string; path: string }
export interface UnkeyableRepo { path: string; reason: string }
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
 * argument for repositories outside that root, persisted nowhere: a registry
 * would cost a writer, a lock, a slice of Rule 17 surface, and the risk that
 * 43 existing criteria start writing into a real ~/.orca (spec §1.9, §12.2),
 * while buying nothing the gate below does not.
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
        // does appear under a root — this plan's own mutation discipline
        // creates them — and refusing the whole command for one copy is out of
        // proportion. Staying silent is the other failure: nobody would ever
        // learn a repository was left out.
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
      // spec §2.1.1 row 3: picking one is a GUESS, counting both is double
      // counting, and the gate below can never catch this — it only fires when
      // a key resolves to NOTHING.
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
 * at node_modules / .git: a target repo nested inside another target repo's
 * .decisions is not a shape this system creates.
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
 * missing from the denominator and the correction rate rises with nothing
 * saying so. Refusing by name is the only handling that cannot be misread —
 * and the message says what to do, because the fix is one --repo away.
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

- [ ] **Step 5: 跑判据，确认 7 条全绿**

- [ ] **Step 6: 🔴 四条变异（11／12／13a／13b），每条一个自包含代码块**

| 变异 | 锚点（整行，`assert count == 1`）→ 改成 | 期望红在 |
|---|---|---|
| **11** | `  if (missing.length === 0) return;` → `  if (true) return;` | `the integrity gate refuses …` |
| **12** | 整个 `if (unique.length > 1) { … }` 块删掉（保留 `repos.push`） | `refuses when one projectKey maps to two paths …` |
| **13a** | `          unkeyable.push({ path: candidate, reason: error.message });\n          continue;` → `          throw error;` | `skips a repo it cannot key BUT names it …` |
| **13b** | 同上 → `          continue;` | `skips a repo it cannot key BUT names it …` **与** `a repo with no remote at all …` |

⚠️ **四次各自看到红，且各自读一眼红在不在点名的那条上。**

- [ ] **Step 7: 收尾**（照抄）。提交主题行：
`feat(metrics): find the repositories, and refuse the two shapes that would quietly shrink the denominator`

---

## Task 4: 🆕 **纯**解析层 —— correction ↔ decision ↔ overturned 对号

**Files:** Create `src/metrics/resolve.ts`；Modify `src/metrics/types.ts`；Test `tests/metrics/resolve.test.ts`

🔴 **本任务是 I9 的落点。** v1 让 collect 先交一个**明知是错的 stub**（归档不查），
而那个 stub 的错误形状正是 spec §3.4.2 判定为「核心交付数字静默劣化」的那一个，
且 collect 的判据**结构上看不见它** ⇒ 评审员没法单独否掉。
⇒ **把「对号」这件事做成纯的：归档目录列举与文件读取由调用方注入，本模块零 fs。**

🔴 **本任务同时落地 I2（一层定点查）与 C6（携带整行 `Correction`）。**

**Interfaces:**
- Produces（追加进 `src/metrics/types.ts`）：
  - `CorrectionObservation { row: Correction }` —— 🔴 **整行，不是五个字段**
  - `UnresolvedDecision { correctionId; projectKey; decisionId }`
  - `OverturnedObservation { correctionId; at }`
- Produces（`src/metrics/resolve.ts`）：
  - `ARCHIVE_NAME_AMBIGUOUS = "archive-name-ambiguous"`
  - `interface ArchiveIo { listYearDirs(repoPath: string): Promise<string[]>; statFile(path: string): Promise<boolean>; readFile(path: string): Promise<string> }`
  - `resolveOverturned(input, io): Promise<{ overturned: OverturnedObservation[]; unresolvedDecisions: UnresolvedDecision[] }>`

- [ ] **Step 1: 写会失败的判据** —— `tests/metrics/resolve.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { deriveCorrectionId, deriveFixRunId } from "../../src/corrections/fields.js";
import type { Correction } from "../../src/corrections/schema.js";
import { MetricsRejection } from "../../src/metrics/rejection.js";
import { ARCHIVE_NAME_AMBIGUOUS, resolveOverturned } from "../../src/metrics/resolve.js";
import type { ArchiveIo } from "../../src/metrics/resolve.js";

/** M6:工厂逐字写出,不留占位。 */
function correction(overrides: Partial<Omit<Correction, "id">> = {}): Correction {
  const base = {
    projectKey: "github.com/biran/orca",
    decisionId: "orca-dev-1/1",
    kind: "wrong" as const,
    because: "证据不对",
    at: "2026-03-01T00:00:00.000Z",
    by: "amy",
    ...overrides,
  };
  return { id: deriveCorrectionId(base), ...base };
}

/** 一个记账的 io:记下它被问过哪些路径,好让判据能观测【遍历规模】(I2)。 */
function io(files: Record<string, string>, yearDirs: string[] = []): ArchiveIo & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async listYearDirs() { return yearDirs; },
    async statFile(path) { asked.push(path); return path in files; },
    async readFile(path) { return files[path]; },
  };
}

describe("resolveOverturned (E2 spec §3.4.1, §3.4.2; A' §3.7.1 pins archive/<YYYY>/)", () => {
  it("finds an overturned that archiving moved into archive/<year>/, so a closed correction stays closed", async () => {
    const c = correction();
    const { id: _drop, ...row } = c;
    const runId = deriveFixRunId(row, c.id);
    const path = join("/repo", ".decisions", "archive", "2026", `${runId}.jsonl`);
    const line = JSON.stringify({
      ev: "overturned", id: c.decisionId, correctionId: c.id, replacedBy: `${runId}/1`,
      at: "2026-05-01T00:00:00.000Z", run: runId,
    });

    const theIo = io({ [path]: `${line}\n` }, ["2026"]);
    const out = await resolveOverturned(
      { repoPath: "/repo", projectKey: c.projectKey, corrections: [{ row: c }], scanned: { overturnedCorrectionIds: new Set(), decisionIds: new Set([c.decisionId]) } },
      theIo,
    );

    expect(out.overturned.map((o) => o.correctionId)).toEqual([c.id]);
    expect(out.unresolvedDecisions).toEqual([]);
  });

  // 🔴 I2:一层定点查,不是递归全扫。判据【正向观测遍历规模】——
  // 只断言「找到了」的话,全扫也会绿。
  it("asks for exactly one path per year dir — never walks the archive tree", async () => {
    const c = correction();
    const theIo = io({}, ["2024", "2025", "2026"]);
    await resolveOverturned(
      { repoPath: "/repo", projectKey: c.projectKey, corrections: [{ row: c }], scanned: { overturnedCorrectionIds: new Set(), decisionIds: new Set([c.decisionId]) } },
      theIo,
    );
    expect(theIo.asked).toHaveLength(3);                       // 三个年份,一条 correction ⇒ 恰好 3 次
    for (const p of theIo.asked) expect(p).toMatch(/archive\/20\d\d\/orca-fix-[0-9a-f]{8}\.jsonl$/);
  });

  it("refuses when the derived filename appears under two year dirs — that is a real ambiguity", async () => {
    const c = correction();
    const { id: _drop, ...row } = c;
    const runId = deriveFixRunId(row, c.id);
    const a = join("/repo", ".decisions", "archive", "2025", `${runId}.jsonl`);
    const b = join("/repo", ".decisions", "archive", "2026", `${runId}.jsonl`);
    const theIo = io({ [a]: "", [b]: "" }, ["2025", "2026"]);

    const error = await resolveOverturned(
      { repoPath: "/repo", projectKey: c.projectKey, corrections: [{ row: c }], scanned: { overturnedCorrectionIds: new Set(), decisionIds: new Set([c.decisionId]) } },
      theIo,
    ).then(() => { throw new Error("accepted an ambiguous archive name"); }, (e: unknown) => e);

    expect((error as MetricsRejection).code).toBe(ARCHIVE_NAME_AMBIGUOUS);
    expect((error as Error).message).toContain("2025");
    expect((error as Error).message).toContain("2026");
  });

  // 🔴 C3 的一半:变异 8 的落点 —— 决策扫不到 ⇒ 报告,不硬拒。
  it("reports a correction whose decision is outside what was scanned, instead of refusing", async () => {
    const c = correction({ decisionId: "orca-dev-archived/7" });
    const out = await resolveOverturned(
      { repoPath: "/repo", projectKey: c.projectKey, corrections: [{ row: c }], scanned: { overturnedCorrectionIds: new Set(), decisionIds: new Set() } },
      io({}, []),
    );
    expect(out.unresolvedDecisions).toEqual([
      { correctionId: c.id, projectKey: c.projectKey, decisionId: "orca-dev-archived/7" },
    ]);
    expect(out.overturned).toEqual([]);      // 没有硬拒,函数正常返回
  });

  it("does not go to the archive at all for a correction the default scan already closed", async () => {
    const c = correction();
    const theIo = io({}, ["2026"]);
    await resolveOverturned(
      { repoPath: "/repo", projectKey: c.projectKey, corrections: [{ row: c }], scanned: { overturnedCorrectionIds: new Set([c.id]), decisionIds: new Set([c.decisionId]) } },
      theIo,
    );
    expect(theIo.asked).toEqual([]);          // spec §3.4.2:代价是【每条未闭环 correction】一次 stat
  });

  it("is pure: no node: import and no clock", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../../src/metrics/resolve.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+"node:/);
    expect(src).not.toMatch(/\bnew Date\s*\(/);
    expect(src).not.toMatch(/\bDate\.now\s*\(/);
  });
});
```

⚠️ **最后一条判据里 `import { join } from "node:path"` 在【判据】里，不在 `resolve.ts` 里** ——
`resolve.ts` 自己拼路径要用字符串拼接（`` `${repoPath}/.decisions/archive/${year}/${runId}.jsonl` ``），
**这是纯度的代价，登记，不掩饰**：它在 Windows 上不对，而本仓库 `package.json` 现测 `"os": ["darwin","linux"]`。

- [ ] **Step 2: 跑它，确认红**

- [ ] **Step 3: 实现**（要点，执行者按此写，不要发挥）

1. `CorrectionObservation` **携带整行 `Correction`** —— 🔴 **C6**：`deriveFixRunId` 是 `CORRECTION_FIELDS`
   全部七个字段（`projectKey`／`decisionId`／`kind`／`chose_instead`／`because`／`at`／`by`）的函数，
   *** **少一个就算不出同一个 `runId`，归档文件就找不到。** ***
2. `runId = deriveFixRunId(rowWithoutId, correction.id)`，basename ＝ `` `${runId}.jsonl` ``。
3. **只对 `scanned.overturnedCorrectionIds` 里没有的 correction** 去问归档。
4. **一层**：`io.listYearDirs(repoPath)` 拿年份目录名，对每个 `io.statFile(<repo>/.decisions/archive/<year>/<basename>)`。
   命中 0 ⇒ 仍算未闭环；命中 1 ⇒ `io.readFile` 它，取 `correctionId` 匹配的 `overturned`；
   命中 ≥2 ⇒ `throw new MetricsRejection(ARCHIVE_NAME_AMBIGUOUS, …)`，消息里列出全部路径。
5. `unresolvedDecisions`：`correction.decisionId` 不在 `scanned.decisionIds` 里 ⇒ 进该数组，按 `correctionId` 字典序。
6. 出口前把 `overturned` 按 `correctionId` 字典序排。

**注释里必须写下这段**（它是本任务存在的理由）：

```
 * spec §3.4.2, review finding C4.
 *
 * The fix rate's numerator comes from `overturned` rows, and `orca correct
 * --close` writes them into its OWN new run file (§1.11). That file ages like
 * any other and gets `git mv`'d into archive/. Once it does, the default scan
 * cannot see it, and a correction closed months ago reappears as backlog: the
 * fix rate drops and "age of the oldest open correction" reports one that is
 * not open. The failure points at "nobody is doing the work", which is the
 * worst possible direction for it to point.
 *
 * The cheap exact fix: deriveFixRunId is a pure function of the correction ROW,
 * and the file is named `<runId>.jsonl`. So for each correction with no
 * overturned in the default scan, compute the one filename it could be in and
 * ask for that one name.
 *
 * 🔴 ONE level, not a recursive walk. A' §3.7.1 item 2 says archiving moves a
 * run file into `.decisions/archive/<YYYY>/` — the depth is fixed upstream. A
 * recursive walk would be wider than needed AND would trade away §3.4.2's
 * stated cost ("one stat per open correction") for a whole-tree traversal per
 * repository, in a way a criterion that only checks which files were READ
 * cannot observe. That is why the io is injected and the criterion counts the
 * paths it was asked for.
```

- [ ] **Step 4: 跑判据，确认 6 条全绿**

- [ ] **Step 5: 🔴 变异 10 与变异 8**

| 变异 | 改什么 | 期望红在 |
|---|---|---|
| **10** | 归档查找整段跳过（未闭环的直接算未闭环） | `finds an overturned that archiving moved …` |
| ~~**10-宽**~~ | ⛔ *** **在本任务里写不出来，已挪到 Task 5。** *** `ArchiveIo` 只有 `listYearDirs`／`statFile`／`readFile` 三个原语，**`resolve.ts` 手里没有任何能列出子树的东西** ⇒ 递归走查在纯层根本表达不了 | 见 Task 5 Step 6 |

⚠️ 🔴 *** **v2 第一版把「偷偷买回全扫」的变异记在这一格，而它在这里不可能存在。** ***（第二席 I-1，控制器复核成立。）
*** **真正能把「一层」变成「全扫」的地方是 Task 5 的 `fsArchiveIo.listYearDirs`** *** —— 一个真 fs 的实现，
而纯层的假 io **看不见它**。⇒ 判据与变异都挪到 Task 5。
⇒ **本任务这条判据（`asks for exactly one path per year dir …`）仍然有价值**：它钉的是
*** **`resolve.ts` 每个年份目录只问一次、且问的是那一个派生出来的文件名** ***，**不是**「fs 侧有没有多走一层」。
**两件事，两个落点，别再混。**
| **8** | `unresolvedDecisions.push(...)` 改成 `throw new MetricsRejection(...)` | `reports a correction whose decision is outside …` |

⚠️ 🔴 *** **变异 10 会让【两条】都红，这是预期的，不是假红。** *** 跳过归档查找同时删掉了「去问」和「问对」两件事
（`theIo.asked` 变成 `[]`，而那条判据断言 `toHaveLength(3)`）。
**v2 第一版在这里写着「应仍然绿」—— 那是假的**（第二席 I-2，控制器现测复核成立）。
⇒ 若要一条只红一条的变异，用 **10-窄**：`statFile` 命中后**不 `readFile`**，此时 `asked` 仍是 3，只有
`finds an overturned that archiving moved …` 红。

- [ ] **Step 6: 收尾**（照抄）。提交主题行：
`feat(metrics): resolve archived fix runs by one derived name, as a function with no filesystem in it`

---

## Task 5: `collect.ts` —— 把 fs 接到纯层上，`--as-of` 过滤，两种未来行分开判

**Files:** Create `src/metrics/collect.ts`；Modify `src/metrics/types.ts`；Test `tests/metrics/collect.test.ts`

**Interfaces:**
- Produces:
  - `export { MetricsRejection } from "./rejection.js";` ← 🔴 **C5**：判据两条 import 路径都要通
  - `FUTURE_ROWS_WITHOUT_AS_OF = "future-rows-without-as-of"`、`AS_OF_NOT_A_TIMESTAMP = "as-of-not-a-timestamp"`
  - `Observations`（**字段表见下，Step 1 有一条机械核对步骤**）
  - `collect(opts: CollectOptions): Promise<Observations>`

### 🔴 `Observations` 的字段（**C5：这张表与实现必须逐字对齐**）

| 字段 | 类型 | 来自 |
|---|---|---|
| `asOf` | `string` | `--as-of` 或注入的 `now()` |
| `asOfMode` | `"explicit" \| "wall_clock"` | 有没有给 `--as-of` |
| `repos` | `DiscoveredRepo[]` | 🔴 **C7**：`discoverRepos` 的结果**必须整份带进来**，否则「有仓库、零决策」的乖仓库会从 `repos` 里消失 |
| `decisions` | `DecisionObservation[]` | 台账（**类型逐字写在本表下方**） |
| `corrections` | `CorrectionObservation[]` | store（**整行 `Correction`**） |
| `overturned` | `OverturnedObservation[]` | 台账 ＋ 归档定点查 |
| `excludedAsFuture` | `number` | `--as-of` 过滤掉的条数 |
| `unresolvedDecisions` | `UnresolvedDecision[]` | `resolveOverturned` |
| `unkeyableRepos` | `UnkeyableRepo[]` | `discoverRepos` |
| `malformed` | `MalformedLine[]` | 两个宽容读取器 |

⚠️ *** **没有 `lastLineLooksTorn`** *** —— I3 把 torn 记进了 `MalformedLine` 自身。

```typescript
/** 一条 decision,压平成指标需要的那几格。第二席 I-6:v2 第一版只在上表引用了这个名字,从未定义。 */
export interface DecisionObservation {
  projectKey: string;
  id: string;
  at: string;
  kind: DecisionKind;
  scope: DecisionScope;
  /**
   * spec §3.4: validateLine 的判决决定成员资格。`rejected` 的行不进分母(它不是
   * 合法记录);`downgraded` 的【进】分母(记录合法,只是这条决策不许 agent 拍 ——
   * A′ §1.1)。两者都【不是】坏行 —— 那是 C2 的整个论点。
   */
  verdict: "ok" | "downgraded";
}
```

- [ ] **Step 1: 🔴 先做一次机械核对（C5 的落点）**

写完 `Observations` 接口与 `collect` 的 `return` 之后，**跑这一条**，两个集合必须完全相等：

```bash
rtk proxy npx tsc --noEmit -p tsconfig.json > /tmp/tc.txt 2>&1; echo "TSC_RC=$?" >> /tmp/tc.txt; cat /tmp/tc.txt
```

⚠️ *** **v1 就是在这一格出的事**：接口少一个字段、`MetricsRejection` 没 re-export，
`npm run verify` 的第一步 `tsc` 直接红，而 v1 的 Self-Review 自称「逐个核过」。 ***
**「核过」是一条可被现测的断言 —— 不许写下它却不跑这条命令。**

- [ ] **Step 2: 写会失败的判据** —— `tests/metrics/collect.test.ts`

```typescript
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { withCorrectionsDir } from "../corrections/harness.js";   // 🔴 I4 / Rule 17
import { FUTURE_ROWS_WITHOUT_AS_OF, MetricsRejection, collect } from "../../src/metrics/collect.js";

const execFileAsync = promisify(execFile);

async function repoWithRemote(root: string, name: string, remote: string): Promise<string> {
  const path = join(root, name);
  await mkdir(join(path, ".decisions"), { recursive: true });
  await execFileAsync("git", ["init", "-q"], { cwd: path });
  await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: path });
  return path;
}

/**
 * M6 + I8:工厂逐字写出。
 * ⚠️ undo.how 现测必须含路径或 camelCase/snake_case,否则 undoHowIsExecutable 为 false
 * ⇒ validateLine 判 downgraded 而不是 ok。"git revert abc123" 就是这样,已现测。
 */
function decision(id: string, at: string, opts: { executable?: boolean; kind?: string } = {}): string {
  return JSON.stringify({
    ev: "decision", id, at, run: id.split("/")[0], question: "q", chose: "a",
    alternatives: [{ option: "b", why_not: "no" }], because: "r",
    undo: {
      how: opts.executable === false ? "看情况再说" : "git revert abc123 -- src/foo.ts",
      cost: "low", blast_radius: "one file",
    },
    scope: "repo", kind: opts.kind ?? "interface",
  });
}

describe("collect + --as-of (E2 spec §4.2, §5.1)", () => {
  it("filters rows newer than --as-of and reports how many", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      await writeFile(join(repo, ".decisions", "orca-dev-1.jsonl"),
        `${decision("orca-dev-1/1", "2026-01-01T00:00:00.000Z")}\n` +
        `${decision("orca-dev-1/2", "2099-01-01T00:00:00.000Z")}\n`);

      const obs = await collect({ root, repos: [], correctionsDir: store, asOf: "2026-06-01T00:00:00.000Z" });

      expect(obs.decisions.map((d) => d.id)).toEqual(["orca-dev-1/1"]);
      expect(obs.excludedAsFuture).toBe(1);
      expect(obs.asOfMode).toBe("explicit");
      expect(obs.asOf).toBe("2026-06-01T00:00:00.000Z");
      // 🔴 C7:仓库整份带进来,哪怕它零决策。
      expect(obs.repos.map((r) => r.projectKey)).toEqual(["github.com/biran/a"]);
    });
  });

  // 🔴 C7 的另一半:一个【有仓库、零决策】的乖仓库必须出现在 repos 里。
  it("keeps a repository with decisions=0 in repos — that is the one the scan exists to catch", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      await repoWithRemote(root, "empty", "https://github.com/biran/empty.git");

      const obs = await collect({ root, repos: [], correctionsDir: store, now: () => "2026-09-09T00:00:00.000Z" });
      expect(obs.repos.map((r) => r.projectKey)).toEqual(["github.com/biran/empty"]);
      expect(obs.decisions).toEqual([]);
    });
  });

  // 🔴 C2:rejected 与 downgraded 是两件事,而且都不是坏行。
  it("keeps a downgraded decision, drops a rejected one, and calls neither a malformed line", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      const rejected = JSON.stringify({ ev: "decision", id: "orca-dev-1/3" });   // 缺必填字段 ⇒ rejected
      await writeFile(join(repo, ".decisions", "orca-dev-1.jsonl"),
        `${decision("orca-dev-1/1", "2026-01-01T00:00:00.000Z")}\n` +
        `${decision("orca-dev-1/2", "2026-01-02T00:00:00.000Z", { executable: false })}\n` +
        `${rejected}\n`);

      const obs = await collect({ root, repos: [], correctionsDir: store, now: () => "2026-09-09T00:00:00.000Z" });

      expect(obs.decisions.map((d) => [d.id, d.verdict])).toEqual([
        ["orca-dev-1/1", "ok"], ["orca-dev-1/2", "downgraded"],
      ]);
      expect(obs.malformed).toEqual([]);        // ← v1 会把 rejected 那行报成坏行 ⇒ 红
    });
  });

  it("WITHOUT --as-of, a future row is a named refusal — not a silent skip", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      await writeFile(join(repo, ".decisions", "orca-dev-1.jsonl"),
        `${decision("orca-dev-1/1", "2099-01-01T00:00:00.000Z")}\n`);

      const error = await collect({
        root, repos: [], correctionsDir: store, now: () => "2026-09-09T00:00:00.000Z",
      }).then(() => { throw new Error("a row dated 2099 was accepted with no --as-of"); }, (e: unknown) => e);

      expect((error as MetricsRejection).code).toBe(FUTURE_ROWS_WITHOUT_AS_OF);
      expect((error as Error).message).toContain("orca-dev-1/1");
    });
  });

  // 🔴 变异 20 的【正向对照】。「读侧不取锁」是「什么都没发生」,不可能直接红。
  // 现测 storeLock.ts 的 STORE_LOCK_TIMEOUT_MS = 1_000 ⇒ 若读侧取了同一把锁,
  // 这里会在 ~1s 抛 CorrectRejection(exitCode 4),远早于 5000ms 超时 ⇒ 是抛错红,不是超时红。
  it("reads while the store lock is held — the read side takes nothing", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      const { withStoreLock } = await import("../../src/corrections/storeLock.js");

      let collected = false;
      await withStoreLock(store, async () => {
        await collect({ root, repos: [], correctionsDir: store, now: () => "2026-09-09T00:00:00.000Z" });
        collected = true;
      });
      expect(collected).toBe(true);
    });
  }, 5000);

  // 🔴 I-1(第二席):真正能把「一层定点查」偷偷变成「全扫」的地方【在这里】,不在纯层。
  // resolve.ts 只有三个原语,表达不了递归;而 fsArchiveIo.listYearDirs 是真 fs,
  // 把它写成递归 walk 就把 spec §3.4.2 的成本承诺换掉了,且纯层的假 io 看不见。
  // ⇒ 这条判据【正向观测遍历规模】。
  it("lists only the top level of archive/ — a nested dir must not become a year dir", async () => {
    await withCorrectionsDir(async () => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      const archive = join(repo, ".decisions", "archive");
      await mkdir(join(archive, "2026", "nested"), { recursive: true });
      await mkdir(join(archive, "2025"), { recursive: true });
      await writeFile(join(archive, "2026", "nested", "orca-fix-deadbeef.jsonl"), "");

      const { fsArchiveIo } = await import("../../src/metrics/collect.js");
      const years = await fsArchiveIo.listYearDirs(repo);

      expect(years).toEqual(["2025", "2026"]);                 // 恰好顶层两个
      for (const y of years) expect(y).not.toContain("/");     // 一个带 / 的项就是走深了
    });
  });

  it("carries every malformed line through, with its file and line", async () => {
    await withCorrectionsDir(async (store) => {
      const root = await mkdtemp(join(tmpdir(), "orca-metrics-root-"));
      const repo = await repoWithRemote(root, "a", "https://github.com/biran/a.git");
      await writeFile(join(repo, ".decisions", "orca-dev-1.jsonl"), `{ not json\n`);

      const obs = await collect({ root, repos: [], correctionsDir: store, now: () => "2026-09-09T00:00:00.000Z" });
      expect(obs.malformed).toHaveLength(1);
      expect(obs.malformed[0].line).toBe(1);
      expect(obs.malformed[0].torn).toBe(false);
    });
  });
});
```

- [ ] **Step 3: 实现要点**（执行者按此写）

1. `asOfMode = opts.asOf === undefined ? "wall_clock" : "explicit"`；`asOf = opts.asOf ?? (opts.now ?? (() => new Date().toISOString()))()`；
   `Number.isNaN(Date.parse(asOf))` ⇒ `MetricsRejection(AS_OF_NOT_A_TIMESTAMP, …)`。
2. 台账**只扫顶层 `*.jsonl`**（A′ §3.7.1 的默认，本刀不推翻别人的默认），排序后遍历。
3. 每条 `kind === "decision"` 的行：先按 `at` 过滤（未来行进 `future` 名单）；再 *** **`validateLine(row.raw)`** ***
   —— `rejected` ⇒ **跳过，不计**；`ok`／`downgraded` ⇒ 进 `decisions`，`verdict` 照记（spec §3.4）。
4. `overturned` 行同样先过滤，进 `scanned.overturnedCorrectionIds`。
5. corrections 走 `readCorrectionsLeniently(correctionsFile(opts.correctionsDir))`，同样按 `at` 过滤。
6. 🔴 **未来行的两种模式**：
   ```typescript
   if (asOfMode === "wall_clock" && future.length > 0) { throw new MetricsRejection(FUTURE_ROWS_WITHOUT_AS_OF, …); }
   ```
   消息里列出全部条目并说「Pass --as-of to ask what the numbers looked like at a chosen instant instead.」
   ⚠️ **消息不许说「时钟偏斜」以外的成因** —— spec §4.2 点名了 v0 那条消息说谎的形状。
7. 🔴 **闸门跑在【未过滤】的 store key 全集上**：一个纠正比 `--as-of` 新的 key 仍然指着一个该进分母的仓库，
   在这里藏起来会让闸门的沉默取决于一个 flag。
8. 逐仓库调 `resolveOverturned(…, fsArchiveIo)`，其中 *** **`fsArchiveIo` 必须 `export`**（判据要直接量它的遍历规模，见 Step 2 最后一条判据）***，
   它是本文件里唯一接 fs 的地方：
   `listYearDirs` ＝ `readdir(join(repo, ".decisions", "archive"), { withFileTypes: true })` 取目录名并 `.sort()`（ENOENT ⇒ `[]`）；
   `statFile` ＝ `stat(path).then(() => true, () => false)`；`readFile` ＝ `readFile(path, "utf8")`。
9. 出口前 `malformed.sort((a,b) => a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.line - b.line)`。

- [ ] **Step 4: 跑判据，确认 6 条全绿**

- [ ] **Step 5: 🔴 变异 5（两个方向）**

| 变异 | 把第 6 条的 `if` 改成 | 期望红在 |
|---|---|---|
| **5a** | `if (future.length > 0)`（给了 `--as-of` 也拒） | `filters rows newer than --as-of …` |
| **5b** | `if (false)`（没给 `--as-of` 也静默过滤） | `WITHOUT --as-of, a future row is a named refusal …` |

spec §8 第 5 条要求的正是「两条判据必有一条红」。**两次各自看到红。**

- [ ] **Step 6: 🔴 变异 3 与变异 10-宽**

**变异 10-宽（从 Task 4 挪来的，第二席 I-1）**：把 `fsArchiveIo.listYearDirs` 改成递归 walk，
返回 `["2025","2026","2026/nested"]`。
Expected: *** **红在 `lists only the top level of archive/ …` 上** ***（`years` 多出一项且含 `/`）。
⚠️ **这条变异在 Task 4 的纯层里写不出来** —— 那边的 io 是注入的假的。
*** **风险在真 fs 这一侧，判据也必须在这一侧。** ***

**变异 3 —— 让 `rejected` 也进分母**

把第 3 条里 `rejected ⇒ 跳过` 改成不跳过。
Expected: 红在 `keeps a downgraded decision, drops a rejected one …`。
⚠️ *** **这是 C2 的收益**：在 v1 的写法下这条变异【结构上不可能红】，因为那行根本到不了 `validateLine`。 ***

- [ ] **Step 7: 收尾**（照抄）。提交主题行：
`feat(metrics): let --as-of filter the input set instead of tripping the guard it was added for`

---

## Task 6: `compute.ts` ＋ **完整的输出形状** —— 口径的唯一持有者

**Files:** Modify `src/metrics/types.ts`（输出类型）；Create `src/metrics/compute.ts`；
Test `tests/metrics/compute.test.ts`、`tests/metrics/computePurity.test.ts`

🔴 **本任务是 C7 的落点。** v1 只写出一个嵌套类型就把其余交给执行者，而判据已经在引用
`caveats`／`stale_only.known_bias`／`review_coverage.available`／`backlog.oldest_correction_id` ——
*** **在 `MetricsReport` 逐字写出来之前，Task 8 的 golden 生成不了。** ***
**这正是 spec 外审判 `No` 的那个缺陷降一层重现，不许再降一层。**

- [ ] **Step 1: 🔴 把输出形状逐字写进 `src/metrics/types.ts`（12 个顶层字段，全部嵌套形状）**

```typescript
import type { DecisionKind } from "../ledger/types.js";
import type { CorrectionKind } from "../corrections/schema.js";
import type { DiscoveredRepo, UnkeyableRepo } from "./discover.js";

/**
 * spec §6: this is the interface E3 and E4 take away, so it cannot be empty and
 * it cannot depend on anyone's readdir order.
 *
 * 🔴 The names are load-bearing (§6 item 4). Two denominators live in here and
 * they are DIFFERENT SETS: the correction rate excludes `stale` from its
 * numerator (a stale correction is the world changing, not the agent being
 * wrong — A' §4.2 as corrected by A' ERRATUM 3), while the repair rate keeps
 * `stale` in its denominator (an unrepaired stale IS the backlog). Every field
 * carries its qualifier in its own name so no reader can subtract one from the
 * other and believe the result.
 */
export interface RepoSummary {
  projectKey: string;
  /** 🔴 Zero is a real, meaningful value here: a repository with decisions and
   *  no corrections is exactly the one §2.1's scan exists to find. */
  decisions: number;
}

export interface CorrectionRateSlice {
  kind: DecisionKind;
  tier: "high" | "low";
  numerator_corrections_excluding_stale: number;
  denominator_decisions: number;
  rate_excluding_stale: number | null;
}

export interface CorrectionRateBucket {
  bucket: string;                                     // cohort by decision.at, "YYYY-MM"
  numerator_corrections_excluding_stale: number;
  denominator_decisions: number;
  rate_excluding_stale: number | null;
  /**
   * 🔴 spec §3.3 requires an explicit per-bucket statement that a cohort bucket
   * is still filling in. A boolean would have to be a constant `true` — a
   * cohort bucket never closes, a decision from any month can be corrected
   * tomorrow — and a constant field is one no mutation can turn red. This
   * carries the as-of instead: the number is what was observable through this
   * instant, and re-running with a later --as-of can only raise it. It also
   * gives the "read the wall clock instead of as-of" mutation a place to land
   * in the golden diff.
   */
  counted_through: string;
}

export interface CorrectionRate {
  numerator_corrections_excluding_stale: number;
  denominator_decisions: number;
  rate_excluding_stale: number | null;                // null when the denominator is 0
  corrections_total_including_stale: number;
  by_decision_kind: CorrectionRateSlice[];            // DECISION_KINDS declaration order
  buckets: CorrectionRateBucket[];                    // bucket ascending
  caveats: string[];
}

export interface RepairRateBucket {
  bucket: string;                                     // cohort by correction.at, "YYYY-MM"
  numerator_overturned: number;
  denominator_corrections_including_stale: number;
  rate: number | null;
  counted_through: string;
}

export interface RepairRate {
  numerator_overturned: number;
  denominator_corrections_including_stale: number;
  rate: number | null;
  /**
   * spec §3.2.1 / A' ERRATUM 3: closing a `stale` needs a --chose-instead that
   * schema.ts says it may not have, so its repair rate is systematically low
   * and reads as "nobody is doing the work". Split out and labelled here; the
   * writer in E1 is NOT changed by this cut.
   */
  stale_only: {
    numerator_overturned: number;
    denominator_corrections: number;
    rate: number | null;
    known_bias: string;
  };
  buckets: RepairRateBucket[];
  caveats: string[];
}

export interface BacklogSlice {
  kind: CorrectionKind;
  open: number;
  oldest_age_ms: number | null;
}

export interface Backlog {
  open_corrections: number;
  oldest_age_ms: number | null;                       // wall clock, as_of minus correction.at
  oldest_correction_id: string | null;
  by_correction_kind: BacklogSlice[];                 // CORRECTION_KINDS declaration order
}

export interface CorrectionKindCount {
  kind: CorrectionKind;
  corrections: number;
}

/**
 * spec §3.5: this cut does not compute review coverage — its only producer is
 * the panel (E3). `available` is deliberately a constant until then, and what
 * is pinned is NOT this boolean but the caveat it forces into BOTH rates:
 * A' §4.4 says the correction rate must never be read alone.
 */
export interface ReviewCoverage {
  available: false;
  reason: string;
}

export interface MetricsReport {
  as_of: string;
  as_of_mode: "explicit" | "wall_clock";
  repos: RepoSummary[];                                          // projectKey ascending
  correction_rate: CorrectionRate;
  repair_rate: RepairRate;
  backlog: Backlog;
  breakdown_by_correction_kind_including_stale: CorrectionKindCount[];
  review_coverage: ReviewCoverage;
  excluded_as_future: number;
  unresolved_decisions: UnresolvedDecision[];                    // correctionId ascending
  unkeyable_repos: UnkeyableRepo[];                              // path ascending
  malformed_lines: MalformedLine[];                              // (file, line) ascending
}

/**
 * Serialization order comes from here, not from the object's own key order —
 * the same lever as CORRECTION_FIELDS in corrections/fields.ts, whose comment
 * says the `satisfies` constraint "buys a compile error" for a typo'd name.
 * Without a written-down order there is no byte-exact golden to diff against
 * (spec §6 item 1, review finding C2 on the spec).
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

- [ ] **Step 2: 写会失败的判据** —— `tests/metrics/compute.test.ts`

⚠️ **判据用手搓的 `Observations` 字面量，不碰 fs** —— 这本身就是「compute 是纯的」的一半证明。
⚠️ **I1：`OBS` 必须塞 2 个 repos ＋ 2 条 unkeyable ＋ 2 条来自【不同文件】的 malformed，且乱序给**
—— v1 把它们留成 `[]`，于是变异 17 的「打乱两次」判据在这两个唯一由目录顺序喂出来的集合上是**空转**。

```typescript
import { describe, expect, it } from "vitest";
import { deriveCorrectionId } from "../../src/corrections/fields.js";
import type { Correction } from "../../src/corrections/schema.js";
import { computeMetrics } from "../../src/metrics/compute.js";
import type { Observations } from "../../src/metrics/collect.js";

/** M6:两个工厂逐字写出。 */
function d(id: string, at: string, kind: string, scope: string, verdict: "ok" | "downgraded") {
  return { projectKey: "github.com/biran/a", id, at, kind, scope, verdict } as Observations["decisions"][number];
}
function c(decisionId: string, kind: Correction["kind"], at: string): { row: Correction } {
  const base = { projectKey: "github.com/biran/a", decisionId, kind, because: "理由", at, by: "amy" };
  return { row: { id: deriveCorrectionId(base), ...base } };
}

/**
 * 🔴 GHOST is the correction whose decision was never scanned. It has to exist
 * as a ROW, not only as an entry in unresolvedDecisions: mutation 9 moves a
 * correction INTO a kind bucket, and with no such row there is nothing for it
 * to move — `inBuckets` would be a constant and the criterion could not go red.
 * (Second review seat, C-1. The first draft of this OBS had the entry and not
 * the row, which is the "criterion is empty" failure this repo's Rule 9 names.)
 */
const GHOST = c("orca-dev-archived/7", "wrong", "2026-04-02T00:00:00.000Z");

export const OBS: Observations = {
  asOf: "2026-09-09T00:00:00.000Z",
  asOfMode: "explicit",
  // I1:乱序给,且含一个零决策的仓库(C7)。
  repos: [
    { projectKey: "github.com/biran/z-empty", path: "/z" },
    { projectKey: "github.com/biran/a", path: "/a" },
  ],
  decisions: [
    d("orca-dev-1/1", "2026-01-05T00:00:00.000Z", "interface", "repo", "ok"),
    d("orca-dev-1/2", "2026-01-06T00:00:00.000Z", "reconcile", "repo", "downgraded"),
    d("orca-dev-1/3", "2026-02-01T00:00:00.000Z", "dependency", "file", "ok"),
  ],
  corrections: [
    c("orca-dev-1/1", "wrong", "2026-03-01T00:00:00.000Z"),
    c("orca-dev-1/2", "stale", "2026-03-02T00:00:00.000Z"),
    c("orca-dev-1/3", "not_my_taste", "2026-04-01T00:00:00.000Z"),
    GHOST,                                   // decision 扫不到 —— 变异 9 的那条
  ],
  overturned: [],           // Step 2 收尾时按下面第 2 条判据填一条
  excludedAsFuture: 0,
  // 🔴 C3 / 变异 9 的落点:一条 decision 扫不到的 correction。
  unresolvedDecisions: [
    { correctionId: GHOST.row.id, projectKey: "github.com/biran/a", decisionId: "orca-dev-archived/7" },
  ],
  // I1:两条,乱序。
  unkeyableRepos: [
    { path: "/tmp/z-copy", reason: "not a URL" },
    { path: "/tmp/a-copy", reason: "not a URL" },
  ],
  // I1:两条,来自【不同文件】,乱序。
  malformed: [
    { file: "/repo/.decisions/z.jsonl", line: 3, bytes: 10, reason: "not valid JSON", torn: false },
    { file: "/repo/.decisions/a.jsonl", line: 1, bytes: 20, reason: "not valid JSON", torn: false },
  ],
};

describe("computeMetrics (E2 spec §3, §4.3)", () => {
  it("keeps stale OUT of the correction rate's numerator, and reports the total separately", () => {
    const r = computeMetrics(OBS, { bucket: "month" });
    expect(r.correction_rate.numerator_corrections_excluding_stale).toBe(3);   // wrong + not_my_taste + GHOST
    expect(r.correction_rate.corrections_total_including_stale).toBe(4);
  });

  it("keeps stale IN the repair rate's denominator — an unrepaired stale is the backlog", () => {
    const r = computeMetrics({ ...OBS, overturned: [{ correctionId: OBS.corrections[0].row.id, at: "2026-05-01T00:00:00.000Z" }] }, { bucket: "month" });
    expect(r.repair_rate.denominator_corrections_including_stale).toBe(4);
    expect(r.repair_rate.numerator_overturned).toBe(1);
  });

  // 变异 4 的【正向观测】——「downgraded 进分母」是「什么都不做」,删不掉。
  it("counts a downgraded decision in the denominator", () => {
    const r = computeMetrics(OBS, { bucket: "month" });
    expect(r.correction_rate.denominator_decisions).toBe(3);
  });

  // 变异 19 的加固形状:钉【年龄的字面毫秒数】,不只钉「跑出来了」。
  it("ages the backlog against as_of, in literal milliseconds", () => {
    const r = computeMetrics(OBS, { bucket: "month" });
    expect(r.backlog.open_corrections).toBe(4);
    expect(r.backlog.oldest_correction_id).toBe(OBS.corrections[0].row.id);
    expect(r.backlog.oldest_age_ms).toBe(
      Date.parse("2026-09-09T00:00:00.000Z") - Date.parse("2026-03-01T00:00:00.000Z"),
    );
  });

  it("buckets the correction rate by decision.at, not by correction.at", () => {
    const r = computeMetrics(OBS, { bucket: "month" });
    expect(r.correction_rate.buckets.map((b) => b.bucket)).toEqual(["2026-01", "2026-02"]);
    expect(r.correction_rate.buckets[0].denominator_decisions).toBe(2);
    expect(r.correction_rate.buckets[0].counted_through).toBe("2026-09-09T00:00:00.000Z");
  });

  // 🔴 C3 / 变异 9:扫不到的 correction 不进任何 decision.kind 桶。
  it("puts a correction whose decision was never scanned into NO decision-kind bucket", () => {
    const r = computeMetrics(OBS, { bucket: "month" });
    const inBuckets = r.correction_rate.by_decision_kind
      .reduce((n, s) => n + s.numerator_corrections_excluding_stale, 0);
    // 🔴 分子是 3(含 GHOST),而进桶的只有 2 —— 两个数【分开】才让变异 9 有落点。
    expect(r.correction_rate.numerator_corrections_excluding_stale).toBe(3);
    expect(inBuckets).toBe(2);                       // GHOST 不在任何 decision.kind 桶里
    expect(r.unresolved_decisions.map((u) => u.correctionId)).toEqual([GHOST.row.id]);
  });

  it("reports review coverage as unavailable and taints BOTH rates with the caveat", () => {
    const r = computeMetrics(OBS, { bucket: "month" });
    expect(r.review_coverage.available).toBe(false);
    expect(r.correction_rate.caveats.join(" ")).toContain("review coverage");
    expect(r.repair_rate.caveats.join(" ")).toContain("review coverage");
  });

  it("adds a second caveat when unresolved_decisions is non-empty", () => {
    const r = computeMetrics(OBS, { bucket: "month" });
    expect(r.correction_rate.caveats.join(" ")).toContain("unresolved");
  });

  it("splits stale's repair rate out and names the known bias", () => {
    const r = computeMetrics(OBS, { bucket: "month" });
    expect(r.repair_rate.stale_only.denominator_corrections).toBe(1);
    expect(r.repair_rate.stale_only.known_bias).toContain("chose_instead");
  });

  it("gives null, not 0, when a denominator is 0 — they are different claims", () => {
    const empty = computeMetrics({ ...OBS, decisions: [], corrections: [] }, { bucket: "month" });
    expect(empty.correction_rate.rate_excluding_stale).toBeNull();
    expect(empty.repair_rate.rate).toBeNull();
  });

  it("lets the rate exceed 1 rather than clamping — A' §4.4 counts corrections, and --again exists", () => {
    const twice = computeMetrics({
      ...OBS,
      decisions: [d("orca-dev-1/1", "2026-01-05T00:00:00.000Z", "interface", "repo", "ok")],
      corrections: [
        c("orca-dev-1/1", "wrong", "2026-03-01T00:00:00.000Z"),
        c("orca-dev-1/1", "wrong", "2026-03-02T00:00:00.000Z"),
      ],
      unresolvedDecisions: [],
    }, { bucket: "month" });
    expect(twice.correction_rate.rate_excluding_stale).toBe(2);
  });

  // 🔴 I7:粒度是纯函数参数,不是焊死的常量,也不是 CLI flag。
  it("takes the bucket granularity as an argument", () => {
    const r = computeMetrics(OBS, { bucket: "month" });
    expect(r.correction_rate.buckets[0].bucket).toMatch(/^\d{4}-\d{2}$/);
  });
});
```

`tests/metrics/computePurity.test.ts`：

```typescript
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../src/metrics/compute.js";
import { OBS } from "./compute.test.js";     // ⚠️ 若不便 export,就在本文件里照抄一份 OBS

describe("compute.ts is pure (E2 spec §5, §4.3)", () => {
  // 这条守的门有人走:任何人往 compute.ts 里加一行 readFile 或一次取时钟都会红。
  it("imports nothing from node: and reads no clock", async () => {
    const src = await readFile(new URL("../../src/metrics/compute.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+"node:/);
    expect(src).not.toMatch(/\bnew Date\s*\(/);
    expect(src).not.toMatch(/\bDate\.now\s*\(/);
    expect(src).not.toMatch(/\bperformance\.now\s*\(/);
  });

  it("is deterministic: the same observations twice give byte-identical JSON", () => {
    expect(JSON.stringify(computeMetrics(OBS, { bucket: "month" })))
      .toBe(JSON.stringify(computeMetrics(OBS, { bucket: "month" })));
  });
});
```

⚠️ **登记（不掩饰）**：这条纯度判据守得住 `node:` import 与三种时钟，**守不住经参数传进来的副作用函数**。
它是一条文本判据，不是类型系统的保证。

- [ ] **Step 3: 实现 `computeMetrics(obs, opts: { bucket: "month" })`**

**硬约束（逐条守）：**
- 文件顶部**不许有任何 `node:` import**；不许 `new Date()`／`Date.now()`／`performance.now()`；只允许 `Date.parse`。
- 分母为 0 ⇒ 率是 `null`，**不是 0**。
- 桶键 ＝ `at.slice(0, 7)`（`opts.bucket === "month"`）。**粒度只从参数来。**
- 纠正率分子**排除 `kind === "stale"`**；修复率分母**保留** `stale`。
- 一条 correction 的 `decisionId` 若在 `unresolvedDecisions` 里 ⇒ *** **不进任何 `by_decision_kind` 桶** ***（猜一个就是造假）。
- `caveats` 必含一句点名 review coverage 的话；`unresolvedDecisions` 非空时**再加一句含 `unresolved`**。
- 所有集合出口前排序：`repos` 按 `projectKey`；`by_decision_kind` 按 `KIND_ORDER`；
  `by_correction_kind` / breakdown 按 `CORRECTION_KINDS` 声明顺序；桶按 `bucket` 升序；
  `unresolved_decisions` 按 `correctionId`；`unkeyable_repos` 按 `path`；`malformed_lines` 按 `(file, line)`。

- [ ] **Step 4: 跑判据，确认 12 ＋ 2 条全绿**

- [ ] **Step 5: 🔴 六条变异（1／2／4／9／16／19），逐条看到红**
（**变异 3 不在这里** —— C2 之后 `rejected` 的判决点在 `collect` 的 `validateLine`，已挪到 Task 5 Step 6。）

| 变异 | 改什么 | 期望红在 |
|---|---|---|
| **1** | 删掉 `kind !== "stale"` 过滤 | `keeps stale OUT …`（分子 2→3） |
| **2** | 修复率分母也排除 stale | `keeps stale IN …`（分母 3→2） |
| **4** | ⚠️ 删不掉 ⇒ **靠正向观测**：把 `verdict === "downgraded"` 的排除掉 | `counts a downgraded decision …`（分母 3→2） |
| **9** | 把 `unresolvedDecisions` 里的 correction 塞进一个默认 kind 桶 | `puts a correction whose decision was never scanned …`（2→3） |
| **16** | 桶键换成 `correction.at.slice(0,7)` | `buckets the correction rate by decision.at …` |
| **19** | 年龄改成对 `new Date()` 算 | `ages the backlog against as_of …` **与** 纯度判据**两条都红** |

- [ ] **Step 6: 收尾**（照抄）。提交主题行：
`feat(metrics): compute both rates in one pure place, with the asymmetry written into the field names`

---

## Task 7: 渲染 —— 让 golden 写得出来，且不泄露人的原话

**Files:** Create `src/metrics/report.ts`；Test `tests/metrics/report.test.ts`

🔴 **本任务额外落地 C6 的另一半**：`CorrectionObservation` 现在携带整行 `Correction`，
其中 `because` 是**人的原话**（A′ §4.3 说它是全表对记忆层最值钱的字段）。
*** **一份指标报告是会被贴进聊天的东西 —— 它绝不能把人的原话带出去。** ***

**Interfaces:**
- Produces: `renderJson(report): string`（按 `METRICS_FIELDS` 排序，末尾一个 `\n`）、
  `renderTable(report): string`、`renderTiming(ms: number): string`（**调用方写 stderr**）

- [ ] **Step 1: 写会失败的判据** —— `tests/metrics/report.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { computeMetrics } from "../../src/metrics/compute.js";
import { METRICS_FIELDS } from "../../src/metrics/types.js";
import { renderJson, renderTable } from "../../src/metrics/report.js";
import { OBS } from "./compute.test.js";     // 或在本文件照抄一份

describe("report rendering (E2 spec §6)", () => {
  // 🔴 变异 17 的加固形状:在一台机器上「照绿」是这条判据的默认坏法
  // ⇒ 判据自己打乱【每一个】输入集合再跑,断言逐字节相同。
  // ⚠️ I1:OBS 的 repos / unkeyableRepos / malformed 各有 2 条,反转才不是恒等操作。
  it("is order-independent: reversing every input collection changes no byte of the JSON", () => {
    const a = renderJson(computeMetrics(OBS, { bucket: "month" }));
    const shuffled = {
      ...OBS,
      repos: [...OBS.repos].reverse(),
      decisions: [...OBS.decisions].reverse(),
      corrections: [...OBS.corrections].reverse(),
      unresolvedDecisions: [...OBS.unresolvedDecisions].reverse(),
      unkeyableRepos: [...OBS.unkeyableRepos].reverse(),
      malformed: [...OBS.malformed].reverse(),
    };
    expect(renderJson(computeMetrics(shuffled, { bucket: "month" }))).toBe(a);
  });

  it("serializes top-level keys in METRICS_FIELDS order, not the object's own", () => {
    expect(Object.keys(JSON.parse(renderJson(computeMetrics(OBS, { bucket: "month" })))))
      .toEqual([...METRICS_FIELDS]);
  });

  // M4:两条精确断言,不是一条互斥的正则。
  it("carries no scan-duration field — that quantity varies every run and would break the golden", () => {
    const json = renderJson(computeMetrics(OBS, { bucket: "month" }));
    expect(json).not.toContain("scan_ms");
    expect(json).not.toContain("duration_ms");
    expect(json).not.toContain("elapsed_ms");
  });

  it("keeps oldest_age_ms — it varies with as_of, not with the run", () => {
    expect(JSON.parse(renderJson(computeMetrics(OBS, { bucket: "month" }))).backlog)
      .toHaveProperty("oldest_age_ms");
  });

  // 🔴 C6 的另一半:人的原话不许进报告。
  it("never renders a correction's own words — `because` and `by` stay out of the report", () => {
    const json = renderJson(computeMetrics(OBS, { bucket: "month" }));
    expect(json).not.toContain("理由");        // OBS 的工厂把 because 写成「理由」
    expect(json).not.toContain("amy");         // by
    expect(json).not.toContain('"because"');
    expect(json).not.toContain('"by"');
  });

  it("the human table names the review-coverage caveat where a person will read it", () => {
    expect(renderTable(computeMetrics(OBS, { bucket: "month" }))).toContain("review coverage");
  });

  it("ends the JSON with exactly one newline, so a golden diff is stable", () => {
    const json = renderJson(computeMetrics(OBS, { bucket: "month" }));
    expect(json.endsWith("\n")).toBe(true);
    expect(json.endsWith("\n\n")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑它，确认红**

- [ ] **Step 3: 实现**

`renderJson` 用 `METRICS_FIELDS` 逐字段取值构造一个新对象再 `JSON.stringify(obj, null, 2) + "\n"`。
⚠️ **不许 `JSON.stringify(report)` 直接来** —— 那样字段序就是对象自身的 key 序（变异 17 的落点）。

- [ ] **Step 4: 跑判据，确认 7 条全绿**

- [ ] **Step 5: 🔴 变异 17 与 18**

| 变异 | 改什么 | 期望 |
|---|---|---|
| **17a**（**钉字段序**） | 去掉 `METRICS_FIELDS` 白名单，直接 `JSON.stringify(report, null, 2)`，**并把 `computeMetrics` 的 `return` 字面量按与 `METRICS_FIELDS` 不同的顺序重写** | `serializes top-level keys …` 红 |
| **17b**（**钉集合序 —— 这才是「打乱」判据的那条**） | 删掉 `compute.ts` 出口的 `repos.sort` / `unkeyable.sort` / `malformed.sort` 三处 | *** **`is order-independent …` 红** *** |

⚠️ 🔴 *** **v2 第一版把这两件事写成一条变异，而那条变异【一条判据都不会红】。** ***（第二席 C-2，控制器复核成立。）
两个独立的原因：
1. **集合序由 `compute` 出口的 `sort` 守，不是渲染层** ⇒ 只改渲染层，「打乱」判据照绿 ⇒ **必须有 17b。**
2. **`MetricsReport` 的字段声明序与 `METRICS_FIELDS` 逐字同序**，而执行者最自然的写法就是按接口顺序写 `return { … }`
   ⇒ 去掉白名单后 key 序**不变**，字段序判据也照绿 ⇒ **17a 必须【同时】打乱 `return` 字面量的顺序**。
⇒ **记法**：*** **一条变异要能红，先问「被删掉的那件事，是不是【唯一】在做它的那件事」。** *** 冗余守卫让变异静默。
| **18** | 🔴 **三处一起改**（`MetricsReport` 加 `scan_ms: number` ＋ `METRICS_FIELDS` 加 `"scan_ms"` ＋ `computeMetrics` 的 `return` 加 `scan_ms: 0`） | `carries no scan-duration field …` 红 |

⚠️ *** **只改一处到不了输出。** *** `renderJson` 按 `METRICS_FIELDS` 白名单逐字段取值 ⇒ 一个不在白名单里的
`scan_ms` **渲染不出来，判据照绿**；而 `METRICS_FIELDS` 上有 `as const satisfies readonly (keyof MetricsReport)[]`
⇒ 往里加名字不同时改 `MetricsReport` 就**编译不过**。
**这是 C7 买来的白名单挡住了变异 18** —— 第二席 Q2 撞出来的第三组（C7 × 变异 18）。

- [ ] **Step 6: 收尾**（照抄）。提交主题行：
`feat(metrics): pin the field order and keep the person's own words out of the report`

---

## Task 8: `orca metrics` 子命令 ＋ spec §7 那条端到端成功判据

**Files:** Modify `src/cli.ts`；Create `tests/metrics/cli.test.ts`、`tests/fixtures/metrics/golden.json`

🔴 **本任务落地 I3（exit 6 的判据）与 I4（复用既有 helper）。**

**Interfaces:** `orca metrics [--root <dir>] [--repo <key>=<path>]… [--as-of <ISO>] [--json]`

- [ ] **Step 1: 先把两个既有 helper 的真实签名抄准（I4）**

```bash
sed -n '298,304p' tests/scheduler/sandbox.ts     # captureStdout:async,返回 { result, stdout }
sed -n '18,40p'  tests/corrections/harness.ts    # withCorrectionsDir:Rule 17 的约定写法
```

⚠️ *** **v1 自造了一个 `captureStdout(() => …)` 返回 `{ code, text }` 的东西，与既有的签名不符。** ***
**照现测的签名写：`const { result, stdout } = await captureStdout(() => main([...]))`，`result` 就是退出码。**

- [ ] **Step 2: 建夹具 —— 逐条照 spec §7，并按 C2 修正**

```
两个一次性 git 仓库(mkdtemp 下,绝不在本仓库树内),各 `git remote add origin https://…`
  ⚠️ 必须显式加:git init 无 remote ⇒ TARGET_HAS_NO_REMOTE;
     git clone --local 的 remote 是路径式 ⇒ TARGET_REMOTE_NOT_KEYABLE(spec §1.8)
各有【已知条数】的 decision,含:
  - 一条 undo.how 可执行的 ⇒ ok
  - 一条 undo.how 不可执行的 ⇒ downgraded   ⚠️ I8:"git revert abc123" 现测判 downgraded,
                                              可执行的要写成 "git revert abc123 -- src/foo.ts"
  - 🔴 C2 修正:一条 schema 不合法的 decision ⇒ validateLine 判 rejected ⇒ 不进分母,
    【且不是坏行】⇒ 这条夹具不影响 exit 0
其中一条被一条真的 overturned 推翻,且那条 overturned 所在的 fix run 文件被 `git mv`
  进 archive/<YYYY>/(钉 §3.4.2 与 I2 的一层查)
corrections 目录由 withCorrectionsDir 提供,已知条数的 correction,含一条 stale
```

⚠️ *** **绝不让任何 `--root` 覆盖到本仓库或它的 clone 副本** *** —— 副本 remote 是路径式，会以
`unkeyable_repos` 的身份出现在你自己的 golden 里。

- [ ] **Step 3: 写判据**

```typescript
it("matches the golden byte for byte", async () => {
  await withCorrectionsDir(async (store) => {
    const root = await buildFixture(store);
    const { result, stdout } = await captureStdout(() =>
      main(["metrics", "--root", root, "--as-of", "2026-09-09T00:00:00.000Z", "--json"]));
    expect(result).toBe(0);
    expect(stdout).toBe(await readFile(GOLDEN, "utf8"));
  });
});

it("① the integrity gate: a store key neither mechanism resolves ⇒ exit 1", …);
it("② one projectKey on two paths ⇒ exit 1", …);
it("③ no --as-of and a row dated 2099 ⇒ exit 1", …);

// 🔴 spec §7 ④ + spec §8 第 6 条的加固形状。
it("④ a corrupt MIDDLE line ⇒ exit 6, AND the report still prints in full", async () => {
  await withCorrectionsDir(async (store) => {
    const root = await buildFixture(store, { corruptMiddleLine: true });
    const { result, stdout } = await captureStdout(() =>
      main(["metrics", "--root", root, "--as-of", "2026-09-09T00:00:00.000Z", "--json"]));
    expect(result).toBe(6);
    // ⚠️ 只断言退出码的话,把 §5.2 改回硬拒【也会绿】。必须断言 stdout 非空。
    expect(stdout.length).toBeGreaterThan(0);
    expect(JSON.parse(stdout).malformed_lines).toHaveLength(1);
  });
});

// 🔴 I3:torn 记在行上,所以这两条能各自成立。
it("a torn LAST line in the store is exit 0 and says a write may be in flight", async () => { … expect(result).toBe(0); });
it("a torn store tail AND a corrupt ledger middle line together are still exit 6", async () => { … expect(result).toBe(6); });

// 🔴 I4 / Rule 17:CLI 必须认改道。
it("reads the corrections store ORCA_CORRECTIONS_DIR points at, not the real ~/.orca", async () => {
  await withCorrectionsDir(async (store) => {
    // 往 store 写一条 correction,断言它出现在报告里 ⇒ 证明改道生效
  });
});
```

- [ ] **Step 4: 改 `src/cli.ts`**

- USAGE 加第六行（照既有格式）
- `main` 加 `if (command === "metrics") return runMetrics(rest);`
- `runMetrics` 用 *** **`correctionsDir(process.env)`** ***（`src/corrections/paths.ts` 现测它是**函数**，读取时求值）
- 接住 `MetricsRejection` ⇒ 打 `rejected: <code>: <message>`、返回 `err.exitCode`（1）
- 🔴 **I3 的退出码规则**：*** **先整份打印报告**，再看 `malformed_lines` 里**有没有至少一条 `torn === false`**；有 ⇒ 返回 6，否则 0 ***
- 耗时：`performance.now()` 前后差 ⇒ `process.stderr.write` —— **永不进 stdout**

- [ ] **Step 5: 生成 golden 并【整份人眼读一遍】再写死**

```bash
set -u
# 1) 夹具必须【确定性】:固定 id、固定 at、固定路径基名。否则 golden 与判据永远差一个路径字符串。
STORE=$(mktemp -d); ROOT=$(mktemp -d)
node scripts-scratch/build-metrics-fixture.mjs "${ROOT:?root unset}" "${STORE:?store unset}"   # 见 Step 2
# 2) 目录先建 —— tests/fixtures/ 现测只有 ledger/,没有 metrics/,`>` 会直接失败
mkdir -p tests/fixtures/metrics
# 3) 🔴 必须改道。src/corrections/paths.ts 现测:correctionsDir(env) 在没有
#    ORCA_CORRECTIONS_DIR 时回落到 join(homedir(), ".orca") —— 那是使用者的真实数据。
ORCA_CORRECTIONS_DIR="${STORE:?store unset}" rtk proxy npx tsx src/cli.ts metrics \
  --root "${ROOT:?root unset}" --as-of 2026-09-09T00:00:00.000Z --json \
  > tests/fixtures/metrics/golden.json 2>/tmp/stderr.txt
cat tests/fixtures/metrics/golden.json     # ⚠️ 整份读,逐个数对着夹具的已知条数核
cat /tmp/stderr.txt                        # 耗时应当【只】出现在这里
/bin/rm -rf "${STORE:?store unset}" "${ROOT:?root unset}"
```

⚠️ 🔴 *** **v2 第一版这条命令没有 `ORCA_CORRECTIONS_DIR`。** ***（第二席 C-3，控制器复核成立。）
两个后果：**(a)** 在**任何有 `~/.orca` 的机器上**，它会把使用者真实的 projectKey 与条数读进一个要提交进仓库的 golden，
或被完整性闸门直接硬拒 —— *** **Rule 17 防的是「判据碰真实用户数据」，读也算** ***；
**(b)** 判据跑在 `withCorrectionsDir` 给的临时 store 里，与生成 golden 用的 store **不是同一个**
⇒ **golden 结构上不可能逐字节匹配**，Task 8 的成功判据无法达成。
⚠️ **`buildFixture` 必须同时被判据与本步调用**（判据里 import 它，本步用一个薄脚本调它），**不许写两份**。

⚠️ *** **golden 是判据的一半，写死一个错数字等于把 bug 变成规范。** ***

- [ ] **Step 6: 🔴 变异 6 —— §5.2 改回硬拒**

🔴 **两条变异，形状不同，各自看到红**（第二席 I-3：v2 第一版只写了第二条，而它的红点**到不了**点名的断言 ——
`expect(result).toBe(6)` 排在前面会先炸，`stdout.length` 那行永远不执行）。

| 变异 | 改什么 | 期望红在 |
|---|---|---|
| **6a**（**spec §8 第 6 条真正要的加固形状**） | *** **仍然返回 6，只把 `process.stdout.write(renderJson(...))` 那一行删掉** *** | *** **`expect(stdout.length).toBeGreaterThan(0)`** *** —— 退出码断言此时是绿的，所以红点必然落在它上面 |
| **6b** | 改成「直接返回 1，不打印」（§5.2 改回硬拒） | `expect(result).toBe(6)` —— **这条会先炸，是预期的** |

⚠️ *** **「只断言退出码会照绿」这句话对 6b 【不成立】** *** —— 它是从 spec §8 第 6 条原样抄来的，
而 spec 说的是「把 §5.2 改回硬拒」这一类里**保住退出码**的那一支。**先例不要外推：抄一句话之前，
把它拿到自己写的那条变异上跑一遍。**

- [ ] **Step 7: 收尾**（照抄）。⚠️ 本任务收尾额外做一件：`git ls-remote` 之后，
若本轮改过任何**已发布**文件，用 `git diff <远端sha>..HEAD -- <文件>` 自查（M2：`ls-remote` 只给 sha，判就地改要 diff）。
提交主题行：`feat(cli): add orca metrics, the sixth subcommand, reading everything and writing nothing`

---

## 已知边界与登记项（**执行完照抄进收尾文档，不掩饰**）

1. **cohort 桶粒度是 `computeMetrics` 的纯函数参数**，默认 `"month"`，无 CLI flag（I7）。
2. **`--root` 之外、且没被 `--repo` 指出的仓库仍会被漏掉**（spec §10 第 2 项）—— 闸门只发现「有纠正但找不到」，
   *** **发现不了「有决策、零纠正、且两条机制都没覆盖」的乖仓库** ***。
3. **`stale` 的修复率系统性偏低**（spec §3.2.1／A′ ERRATUM 3）—— 本刀只拆开输出并标注，**不改 E1 的生产代码**。
4. **审阅覆盖率无数据**，两个率都带显式标注（spec §3.5）。`review_coverage.available` 是**有意的常量**，
   承重的是它逼进两个率的那句 caveat，不是这个布尔本身。
5. **归档定点查只覆盖 `overturned`**（spec §10 第 6 项），且**只查 `archive/<YYYY>/` 一层**（A′ §3.7.1）。
   若将来归档改成多层，这里会静默漏掉 —— **登记，不掩饰**。
6. **`compute.ts` / `resolve.ts` 的纯度靠一条【读源码文本】的判据守**，不是类型系统。
   它守得住 `node:` import 与三种时钟，**守不住经参数传进来的副作用函数**。
7. **`resolve.ts` 用字符串拼路径**（为了零 `node:path` import），在 Windows 上不对；
   本仓库 `package.json` 现测 `"os": ["darwin","linux"]`，**在此边界内成立**。

---

## 第二席外派评审（**2026-09-09，判 `Ready to implement? No`；本文已按它逐条修正**）

**报告原文与控制器复核**：`.superpowers/sdd/2026-09-09-metrics-core-e2/external-review-2.md`
它审的是**修法本身**：22 条修法逐条判定（**16 条现测修好**），并按要求做了修法之间的两两对撞。

**它抓到的、本文已修的**（每条都经控制器现测复核）：

| | 发现 | 本文的修正 |
|---|---|---|
| **C-1** | 变异 9 **结构上不可能红** —— `OBS.unresolvedDecisions` 有条目，`OBS.corrections` 里却没有对应的行 | 新增 `GHOST` 行，并让「分子 3」与「进桶 2」两个数**分开** |
| **C-2** | 变异 17 是**空操作** —— 集合序由 compute 的 `sort` 守、字段序两处同序 | 拆成 **17a／17b** 两条，各自有落点 |
| **C-3** | golden 生成命令**读使用者真实的 `~/.orca`**，且与判据不是同一个 store ⇒ golden 结构上对不上 | 改道 ＋ 同一个 `buildFixture` ＋ `mkdir -p` |
| **I-1** | 变异「10-宽」在纯层**写不出来**；真风险在 Task 5 的 `fsArchiveIo` | 判据与变异一起挪到 Task 5，并 `export fsArchiveIo` |
| **I-2** | 变异 10 的「另一条应仍绿」**为假**（`asked` 变 `[]` ⇒ 必红） | 改成「两条都红是预期的」，并给出只红一条的 **10-窄** |
| **I-3** | 变异 6 点名的断言**到不了**（退出码断言先炸） | 拆成 **6a**（保住退出码只删打印）与 **6b** |
| **I-4** | M5 第二步正文与代码块**互相矛盾** | 改成「两个独立副本」，并补 `diff` 证明 |
| **I-5** | 变异 18 被 C7 的白名单**挡在输出之外** | 改成 `MetricsReport` ＋ `METRICS_FIELDS` ＋ `return` **三处一起改** |
| **Minor 1–8** | `OBS` 未 export；`<占位符>` 是重定向；checklist 里的管道；一句假注释；`2>&1` 混进二进制流；`null` 行抛 TypeError；`opts` 必填与「默认」矛盾；两处计数标签 | 全部已改 |

🔴 *** **本轮最该被继承的一条**（I-2 与 I-3 是同一个形状）：
**在计划里写下「应当红／应当绿」，就是写下一条【预言】。而本文第一版的两条预言现测都是假的，
且都会【主动把执行者引向错误结论】** —— 按纪律「红在别处＝假红」，执行者会回去改没坏的代码。 ***
⇒ **记法：每写一条「期望红在 X」，就把那条变异在脑内跑到底，问「在 X 之前有没有别的断言会先炸」。**

---

## Self-Review

**1. Spec coverage** —— 逐节对照：

| spec 节 | 落在哪 |
|---|---|
| §2.1 仓库发现 ／ §2.1.1 四种坏情况 | Task 3 |
| §3.1 两个 kind 切法 ／ §3.2 不对称 ／ §3.2.1 已知偏差 | Task 6 |
| §3.3 cohort ＋ 单报积压 | Task 6（`counted_through` ＋ `bucket` 参数） |
| §3.4 边界情形 | Task 5（rejected／downgraded）＋ Task 6（`--again` 可超 100%） |
| §3.4.1 决策扫不到 ／ §3.4.2 归档定点查 | Task 4（纯层）＋ Task 5（fs 接线）＋ Task 6（不进桶） |
| §3.5 不算覆盖率 ＋ 显式标注 | Task 6 |
| §3.6 高位穷尽分类 | Task 1 |
| §4.1 时钟分工 ／ §4.2 `--as-of` ／ §4.3 `now` 注入 | Task 8（耗时走 stderr）＋ Task 5（§4.2）＋ Task 6（§4.3） |
| §5 模块边界 ／ §5.1 不取锁 ／ §5.2 坏行 ／ §5.3 只给读侧 | File Structure ＋ Task 5（§5.1 正向对照）＋ Task 2／8（§5.2）＋ Task 2（§5.3） |
| §6 输出形状四条 | Task 6（`MetricsReport` ＋ `METRICS_FIELDS`）＋ Task 7（排序、耗时、命名） |
| §7 成功判据 | Task 8 |
| §8 二十一条变异 | **1,2,4,9,16,19→T6；3,5,10-宽,20→T5；6a/6b→T8；7(两处),21→T2；8,10→T4；11,12,13→T3；14,15(两步)→T1；17a/17b,18(三处一起改)→T7** |
| §10 登记项 | 「已知边界」节 |

⚠️ **变异 3 从 T6 挪到了 T5** —— C2 之后 `rejected` 的判决点在 `collect` 里（`validateLine`），不在 compute。

**2. Placeholder scan** —— 逐项扫过：
- `d(...)`／`c(...)` 工厂**已在 Task 6 逐字写出**（M6）。
- Task 8 的 `buildFixture` 与四条 fail-loud 判据体仍写作 `…`。⚠️ **这是本文剩下的唯一一处真占位** ——
  执行者必须照 Task 5 的 `repoWithRemote`／`decision` 工厂**照抄一份进 `tests/metrics/cli.test.ts`**，
  **不跨文件 import 夹具**（任务可能乱序执行）。**登记，不掩饰。**
- Task 6／7 的判据从 `./compute.test.js` import `OBS`；若不便 export，**在本文件照抄一份**（已在正文写明）。

**3. Type consistency** —— ⚠️ *** **这一项在 v1 是【自称核过、现测为假】的那一项。** ***
本文的做法不是再声明一次「核过」，而是把它变成一条**可跑的命令**：
**Task 5 Step 1 是一条 `tsc --noEmit` 的独立步骤**，且 `Observations` 的字段以**表格**形式写在同一节，
与实现的 `return` 逐字对照。**`METRICS_FIELDS` 的 `as const satisfies readonly (keyof MetricsReport)[]` 是第二道**：
字段名打错会编译不过。

**4. 🆕 Shell scan（v1 缺的那一项，C1 就是从这里漏掉的）** —— *** **两问，不是一问。** ***

**第一问：变量未赋值时它展开成什么？**（C1 那一类）
- **每个变异是一个自包含代码块**，`T=$(mktemp -d)` 与用到它的每一行都在同一块内；
- **每处销毁写作 `/bin/rm -rf "${T:?clone root unset}"`** —— 变量为空时 `:?` 直接退出，不会展开成 `.`；
- **每段开头 `set -u`**；
- **没有任何一处用管道过滤 `rtk` 的输出**（I6）；
- 观测工作树一律 `git status --porcelain -z` ＋ python 按 NUL 切（M1：`git diff` 看不见未跟踪文件）。

**第二问：有没有 `<` 或 `>` 出现在不是重定向的位置？**（第二席 Minor 2 那一类）
⚠️ *** **第一问结构上看不见第二问** *** —— `<占位符>` 里根本没有变量。
⇒ 本文所有 `<…>` 形状的 shell 占位符已全部换成 `"${VAR:?msg}"`。

**这两问都写成了可跑的命令，不是一句「扫过了」**（v1 正是自称「核过」而现测为假）：

```bash
python3 - <<'SCAN'
import re
lines = open('docs/superpowers/plans/2026-09-09-metrics-core-and-query-v2.md').read().splitlines()
blocks, cur = [], None
for i, l in enumerate(lines, 1):
    if l.strip().startswith('```bash'): cur = [i, []]
    elif l.strip() == '```' and cur: cur.append(i); blocks.append(cur); cur = None
    elif cur is not None: cur[1].append((i, l))
bad = 0
for start, body, end in blocks:
    txt = '\n'.join(l for _, l in body)
    for n, l in body:
        if re.search(r'\brm -rf\b', l):
            ok = ('T=$(mktemp' in txt) and ('${T:?' in l) and ('/bin/rm' in l)
            if not ok: print('Q1 BAD', n, l.strip()); bad += 1
        # ⚠️ 先剥掉行内注释再判 —— 否则这一段【自己写的警告文字】就会把扫描器点着,
        #    而一个对自己的注释报警的扫描器会被读的人忽略掉。
        code = l.split('#', 1)[0]
        if re.search(r'<[^<>|]{1,40}>', code) and '2>&1' not in code:
            print('Q2 BAD', n, l.strip()); bad += 1
print('BAD_COUNT =', bad)
SCAN
```
