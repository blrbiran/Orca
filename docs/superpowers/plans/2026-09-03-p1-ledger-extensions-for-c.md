# P1：A′ 决策台账的三处扩展（为子系统 C 让路）—— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 C 写下第一条台账记录**之前**，把 A′ 的三处不可后补的扩展做完：`bound` 事件的 `taskId`/`runId` 字段、写入方的两条新检查、新增 `reconcile` 决策 kind。

**Architecture:** 全部落在 `src/ledger/**` 这一层。**顺序由「哪一处后补不上」决定，不由 spec 的行文顺序决定**：先把散在代码里的重复清单收敛成单一来源（否则后面每一步都会漏改一处），再落写入侧的格式（台账只追加，格式错过就永远补不上），最后才是可以随时加的消费侧与枚举。

**Tech Stack:** TypeScript / Node ≥ 20 / vitest / zod（既有依赖，见 `src/ledger/schema.ts:1`）

**Spec:** `docs/superpowers/specs/2026-09-03-scheduler-design.md` §5.5、§8.2、§8.4②
**上游 spec（A′）:** `docs/superpowers/specs/2026-08-29-decision-ledger-design.md` §3.3、§3.6、§3.8

---

## Global Constraints

| # | 约束 | 出处 |
|---|---|---|
| G1 | **`npm run verify` 必须始终 exit 0。** 开工基线（本计划写下时现测）：`7 files / 100 tests` 全绿，末三行 `ok: 3 ledger file(s)` ／ `ok: CLAUDE.md is 135/200 lines` ／ `ok: core.hooksPath is scripts/githooks` | 本会话现测 |
| G2 | **每新增一个分支，点名那条删掉【它自己】的变异，并确认它存在且被【看见】红。** 「绿」本身可能是空的 | `CLAUDE.md` Rule 9 推论 1 |
| G3 | **排在被测调用【之前】、读回测试自己刚写进去的值的断言，永远不可能红。** 验收任何判据改写时先扫这个形状 | `CLAUDE.md` Rule 9 推论 2 |
| G4 | **绝不过滤验证性跑。** `grep`/`tail`/`head`/`sed` 都算过滤，管道还会吞退出码 ⇒ 一律重定向到文件再整份读回 | `CLAUDE.md` Rule 14 |
| G5 | **变异只在 `git clone --local` 副本里做**，主工作树全程零触碰；还原证明用 `shasum -a 256` 前后比对，**不用 `git diff` 管道到 `wc -c` 的那套**（实测：`git diff` 对未跟踪文件的内容改动完全看不见） | `CLAUDE.md` Rule 15 ＋ handoff 现测 |
| G6 | **本机 `rm`／`cp` 都有 `-i` alias** ⇒ 一律 `/bin/rm -rf` 和 `cat pristine > target` | handoff 方法论 7 |
| G7 | **验证性 git 命令走裸 `/usr/bin/git`，不走 rtk** —— rtk 会漏掉 HEAD 那一笔 | handoff 2026-08-29 节第 2 条 |
| G8 | **改代码／注释按【整行锚点 ＋ 命中数 ==1 否则退出】**，子串替换会在句子中间切开段落 | handoff 方法论 3 |
| G9 | **push／合并 main／删分支或 worktree 每次单独找人。** 本计划全程不 push | `CLAUDE.md` Rule 15 |
| G10 | 代码、注释、commit message **一律英文**；本计划正文中文 | 2026-09-01／09-02 语言约定 |
| G11 | **spec 与 plan 都是已发布文本** ⇒ 发现它们写错了**只能追加具名 ERRATUM，不许就地改** | `CLAUDE.md` Rule 13 |
| G12 | **本轮新做的决策落 `.decisions/orca-dev-<本会话 id>.jsonl`，不许混进上一轮的文件**，且**全部经 `appendEvent` 落盘，不许手写** | handoff 2026-09-01 节 |

---

## 🔴 开工前的普查结论（**已做完，2026-09-03 现测于 Orca `43bcb96`**）

spec §5.5 明写「实施时第一步是做一次『白名单／清单在代码里有几份副本』的普查」。**已做，结论如下**，
口径 `/usr/bin/grep -rn -E "bound|superseded|overturned|correction" src/` ＋ 五个源文件整份读回。

### 结论一：引用事件清单（`bound`/`superseded`/`overturned`）在 `src/` 里有 **4 处**，其中 **1 处是真副本**

| # | 位置 | 形状 | 是不是副本 |
|---|---|---|---|
| 1 | `src/ledger/schema.ts:46` `REFERENCE_EVENT_TYPES` | `["bound","superseded","overturned"] as const` | **单一来源**（注释自称如此） |
| 2 | `src/ledger/schema.ts:55` | `z.enum(REFERENCE_EVENT_TYPES)` | 派生，✅ 不是副本 |
| 3 | `src/ledger/validateFile.ts:15` | `new Set<string>(REFERENCE_EVENT_TYPES)` | 派生，✅ 不是副本 |
| 4 | *** `src/ledger/validateLine.ts:45` *** | 三个字符串字面量组成的 OR 链 | 🔴 **硬编码的第四份，真副本** |

⇒ **handoff 的预警属实，且到 `43bcb96` 仍然成立。** 它是**路由条件**不是白名单，所以**加第 4 种引用事件**时会咬人 ——
但本计划不加第 4 种。**它真正咬人的时刻是 Task 2**：`bound` 需要一份**与 `superseded`/`overturned` 不同**的 schema，
而「按 ev 分流到不同 schema」的代码**正好就是这条 OR 链**。⇒ **Task 1 先把它收敛，再动 Task 2。**

### 结论二：决策 kind 清单在 `src/` 里**只有一份**，但**测试里有第二份**

| # | 位置 | 是不是副本 |
|---|---|---|
| 1 | `src/ledger/types.ts:1-8` `DECISION_KINDS` | 单一来源 |
| 2 | `src/ledger/schema.ts:31` `z.enum(DECISION_KINDS)` | 派生，✅ |
| 3 | *** `tests/ledger/validateLine.test.ts:84` *** —— `for (const kind of [...六个字面量...])` | 🔴 **硬编码的第二份，在判据里** |

⇒ 🔴 *** **这是一处对 spec §5.5 前提的更正**：spec 担心的是「加 `reconcile` 时第四份清单会咬人」，
但第四份清单是**引用事件**的，**不是 kind 的**。加 `reconcile` 在 `src/` 里是**一行改动**。 ***
⇒ **真正的风险在测试侧**：那个循环写死了 6 个 kind，加第 7 个**不会红，只会静默不覆盖** ——
正是「绿是空的」那个形状。**Task 4 必须把它改成从 `DECISION_KINDS` 派生。**

### 结论三：两条待补检查的现状（**本仓库现有台账全部合格，所以两条检查都不会打破现状**）

口径：python3 逐行解析三个 `.decisions/*.jsonl`。

| 量 | 值 |
|---|---|
| `decision` 事件总数 | **40**（09cc3ea1 7 条 ／ cd28ef61 13 条 ／ 8d4c6ba3 20 条） |
| `run` 字段与文件名**不一致**的 | **0** |
| 文件内**重复的 decision id** | **无** |
| `bound` 事件总数 | **7**（全在 `orca-dev-09cc3ea1.jsonl`） |
| 其中缺 `taskId`／`runId` 的 | *** **7 / 7** *** |

### 🔴 结论四：**两条既有判据会被 Task 2 打红，而且是设计正确时也会红**

| 判据 | 它做什么 | 为什么会红 |
|---|---|---|
| `tests/ledger/validateLine.test.ts:137` `accepts every non-empty line in .decisions/orca-dev-09cc3ea1.jsonl` | 逐行校验本仓库自己的台账 | 若把 `taskId`/`runId` 设成 **schema 必需**，7 条历史 `bound` 全部变 rejected |
| *** `tests/ledger/writer.test.ts:173` `feeding each line through appendEvent reproduces .decisions/orca-dev-09cc3ea1.jsonl byte for byte` *** | **把那 14 行逐条喂进 `appendEvent` 重放** | 🔴 *** **即使 schema 里设成可选、只在写入方要求，这条也会红** *** —— 它重放的正是那 7 条没有新字段的历史 `bound` |

⇒ *** **「schema 可选 ＋ 写入方必需」这个直觉上安全的方案，并不安全。** ***
⇒ **Task 2 必然要动一条既有的承重判据**，这需要人单独点头。**见本文末尾「执行前必须拿到的人类点头」。**

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/ledger/schema.ts` | zod schema ＋ 引用事件名的单一来源 | **Modify**（Task 1 加导出、Task 2 拆 `bound` 的 schema） |
| `src/ledger/validateLine.ts` | 单行的检查 1/2/3/4 ＋ 按 `ev` 路由 | **Modify**（Task 1 消灭第四份副本、Task 2 让 `bound` 走自己的 schema） |
| `src/ledger/writer.ts` | 唯一写入口，fail-closed | **Modify**（Task 2 加 `bound` 字段要求、Task 3 加两条检查） |
| `src/ledger/types.ts` | kind／scope 枚举 ＋ `ValidationResult` | **Modify**（Task 4 加 `reconcile`） |
| `tests/ledger/validateLine.test.ts` | 单行判据 | **Modify**（Task 1／2／4） |
| `tests/ledger/writer.test.ts` | 写入方判据 | **Modify**（Task 2／3；**含一条既有判据的改写，见结论四**） |
| `docs/superpowers/specs/2026-09-03-scheduler-design.md` | C 的 spec | **Modify**（Task 5 追加一条具名 ERRATUM —— 更正 §5.5 关于"第四份清单"的前提） |

⚠️ **明确不碰**：`src/ledger/validateFile.ts`（它已经从单一来源派生，无需改）、`src/ledger/appendOnly.ts`、
`src/ledger/undoExecutable.ts`、`src/cli.ts`、`scripts/**`、`.decisions/**` 里**已经写下的任何一行**。

---

## 本计划自己做的 5 条决策

| # | 决策 | 为什么 | 撤销 |
|---|---|---|---|
| **D1** | **任务顺序改为 T1（消灭副本）→ T2（`bound` 字段）→ T3（写入方两条检查）→ T4（`reconcile`）**，而不是 spec §8.2 建议的「`reconcile` ＋ 两条检查合成一个任务排最前」 | 普查结论二：`reconcile` 在 `src/` 里是一行改动、无副本风险，**没有理由排最前**；而结论一说明**副本必须先消灭**，否则 T2 会在那条 OR 链上翻车。spec 的排序依据是它写作时**尚未做过普查**的假设 | 顺序是执行顺序，任何时候可重排 |
| **D2** | **`taskId`/`runId` 在 schema 里对 `bound` 是【必需】的，不是可选** | 结论四已经证明「可选 ＋ 写入方必需」同样会打红那条重放判据 ⇒ 两条路都要动既有判据，**那就选语义更真的那条**：一条没有 `taskId` 的 `bound` 就是不合格的 `bound` | `git checkout <基点> -- src/ledger/schema.ts src/ledger/validateLine.ts` |
| **D3** | **`superseded`／`overturned` 不加这两个字段** | spec §8.4② 只要求 `bound`。**不做没被要求的事**（Rule 2），且它们不承担"哪个任务实现了它"这个语义 | 同上 |
| **D4** | **两条既有判据改写成「记录新的真事实」，不是删掉** | 那 7 行历史 `bound` 确实不再是当前写入方能产出的东西 —— **这是真的，不是回归**。判据改成断言「决策行仍逐字节重放成功，7 条历史 bound 被具名拒绝」，dogfood 属性保住，且**新要求反而被真实历史数据钉住了** | `git checkout <基点> -- tests/ledger/*.test.ts` |
| **D5** | **给 C 的 spec 追加一条具名 ERRATUM**，更正 §5.5 关于"第四份清单会在加 `reconcile` 时咬人"的前提 | spec 是已发布文本（G11），不许就地改；但把一个已知为假的前提留着不管，下一轮会照着它排错任务顺序 | 删掉那一节追加（追加本身可逆） |
| **D6** | **`verify` 成为退出码 2 的第一个消费者**，并同时加一条判据把这份宽容收窄到那 7 行 | 人 2026-09-03 选定 (a) 路。⚠️ **光放行 2 是净松闸门** —— 日后任何降级（例如 `undo.how` 写成散文）都会被静默放过。**放行与收窄必须同一笔落地**，否则中间会存在一个"verify 什么降级都不管"的窗口 | 把 `package.json:15` 的那一步改回 `&&` 直连 |

---

## Task 1: 消灭第四份引用事件清单

**Files:**
- Modify: `src/ledger/validateLine.ts:45`
- Modify: `src/ledger/schema.ts`（新增一个导出的类型守卫）
- Test: `tests/ledger/validateLine.test.ts`（只加）

**Interfaces:**
- Consumes: 既有 `REFERENCE_EVENT_TYPES`（`schema.ts:46`）、`referenceEventSchema`（`:53`）
- Produces: `export function isReferenceEventName(ev: unknown): ev is ReferenceEventName`
  ＋ `export type ReferenceEventName = (typeof REFERENCE_EVENT_TYPES)[number]`

- [ ] **Step 1: 写下会红的判据**

追加到 `tests/ledger/validateLine.test.ts`：

```ts
import { REFERENCE_EVENT_TYPES } from "../../src/ledger/schema.js";

describe("validateLine routes every reference event name from the single source", () => {
  // Iterating the constant rather than listing names is the whole point: a
  // fourth hard-coded copy of this list used to live in validateLine's router,
  // which meant a name could be in REFERENCE_EVENT_TYPES and still fall
  // through to "unknown ev". A test that spelled the three names out would
  // have stayed green through exactly that bug.
  for (const ev of REFERENCE_EVENT_TYPES) {
    it(`accepts a minimal ${ev} record`, () => {
      expect(validateLine(JSON.stringify({ ev, id: "run-7c/3" })).verdict).toBe("ok");
    });
  }

  it("every name in REFERENCE_EVENT_TYPES is routed away from the unknown-ev branch", () => {
    for (const ev of REFERENCE_EVENT_TYPES) {
      const result = validateLine(JSON.stringify({ ev }));
      // Missing id, so this must be rejected — but rejected by the reference
      // schema for the missing field, never by the router for an unknown ev.
      expect(result.verdict).toBe("rejected");
      expect(result.verdict === "rejected" ? result.reasons.join(" ") : "").not.toContain("unknown ev");
    }
  });
});
```

⚠️ **第二条判据是本任务的承重那条** —— 第一条（逐个接受）在改造前也是绿的，因为三个名字恰好一致。
**只有第二条能在「清单加了第 4 个名字但 OR 链没跟上」时打红。**

- [ ] **Step 2: 跑，确认第二条判据当前是【绿】的，并确认它【能】红**

```bash
cd /Users/biran/code/skills/loop/Orca
npm test -- --run tests/ledger/validateLine.test.ts > /tmp/p1-t1-a.txt 2>&1; echo "RC=$?"; cat /tmp/p1-t1-a.txt
```

🔴 **这是本任务最重要的一步。** 新判据现在**会绿**（三个名字本来就一致）⇒ **一条没红过的判据不是判据**（G2）。
⇒ 立刻在**副本**里做一次证明它承重的变异（**副本流程见本任务 Step 5**）：

在副本的 `src/ledger/schema.ts` 把 `REFERENCE_EVENT_TYPES` 加上第四个成员 `"retracted"`，**其余一字不动**，然后跑：

```bash
cd /tmp/p1-mut && npm test -- --run tests/ledger/validateLine.test.ts > /tmp/p1-t1-proof.txt 2>&1; echo "RC=$?"; cat /tmp/p1-t1-proof.txt
```

**期望：红，且红在 `every name in REFERENCE_EVENT_TYPES is routed away from the unknown-ev branch`，
理由里含 `unknown ev`。** 这就证明了第四份副本是真的、且这条判据能看见它。
**看到红之后还原副本，再回主树做 Step 3。**

- [ ] **Step 3: 改造 —— 让路由从单一来源派生**

`src/ledger/schema.ts`，在 `referenceEventSchema` 之后追加：

```ts
export type ReferenceEventName = (typeof REFERENCE_EVENT_TYPES)[number];

const REFERENCE_EVENT_NAMES: ReadonlySet<string> = new Set(REFERENCE_EVENT_TYPES);

/**
 * The router in validateLine used to spell these three names out again, which
 * made REFERENCE_EVENT_TYPES a source of truth for the schema but not for the
 * routing — a fourth name could be added to the constant and still be answered
 * with "unknown ev". Deriving the predicate here keeps the two in step by
 * construction rather than by anyone remembering to update both.
 */
export function isReferenceEventName(ev: unknown): ev is ReferenceEventName {
  return typeof ev === "string" && REFERENCE_EVENT_NAMES.has(ev);
}
```

`src/ledger/validateLine.ts`：先确认锚点唯一（G8）。用 `grep -c` 数那一行整行的命中数，
**必须打印 `1`；不是 1 就停下来报人。** 然后把该整行换成：

```ts
  if (isReferenceEventName(ev)) {
```

并把首行 import 改为：

```ts
import { decisionEventSchema, isReferenceEventName, referenceEventSchema } from "./schema.js";
```

- [ ] **Step 4: 跑，确认全绿**

```bash
cd /Users/biran/code/skills/loop/Orca
npm run verify > /tmp/p1-t1-verify.txt 2>&1; echo "VERIFY_RC=$?"; cat /tmp/p1-t1-verify.txt
```

期望 exit 0，测试数 = 基线 **100 + 4**（3 条 `accepts a minimal X record` ＋ 1 条路由判据）。

- [ ] **Step 5: 点名变异（副本流程）**

```bash
cd /Users/biran/code/skills/loop/Orca
/bin/rm -rf /tmp/p1-mut && /usr/bin/git clone --local . /tmp/p1-mut > /tmp/p1-clone.txt 2>&1; echo "RC=$?"
# clone 只含已提交状态 ⇒ 把本任务尚未提交的文件覆盖过去，并证明逐字节相同
for f in src/ledger/schema.ts src/ledger/validateLine.ts tests/ledger/validateLine.test.ts; do
  cat "$f" > "/tmp/p1-mut/$f"; diff "$f" "/tmp/p1-mut/$f" && echo "IDENTICAL $f"
done
( cd /tmp/p1-mut && npm ci ) > /tmp/p1-mut-install.txt 2>&1; echo "INSTALL_RC=$?"
```

| 变异 | 怎么改（在副本里） | 必须红的那条 |
|---|---|---|
| **M1-1** 🔴 | 把 `isReferenceEventName(ev)` 换回硬编码 OR 链，**并**给 `REFERENCE_EVENT_TYPES` 加第 4 个名字 `"retracted"` | `every name in REFERENCE_EVENT_TYPES is routed away from the unknown-ev branch` |
| **M1-2** | 让 `isReferenceEventName` 恒返回 `false` | 3 条 `accepts a minimal X record` 全红 |
| **M1-3** | 让 `isReferenceEventName` 恒返回 `true` | 既有那条「拒绝未知 ev」的判据必须红（**判据名以现测为准**） |

**M1-3 存在的理由**：只有 M1-2 的话，一个恒真的谓词也能让本任务的新判据全绿 —— **必须两个方向各有一条**。

每条跑完整份读回，还原用 `cat 主树文件 > 副本文件`（**不要用 `git checkout`**，它是从索引恢复，
且对未提交的新文件报 `pathspec did not match` 并且什么都不还原）。

- [ ] **Step 6: 主树零触碰证明 ＋ 删副本 ＋ Commit**

```bash
cd /Users/biran/code/skills/loop/Orca
for f in src/ledger/schema.ts src/ledger/validateLine.ts tests/ledger/validateLine.test.ts; do
  diff "/tmp/p1-mut/$f" "$f" && echo "COPY_MATCHES_TREE $f"
done
shasum -a 256 src/ledger/*.ts > /tmp/p1-t1-sha.txt; cat /tmp/p1-t1-sha.txt
/bin/rm -rf /tmp/p1-mut
/usr/bin/git add src/ledger/schema.ts src/ledger/validateLine.ts tests/ledger/validateLine.test.ts
/usr/bin/git commit -m "refactor(ledger): derive the reference-event router from its single source

validateLine spelled the three reference event names out again, so
REFERENCE_EVENT_TYPES was the source of truth for the schema but not for the
routing: a fourth name could be added to the constant and still be answered
with 'unknown ev'. The criterion iterates the constant, so it goes red under
exactly that divergence."
```

---

## Task 2: `bound` 必须带 `taskId` 与 `runId`

🔴 **这是整份计划里唯一不能延后的一条。台账只追加 —— 格式错过就永远补不上。**

**Files:**
- Modify: `src/ledger/schema.ts`（拆出 `boundEventSchema`）
- Modify: `src/ledger/validateLine.ts`（`bound` 走自己的 schema）
- Modify: `tests/ledger/validateLine.test.ts`（**改写既有判据 1 条**，见 D4）
- Modify: `tests/ledger/writer.test.ts`（**改写既有判据 1 条**，见 D4）
- Modify: `package.json:15`（verify 串接受台账那一步的退出码 2 —— **人 2026-09-03 选定的 (a) 路**）
- Test: `tests/ledger/validateFile.test.ts`（新增「本仓库台账里唯一允许的降级」那条精确判据）

**Interfaces:**
- Consumes: Task 1 的 `isReferenceEventName`
- Produces:
  - `export const boundEventSchema` —— 在 `referenceEventSchema` 之上追加
    `taskId: z.string().min(1)` 与 `runId: z.string().min(1)`；`export type BoundEvent = z.infer<typeof boundEventSchema>`
  - `validateLine` 对 **`bound` 且【唯一的问题】就是缺 `taskId`／`runId`** 的那一类，返回
    `{ verdict: "downgraded", tier: 0, reasons: [...] }` 而不是 `rejected`

🔴 **降级不等于放行。** `appendEvent` 对 `rejected` 与 `downgraded` **两者都抛**（`writer.ts:26-33`）
⇒ *** **写入侧的硬要求一点没松：C 写一条没有 `taskId` 的 `bound` 照样写不进去。** ***
降级只改变**读历史**时的语义 —— 那 7 行不是非法记录，是**归属信息不足以自动使用，得交给人**，
这正是 `ValidationResult` 三态里 `downgraded` 的原义（`types.ts:15-21` 的注释）。

- [ ] **Step 1: 先把两条既有判据的【当前】行为量出来并留档**

```bash
cd /Users/biran/code/skills/loop/Orca
npm test -- --run tests/ledger/validateLine.test.ts tests/ledger/writer.test.ts > /tmp/p1-t2-before.txt 2>&1; echo "RC=$?"
cat /tmp/p1-t2-before.txt
```

再把那两条既有判据**整条读回**留档（用 `grep -n` 现测行号，再 `sed -n 'a,bp'` 取整段）。
⚠️ **行号会移动**（Task 1 刚在这两个文件里加过内容）⇒ **以现测为准，不许照抄本文的行号**。

- [ ] **Step 2: 写下会红的新判据**

追加到 `tests/ledger/validateLine.test.ts`：

```ts
describe("bound events must name the task and run that implemented them", () => {
  // Why the fields exist at all: `git blame` on a bound line answers "which
  // commit implemented this", and a squash merge destroys that answer while
  // keeping the line. taskId/runId answer the question people actually ask —
  // "which task implemented this" — with an identifier no history rewrite can
  // touch. They are required now because a ledger is append-only: a field the
  // format never had cannot be backfilled onto lines already written.
  it("accepts a bound carrying taskId and runId", () => {
    const result = validateLine(JSON.stringify({
      ev: "bound", id: "run-7c/3", taskId: "t-4", runId: "orca-dev-abc123",
    }));
    expect(result.verdict).toBe("ok");
  });

  it("downgrades a bound whose only problem is a missing taskId", () => {
    // Downgraded, not rejected: such a line is not malformed, it just cannot
    // say which task implemented the decision, so nothing may act on its
    // attribution automatically. Every bound written before the field existed
    // has exactly this shape and can never be repaired — the ledger is
    // append-only. The writer still refuses to append one (it throws on
    // downgraded as well as on rejected), so this loosens reading history
    // without loosening anything about writing.
    const result = validateLine(JSON.stringify({ ev: "bound", id: "run-7c/3", runId: "orca-dev-abc123" }));
    expect(result.verdict).toBe("downgraded");
    expect(result.verdict === "downgraded" ? result.reasons.join(" ") : "").toContain("taskId");
  });

  it("downgrades a bound whose only problem is a missing runId", () => {
    const result = validateLine(JSON.stringify({ ev: "bound", id: "run-7c/3", taskId: "t-4" }));
    expect(result.verdict).toBe("downgraded");
    expect(result.verdict === "downgraded" ? result.reasons.join(" ") : "").toContain("runId");
  });

  it("rejects — does not downgrade — a bound that is broken in any other way", () => {
    // The downgrade is narrow on purpose. A bound with no id is malformed, not
    // merely unattributable, and widening the downgrade to every bound problem
    // would quietly turn a hard rejection into a warning.
    expect(validateLine(JSON.stringify({ ev: "bound", taskId: "t-4", runId: "r-1" })).verdict).toBe("rejected");
    expect(validateLine(JSON.stringify({ ev: "bound", id: "run-7c/3", taskId: 4, runId: "r-1" })).verdict).toBe("rejected");
    expect(validateLine(JSON.stringify({ ev: "bound", id: "", taskId: "t-4" })).verdict).toBe("rejected");
  });

  it("still accepts superseded and overturned without those fields", () => {
    // Deliberately not tightened: only bound carries "which task implemented
    // this". Requiring the fields everywhere would be scope this plan has no
    // authority to take.
    expect(validateLine(JSON.stringify({ ev: "superseded", id: "run-7c/3" })).verdict).toBe("ok");
    expect(validateLine(JSON.stringify({ ev: "overturned", id: "run-7c/3" })).verdict).toBe("ok");
  });
});
```

追加到 `tests/ledger/writer.test.ts`：

```ts
describe("appendEvent refuses a bound that cannot say which task implemented it", () => {
  it("throws and writes not one byte", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-a", DECISION_FIXTURE);
    const before = await readFile(join(dir, "run-a.jsonl"), "utf8");

    // The verdict for this shape is `downgraded`, not `rejected` — and the
    // writer throws on both. That is the point: reading old history got
    // gentler, writing new history did not. Matching on the reason text rather
    // than the verdict word keeps this criterion pinned to the requirement
    // instead of to which of the two refusal paths carries it.
    await expect(
      appendEvent(dir, "run-a", { ev: "bound", id: DECISION_FIXTURE.id }),
    ).rejects.toThrow(/taskId/);

    // Measure the bytes directly rather than trusting the throw: a writer that
    // threw after appending would still satisfy `rejects.toThrow`.
    expect(await readFile(join(dir, "run-a.jsonl"), "utf8")).toBe(before);
  });
});
```

⚠️ **`DECISION_FIXTURE` 与 `tempDir()` 用该文件既有的那两个** —— **开工第一步整份读回 `tests/ledger/writer.test.ts`**，
照它现成的名字来，不要照抄本文。
⚠️ **`rejects.toThrow` 之后那条读字节的断言是承重的**：它排在被测调用**之后**，读的是磁盘而不是测试自己刚写进去的值（G3）。

- [ ] **Step 3: 跑，确认它红**

```bash
cd /Users/biran/code/skills/loop/Orca
npm test -- --run tests/ledger/validateLine.test.ts tests/ledger/writer.test.ts > /tmp/p1-t2-red.txt 2>&1; echo "RC=$?"; cat /tmp/p1-t2-red.txt
```

期望：3 条新的 bound 判据红（`rejects a bound with no taskId` 等），写入方那条红。

- [ ] **Step 4: 实现**

`src/ledger/schema.ts`，在 `referenceEventSchema` 之后追加：

```ts
/**
 * bound is the one reference event that answers "which task implemented this
 * decision". Its two extra fields are required rather than optional because
 * the ledger is append-only: an optional field is one an agent will omit, and
 * the omission can never be repaired on a line already written. superseded and
 * overturned keep the looser shape — they do not carry that question.
 */
export const boundEventSchema = referenceEventSchema.extend({
  taskId: z.string().min(1),
  runId: z.string().min(1),
});

export type BoundEvent = z.infer<typeof boundEventSchema>;
```

`src/ledger/validateLine.ts`，把 Task 1 落下的那个引用事件分支改成：

```ts
  if (isReferenceEventName(ev)) {
    // bound carries two extra required fields; the other reference events do
    // not. Picking the schema by name here is why the router had to stop
    // spelling the names out (Task 1) — this is the branch that needs to tell
    // them apart.
    const schema = ev === "bound" ? boundEventSchema : referenceEventSchema;
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
      // A bound whose *only* complaints are the two attribution fields is not
      // malformed — it is a line written before the fields existed, and the
      // ledger being append-only it can never acquire them. Tier 0 is the
      // honest verdict: a human, not an agent, has to say which task this
      // belongs to. Anything else wrong with the record is still a rejection;
      // widening this would quietly turn hard failures into warnings.
      if (ev === "bound" && issuesAreOnlyMissingAttribution(result.error.issues)) {
        return { verdict: "downgraded", tier: 0, reasons: issues };
      }
      return rejected(issues);
    }
    return { verdict: "ok" };
  }
```

并在同文件（`validateLine.ts`）加上这个私有谓词：

```ts
const ATTRIBUTION_FIELDS = new Set(["taskId", "runId"]);

/**
 * True only when every issue zod raised is "this attribution field is absent".
 * A wrong-typed taskId, an empty runId, or any problem on another field all
 * fall through to a rejection, so the downgrade cannot widen by accident.
 */
function issuesAreOnlyMissingAttribution(issues: readonly z.ZodIssue[]): boolean {
  return (
    issues.length > 0 &&
    issues.every(
      (i) =>
        i.code === "invalid_type" &&
        i.received === "undefined" &&
        i.path.length === 1 &&
        typeof i.path[0] === "string" &&
        ATTRIBUTION_FIELDS.has(i.path[0]),
    )
  );
}
```

并把 import 补上 `boundEventSchema` 与 `z`（`import { z } from "zod";`）。

⚠️ *** **`i.received === "undefined"` 这个判别必须现测，不许照抄。** *** zod 的 issue 形状随版本变
（本仓库锁的是 `zod ^3.23.8`，`package.json:20`）。**先写一个一次性探针把真实的 issue 对象打印出来再定谓词** ——
本仓库栽过「探针没被验证之前它的输出不是证据」这个坑三次。

- [ ] **Step 5: 🔴 改写那两条既有判据（D4）—— 每一条都要写明它现在编码的是什么**

**5a.** `tests/ledger/validateLine.test.ts` 的 `accepts every non-empty line in .decisions/orca-dev-09cc3ea1.jsonl`：

```ts
  it("accepts every decision line in .decisions/orca-dev-09cc3ea1.jsonl, and downgrades the seven bound lines that predate the attribution fields", () => {
    // Rewritten by P1 Task 2 (human ruling 2026-09-03). The original asserted
    // every line validates ok. That stopped being true the moment bound began
    // requiring taskId/runId, and it stopped being true *correctly*: those
    // seven lines predate the fields and, the ledger being append-only, can
    // never acquire them. Asserting the new fact keeps this criterion doing
    // its original job — running the validator against real data rather than
    // hand-made fixtures, the gap that let .strict() reject all seven real
    // decisions while 34 criteria stayed green — and additionally pins the new
    // requirement against real history.
    const lines = readFileSync(
      new URL("../../.decisions/orca-dev-09cc3ea1.jsonl", import.meta.url),
      "utf8",
    ).split("\n").filter((l) => l.trim().length > 0);

    const results = lines.map((l) => ({ line: l, result: validateLine(l) }));
    const decisions = results.filter(({ line }) => JSON.parse(line).ev === "decision");
    const bounds = results.filter(({ line }) => JSON.parse(line).ev === "bound");

    expect(decisions.length).toBe(7);
    expect(bounds.length).toBe(7);
    for (const { result } of decisions) {
      expect(result.verdict).toBe("ok");
    }
    for (const { result } of bounds) {
      expect(result.verdict).toBe("downgraded");
      expect(result.verdict === "downgraded" ? result.reasons.join(" ") : "").toContain("taskId");
    }
  });
```

**5b.** `tests/ledger/writer.test.ts` 的 `feeding each line through appendEvent reproduces … byte for byte`：
改成**只重放 7 条 decision 行**并比字节，另加一条断言「重放第一条 bound 行会抛且提到 `taskId`」。
**逐字保留原判据里的字节比对断言**，只把喂进去的行集从 14 行收窄到 7 行，并在注释里写明为什么。

⚠️ **验收这两条改写时先扫 G3 那个形状**：断言若排在被测调用之前、读的是测试自己刚写进去的值，**它永远不可能红**。
⚠️ **`.decisions/orca-dev-09cc3ea1.jsonl` 一个字节都不许改** —— 它是已发布的历史。

- [ ] **Step 6: 让 verify 接受台账那一步的退出码 2 —— 并同时钉死"只允许这一处降级"**

**人 2026-09-03 已在两条路里选定 (a)**：让 `validate` 对那 7 行报 **downgraded（退出码 2）而非 rejected**。
备选 (b)（把历史文件移进 `.decisions/archive/`）**已被否，不要再考虑**。

先跑一次看现状：

```bash
cd /Users/biran/code/skills/loop/Orca
npm run ledger -- validate .decisions > /tmp/p1-t2-ledger.txt 2>&1; echo "LEDGER_RC=$?"; cat /tmp/p1-t2-ledger.txt
npm run verify > /tmp/p1-t2-verify.txt 2>&1; echo "VERIFY_RC=$?"; cat /tmp/p1-t2-verify.txt
```

**期望：`LEDGER_RC=2`**（Step 4 的降级分支已经把 1 变成了 2），**而 `VERIFY_RC` 非 0** ——
因为 `package.json:15` 的 verify 串是 `&&` 连的，**`&&` 把 2 和 1 一样地当成停**
（handoff 已登记：「退出码 2 目前没有任何消费者」）。

**6a. 改 `package.json:15` 的 verify 串**，把台账那一步换成：

```
(npm run ledger -- validate .decisions || [ $? -eq 2 ])
```

⚠️ **先确认锚点唯一**（G8）：`grep -c` 数 `npm run ledger -- validate .decisions` 在 `package.json` 里的命中数，**必须为 1**。
⚠️ *** **`verify` 从此成为退出码 2 的第一个消费者。** *** handoff 那句「别把那几条判据读成『已经有人在用它』」
**从这一笔起不再成立** —— 要在本轮台账里记一条决策登记这个变化。

**6b. 🔴 光放行 2 是【松了闸门】—— 必须同时加一条判据把它收窄回来**

放行退出码 2 意味着**任何**降级都不再让 verify 红：**日后某条决策的 `undo.how` 写成散文（检查 3 判降级），
verify 会静默放过它。** 这正是本仓库最贵的那类错。

⇒ 新增到 `tests/ledger/validateFile.test.ts`：

```ts
describe("the only downgrade this repository's own ledgers may contain", () => {
  it("is the seven pre-attribution bound lines in orca-dev-09cc3ea1.jsonl, and nothing else", async () => {
    // verify now tolerates exit code 2 from the ledger step, which on its own
    // would let any future downgrade through in silence — a decision whose
    // undo.how is prose, say. This criterion is what keeps that tolerance
    // narrow: it names the exact set of downgraded lines the repository is
    // allowed to carry, so an eighth one is a red test rather than a warning
    // nobody reads.
    const dir = new URL("../../.decisions/", import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort();

    const downgraded: string[] = [];
    for (const file of files) {
      const text = await readFile(new URL(file, dir), "utf8");
      const verdict = validateFile(text.split("\n"));
      for (const line of verdict.lines) {
        if (line.result.verdict === "downgraded") downgraded.push(`${file}:${line.lineNumber}`);
      }
      expect(verdict.lines.filter((l) => l.result.verdict === "rejected")).toEqual([]);
    }

    expect(downgraded).toEqual([
      "orca-dev-09cc3ea1.jsonl:8",
      "orca-dev-09cc3ea1.jsonl:9",
      "orca-dev-09cc3ea1.jsonl:10",
      "orca-dev-09cc3ea1.jsonl:11",
      "orca-dev-09cc3ea1.jsonl:12",
      "orca-dev-09cc3ea1.jsonl:13",
      "orca-dev-09cc3ea1.jsonl:14",
    ]);
  });
});
```

⚠️ **那 7 个行号是现测值**（`orca-dev-09cc3ea1.jsonl` 共 14 行，前 7 行 decision、后 7 行 bound，本计划开工时逐行数过）
—— **执行时先现测一遍再写进去**，别照抄。
⚠️ **这条判据会随本轮新增台账文件而需要更新**（新文件里不该有任何降级 ⇒ 它自然仍绿）。
**它红的时候几乎总是真的发现了东西，不要顺手改期望值。**

**6c. 跑 verify，期望 exit 0**

```bash
cd /Users/biran/code/skills/loop/Orca
npm run verify > /tmp/p1-t2-verify2.txt 2>&1; echo "VERIFY_RC=$?"; cat /tmp/p1-t2-verify2.txt
```

期望 exit 0，且输出里**能看到那 7 行 `downgraded to tier 0`** —— **看得见的降级才是降级**。

- [ ] **Step 7: 点名变异**

| 变异 | 怎么改 | 必须红的那条 |
|---|---|---|
| **M1-4** 🔴 | 把 `boundEventSchema` 里 `taskId` 那一行删掉 | `downgrades a bound whose only problem is a missing taskId` ＋ 写入方那条 ＋ 改写后的历史台账判据 ＋ Step 6b 的精确判据 |
| **M1-5** | 把 `taskId` / `runId` 改成 `.optional()` | 同上 |
| **M1-6** | 把路由里的 `ev === "bound" ? boundEventSchema : referenceEventSchema` 改成恒用 `boundEventSchema` | `still accepts superseded and overturned without those fields` |
| **M1-13** 🔴 | 删掉 `issuesAreOnlyMissingAttribution` 那个分支（即那 7 行回到 `rejected`） | Step 6b 的精确判据（`rejected` 列表不再为空）＋ 改写后的历史台账判据 ＋ **`npm run verify` 会退到非 0** |
| **M1-14** 🔴 | 把 `issuesAreOnlyMissingAttribution` 改成恒返回 `true`（任何 bound 问题都降级） | `rejects — does not downgrade — a bound that is broken in any other way` |
| **M1-15** | 把 `package.json` 的 verify 串改回不接受退出码 2 | **`npm run verify` 退到非 0**（这条不是测试判据，是 verify 本身；**跑 verify 看退出码，别跑 vitest**） |

**M1-6 存在的理由**：没有它的话，「只对 bound 收紧」这半条判断没有任何东西钉住。
🔴 **M1-14 存在的理由**：降级分支最危险的坏法不是"没生效"，是"**生效得太宽**" ——
一个恒真的谓词会把所有 bound 的硬错都变成警告，**而 M1-13 那条判据照绿**。
**必须两个方向各有一条**（本仓库在 Task 1 的 M1-2／M1-3 上用的是同一条纪律）。

- [ ] **Step 8: Commit**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/ledger/schema.ts src/ledger/validateLine.ts package.json \
  tests/ledger/validateLine.test.ts tests/ledger/writer.test.ts tests/ledger/validateFile.test.ts
/usr/bin/git commit -m "feat(ledger): require taskId and runId on bound events

git blame on a bound line answers 'which commit implemented this decision',
and a squash merge destroys that answer while keeping the line. These two
fields answer the question people actually ask with an identifier no history
rewrite can touch.

Required rather than optional, and landed now rather than alongside the
consumer, because the ledger is append-only: a field the format never had
cannot be backfilled onto lines already written.

Lines written before the fields existed are downgraded to tier 0 rather than
rejected: they are not malformed, they simply cannot say which task they
belong to, and no agent can repair that. verify tolerates the resulting exit
code 2 for the ledger step, and a criterion names the exact seven lines that
tolerance covers so an eighth downgrade is red rather than silent."
```

---

## Task 3: 写入方的两条新检查

**Files:**
- Modify: `src/ledger/writer.ts`
- Test: `tests/ledger/writer.test.ts`（只加）

**Interfaces:**
- Consumes: 既有 `appendEvent(decisionsDir, runId, event)`
- Produces: 签名不变。**行为新增两条拒绝。**

- [ ] **Step 1: 写下会红的判据**

```ts
describe("appendEvent — the run field must match the file it lands in", () => {
  it("throws when a decision's run field names a different run than the file", async () => {
    const dir = await tempDir();
    await expect(
      appendEvent(dir, "run-a", { ...DECISION_FIXTURE, run: "run-b" }),
    ).rejects.toThrow(/run/);
    // The file must not even have been created.
    await expect(readFile(join(dir, "run-a.jsonl"), "utf8")).rejects.toThrow();
  });

  it("accepts a decision whose run field matches", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-a", { ...DECISION_FIXTURE, run: "run-a" });
    expect(await readFile(join(dir, "run-a.jsonl"), "utf8")).toContain("run-a");
  });

  it("does not apply the check to reference events, which carry no run field", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-a", { ...DECISION_FIXTURE, run: "run-a" });
    await appendEvent(dir, "run-a", {
      ev: "bound", id: DECISION_FIXTURE.id, taskId: "t-1", runId: "run-a",
    });
    const text = await readFile(join(dir, "run-a.jsonl"), "utf8");
    expect(text.split("\n").filter(Boolean).length).toBe(2);
  });
});

describe("appendEvent — a decision id must be unique within its file", () => {
  it("throws on a second decision with an id already in the file, and writes not one byte", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-a", { ...DECISION_FIXTURE, run: "run-a" });
    const before = await readFile(join(dir, "run-a.jsonl"), "utf8");

    await expect(
      appendEvent(dir, "run-a", { ...DECISION_FIXTURE, run: "run-a", question: "a different question" }),
    ).rejects.toThrow(/duplicate/);

    expect(await readFile(join(dir, "run-a.jsonl"), "utf8")).toBe(before);
  });

  it("allows two decisions with different ids", async () => {
    const dir = await tempDir();
    await appendEvent(dir, "run-a", { ...DECISION_FIXTURE, run: "run-a", id: "run-a/1" });
    await appendEvent(dir, "run-a", { ...DECISION_FIXTURE, run: "run-a", id: "run-a/2" });
    expect((await readFile(join(dir, "run-a.jsonl"), "utf8")).split("\n").filter(Boolean).length).toBe(2);
  });
});
```

⚠️ **`DECISION_FIXTURE` 的 `run` 字段现在是什么值，先现测** —— 既有判据都用它，若它写死成某个 run 名，
上面的展开写法才有意义。**整份读回该文件再动手。**

- [ ] **Step 2: 跑，确认红**

```bash
cd /Users/biran/code/skills/loop/Orca
npm test -- --run tests/ledger/writer.test.ts > /tmp/p1-t3-red.txt 2>&1; echo "RC=$?"; cat /tmp/p1-t3-red.txt
```

- [ ] **Step 3: 实现**

在 `src/ledger/writer.ts` 的 `const line = JSON.stringify(event);` **之前**插入：

```ts
  // Check A: a decision's run field must name the file it lands in.
  // C writes several ledgers, in several repositories, in the same process;
  // a run field that disagrees with the filename makes every downstream
  // attribution wrong while every existing check stays green.
  const run = (event as { run?: unknown }).run;
  if ((event as { ev?: unknown }).ev === "decision" && run !== runId) {
    throw new Error(
      `refusing to append: run field ${JSON.stringify(run)} does not match the ledger file for run ${JSON.stringify(runId)}`,
    );
  }
```

在**读回 `existingText` 之后**、构造 `payload` 之前插入：

```ts
  // Check B: a decision id must be unique within its file. The ledger is
  // append-only, so a duplicate can never be removed — and the panel (E)
  // resolves decisions by id, which a duplicate makes ambiguous forever.
  if ((event as { ev?: unknown }).ev === "decision") {
    const id = (event as { id?: unknown }).id;
    for (const existing of existingText.split("\n")) {
      if (existing.trim().length === 0) continue;
      let parsedExisting: { ev?: unknown; id?: unknown };
      try {
        parsedExisting = JSON.parse(existing) as { ev?: unknown; id?: unknown };
      } catch {
        // A line that does not parse is validateFile's problem, not this
        // check's; the prospective validation below rejects it anyway.
        continue;
      }
      if (parsedExisting.ev === "decision" && parsedExisting.id === id) {
        throw new Error(`refusing to append: duplicate decision id ${JSON.stringify(id)}`);
      }
    }
  }
```

⚠️ *** **`throw` 必须在 `try` 块【外面】。** *** 若把它写进 `try` 里，它会被自己的 `catch` 吞掉，
**而所有判据仍然可能绿** —— 这正是本仓库栽过的「绿是空的」形状。上面的写法（先 parse、后判断）就是为了让这件事**结构上不可能发生**。

- [ ] **Step 4: 跑 verify**

```bash
cd /Users/biran/code/skills/loop/Orca
npm run verify > /tmp/p1-t3-verify.txt 2>&1; echo "VERIFY_RC=$?"; cat /tmp/p1-t3-verify.txt
```

⚠️ **两条检查都只在【写入时】生效，不进 `validateFile`** ⇒ **现有三个台账文件不受影响**
（普查结论三已量过：0 处 run 不一致、无重复 id）。若 verify 因这两条红了，**说明实现落错了层**。

- [ ] **Step 5: 点名变异**

| 变异 | 怎么改 | 必须红的那条 |
|---|---|---|
| **M1-7** 🔴 | 删掉 Check A 整段 | `throws when a decision's run field names a different run than the file` |
| **M1-8** 🔴 | 删掉 Check B 整段 | `throws on a second decision with an id already in the file` |
| **M1-9** | 把 Check A 的 `ev === "decision" &&` 去掉（让它也管引用事件） | `does not apply the check to reference events, which carry no run field` |
| **M1-10** | 把 Check B 的 `throw` 移进 `try` 块里 | `throws on a second decision with an id already in the file`（会变成不抛） |

- [ ] **Step 6: Commit**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/ledger/writer.ts tests/ledger/writer.test.ts
/usr/bin/git commit -m "feat(ledger): reject a mismatched run field and a duplicate decision id at the writer

Both checks live in the writer rather than in its caller, for the reason the
design gives for the writer existing at all: whether a record is legal cannot
depend on the agent writing it remembering to check. Putting them in the
scheduler would leave the next consumer free to repeat the same mistake."
```

---

## Task 4: 新增 `reconcile` 决策 kind

**Files:**
- Modify: `src/ledger/types.ts:1-8`
- Test: `tests/ledger/validateLine.test.ts`（**把硬编码的 kind 循环改成从 `DECISION_KINDS` 派生**，并加一条计数判据）

**Interfaces:**
- Consumes: `DECISION_KINDS`
- Produces: 枚举多一个成员 `"reconcile"`。`DecisionKind` 类型自动跟随。

- [ ] **Step 1: 先修判据侧的第二份副本（否则加第 7 个 kind 不会被覆盖）**

先现测锚点唯一（`grep -n` 找那个 `for (const kind of [` 开头的整行，**命中数必须为 1**），把它改成：

```ts
  // Derived from DECISION_KINDS, not spelled out: a hard-coded list here would
  // silently stop covering a newly added kind — green, and empty. That is the
  // shape this repo has been bitten by before.
  for (const kind of DECISION_KINDS) {
```

并在该文件 import 里补 `DECISION_KINDS`（来自 `../../src/ledger/types.js`）。

- [ ] **Step 2: 跑，确认仍绿且【条数不变】**

```bash
cd /Users/biran/code/skills/loop/Orca
npm test -- --run tests/ledger/validateLine.test.ts > /tmp/p1-t4-a.txt 2>&1; echo "RC=$?"; cat /tmp/p1-t4-a.txt
```

⚠️ **条数必须与 Step 1 之前完全相同** —— 现在还是 6 个 kind。**条数变了说明改错了。**

- [ ] **Step 3: 加一条计数判据 —— 没有它，本任务的两条变异都是不可观测的**

```ts
it("DECISION_KINDS has exactly the seven kinds the ledger recognises", () => {
  // Counting is the only way this task's mutations are visible: dropping a
  // kind, or reverting the loop above to a hard-coded list, makes the derived
  // loop run one fewer case — and a suite that runs one fewer case is green,
  // not red. vitest has no opinion about a test that stopped existing.
  expect([...DECISION_KINDS]).toEqual([
    "dependency", "interface", "scheduling", "abandon", "criteria", "boundary", "reconcile",
  ]);
});
```

先跑一次，**确认它红**（此刻 `reconcile` 还没加）：

```bash
cd /Users/biran/code/skills/loop/Orca
npm test -- --run tests/ledger/validateLine.test.ts > /tmp/p1-t4-red.txt 2>&1; echo "RC=$?"; cat /tmp/p1-t4-red.txt
```

- [ ] **Step 4: 加 `reconcile`**

`src/ledger/types.ts`：

```ts
export const DECISION_KINDS = [
  "dependency",
  "interface",
  "scheduling",
  "abandon",
  "criteria",
  "boundary",
  // Reconciling a merge conflict is an agent choosing between two agents'
  // code, not a scheduling choice. Folding it into "scheduling" would leave
  // the panel unable to tell an ordering decision from a code-content one,
  // and the second is an order of magnitude riskier.
  "reconcile",
] as const;
```

- [ ] **Step 5: 跑，确认回绿且条数【正好多 2】**

```bash
cd /Users/biran/code/skills/loop/Orca
npm run verify > /tmp/p1-t4-verify.txt 2>&1; echo "VERIFY_RC=$?"; cat /tmp/p1-t4-verify.txt
```

🔴 **期望比 Step 2 多 2 条**：派生循环多跑一个 kind（+1）＋ Step 3 那条计数判据（+1）。
**这就是 Step 1／Step 3 存在的全部理由**：不先做它们，这里加了 kind **条数不变、全绿、零覆盖**。

- [ ] **Step 6: 点名变异**

| 变异 | 怎么改 | 必须红的那条 |
|---|---|---|
| **M1-11** 🔴 | 把 `"reconcile"` 从 `DECISION_KINDS` 删掉 | `DECISION_KINDS has exactly the seven kinds the ledger recognises` |
| **M1-12** | 把 Step 1 的循环改回硬编码 6 个名字 | **不会红** —— 它只是少跑一条。⚠️ **本条如实登记为一条【不可观测的变异】**：它的防线是 Step 1 那条注释与代码评审，不是判据。**要让它可观测，得另加一条断言"参数化用例数 == `DECISION_KINDS.length`"，而 vitest 没有直接读这个数的稳定接口** |

🔴 **M1-12 这条如实写出来，不掩饰。** 它正是「**没跑过的那条变异**」的反面：一条**跑不出来**的变异。
**登记它比假装它红过要有用得多。**

- [ ] **Step 7: Commit**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/ledger/types.ts tests/ledger/validateLine.test.ts
/usr/bin/git commit -m "feat(ledger): add the reconcile decision kind

Reconciling a merge conflict is an agent choosing between two agents' code,
not a scheduling choice; folding it into scheduling would leave the panel
unable to tell an ordering decision from a code-content one.

The kind loop in the criteria is derived from DECISION_KINDS in the same
commit, and a separate criterion counts the list, because a hard-coded loop
would have covered six kinds while staying green — one fewer case, not one
red case."
```

---

## Task 5: 收尾 —— spec 的具名 ERRATUM ＋ 本轮台账 ＋ 整支验证

**Files:**
- Modify: `docs/superpowers/specs/2026-09-03-scheduler-design.md`（**只追加一节，正文一字不动**）
- Create: `.decisions/orca-dev-<本会话 id>.jsonl`（**经 `appendEvent` 落盘，不许手写**）

**Interfaces:**
- Consumes: Task 2／Task 3／Task 4 之后的 `appendEvent`（**含新的两条检查与 `bound` 字段要求** —— 本任务同时是它们的 dogfood）
- Produces: 无代码接口。产物是**证据与更正**。

- [ ] **Step 1: 给 spec 追加具名 ERRATUM**

追加到 spec 文末（**§5.5 的正文一个字都不动**，G11）：

```markdown
---

## ERRATUM 1（P1 实施时现测，2026-09-03，Orca `43bcb96`）

§5.5 末尾把两件事接错了：它说「加第五种类型时会咬人」的那份第四份清单，是
**引用事件**（`bound`/`superseded`/`overturned`）的清单，**不是决策 kind 的**。现测：

- **决策 kind 在 `src/` 里只有一份**（`types.ts`），加 `reconcile` 是**一行改动，没有副本风险**；
- 第四份清单真正咬人的时刻是 **`bound` 需要自己的 schema 那一刻**（§8.4②），不是加 kind 那一刻；
- 而 kind 的**第二份副本在判据里**（`tests/ledger/validateLine.test.ts` 的硬编码循环），
  加第 7 个 kind **不会红，只会静默不覆盖**。

⇒ §5.5 那句「实施时第一步是做一次普查」**依然完全正确 —— 正是这次普查发现了这条更正**。
⇒ §8.2 建议的「`reconcile` ＋ 写入方两条检查合成一个任务、排最前」**已被 P1 计划的决策 D1 改序**，理由记在该计划。
⇒ **原文逐字保留，此处即为具名更正。**
```

- [ ] **Step 2: 本轮决策落台账**

用**写入方**逐条落盘（G12），run-id 用**本会话的 id**，**不要写进上一轮的文件**。
要写的就是本文「本计划自己做的 5 条决策」那张表 —— **逐条照抄 `question` / `chose` / `alternatives` /
`because` / `undo` / `evidence`，本文不再重复一遍**。

⚠️ **这一步同时是 Task 2／3 的 dogfood**：它会真的走一遍新的 `run` 一致性检查与重复 id 检查。
⚠️ **`at` 字段如实写。** handoff 已登记过一处坑：**两份台账里 `decision` 的 `at` 都是批量回填的同一个时刻**
—— **别把 `at` 读成「这条决策是那一刻做出的」**。本轮若也是回填，**就把这件事本身记成一条决策**。

- [ ] **Step 3: 整支验证 ＋ Commit**

```bash
cd /Users/biran/code/skills/loop/Orca
npm run verify > /tmp/p1-final.txt 2>&1; echo "VERIFY_RC=$?"; cat /tmp/p1-final.txt
/usr/bin/git status --short
```

期望 exit 0，末三行 `ok: 4 ledger file(s)` ／ `ok: CLAUDE.md is 135/200 lines` ／ `ok: core.hooksPath is scripts/githooks`。

```bash
/usr/bin/git add docs/superpowers/specs/2026-09-03-scheduler-design.md .decisions/
/usr/bin/git commit -m "docs(spec): record an erratum the P1 census turned up, and land P1's own decisions"
```

**不 push。**

---

## Self-Review

### 1. Spec 覆盖

| spec 要求 | 落在哪 |
|---|---|
| §5.5 新增 `reconcile` kind | Task 4 |
| §5.5「实施时第一步做副本普查」 | **开工前已做完**，结论写在本文「开工前的普查结论」一节；并因此产出 ERRATUM 1（Task 5 Step 1） |
| §8.2 检查①：`run` 字段与文件名一致 | Task 3 Check A ＋ 变异 M1-7／M1-9 |
| §8.2 检查②：拒绝重复 decision id | Task 3 Check B ＋ 变异 M1-8／M1-10 |
| §8.2「在写入方里补，不在 C 里加一层」 | Task 3 Step 3 的实现位置 ＋ commit message 里写明理由 |
| §8.2「与 §5.5 合成一个任务且排最前」 | **有意偏离（决策 D1）**，理由：普查证明二者无耦合，且 `bound` 才是不可后补的那条 |
| §8.4② `bound` 加 `taskId` ＋ `runId` | Task 2（**整份计划里唯一不能延后的一条**） |
| §8.4②「必须现在做，不能等实现 PR 档位」 | Task 2 排在 Task 3／Task 4 之前 ＋ 本文顶部与 Task 2 标题的红字 |
| §8.4③ 索引器降级标 `ambiguous` | **不在本计划范围** —— spec 自己说 ①③ 是消费侧、日后随时能加。**登记，不掩饰** |
| §8.4① squash 检测启发式 | 同上，消费侧，不在 P1 |
| A′ §3.6 kind 白名单 | Task 4 |
| §8.3「`bound` 行必须先写进树再 `commit-tree`」 | **不在 P1**：它是 C 的**实现时序**，不是台账格式。归 P2 |

**缺口三处，如实登记**：§8.4 的 ① 与 ③ 是**消费侧**（spec 明写"日后随时能加"，下游是子系统 E）；
§8.3 是 C 的时序，归 P2。**三处都不是遗漏，是划界。**

### 2. 占位符扫描

已扫。四处**故意**留空，且都写明了填法，不是占位符：

1. Task 5 Step 2 的 run-id `<本会话 id>` —— 必须是执行时的真 id，写死就会张冠李戴（handoff 已记过这个坑）。
2. Task 5 Step 2 的决策内容 —— 就是本文「本计划自己做的 5 条决策」那张表，**逐条照抄，不重复一遍**。
3. Task 2／Task 3 里的 `DECISION_FIXTURE`、`tempDir()` —— **明确要求整份读回既有判据文件照它的名字来**；
   写死一个名字反而会让执行者以为它已经存在。
4. ~~Task 2 Step 6 的两条路 (a)/(b)~~ ⇒ *** **人已裁决选 (a)，该分叉已消除**，Step 6 现在是一条直路。 ***
5. Task 2 Step 4 的 `i.received === "undefined"` —— **明确要求先用一次性探针把 zod 真实的 issue 形状打印出来再定谓词**。
   这不是占位符，是**禁止照抄**的标记：zod 的 issue 形状随版本变，而本仓库栽过三次「探针没被验证之前它的输出不是证据」。

### 3. 类型一致

- `isReferenceEventName` 在 Task 1 定义、Task 2 使用，名字一致。✅
- `boundEventSchema` 在 Task 2 定义并在同一个 Task 内使用；`referenceEventSchema` 是既有名字，未改。✅
- `REFERENCE_EVENT_TYPES` 是既有名字（`schema.ts:46`），Task 1 的判据与 `ReferenceEventName` 都从它派生。✅
- `DECISION_KINDS` 是既有名字（`types.ts:1`），Task 4 的循环、计数判据与实现都用它。✅
- `issuesAreOnlyMissingAttribution` 在 Task 2 Step 4 定义（`validateLine.ts` 私有），只在同处使用；
  它吃 `readonly z.ZodIssue[]`，与 `result.error.issues` 的类型一致。✅
- `ValidationResult` 的 `downgraded` 分支形状 `{ verdict: "downgraded"; tier: 0; reasons: string[] }`
  是既有类型（`types.ts:24`），Task 2 的新分支**原样复用，没有新造第二种降级形状**。✅
- `validateFile` 在 Task 2 Step 6b 的新判据里被直接调用，签名 `(rawLines: string[]) => FileVerdict` 未改。✅
- `appendEvent(decisionsDir, runId, event)` 三参数签名在 Task 2、Task 3、Task 5 的所有调用里一致。✅
- 新字段名在 spec §8.4②、schema、判据、变异表里逐字一致：`taskId` / `runId`（**不是** `task_id` / `run_id`）。✅
  ⚠️ **与 `decision` 事件既有的 `run` 字段区分**：`bound.runId` 与 `decision.run` 是两个不同的字段名，
  这是既有形状决定的，**不是笔误**。Task 3 的 Check A 只管 `decision.run`，**不管 `bound.runId`** —— 判据
  `does not apply the check to reference events` 就是钉这一点的。

---

## ✅ 三处人类裁决（**2026-09-03，人当面拍板；执行时逐条援引，不要重开**）

| # | 问的什么 | 裁决 |
|---|---|---|
| **裁决 1** | 决策 D4 —— 要不要改写那两条既有的承重判据（`validateLine.test.ts` 的历史台账判据、`writer.test.ts` 的字节重放判据）。handoff 明写那条 dogfood 判据「**是承重的，别删**」 | *** **按建议：改写成新的真事实，不删。** *** dogfood 属性保住，新要求反而被真实历史钉住 |
| **裁决 2** | Task 2 Step 6 的两条路二选一 | *** **选 (a)** *** —— 历史 `bound` 报 downgraded（退出码 2），**不**移进 `archive/`。⚠️ **(b) 已被否，不要再考虑** |
| **裁决 3** | 决策 D1 —— 改掉 spec §8.2 建议的任务顺序 | *** **按建议：改序，并追加具名 ERRATUM。** *** |

⚠️ **D6（verify 成为退出码 2 的第一个消费者 ＋ 同一笔收窄）是裁决 2 的直接推论**，
本计划在裁决之后补上的，**不是另一次授权**。

## 归属

本计划由 run `orca-dev-10762e47` 于 2026-09-03 写下，基点是主题行
`docs(handoff): continue this round's section with the review and the proposal` 那一笔。
普查与全部实测值的观测时点是 Orca `43bcb96`。
⚠️ **所有行号引用前必须现测。**
