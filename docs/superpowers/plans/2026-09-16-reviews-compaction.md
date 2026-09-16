# reviews.jsonl 压实 ＋ 面板去重集文件身份核对 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或
> `superpowers:executing-plans` 逐任务实施本计划。步骤用 `- [ ]` 复选框跟踪。
> ⚠️ **勾选复选框是进度状态，不是改写论断，照勾。改某个 Task 的【内容】才需要另起一节写具名更正。**

**Goal:** 加第八个子命令 `orca compact-reviews`（默认试跑，`--apply` 才写），并修掉它引出的面板去重集缺陷。

**Architecture:** 三个新模块各管一件事 —— `compactClassify.ts`（纯函数：逐行分类、算出活文件与孤儿）、
`ledgerViews.ts`（读台账顶层与归档，给分类器备料）、`compactReviews.ts`（锁内写：备份 → 归档 → tmp ＋ rename）；
CLI 只做参数与报告。`ReviewsWriter` 在「内存判重复」这一条路径上核对文件身份，身份变了就从盘上重建（并上尚未写完的 claim）。

**Tech Stack:** Node v22.13.1 ／ TypeScript 5.5 ／ vitest 2 ／ tsx 4

**Spec:** `docs/superpowers/specs/2026-09-16-reviews-compaction-design.md` —— **本计划从它论证，执行者两份都要读。**
（spec 在写本计划期间于同会话、未发布时修订过三次，以主题行 `docs(spec): drop the reload single-flight…` 那一笔之后的版本为准。）

**归属**：run `orca-dev-5e5985bc`，2026-09-16，观测锚点为 spec 最后一笔修订提交（`git log -1 -- <spec>`）。

---

## Global Constraints（**每个 Task 的要求都隐含本节**）

1. **语言**：本文正文中文；*** **代码、代码注释、CLI help 文本、commit message 一律英文。** ***
2. **Rule 17**：store 目录一律经 `correctionsDir(env)`；*** **判据一律走 `ORCA_CORRECTIONS_DIR` 改道或 `mkdtemp` 目录，一条会写真 `~/.orca` 的判据不可接受。** ***
   新建文件显式 `0o600`（`writeFile wx` ＋ `chmod`，与 `reviewsStore.ts` 同形），**已存在文件的 mode 不改**；
   `reviews.jsonl` 被 rename 替换时 **chmod 成原文件的权限位**（spec §4.3）。
   *** **`orca compact-reviews` 永远不创建 store 目录**（目录不存在 ⇒ 什么都不做）。 ***
3. **孤儿要正向证据**（spec R-E）：顶层找不到 **且** `archive/<YYYY>/<run-id>.jsonl` 里找得到。两处都找不到 ⇒ 不判。
4. **已发布文本不就地改**：`src/panel/reviewsStore.ts` 的类注释、`scripts/verify-panel.ts` 的全部既有注释与步骤编号、
   E3 spec —— 一律**追加**具名 ERRATUM 或新段落。*** **追加前现跑 `/usr/bin/git ls-remote origin refs/heads/main` ＋ `merge-base --is-ancestor`。** ***
5. **不改既有判据**（改要人指名，CLAUDE.md Rule 9）。本计划**只在** `tests/panel/reviewsStore.test.ts` **末尾追加**一个 `describe`，一个字节不动既有 `it`。
6. **先红**：每个 Task 先落一个**能编译的桩**再跑判据，红必须落在**具名断言**上，**不许红在模块加载**。
   桩下「本来就绿」的判据逐条在 Task 里点名并写明它的牙齿来自哪条变异。
7. **变异纪律**：只在 `git clone --local` 副本里做；副本 `ln -s` 主仓库的 `node_modules`（`web/` 走根 workspaces，不需要第二条）；
   变异前后各取 `shasum -a 256`，**不相等才算落上去**，变异行读回；销毁副本 `/bin/rm -rf "${CLONE:?}"`（本机 `rm`／`cp` 有 `-i` alias）。
8. **绝不过滤验证性跑**：`命令 > 文件 2>&1; echo "RC=$?" >> 文件` 再**整份读回**；验证性跑走 `rtk proxy`，git 验证走 `/usr/bin/git`。
9. **每次编辑后做字节扫描**（除 `\t` `\n` 外的 < 0x20 字节必须为 0）；**代码里不写控制字符转义，用 `String.fromCharCode(0x1f)`**。
   提交前看 `git diff --stat` 有没有 `Bin`。
10. **push／合并进 main／删分支或 worktree 每一次都要人单独点头。控制器不许 push。**

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

本计划写下时（2026-09-16 现测）：`VERIFY_RC=0`；npm test **95 files / 566 tests**；verify:scheduler **51 / 167**；verify:panel **PASS 0–12**；web **8 / 26**；`ls ~/.orca` RC 1。
⚠️ 两个判据数别混：95/566 是全仓，51/167 是 scheduler 档。

**本计划全部落地后的预期**（由本计划各 Task 的 `it` 条数算出 —— **是预言，Task 8 现测验收**）：
npm test **100 files / 602 tests**（+5 文件：`compactClassify`、`coverageDuplicates`、`ledgerViews`、`compactReviews`、`compactReviewsCli`；
+36 条：8 ＋ 2 ＋ 5 ＋ 11 ＋ 5 ＋ 5）；scheduler 51/167 不变；verify:panel **PASS 0–13**；web 8/26 不变。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/panel/compactClassify.ts` | 新建 | 纯函数 `classifyReviews(text, views)`：逐行分类、活文件字节、孤儿行、计数 |
| `src/panel/ledgerViews.ts` | 新建 | `buildLedgerViews(repos, wanted)` 读顶层与归档；`wantedDecisions(dir)` |
| `src/panel/compactReviews.ts` | 新建 | `dryRunCompaction`、`applyCompaction`（锁内写）、`renderCompactionReport` |
| `src/panel/paths.ts` | 追加 | 三个新路径函数 |
| `src/panel/decisionSource.ts` | 改一个词 | `ledgerFiles` 加 `export` |
| `src/panel/reviewsStore.ts` | 改 | `identityFromStats`、`statIdentity`、`ReviewsWriter` 的身份核对与 `inFlight`；类注释末尾追加 ERRATUM |
| `src/cli.ts` | 改 | `runCompactReviews`、USAGE 一段、`main` 分派 |
| `scripts/verify-panel.ts` | 追加 | `runCliToExit` ＋ PASS 13 |
| `docs/superpowers/specs/2026-09-09-panel-design.md` | 追加 | §4.3.2 末尾与 §9 末尾各一条 ERRATUM |
| `tests/panel/compactClassify.test.ts` 等五个 | 新建 | 见各 Task |
| `tests/panel/reviewsStore.test.ts` | **末尾追加** | 身份核对五条 |

---

### Task 0：开工复核（不写代码）

- [ ] **Step 1：跑基线**（上一节的两条命令），整份读回，数字写进本轮 SDD 台账 `.superpowers/sdd/2026-09-16-reviews-compaction/progress.md`（新建，`git add -f`）。
- [ ] **Step 2：现测本计划依赖的每个名字存在**（「计划里的代码块会 import 未来」那条教训）：

```bash
cd /Users/biran/code/skills/loop/Orca
for pat in "export const fsArchiveIo" "export interface ArchiveIo" "export async function readLedgerLeniently" \
           "export async function acquireReviewsLock" "export const REVIEWS_STORE_BUSY" "export async function readReviews" \
           "export function computePanelCoverage" "export function unreviewedHighTier" "export function correctionsDir" \
           "export async function withCorrectionsDir" "export async function captureStreams" "export function validateLine" \
           "async function ledgerFiles" "async function guardedRmRecursive" "async function git(" "function snapshotHomeOrca" ; do
  printf '%s\t' "$pat"; /usr/bin/grep -rlF "$pat" src tests scripts | tr '\n' ' '; echo
done > "$TMPDIR/names.txt" 2>&1; cat "$TMPDIR/names.txt"
```

期望：每一行后面都至少有一个文件名。`async function ledgerFiles` 应只在 `src/panel/decisionSource.ts`（和 `src/metrics/collect.ts`）里、**尚无 `export`**。**任何一行为空 ⇒ 停，写更正节。**

---

### Task 1：分类器（纯函数）＋ 重复行不改数字

**Files:**
- Create: `src/panel/compactClassify.ts`
- Test: `tests/panel/compactClassify.test.ts`、`tests/panel/coverageDuplicates.test.ts`

**Interfaces:**
- Consumes: `computePanelCoverage`、`unreviewedHighTier`（`src/panel/coverage.ts`，只在判据里用）
- Produces:
```ts
export type NotJudgedReason = "repo-not-discovered" | "ledger-has-malformed-lines" | "decision-not-found";
export type LedgerView =
  | { judged: true; topLevelIds: ReadonlySet<string>; archivedIds: ReadonlySet<string> }
  | { judged: false; reason: "ledger-has-malformed-lines" };
export type LineClass =
  | { kind: "unreadable" }
  | { kind: "not-judged"; reason: NotJudgedReason; projectKey: string; decisionId: string }
  | { kind: "duplicate" }
  | { kind: "orphan" }
  | { kind: "kept" };
export type LineKind = LineClass["kind"];
export interface ClassifiedLine { text: string; cls: LineClass }
export interface Classification {
  lines: ClassifiedLine[];
  liveText: string;
  orphanLines: string[];
  counts: Record<LineKind, number>;
}
export function classifyReviews(text: string, views: ReadonlyMap<string, LedgerView>): Classification;
```

- [ ] **Step 1：写桩**（能编译、行为错）

```ts
// src/panel/compactClassify.ts -- STUB for the red run; Step 3 replaces the function body.
export type NotJudgedReason = "repo-not-discovered" | "ledger-has-malformed-lines" | "decision-not-found";
export type LedgerView =
  | { judged: true; topLevelIds: ReadonlySet<string>; archivedIds: ReadonlySet<string> }
  | { judged: false; reason: "ledger-has-malformed-lines" };
export type LineClass =
  | { kind: "unreadable" }
  | { kind: "not-judged"; reason: NotJudgedReason; projectKey: string; decisionId: string }
  | { kind: "duplicate" }
  | { kind: "orphan" }
  | { kind: "kept" };
export type LineKind = LineClass["kind"];
export interface ClassifiedLine {
  text: string;
  cls: LineClass;
}
export interface Classification {
  lines: ClassifiedLine[];
  liveText: string;
  orphanLines: string[];
  counts: Record<LineKind, number>;
}

export function classifyReviews(text: string, _views: ReadonlyMap<string, LedgerView>): Classification {
  return {
    lines: [],
    liveText: text,
    orphanLines: [],
    counts: { kept: 0, duplicate: 0, orphan: 0, unreadable: 0, "not-judged": 0 },
  };
}
```

- [ ] **Step 2：写判据**

```ts
// tests/panel/compactClassify.test.ts
import { describe, expect, it } from "vitest";
import { classifyReviews } from "../../src/panel/compactClassify.js";
import type { LedgerView } from "../../src/panel/compactClassify.js";
import { computePanelCoverage, unreviewedHighTier } from "../../src/panel/coverage.js";
import type { DecisionObservation } from "../../src/metrics/types.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";

const PK = "github.com/biran/target";

const line = (over: Partial<ReviewRow> = {}): string =>
  JSON.stringify({
    decisionId: "orca-dev-1/1",
    projectKey: PK,
    action: "reviewed",
    by: "amy",
    at: "2026-09-10T00:00:00.000Z",
    ...over,
  });

const judged = (top: string[], archived: string[] = []): Map<string, LedgerView> =>
  new Map([[PK, { judged: true, topLevelIds: new Set(top), archivedIds: new Set(archived) }]]);

const kinds = (text: string, views: Map<string, LedgerView>): string[] =>
  classifyReviews(text, views).lines.map((l) => l.cls.kind);

describe("classifyReviews (reviews compaction spec section 3.1)", () => {
  it("C1 keeps the first occurrence of a key byte for byte and drops the later ones", () => {
    // The two lines share (projectKey, decisionId, by, action) and differ only
    // in `at`, so the surviving bytes say WHICH one survived. Counting lines
    // alone would stay green under a keep-the-last mutation.
    const first = line({ at: "2026-09-10T00:00:00.000Z" });
    const later = line({ at: "2026-09-11T00:00:00.000Z" });
    const c = classifyReviews(`${first}\n${later}\n`, judged(["orca-dev-1/1"]));
    expect(c.lines.map((l) => l.cls.kind)).toEqual(["kept", "duplicate"]);
    expect(c.liveText).toBe(`${first}\n`);
  });

  it("C5 leaves an unreadable line where it was, byte for byte, never deduped or moved", () => {
    const a = line();
    const junk = '{"decisionId": "orca-dev-1/1", "proj';
    const dup = line({ at: "2026-09-12T00:00:00.000Z" });
    const c = classifyReviews(`${a}\n${junk}\n${dup}\n`, judged(["orca-dev-1/1"]));
    expect(c.lines.map((l) => l.cls.kind)).toEqual(["kept", "unreadable", "duplicate"]);
    expect(c.liveText).toBe(`${a}\n${junk}\n`);
  });

  it("C5 keeps a torn last line without inventing the newline it never had", () => {
    // A torn tail may be a row still being written. Compaction rewrites the
    // file, so it keeps those bytes exactly -- including the missing newline.
    const a = line();
    const torn = '{"decisionId":"orca-dev-1/2"';
    const c = classifyReviews(`${a}\n${torn}`, judged(["orca-dev-1/1"]));
    expect(c.liveText).toBe(`${a}\n${torn}`);
  });

  it("C6 keeps the surviving lines in their original order", () => {
    // Deliberately NOT sorted by decisionId, so a sort would show.
    const x = line({ decisionId: "orca-dev-1/2" });
    const y = line({ decisionId: "orca-dev-1/1" });
    const z = line({ decisionId: "orca-dev-1/3" });
    const c = classifyReviews(`${x}\n${y}\n${z}\n`, judged(["orca-dev-1/1", "orca-dev-1/2", "orca-dev-1/3"]));
    expect(c.liveText).toBe(`${x}\n${y}\n${z}\n`);
  });

  it("an orphan needs the archive: absent from the top level and present in the archive", () => {
    const row = line({ decisionId: "orca-dev-9/1" });
    const c = classifyReviews(`${row}\n`, judged([], ["orca-dev-9/1"]));
    expect(kinds(`${row}\n`, judged([], ["orca-dev-9/1"]))).toEqual(["orphan"]);
    expect(c.orphanLines).toEqual([row]);
    expect(c.liveText).toBe("");
  });

  it("a row whose decision is in neither place is not judged, and says why", () => {
    // spec R-E: a branch switch also takes an id off the top level. Only the
    // archive is evidence that the decision really left.
    const row = line({ decisionId: "orca-dev-9/1" });
    const c = classifyReviews(`${row}\n`, judged([], []));
    expect(c.lines[0]?.cls).toEqual({
      kind: "not-judged",
      reason: "decision-not-found",
      projectKey: PK,
      decisionId: "orca-dev-9/1",
    });
    expect(c.liveText).toBe(`${row}\n`);
  });

  it("an empty file classifies to nothing", () => {
    const c = classifyReviews("", judged([]));
    expect(c.lines).toEqual([]);
    expect(c.liveText).toBe("");
  });

  it("C15 compaction changes neither the coverage nor the to-do list when every repository is present", () => {
    const decisions: DecisionObservation[] = [
      { projectKey: PK, id: "orca-dev-1/1", at: "2026-01-01T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok" },
      { projectKey: PK, id: "orca-dev-1/2", at: "2026-01-02T00:00:00.000Z", kind: "dependency", scope: "repo", verdict: "ok" },
      { projectKey: PK, id: "orca-dev-1/3", at: "2026-01-03T00:00:00.000Z", kind: "boundary", scope: "repo", verdict: "ok" },
    ];
    const text =
      [
        line({ decisionId: "orca-dev-1/1", action: "opened" }),
        line({ decisionId: "orca-dev-1/1", action: "reviewed" }),
        line({ decisionId: "orca-dev-1/1", action: "reviewed", at: "2026-09-12T00:00:00.000Z" }),
        line({ decisionId: "orca-dev-1/2", action: "opened" }),
        line({ decisionId: "orca-dev-8/1", action: "reviewed" }),
      ].join("\n") + "\n";
    const views = judged(["orca-dev-1/1", "orca-dev-1/2", "orca-dev-1/3"], ["orca-dev-8/1"]);
    const rowsOf = (t: string): ReviewRow[] =>
      t.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as ReviewRow);

    const after = classifyReviews(text, views);
    // Positive control first: the fixture really compacts one duplicate and one
    // orphan, or the equalities below would compare a file with itself.
    expect(after.counts.duplicate + after.counts.orphan).toBe(2);
    expect(computePanelCoverage(decisions, rowsOf(after.liveText))).toEqual(
      computePanelCoverage(decisions, rowsOf(text)),
    );
    expect(unreviewedHighTier(decisions, rowsOf(after.liveText))).toEqual(unreviewedHighTier(decisions, rowsOf(text)));
    // A value, not only an equality: the reviewed decision is really off the list.
    expect(unreviewedHighTier(decisions, rowsOf(after.liveText)).map((d) => d.id)).toEqual([
      "orca-dev-1/2",
      "orca-dev-1/3",
    ]);
  });
});
```

```ts
// tests/panel/coverageDuplicates.test.ts
import { describe, expect, it } from "vitest";
import { computePanelCoverage, unreviewedHighTier } from "../../src/panel/coverage.js";
import type { DecisionObservation } from "../../src/metrics/types.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";

// reviews compaction spec C16. E3 section 4.3.2 accepted duplicate rows from
// concurrent panel processes on the grounds that both consumers key by
// (projectKey, id) through a Set. Nothing pinned that ground until now.
const A = "github.com/biran/a";
const B = "github.com/biran/b";
const decision = (projectKey: string, id: string): DecisionObservation => ({
  projectKey,
  id,
  at: "2026-01-01T00:00:00.000Z",
  kind: "interface",
  scope: "repo",
  verdict: "ok",
});
const reviewed = (projectKey: string, decisionId: string, by = "amy"): ReviewRow => ({
  decisionId,
  projectKey,
  action: "reviewed",
  by,
  at: "2026-09-10T00:00:00.000Z",
});
const decisions = [decision(A, "orca-dev-1/1"), decision(B, "orca-dev-1/1")];

describe("panel coverage under duplicate review rows (reviews compaction spec C16)", () => {
  it("C16 duplicate reviewed rows change neither the coverage nor the to-do list", () => {
    const once = [reviewed(A, "orca-dev-1/1")];
    const thrice = [...once, reviewed(A, "orca-dev-1/1"), reviewed(A, "orca-dev-1/1", "bob")];
    expect(computePanelCoverage(decisions, thrice)).toEqual(computePanelCoverage(decisions, once));
    expect(unreviewedHighTier(decisions, thrice)).toEqual(unreviewedHighTier(decisions, once));
    expect(computePanelCoverage(decisions, thrice).reviewed_high_tier).toBe(1);
  });

  it("C16 must-catch: a reviewed row for the same id in ANOTHER repository does change them", () => {
    // Without this, a coverage function that ignored review rows entirely
    // would satisfy the equalities above.
    const both = [reviewed(A, "orca-dev-1/1"), reviewed(B, "orca-dev-1/1")];
    expect(computePanelCoverage(decisions, both).reviewed_high_tier).toBe(2);
    expect(unreviewedHighTier(decisions, both)).toEqual([]);
  });
});
```

- [ ] **Step 3：跑判据看红**

```bash
rtk proxy ./node_modules/.bin/vitest run tests/panel/compactClassify.test.ts tests/panel/coverageDuplicates.test.ts > "$TMPDIR/t1-red.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/t1-red.txt"
```

期望（整份读回核对，**红必须在具名断言上**）：
- 红：C1（`[] vs ["kept","duplicate"]`）、两条 C5、「an orphan needs the archive」、「a row whose decision is in neither place」（`undefined` vs 对象）、C15（`0 vs 2`）。
- **桩下绿，登记牙齿来源**：C6（桩把原文原样当活文件 —— 牙齿是 M15）；「an empty file」（牙齿：无，它是边界对照）；两条 C16（测的是既有代码 —— 牙齿是 M23 ＋ 自带必抓样本）。

- [ ] **Step 4：实现**（替换桩的函数体，类型不变）

```ts
// src/panel/compactClassify.ts -- replace the stub's classifyReviews with this, and add the helpers above it.

// U+001F, built rather than written as an escape (a raw control byte in a
// source file has made git treat it as binary here before). Same separator
// reviewsStore.ts uses for its own dedupe key.
const UNIT_SEPARATOR = String.fromCharCode(0x1f);

interface RowKeyFields {
  projectKey: string;
  decisionId: string;
  by: string;
  action: string;
}

function parseRow(text: string): RowKeyFields | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const fields = value as Record<string, unknown>;
  for (const name of ["projectKey", "decisionId", "by", "action"] as const) {
    if (typeof fields[name] !== "string") return undefined;
  }
  return fields as unknown as RowKeyFields;
}

const notJudged = (reason: NotJudgedReason, row: RowKeyFields): LineClass => ({
  kind: "not-judged",
  reason,
  projectKey: row.projectKey,
  decisionId: row.decisionId,
});

/**
 * spec section 3.1, in the table's order: unreadable, not judged, duplicate,
 * orphan, kept. A not-judged row takes no part in dedupe (ruling R-B: a
 * repository that is not here is not touched at all).
 */
function classifyLine(part: string, views: ReadonlyMap<string, LedgerView>, seen: Set<string>): LineClass {
  const row = parseRow(part);
  if (row === undefined) return { kind: "unreadable" };
  const view = views.get(row.projectKey);
  if (view === undefined) return notJudged("repo-not-discovered", row);
  if (!view.judged) return notJudged(view.reason, row);
  const atTopLevel = view.topLevelIds.has(row.decisionId);
  // ruling R-E: absence from the top level is not evidence -- a branch switch
  // produces it too. Only the archive says the decision really left.
  if (!atTopLevel && !view.archivedIds.has(row.decisionId)) return notJudged("decision-not-found", row);
  const rowKey = [row.projectKey, row.decisionId, row.by, row.action].join(UNIT_SEPARATOR);
  if (seen.has(rowKey)) return { kind: "duplicate" };
  seen.add(rowKey);
  return atTopLevel ? { kind: "kept" } : { kind: "orphan" };
}

export function classifyReviews(text: string, views: ReadonlyMap<string, LedgerView>): Classification {
  const endsWithNewline = text.endsWith("\n");
  const parts = text.length === 0 ? [] : text.split("\n");
  if (endsWithNewline) parts.pop();

  const seen = new Set<string>();
  const counts: Record<LineKind, number> = { kept: 0, duplicate: 0, orphan: 0, unreadable: 0, "not-judged": 0 };
  const lines: ClassifiedLine[] = parts.map((part) => {
    const cls = classifyLine(part, views, seen);
    counts[cls.kind] += 1;
    return { text: part, cls };
  });

  // Every surviving line gets its newline back, except a torn last line that
  // never had one: those bytes may be a row still being written.
  const lastIndex = parts.length - 1;
  const survivors = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.cls.kind !== "duplicate" && l.cls.kind !== "orphan");
  const liveText = survivors.map(({ l, i }) => (i === lastIndex && !endsWithNewline ? l.text : `${l.text}\n`)).join("");
  const orphanLines = lines.filter((l) => l.cls.kind === "orphan").map((l) => l.text);

  return { lines, liveText, orphanLines, counts };
}
```

- [ ] **Step 5：跑判据看绿**（同 Step 3 的命令，输出到 `t1-green.txt`）。期望 `2 passed` 文件、`10 passed` 条，RC 0。
- [ ] **Step 6：`rtk proxy npm run typecheck > "$TMPDIR/t1-tsc.txt" 2>&1; echo RC=$?`**，RC 0；字节扫描三个文件，0。
- [ ] **Step 7：提交**

```bash
/usr/bin/git add src/panel/compactClassify.ts tests/panel/compactClassify.test.ts tests/panel/coverageDuplicates.test.ts
/usr/bin/git commit -m "feat(panel): classify reviews.jsonl lines for compaction, and pin that duplicates change no number"
```

---

### Task 2：台账视图（顶层 ＋ 归档）

**Files:**
- Modify: `src/panel/decisionSource.ts`（`async function ledgerFiles` → `export async function ledgerFiles`，**只改这一个词**）
- Create: `src/panel/ledgerViews.ts`
- Test: `tests/panel/ledgerViews.test.ts`

**Interfaces:**
- Consumes: `LedgerView`、`classifyReviews`（Task 1）；`fsArchiveIo`（`src/metrics/collect.ts`）；`ArchiveIo`（`src/metrics/resolve.ts`）；`DiscoveredRepo`（`src/metrics/discover.ts`）；`readLedgerLeniently`；`ledgerFiles`；`readReviews`
- Produces:
```ts
export interface WantedDecision { projectKey: string; decisionId: string }
export async function buildLedgerViews(repos: readonly DiscoveredRepo[], wanted: readonly WantedDecision[], io?: ArchiveIo): Promise<Map<string, LedgerView>>;
export async function wantedDecisions(dir: string): Promise<WantedDecision[]>;
```

- [ ] **Step 1：改 `decisionSource.ts` 那一个词，写桩**

```ts
// src/panel/ledgerViews.ts -- STUB for the red run.
import type { ArchiveIo } from "../metrics/resolve.js";
import type { DiscoveredRepo } from "../metrics/discover.js";
import type { LedgerView } from "./compactClassify.js";

export interface WantedDecision {
  projectKey: string;
  decisionId: string;
}

export async function buildLedgerViews(
  _repos: readonly DiscoveredRepo[],
  _wanted: readonly WantedDecision[],
  _io?: ArchiveIo,
): Promise<Map<string, LedgerView>> {
  return new Map();
}

export async function wantedDecisions(_dir: string): Promise<WantedDecision[]> {
  return [];
}
```

- [ ] **Step 2：写判据**

```ts
// tests/panel/ledgerViews.test.ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateLine } from "../../src/ledger/validateLine.js";
import type { DiscoveredRepo } from "../../src/metrics/discover.js";
import { classifyReviews } from "../../src/panel/compactClassify.js";
import type { LineClass } from "../../src/panel/compactClassify.js";
import { buildLedgerViews } from "../../src/panel/ledgerViews.js";

const PK = "github.com/biran/target";

const decisionLine = (id: string, over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    ev: "decision",
    id,
    at: "2026-01-01T00:00:00.000Z",
    run: id.slice(0, id.lastIndexOf("/")),
    question: "q",
    chose: "a",
    alternatives: [{ option: "b", why_not: "no" }],
    because: "r",
    // An executable undo.how, so validateLine answers ok rather than downgraded
    // (tests/metrics/buildFixture.ts measured the difference).
    undo: { how: "git revert abc123 -- src/foo.ts", cost: "low", blast_radius: "one file" },
    scope: "repo",
    kind: "interface",
    ...over,
  });

const reviewLine = (decisionId: string): string =>
  JSON.stringify({ decisionId, projectKey: PK, action: "reviewed", by: "amy", at: "2026-09-10T00:00:00.000Z" });

describe("buildLedgerViews + classifyReviews (reviews compaction spec section 3.1, ruling R-E)", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "orca-ledger-views-"));
    repoPath = join(root, "repo");
    await mkdir(join(repoPath, ".decisions"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const put = async (rel: string, lines: string[]): Promise<void> => {
    await mkdir(dirname(join(repoPath, rel)), { recursive: true });
    await writeFile(join(repoPath, rel), lines.map((l) => `${l}\n`).join(""));
  };

  const classesFor = async (repos: DiscoveredRepo[], decisionId: string): Promise<LineClass[]> => {
    const text = `${reviewLine(decisionId)}\n`;
    const views = await buildLedgerViews(repos, [{ projectKey: PK, decisionId }]);
    return classifyReviews(text, views).lines.map((l) => l.cls);
  };

  it("C3 leaves a repository that was not discovered alone, and the same row is an orphan once it is", async () => {
    await put(".decisions/archive/2026/orca-dev-9.jsonl", [decisionLine("orca-dev-9/1")]);
    expect(await classesFor([], "orca-dev-9/1")).toEqual([
      { kind: "not-judged", reason: "repo-not-discovered", projectKey: PK, decisionId: "orca-dev-9/1" },
    ]);
    expect(await classesFor([{ projectKey: PK, path: repoPath }], "orca-dev-9/1")).toEqual([{ kind: "orphan" }]);
  });

  it("C4 leaves a repository with a bad top-level ledger line alone, and the same row is an orphan without it", async () => {
    await put(".decisions/archive/2026/orca-dev-9.jsonl", [decisionLine("orca-dev-9/1")]);
    // A bad top-level line could be hiding the very id being looked for.
    await put(".decisions/orca-dev-1.jsonl", [decisionLine("orca-dev-1/1"), "{not json"]);
    const repos = [{ projectKey: PK, path: repoPath }];
    expect(await classesFor(repos, "orca-dev-9/1")).toEqual([
      { kind: "not-judged", reason: "ledger-has-malformed-lines", projectKey: PK, decisionId: "orca-dev-9/1" },
    ]);
    await put(".decisions/orca-dev-1.jsonl", [decisionLine("orca-dev-1/1")]);
    expect(await classesFor(repos, "orca-dev-9/1")).toEqual([{ kind: "orphan" }]);
  });

  it("C4b counts a top-level decision the validator rejects as present, and the same row is an orphan once its file is archived", async () => {
    // JSON.stringify drops an undefined value, so `because` is really absent.
    const rejectedLine = decisionLine("orca-dev-1/1", { because: undefined });
    // Fixture sanity, read from the validator rather than from this test's own input.
    expect(validateLine(rejectedLine).verdict).toBe("rejected");
    const repos = [{ projectKey: PK, path: repoPath }];

    await put(".decisions/orca-dev-1.jsonl", [rejectedLine]);
    // The exact class: under the "only validated decisions count" mutation this
    // row falls into decision-not-found, which is ALSO not an orphan.
    expect(await classesFor(repos, "orca-dev-1/1")).toEqual([{ kind: "kept" }]);

    await rm(join(repoPath, ".decisions", "orca-dev-1.jsonl"));
    await put(".decisions/archive/2026/orca-dev-1.jsonl", [rejectedLine]);
    expect(await classesFor(repos, "orca-dev-1/1")).toEqual([{ kind: "orphan" }]);
  });

  it("C4c leaves a row whose decision is in neither place alone, and the same row is an orphan once its run file is archived", async () => {
    const repos = [{ projectKey: PK, path: repoPath }];
    await put(".decisions/orca-dev-1.jsonl", [decisionLine("orca-dev-1/1")]);
    expect(await classesFor(repos, "orca-dev-7/1")).toEqual([
      { kind: "not-judged", reason: "decision-not-found", projectKey: PK, decisionId: "orca-dev-7/1" },
    ]);
    await put(".decisions/archive/2025/orca-dev-7.jsonl", [decisionLine("orca-dev-7/1")]);
    expect(await classesFor(repos, "orca-dev-7/1")).toEqual([{ kind: "orphan" }]);
  });

  it("C4d finds nothing for a decision id whose run part climbs out of the archive", async () => {
    // The decision id comes from reviews.jsonl, which is data. Its run part
    // becomes a file name under archive/<YYYY>/, so a "/" in it would read a
    // file outside the archive. A real decision file sits exactly where the
    // climb lands, so only the guard stands between it and a false orphan.
    const climbing = "../../../outside/1";
    await mkdir(join(repoPath, ".decisions", "archive", "2026"), { recursive: true });
    await put("outside.jsonl", [decisionLine(climbing)]);
    expect(await classesFor([{ projectKey: PK, path: repoPath }], climbing)).toEqual([
      { kind: "not-judged", reason: "decision-not-found", projectKey: PK, decisionId: climbing },
    ]);
  });
});
```

⚠️ C4d 的落点核算：`archive/2026/` ＋ `../../../outside` ＋ `.jsonl` ＝ `<repo>/.decisions/archive/2026/../../../outside.jsonl` ＝ `<repo>/outside.jsonl` —— 正好是夹具放文件的地方，且**不在** `.decisions/` 顶层（不会被顶层扫描先找到）。

- [ ] **Step 3：跑判据看红**（`tests/panel/ledgerViews.test.ts`，输出 `t2-red.txt`）
  期望：C3 **红在第二条断言**（第一条桩下成立 —— 空 Map 本来就答 `repo-not-discovered`）；C4、C4b、C4c、C4d 都红在各自第一条 `toEqual`（桩答 `repo-not-discovered`）；C4b 的 fixture sanity 断言**绿**。

- [ ] **Step 4：实现**

```ts
// src/panel/ledgerViews.ts
import { fsArchiveIo } from "../metrics/collect.js";
import type { DiscoveredRepo } from "../metrics/discover.js";
import { readLedgerLeniently } from "../metrics/lenientRead.js";
import type { ArchiveIo } from "../metrics/resolve.js";
import type { LedgerView } from "./compactClassify.js";
import { ledgerFiles } from "./decisionSource.js";
import { readReviews } from "./reviewsStore.js";

export interface WantedDecision {
  projectKey: string;
  decisionId: string;
}

const idOf = (value: unknown): string | undefined => {
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
};

/**
 * A decision id is `<run-id>/<n>` and its ledger file is `<run-id>.jsonl`
 * (spec section 1.8 measured 156 of 156). The id is read from reviews.jsonl,
 * which is data, so a run part carrying a path separator is refused rather
 * than joined into a path: it would read a file outside the archive.
 */
function runIdOf(decisionId: string): string | undefined {
  const slash = decisionId.lastIndexOf("/");
  if (slash <= 0) return undefined;
  const runId = decisionId.slice(0, slash);
  if (runId.includes("/") || runId.includes("\\")) return undefined;
  return runId;
}

async function decisionIdsIn(file: string, into: Set<string>): Promise<boolean> {
  const read = await readLedgerLeniently(file);
  for (const row of read.rows) {
    if (row.kind !== "decision") continue;
    // Every ev:"decision" line counts, whatever validateLine would say about
    // it (spec section 3.1): a validator that tightens later must not turn a
    // reviewed decision into an orphan.
    const id = idOf(row.value);
    if (id !== undefined) into.add(id);
  }
  return read.malformed.length > 0;
}

/**
 * spec section 3.1 / ruling R-E. One view per DISCOVERED repository; a
 * repository missing from the map is "repo-not-discovered" to the classifier.
 * Only the archive files of runs that `wanted` actually names are read, one
 * level down, the same stat-by-name shape as src/metrics/resolve.ts.
 *
 * A malformed line in the TOP-LEVEL ledger makes the whole repository not
 * judged: it could be hiding an id, and a hidden id is a false orphan. A
 * malformed line in an ARCHIVE file can only hide evidence, which turns into
 * "decision-not-found" -- the safe direction -- so it needs no rule.
 */
export async function buildLedgerViews(
  repos: readonly DiscoveredRepo[],
  wanted: readonly WantedDecision[],
  io: ArchiveIo = fsArchiveIo,
): Promise<Map<string, LedgerView>> {
  const views = new Map<string, LedgerView>();
  for (const repo of repos) {
    const topLevelIds = new Set<string>();
    let malformed = false;
    for (const file of await ledgerFiles(repo.path)) {
      if (await decisionIdsIn(file, topLevelIds)) malformed = true;
    }
    if (malformed) {
      views.set(repo.projectKey, { judged: false, reason: "ledger-has-malformed-lines" });
      continue;
    }

    const runIds = new Set<string>();
    for (const w of wanted) {
      if (w.projectKey !== repo.projectKey || topLevelIds.has(w.decisionId)) continue;
      const runId = runIdOf(w.decisionId);
      if (runId !== undefined) runIds.add(runId);
    }
    const archivedIds = new Set<string>();
    if (runIds.size > 0) {
      const years = await io.listYearDirs(repo.path);
      for (const runId of runIds) {
        for (const year of years) {
          const path = `${repo.path}/.decisions/archive/${year}/${runId}.jsonl`;
          if (await io.statFile(path)) await decisionIdsIn(path, archivedIds);
        }
      }
    }
    views.set(repo.projectKey, { judged: true, topLevelIds, archivedIds });
  }
  return views;
}

/**
 * The decisions an unlocked read of reviews.jsonl names. A row appended after
 * this read is not in `wanted`, so its archive file is never read and it can
 * only come out "decision-not-found" or "kept" -- never a false orphan.
 */
export async function wantedDecisions(dir: string): Promise<WantedDecision[]> {
  return (await readReviews(dir)).map((row) => ({ projectKey: row.projectKey, decisionId: row.decisionId }));
}
```

⚠️ `readLedgerLeniently` 返回的 `row.value` 已被它保证是非 null 对象（`src/metrics/lenientRead.ts` 的 `line is not a JSON object` 分支），`idOf` 的类型断言依此成立。

- [ ] **Step 5：跑判据看绿**（输出 `t2-green.txt`）：`5 passed`，RC 0。另跑 `tests/panel/decisionsApi.test.ts`（`ledgerFiles` 的既有消费者）确认仍绿。
- [ ] **Step 6：typecheck ＋ 字节扫描**（同 Task 1 Step 6）。
- [ ] **Step 7：提交**

```bash
/usr/bin/git add src/panel/decisionSource.ts src/panel/ledgerViews.ts tests/panel/ledgerViews.test.ts
/usr/bin/git commit -m "feat(panel): read the top-level ledger and the archive to tell an archived decision from a missing one"
```

---

### Task 3：执行层（试跑 ／ 锁内写）

**Files:**
- Modify: `src/panel/paths.ts`（文件末尾追加三个函数）
- Create: `src/panel/compactReviews.ts`
- Test: `tests/panel/compactReviews.test.ts`

**Interfaces:**
- Consumes: `classifyReviews`、`Classification`、`LedgerView`（Task 1）；`acquireReviewsLock`、`REVIEWS_STORE_BUSY`；`ReviewsWriter`、`readReviews`（判据用）
- Produces:
```ts
// paths.ts
export const reviewsArchiveFile: (dir: string) => string;
export const reviewsBackupFile: (dir: string) => string;
export const reviewsCompactTmpFile: (dir: string) => string;
// compactReviews.ts
export interface CompactHooks { beforeLock?: () => Promise<void>; beforeArchiveAppend?: () => Promise<void> }
export interface CompactOutcome { classification: Classification; wrote: boolean }
export async function dryRunCompaction(dir: string, views: ReadonlyMap<string, LedgerView>): Promise<Classification>;
export async function applyCompaction(dir: string, views: ReadonlyMap<string, LedgerView>, hooks?: CompactHooks): Promise<CompactOutcome>;
export type CompactMode = "dry-run" | "applied" | "nothing-to-do";
export const DRY_RUN_LAST_LINE: string;
export const APPLIED_LAST_LINE: string;
export const NOTHING_TO_DO_LAST_LINE: string;
export function renderCompactionReport(classification: Classification, mode: CompactMode, file: string): string;
```

- [ ] **Step 1：`paths.ts` 末尾追加**

```ts
/**
 * reviews compaction spec section 7: the three paths only
 * `orca compact-reviews --apply` writes. The panel itself only appends
 * reviews.jsonl and takes .reviews-lock.
 */
export const reviewsArchiveFile = (dir: string): string => join(dir, "reviews-archive.jsonl");
export const reviewsBackupFile = (dir: string): string => join(dir, "reviews.jsonl.pre-compact");
export const reviewsCompactTmpFile = (dir: string): string => join(dir, "reviews.jsonl.compact-tmp");
```

- [ ] **Step 2：写桩**

```ts
// src/panel/compactReviews.ts -- STUB for the red run.
import { readFile } from "node:fs/promises";
import { classifyReviews } from "./compactClassify.js";
import type { Classification, LedgerView } from "./compactClassify.js";
import { reviewsFile } from "./paths.js";

export interface CompactHooks {
  beforeLock?: () => Promise<void>;
  beforeArchiveAppend?: () => Promise<void>;
}
export interface CompactOutcome {
  classification: Classification;
  wrote: boolean;
}
export type CompactMode = "dry-run" | "applied" | "nothing-to-do";
export const DRY_RUN_LAST_LINE = "dry run; nothing was written. Pass --apply to write.";
export const APPLIED_LAST_LINE =
  "written; a running orca panel picks this up on its next duplicate check, no restart needed";
export const NOTHING_TO_DO_LAST_LINE = "nothing to compact; no file was written";

export async function dryRunCompaction(dir: string, views: ReadonlyMap<string, LedgerView>): Promise<Classification> {
  const text = await readFile(reviewsFile(dir), "utf8").catch(() => "");
  return classifyReviews(text, views);
}

export async function applyCompaction(
  _dir: string,
  views: ReadonlyMap<string, LedgerView>,
  _hooks: CompactHooks = {},
): Promise<CompactOutcome> {
  return { classification: classifyReviews("", views), wrote: false };
}

export function renderCompactionReport(_c: Classification, _mode: CompactMode, _file: string): string {
  return "";
}
```

- [ ] **Step 3：写判据**

```ts
// tests/panel/compactReviews.test.ts
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LedgerView } from "../../src/panel/compactClassify.js";
import { applyCompaction, dryRunCompaction } from "../../src/panel/compactReviews.js";
import {
  reviewsArchiveFile,
  reviewsBackupFile,
  reviewsFile,
  reviewsLockDir,
} from "../../src/panel/paths.js";
import { acquireReviewsLock } from "../../src/panel/reviewsLock.js";
import { ReviewsWriter } from "../../src/panel/reviewsStore.js";
import type { ReviewRow } from "../../src/panel/reviewsStore.js";

const PK = "github.com/biran/target";
const rl = (decisionId: string, at = "2026-09-10T00:00:00.000Z"): string =>
  JSON.stringify({ decisionId, projectKey: PK, action: "reviewed", by: "amy", at });

const KEPT = rl("orca-dev-1/1");
const DUP = rl("orca-dev-1/1", "2026-09-12T00:00:00.000Z");
const ORPHAN = rl("orca-dev-8/1");
const FIXTURE = `${KEPT}\n${DUP}\n${ORPHAN}\n`;

const VIEWS: ReadonlyMap<string, LedgerView> = new Map([
  [PK, { judged: true, topLevelIds: new Set(["orca-dev-1/1", "orca-dev-1/2"]), archivedIds: new Set(["orca-dev-8/1"]) }],
]);

const sha = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

/** Every entry of the store directory: file name to sha256, directory name to "dir". */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    out[name] = (await stat(path)).isDirectory() ? "dir" : await sha(path);
  }
  return out;
}

describe("applying and dry-running compaction (reviews compaction spec section 4)", () => {
  let dir: string;
  let umaskBefore: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-compact-"));
    // Pinned so the mode assertions cannot pass because of the developer's umask.
    umaskBefore = process.umask(0o022);
  });
  afterEach(async () => {
    process.umask(umaskBefore);
    await rm(dir, { recursive: true, force: true });
  });

  const seed = async (text = FIXTURE, mode = 0o600): Promise<void> => {
    await writeFile(reviewsFile(dir), text, { mode });
    await chmod(reviewsFile(dir), mode);
  };

  it("C2 moves an orphan byte for byte into the archive and out of reviews.jsonl", async () => {
    await seed();
    const outcome = await applyCompaction(dir, VIEWS);
    expect(outcome.wrote).toBe(true);
    expect(await readFile(reviewsArchiveFile(dir), "utf8")).toBe(`${ORPHAN}\n`);
    expect(await readFile(reviewsFile(dir), "utf8")).toBe(`${KEPT}\n`);
  });

  it("C2b never glues a new orphan onto a torn archive tail, and adds no blank line after a clean one", async () => {
    await seed();
    await writeFile(reviewsArchiveFile(dir), '{"torn');
    await applyCompaction(dir, VIEWS);
    const archive = await readFile(reviewsArchiveFile(dir), "utf8");
    expect(archive).toBe(`{"torn\n${ORPHAN}\n`);
    expect(JSON.parse(archive.split("\n")[1] ?? "")).toMatchObject({ decisionId: "orca-dev-8/1" });

    // Must-not: a clean tail gets no extra newline in front of the new line.
    const other = rl("orca-dev-5/1");
    await seed();
    await writeFile(reviewsArchiveFile(dir), `${other}\n`);
    await applyCompaction(dir, VIEWS);
    expect(await readFile(reviewsArchiveFile(dir), "utf8")).toBe(`${other}\n${ORPHAN}\n`);
  });

  it("C7 a dry run writes nothing, even while the lock is held, and the same fixture under apply does", async () => {
    await seed();
    const before = await snapshot(dir);
    const report = await dryRunCompaction(dir, VIEWS);
    expect(report.counts).toEqual({ kept: 1, duplicate: 1, orphan: 1, unreadable: 0, "not-judged": 0 });
    expect(await snapshot(dir)).toEqual(before);

    // It takes no lock, so a held lock does not stop it.
    const held = await acquireReviewsLock(dir);
    try {
      await expect(dryRunCompaction(dir, VIEWS)).resolves.toMatchObject({ liveText: `${KEPT}\n` });
    } finally {
      await held.release();
    }

    // Positive control: the same fixture is not a no-op under apply.
    const liveBefore = await sha(reviewsFile(dir));
    await applyCompaction(dir, VIEWS);
    expect(await sha(reviewsFile(dir))).not.toBe(liveBefore);
  });

  it("C8 an apply with nothing to remove writes nothing and creates no backup", async () => {
    await seed(`${KEPT}\n`);
    const before = await snapshot(dir);
    const outcome = await applyCompaction(dir, VIEWS);
    expect(outcome.wrote).toBe(false);
    expect(await snapshot(dir)).toEqual(before);
  });

  it("C8b an apply against a store directory that does not exist creates nothing", async () => {
    // Rule 17: `orca compact-reviews --apply` on a machine with no ~/.orca must
    // not be the thing that creates one.
    const absent = join(dir, "absent");
    const outcome = await applyCompaction(absent, VIEWS);
    expect(outcome.wrote).toBe(false);
    await expect(stat(absent)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("C9 the backup holds the original bytes, not the compacted ones", async () => {
    await seed();
    await applyCompaction(dir, VIEWS);
    expect(await readFile(reviewsBackupFile(dir), "utf8")).toBe(FIXTURE);
  });

  it("C10 appends an orphan once even when an earlier run already archived it", async () => {
    // The crash between the archive append and the rename leaves the orphan in
    // both files; the re-run must not archive it twice. The not-pre-seeded
    // half of this pair is C2.
    await seed();
    await writeFile(reviewsArchiveFile(dir), `${ORPHAN}\n`);
    await applyCompaction(dir, VIEWS);
    expect(await readFile(reviewsArchiveFile(dir), "utf8")).toBe(`${ORPHAN}\n`);
  });

  it("C11 keeps the live file's own mode, creates the archive and backup 0600, and leaves an existing backup's mode alone", async () => {
    await seed(FIXTURE, 0o644);
    await applyCompaction(dir, VIEWS);
    // Literals, not the constants a mutation would edit on both sides.
    expect((await stat(reviewsFile(dir))).mode & 0o777).toBe(0o644);
    expect((await stat(reviewsArchiveFile(dir))).mode & 0o777).toBe(0o600);
    expect((await stat(reviewsBackupFile(dir))).mode & 0o777).toBe(0o600);

    await seed(FIXTURE, 0o644);
    await chmod(reviewsBackupFile(dir), 0o640);
    await applyCompaction(dir, VIEWS);
    expect((await stat(reviewsBackupFile(dir))).mode & 0o777).toBe(0o640);
  });

  it("C12 refuses by name while the lock is held and touches nothing", async () => {
    await seed();
    const before = await snapshot(dir);
    const held = await acquireReviewsLock(dir);
    try {
      await expect(applyCompaction(dir, VIEWS)).rejects.toMatchObject({ code: "reviews-store-busy", exitCode: 5 });
    } finally {
      await held.release();
    }
    expect(await snapshot(dir)).toEqual(before);
  });

  it("C13 a failed archive write leaves reviews.jsonl byte for byte as it was and releases the lock", async () => {
    await seed();
    const liveBefore = await sha(reviewsFile(dir));
    await expect(
      applyCompaction(dir, VIEWS, {
        beforeArchiveAppend: async () => {
          throw new Error("simulated archive failure");
        },
      }),
    ).rejects.toThrow("simulated archive failure");
    expect(await sha(reviewsFile(dir))).toBe(liveBefore);
    await expect(stat(reviewsLockDir(dir))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("C14 keeps a row a running panel appended just before the lock was taken", async () => {
    await seed();
    const late: ReviewRow = {
      decisionId: "orca-dev-1/2",
      projectKey: PK,
      action: "reviewed",
      by: "amy",
      at: "2026-09-13T00:00:00.000Z",
    };
    await applyCompaction(dir, VIEWS, {
      // A REAL append through the panel's writer, taking the real lock: the
      // lock is free at this point, so this is the window a read outside the
      // lock would lose.
      beforeLock: async () => {
        const writer = new ReviewsWriter(dir);
        await writer.load();
        expect(await writer.append(late)).toBe("written");
      },
    });
    expect(await readFile(reviewsFile(dir), "utf8")).toBe(`${KEPT}\n${JSON.stringify(late)}\n`);
  });
});
```

- [ ] **Step 4：跑判据看红**（输出 `t3-red.txt`）
  期望红：C2（`wrote false`）、C2b（archive 仍是 `{"torn`）、C7 **红在最后的正向对照**（前两段桩下成立）、C9（`ENOENT`）、C11（归档 `stat` `ENOENT`）、C12（resolved 而非 rejected）、C13（resolved）、C14（`beforeLock` 没被调用 ⇒ 活文件仍是 FIXTURE）。
  **桩下绿，登记牙齿**：C8（牙齿 M6）、C8b（牙齿 M26）、C10（牙齿 M7）。

- [ ] **Step 5：实现**（整份替换桩）

```ts
// src/panel/compactReviews.ts
import { chmod, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { classifyReviews } from "./compactClassify.js";
import type { Classification, LedgerView, LineKind } from "./compactClassify.js";
import {
  REVIEWS_FILE_MODE,
  reviewsArchiveFile,
  reviewsBackupFile,
  reviewsCompactTmpFile,
  reviewsFile,
} from "./paths.js";
import { acquireReviewsLock } from "./reviewsLock.js";

export interface CompactHooks {
  /** Test seam (spec C14): after the caller's unlocked work, before the lock is taken. */
  beforeLock?: () => Promise<void>;
  /** Test seam (spec C13): immediately before the archive append; a throw stands in for that write failing. */
  beforeArchiveAppend?: () => Promise<void>;
}

export interface CompactOutcome {
  classification: Classification;
  wrote: boolean;
}

export type CompactMode = "dry-run" | "applied" | "nothing-to-do";
export const DRY_RUN_LAST_LINE = "dry run; nothing was written. Pass --apply to write.";
export const APPLIED_LAST_LINE =
  "written; a running orca panel picks this up on its next duplicate check, no restart needed";
export const NOTHING_TO_DO_LAST_LINE = "nothing to compact; no file was written";

const isEnoent = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === "ENOENT";

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) return "";
    throw err;
  }
}

/** Created with an explicit 0600 when absent; an existing file keeps its mode (Rule 17). */
async function ensureFile(path: string): Promise<void> {
  try {
    await writeFile(path, "", { flag: "wx", mode: REVIEWS_FILE_MODE });
    await chmod(path, REVIEWS_FILE_MODE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

async function writeSynced(path: string, flags: "a" | "w", data: string): Promise<void> {
  const handle = await open(path, flags);
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** spec section 3.2: reads without the lock and writes nothing. */
export async function dryRunCompaction(dir: string, views: ReadonlyMap<string, LedgerView>): Promise<Classification> {
  return classifyReviews(await readOrEmpty(reviewsFile(dir)), views);
}

/**
 * spec section 4.1. The order is load-bearing (section 4.2): the backup, then
 * the archive, then the rename -- so a crash at any point leaves an orphan in
 * at least one file that the next apply will not overwrite.
 */
export async function applyCompaction(
  dir: string,
  views: ReadonlyMap<string, LedgerView>,
  hooks: CompactHooks = {},
): Promise<CompactOutcome> {
  // Rule 17: never the command that creates the store directory. Taking the
  // lock would otherwise fail on a missing parent with a raw ENOENT.
  try {
    await stat(dir);
  } catch (err) {
    if (isEnoent(err)) return { classification: classifyReviews("", views), wrote: false };
    throw err;
  }

  await hooks.beforeLock?.();
  const lock = await acquireReviewsLock(dir);
  try {
    // Read INSIDE the lock: a row the panel appended before this point is in
    // `text`, and nothing can append between here and the rename.
    const live = reviewsFile(dir);
    const text = await readOrEmpty(live);
    const classification = classifyReviews(text, views);
    if (classification.counts.duplicate === 0 && classification.counts.orphan === 0) {
      return { classification, wrote: false };
    }
    const liveMode = (await stat(live)).mode & 0o777;

    const backup = reviewsBackupFile(dir);
    await ensureFile(backup);
    await writeSynced(backup, "w", text);

    await hooks.beforeArchiveAppend?.();
    const archive = reviewsArchiveFile(dir);
    await ensureFile(archive);
    const archived = await readFile(archive, "utf8");
    const already = new Set(archived.split("\n"));
    const fresh = classification.orphanLines.filter((line) => !already.has(line));
    if (fresh.length > 0) {
      // A torn tail from an earlier crash would swallow the first new line.
      const separator = archived.length > 0 && !archived.endsWith("\n") ? "\n" : "";
      await writeSynced(archive, "a", separator + fresh.map((line) => `${line}\n`).join(""));
    }

    // rename gives reviews.jsonl a new inode; the chmod keeps the person's
    // mode on it instead of quietly replacing that mode with ours.
    const tmp = reviewsCompactTmpFile(dir);
    await ensureFile(tmp);
    await writeSynced(tmp, "w", classification.liveText);
    await chmod(tmp, liveMode);
    await rename(tmp, live);
    return { classification, wrote: true };
  } finally {
    await lock.release();
  }
}

const KIND_ORDER: readonly LineKind[] = ["kept", "duplicate", "orphan", "unreadable", "not-judged"];

export function renderCompactionReport(classification: Classification, mode: CompactMode, file: string): string {
  const out = [`orca compact-reviews: ${file}`];
  for (const kind of KIND_ORDER) out.push(`  ${kind.padEnd(11)} ${classification.counts[kind]}`);

  const labels: string[] = [];
  for (const { cls } of classification.lines) {
    if (cls.kind !== "not-judged") continue;
    const label =
      cls.reason === "decision-not-found"
        ? `  ${cls.reason} ${cls.projectKey} ${cls.decisionId}`
        : `  ${cls.reason} ${cls.projectKey}`;
    if (!labels.includes(label)) labels.push(label);
  }
  if (labels.length > 0) out.push("not judged:", ...labels);

  out.push(mode === "applied" ? APPLIED_LAST_LINE : mode === "nothing-to-do" ? NOTHING_TO_DO_LAST_LINE : DRY_RUN_LAST_LINE);
  return `${out.join("\n")}\n`;
}
```

- [ ] **Step 6：跑判据看绿**（输出 `t3-green.txt`）：`11 passed`，RC 0。另跑 `tests/panel/reviewsStore.test.ts` 确认既有 10 条仍绿。
- [ ] **Step 7：typecheck ＋ 字节扫描。**
- [ ] **Step 8：提交**

```bash
/usr/bin/git add src/panel/paths.ts src/panel/compactReviews.ts tests/panel/compactReviews.test.ts
/usr/bin/git commit -m "feat(panel): compact reviews.jsonl under the reviews lock, backup and archive before the rename"
```

---

### Task 4：CLI `orca compact-reviews`

**Files:**
- Modify: `src/cli.ts`（import、USAGE 末尾一段、`runCompactReviews`、`main` 分派）
- Test: `tests/panel/compactReviewsCli.test.ts`

**Interfaces:**
- Consumes: `collect`、`MetricsRejection`、`correctionsDir`（既有）；`buildLedgerViews`、`wantedDecisions`（Task 2）；`applyCompaction`、`dryRunCompaction`、`renderCompactionReport`、`APPLIED_LAST_LINE`（Task 3）；`PanelRejection`；`reviewsFile`
- Produces: `main(["compact-reviews", ...])` —— 0 ／ 1 ／ 5

- [ ] **Step 1：写桩** —— `main` 里 `if (command === "panel")` 之后加：

```ts
  if (command === "compact-reviews") {
    return 1;
  }
```

- [ ] **Step 2：写判据**

```ts
// tests/panel/compactReviewsCli.test.ts
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli.js";
import { correctionsDir } from "../../src/corrections/paths.js";
import { APPLIED_LAST_LINE } from "../../src/panel/compactReviews.js";
import { reviewsArchiveFile, reviewsFile } from "../../src/panel/paths.js";
import { captureStreams, withCorrectionsDir } from "../corrections/harness.js";

const PK = "github.com/biran/target";

const decisionLine = (id: string, at = "2026-01-01T00:00:00.000Z"): string =>
  JSON.stringify({
    ev: "decision", id, at, run: id.slice(0, id.lastIndexOf("/")), question: "q", chose: "a",
    alternatives: [{ option: "b", why_not: "no" }], because: "r",
    undo: { how: "git revert abc123 -- src/foo.ts", cost: "low", blast_radius: "one file" },
    scope: "repo", kind: "interface",
  });
const rl = (decisionId: string, at = "2026-09-10T00:00:00.000Z"): string =>
  JSON.stringify({ decisionId, projectKey: PK, action: "reviewed", by: "amy", at });

const KEPT = rl("orca-dev-1/1");
const DUP = rl("orca-dev-1/1", "2026-09-12T00:00:00.000Z");
const ORPHAN = rl("orca-dev-8/1");
const NOT_FOUND = rl("orca-dev-7/1");
const STORE = `${KEPT}\n${DUP}\n${ORPHAN}\n${NOT_FOUND}\n`;

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    out[name] = (await stat(path)).isDirectory() ? "dir" : createHash("sha256").update(await readFile(path)).digest("hex");
  }
  return out;
}

describe("orca compact-reviews (reviews compaction spec section 3)", () => {
  let root: string;
  let repoPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "orca-compact-cli-"));
    repoPath = join(root, "repo");
    const put = async (rel: string, lines: string[]): Promise<void> => {
      await mkdir(dirname(join(repoPath, rel)), { recursive: true });
      await writeFile(join(repoPath, rel), lines.map((l) => `${l}\n`).join(""));
    };
    await put(".decisions/orca-dev-1.jsonl", [decisionLine("orca-dev-1/1")]);
    await put(".decisions/archive/2026/orca-dev-8.jsonl", [decisionLine("orca-dev-8/1")]);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Rule 17 guard: every store path below must resolve under the temp dir.
  const inStore = async <T>(fn: (store: string) => Promise<T>): Promise<T> =>
    withCorrectionsDir(async (store) => {
      expect(correctionsDir(process.env)).toBe(store);
      expect(store.startsWith(tmpdir())).toBe(true);
      return fn(store);
    });

  it("refuses an unknown argument and a malformed --repo by name with exit 1", async () => {
    await inStore(async () => {
      const unknown = await captureStreams(() => main(["compact-reviews", "--bogus"]));
      expect(unknown.result).toBe(1);
      expect(unknown.stderr).toContain('unknown argument "--bogus"');
      const badRepo = await captureStreams(() => main(["compact-reviews", "--repo", "no-equals-sign"]));
      expect(badRepo.result).toBe(1);
      expect(badRepo.stderr).toContain("--repo wants <projectKey>=<path>");
    });
  });

  it("without --apply prints the report and leaves the store byte for byte as it was", async () => {
    await inStore(async (store) => {
      await writeFile(reviewsFile(store), STORE);
      const before = await snapshot(store);
      const run = await captureStreams(() => main(["compact-reviews", "--repo", `${PK}=${repoPath}`]));
      expect(run.result).toBe(0);
      expect(run.stdout).toBe(
        [
          `orca compact-reviews: ${reviewsFile(store)}`,
          "  kept        1",
          "  duplicate   1",
          "  orphan      1",
          "  unreadable  0",
          "  not-judged  1",
          "not judged:",
          `  decision-not-found ${PK} orca-dev-7/1`,
          "dry run; nothing was written. Pass --apply to write.",
          "",
        ].join("\n"),
      );
      expect(await snapshot(store)).toEqual(before);
    });
  });

  it("with --apply compacts and says a running panel needs no restart", async () => {
    await inStore(async (store) => {
      await writeFile(reviewsFile(store), STORE);
      const run = await captureStreams(() => main(["compact-reviews", "--apply", "--repo", `${PK}=${repoPath}`]));
      expect(run.result).toBe(0);
      expect(run.stdout.trimEnd().split("\n").at(-1)).toBe(APPLIED_LAST_LINE);
      expect(await readFile(reviewsFile(store), "utf8")).toBe(`${KEPT}\n${NOT_FOUND}\n`);
      expect(await readFile(reviewsArchiveFile(store), "utf8")).toBe(`${ORPHAN}\n`);
    });
  });

  it("passes collect()'s refusal through by name with exit 1 and writes nothing", async () => {
    await inStore(async (store) => {
      await writeFile(reviewsFile(store), STORE);
      // A decision dated after now, with no --as-of: collect() refuses the
      // whole command (spec section 1.7), and compaction inherits that.
      await writeFile(join(repoPath, ".decisions", "future.jsonl"), `${decisionLine("orca-dev-2/1", "2099-01-01T00:00:00.000Z")}\n`);
      const before = await snapshot(store);
      const run = await captureStreams(() => main(["compact-reviews", "--apply", "--repo", `${PK}=${repoPath}`]));
      expect(run.result).toBe(1);
      expect(run.stderr).toContain("rejected: future-rows-without-as-of");
      expect(await snapshot(store)).toEqual(before);
    });
  });

  it("lists compact-reviews in the usage text", async () => {
    const { stderr } = await captureStreams(() => main([]));
    expect(stderr).toContain("orca compact-reviews [--apply]");
  });
});
```

⚠️ `withCorrectionsDir` 用 `mkdtemp(join(tmpdir(), …))`，所以 `store.startsWith(tmpdir())` 按字符串成立（不经 realpath）；**Step 3 的红跑里若这条守卫本身红了，停 —— 那是夹具问题，不是被测代码。**

- [ ] **Step 3：跑判据看红**（输出 `t4-red.txt`）
  期望：第一条红在 `toContain('unknown argument "--bogus"')`（退出码 1 那条桩下成立）；dry-run 红在 `stdout` 的 `toBe`；apply 红在末行；refusal 红在 `stderr` 的 `toContain`；usage 红在 `toContain`。

- [ ] **Step 4：实现**

`src/cli.ts` 顶部 import 追加：

```ts
import { applyCompaction, dryRunCompaction, renderCompactionReport } from "./panel/compactReviews.js";
import { buildLedgerViews, wantedDecisions } from "./panel/ledgerViews.js";
import { reviewsFile } from "./panel/paths.js";
import { PanelRejection } from "./panel/rejection.js";
```

⚠️ 先现测这四个模块的 import 链**不经过 `express`**（`runPanel` 用动态 import 正是为了不在其他子命令里加载它）：

```bash
/usr/bin/grep -n "^import" src/panel/compactReviews.ts src/panel/ledgerViews.ts src/panel/compactClassify.ts src/panel/paths.ts src/panel/rejection.ts src/panel/reviewsLock.ts src/panel/reviewsStore.ts src/panel/decisionSource.ts > "$TMPDIR/t4-imports.txt" 2>&1; cat "$TMPDIR/t4-imports.txt"
```

期望：没有一行 import `express` 或 `./server.js`／`./api.js`。有 ⇒ 改成与 `runPanel` 同形的动态 import。

USAGE 在 `orca panel …` 那一段之后、结尾反引号之前追加：

```
  orca compact-reviews [--apply] [--root <dir>] [--repo <key>=<path>]...
                                 dedupe reviews.jsonl and move rows whose decision was archived into
                                 reviews-archive.jsonl. Without --apply it prints the report and writes
                                 nothing. A row is left untouched when its repository is not found, its
                                 ledger has a bad line, or its decision is in neither the ledger nor
                                 .decisions/archive/. It never creates the store directory.
```

`runPanel` 之后加：

```ts
/**
 * reviews compaction spec section 3. Repositories come from collect() -- the
 * same --root/--repo flags as `metrics` and `panel`, so "which repositories
 * are here" has one definition -- and collect()'s refusals pass through by
 * name (section 1.7): a store key nothing resolves means nothing is touched.
 */
async function runCompactReviews(args: string[]): Promise<number> {
  let apply = false;
  let root: string | undefined;
  const repos: Array<{ projectKey: string; path: string }> = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--root" && args[i + 1] !== undefined) {
      root = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--repo") {
      const pair = args[i + 1] ?? "";
      const split = pair.indexOf("=");
      if (split <= 0) {
        process.stderr.write(`orca compact-reviews: --repo wants <projectKey>=<path>, got ${JSON.stringify(pair)}\n`);
        return 1;
      }
      repos.push({ projectKey: pair.slice(0, split), path: pair.slice(split + 1) });
      i += 1;
      continue;
    }
    process.stderr.write(`orca compact-reviews: unknown argument ${JSON.stringify(arg)}\n${USAGE}`);
    return 1;
  }

  const dir = correctionsDir(process.env);
  try {
    const observations = await collect({ root, repos, correctionsDir: dir });
    const views = await buildLedgerViews(observations.repos, await wantedDecisions(dir));
    if (!apply) {
      process.stdout.write(renderCompactionReport(await dryRunCompaction(dir, views), "dry-run", reviewsFile(dir)));
      return 0;
    }
    const outcome = await applyCompaction(dir, views);
    process.stdout.write(
      renderCompactionReport(outcome.classification, outcome.wrote ? "applied" : "nothing-to-do", reviewsFile(dir)),
    );
    return 0;
  } catch (err) {
    if (err instanceof MetricsRejection || err instanceof PanelRejection) {
      process.stderr.write(`rejected: ${err.code}: ${err.message}\n`);
      return err.exitCode;
    }
    throw err;
  }
}
```

`main` 里把 Step 1 的桩换成：

```ts
  if (command === "compact-reviews") {
    return runCompactReviews(rest);
  }
```

⚠️ `wantedDecisions` 调的 `readReviews` 在目录不存在时答 `[]`（ENOENT 分支），**不创建目录**；`collect` 读 corrections store 同样只读。

- [ ] **Step 5：跑判据看绿**（输出 `t4-green.txt`）：`5 passed`。另跑 `tests/panel/usage.test.ts` 与 `tests/metrics/cli.test.ts` 确认仍绿。
- [ ] **Step 6：typecheck ＋ 字节扫描。**
- [ ] **Step 7：提交**

```bash
/usr/bin/git add src/cli.ts tests/panel/compactReviewsCli.test.ts
/usr/bin/git commit -m "feat(cli): add orca compact-reviews, a dry run unless --apply"
```

---

### Task 5：`ReviewsWriter` 的文件身份核对

**Files:**
- Modify: `src/panel/reviewsStore.ts`
- Test: `tests/panel/reviewsStore.test.ts`（**只在文件末尾追加一个新 `describe`**）

**Interfaces:**
- Produces:
```ts
export type IdentityOf = (path: string) => Promise<string | undefined>;
export function identityFromStats(stats: { dev: number; ino: number; birthtimeMs: number }): string;
export const statIdentity: IdentityOf;
export class ReviewsWriter { constructor(dir: string, identityOf?: IdentityOf); load(): Promise<void>; append(row: ReviewRow): Promise<"written" | "duplicate"> }
```

- [ ] **Step 1：现测发布状态**（Global Constraints 4）

```bash
R=$(/usr/bin/git ls-remote origin refs/heads/main | cut -f1); /usr/bin/git merge-base --is-ancestor "$(/usr/bin/git log -1 --format=%H -- src/panel/reviewsStore.ts)" "$R"; echo "reviewsStore_last_commit_published_rc=$?"
```

RC 0 ⇒ 类注释是已发布文本（预期如此）⇒ **只追加 ERRATUM**。

- [ ] **Step 2：写桩** —— `reviewsStore.ts` 在 `export class ReviewsWriter` 之前加：

```ts
export type IdentityOf = (path: string) => Promise<string | undefined>;

export function identityFromStats(_stats: { dev: number; ino: number; birthtimeMs: number }): string {
  return "";
}

export const statIdentity: IdentityOf = async () => undefined;
```

并把构造函数改为 `constructor(private readonly dir: string, private readonly identityOf: IdentityOf = statIdentity) {}`（`append`／`load` 本步不动）。

- [ ] **Step 3：在 `tests/panel/reviewsStore.test.ts` 末尾追加判据**（import 行按需追加 `rename`、`writeFile`、`identityFromStats`；**既有 import 与既有 `it` 一个字节不动** —— 用 `import { … } from` 的**新增一行**，不改原行）

```ts
// Appended by the reviews compaction round (spec section 5). Nothing above this line is edited.
import { rename as renameFile, writeFile as writeFileRaw } from "node:fs/promises";
import { identityFromStats } from "../../src/panel/reviewsStore.js";

describe("the reviews writer after reviews.jsonl is replaced (reviews compaction spec section 5)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "orca-reviews-identity-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const reviewed = (over: Partial<ReviewRow> = {}): ReviewRow => row({ action: "reviewed", ...over });

  it("C17 writes a key again after reviews.jsonl was replaced by a rename that no longer holds it", async () => {
    const writer = new ReviewsWriter(dir);
    await writer.load();
    expect(await writer.append(reviewed())).toBe("written");
    // What `orca compact-reviews --apply` does when it moves this row out.
    const replacement = join(dir, "replacement");
    await writeFileRaw(replacement, "");
    await renameFile(replacement, reviewsFile(dir));
    expect(await writer.append(reviewed())).toBe("written");
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("C18 identityFromStats tells two files apart by birthtime even when dev and ino match", () => {
    // ext4 reuses inode numbers; two compactions in a row can hand the new
    // file the old one's ino. This machine (APFS) cannot produce that, which is
    // why the spelling is pinned here directly.
    expect(identityFromStats({ dev: 1, ino: 2, birthtimeMs: 3 })).not.toBe(identityFromStats({ dev: 1, ino: 2, birthtimeMs: 4 }));
    // The equal half, or a function that never answers equal would pass.
    expect(identityFromStats({ dev: 1, ino: 2, birthtimeMs: 3 })).toBe(identityFromStats({ dev: 1, ino: 2, birthtimeMs: 3 }));
  });

  it("C19 answers duplicate without reloading when the identity is unchanged, and it did check", async () => {
    let calls = 0;
    const writer = new ReviewsWriter(dir, async () => {
      calls += 1;
      return "same";
    });
    await writer.load();
    expect(await writer.append(reviewed())).toBe("written");
    expect(calls).toBe(1); // load only: the non-duplicate path does not look
    expect(await writer.append(reviewed())).toBe("duplicate");
    expect(calls).toBe(2); // exactly one check, and no reload (a reload would make it 3)
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("C19b keeps a claim still being written when a changed identity forces a reload", async () => {
    let calls = 0;
    const writer = new ReviewsWriter(dir, async () => (calls++ === 0 ? "before" : "after"));
    await writer.load();
    // Holding the lock parks the first append after its claim and before its
    // write, deterministically -- no sleeps.
    const held = await acquireReviewsLock(dir);
    const first = writer.append(reviewed());
    // Under the mutation that drops in-flight claims, `first` can time out on
    // the lock while `second` is awaited; mark it handled so that shows up as
    // THIS test's red, not as an unhandled rejection elsewhere in the run.
    first.catch(() => undefined);
    try {
      const second = writer.append(reviewed());
      // The second call hits memory, sees the identity change, and reloads from
      // a disk that does not hold the row yet. Only the in-flight claim can
      // still answer duplicate -- without it, it claims and waits on the lock.
      expect(await second).toBe("duplicate");
    } finally {
      await held.release();
    }
    expect(await first).toBe("written");
    expect(await readReviews(dir)).toHaveLength(1);
  });

  it("C20 writes a key again after reviews.jsonl was deleted by hand", async () => {
    // Seeded by ANOTHER writer, so this one loads a file that exists: a writer
    // that loaded "no file" and then sees "no file" has, correctly, nothing to
    // reload -- that would not be the case this criterion is about.
    const seeder = new ReviewsWriter(dir);
    await seeder.load();
    expect(await seeder.append(reviewed())).toBe("written");
    const writer = new ReviewsWriter(dir);
    await writer.load();
    await rm(reviewsFile(dir));
    expect(await writer.append(reviewed())).toBe("written");
    expect(await readReviews(dir)).toHaveLength(1);
  });
});
```

⚠️ ES module 的 `import` 必须在顶层；追加在文件末尾的 `import` 语句**语法合法**（import 声明会被提升），vitest／tsc 都接受。若本仓库 lint 规则禁止（现测 `package.json` 无 eslint），无需处理。
⚠️ `row`、`mkdtemp`、`join`、`tmpdir`、`rm`、`readReviews`、`reviewsFile`、`acquireReviewsLock`、`ReviewsWriter`、`ReviewRow` 均由文件顶部既有 import 提供（Task 0 已现测）。

- [ ] **Step 4：跑判据看红**（`tests/panel/reviewsStore.test.ts`，输出 `t5-red.txt`）
  期望红：C17（`duplicate` vs `written`）、C18（`"" not.toBe ""`）、C19（`calls` 0 vs 1）、C20（`duplicate`）。
  **现代码下绿，登记牙齿**：C19b（现代码不重建，第二个调用直接答 `duplicate` —— 牙齿是 M24）。既有 10 条全绿。

- [ ] **Step 5：实现** —— 把 Step 2 的桩与 `ReviewsWriter` 类体换成下面这段；**类上方的注释块原文逐字保留**，只在它的 ` */` 之前插入 ERRATUM 段：

插入到类注释 ` * about getting the observation mechanism off that path, not further onto it.` 这一行之后、` */` 之前：

```ts
 *
 * *** ERRATUM (2026-09-16, run orca-dev-5e5985bc, reviews compaction spec section 5) ***
 * "seeded once at startup" no longer holds on its own. `orca compact-reviews
 * --apply` replaces reviews.jsonl by rename, so a key this set remembers may no
 * longer be on disk, and answering `duplicate` for it would leave a reviewed
 * decision on the to-do list with a 200. On a duplicate hit the writer now
 * compares the file's identity (dev:ino:birthtimeMs) with the one it loaded;
 * if it changed, it rebuilds the set from disk plus the claims still being
 * written. The non-duplicate path is unchanged.
```

桩与类体替换为：

```ts
export type IdentityOf = (path: string) => Promise<string | undefined>;

/**
 * reviews compaction spec sections 5.2.1 and 5.3. birthtime is in the identity
 * because ext4 reuses inode numbers. Where a filesystem has no birthtime, Node
 * may report ctime or 0 there: 0 degrades this to dev:ino; ctime makes every
 * duplicate check see a change and re-read the file -- slower, never wrong.
 */
export function identityFromStats(stats: { dev: number; ino: number; birthtimeMs: number }): string {
  return `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`;
}

export const statIdentity: IdentityOf = async (path) => {
  try {
    return identityFromStats(await stat(path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
};

export class ReviewsWriter {
  private seen = new Set<string>();
  /** Keys claimed and not yet written (or failed). A reload keeps them. */
  private readonly inFlight = new Set<string>();
  private identity: string | undefined;
  private loaded = false;

  constructor(
    private readonly dir: string,
    private readonly identityOf: IdentityOf = statIdentity,
  ) {}

  async load(): Promise<void> {
    // Identity BEFORE the read: a replacement landing between the two is then
    // seen as a change on the next duplicate check, never missed.
    this.identity = await this.identityOf(reviewsFile(this.dir));
    const next = new Set<string>();
    for (const row of await readReviews(this.dir)) next.add(key(row));
    // A claim still being written is not on disk yet; dropping it here would
    // let a concurrent append of the same row write it twice.
    for (const claimed of this.inFlight) next.add(claimed);
    this.seen = next;
    this.loaded = true;
  }

  async append(row: ReviewRow): Promise<"written" | "duplicate"> {
    if (!this.loaded) throw new Error("orca panel: ReviewsWriter.append called before load()");
    const rowKey = key(row);
    if (this.seen.has(rowKey)) {
      // reviews compaction spec section 5.2: only on this path, so the read
      // path and the non-duplicate write path gain no I/O.
      const current = await this.identityOf(reviewsFile(this.dir));
      if (current === this.identity) return "duplicate";
      await this.load();
      if (this.seen.has(rowKey)) return "duplicate";
    }

    // Claimed HERE, synchronously, before the first `await` -- not after the
    // write finishes. `has` then `add` is a check-then-act pair, and every
    // `await` between them opens a window where a second concurrent `append`
    // call on this SAME instance can also pass the `has` check before either
    // call reaches `add`: both would then write. Task 5 wires one shared
    // ReviewsWriter into the HTTP handlers, where two clicks (or one double
    // click) are exactly two concurrent calls, so this window is reachable in
    // production, not just in theory. Removed again in the `catch` below if
    // the write itself fails, so a failed write does not permanently brand a
    // row as already-written.
    this.seen.add(rowKey);
    this.inFlight.add(rowKey);
    try {
      // `mode` here is masked by the umask, which is why the criterion pins the
      // umask explicitly rather than trusting the developer's. An
      // ALREADY-EXISTING directory keeps whatever mode it already has: a
      // recursive mkdir does not touch a directory that is already there, and
      // there is no chmod on this path -- it is a person's (or another
      // program's) directory, and changing its mode is not this program's
      // decision to make.
      await mkdir(this.dir, { recursive: true, mode: REVIEWS_DIR_MODE });
      const lock = await acquireReviewsLock(this.dir);
      try {
        const file = reviewsFile(this.dir);
        let created = false;
        try {
          await writeFile(file, "", { flag: "wx", mode: REVIEWS_FILE_MODE });
          created = true;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
        if (created) await chmod(file, REVIEWS_FILE_MODE);
        await appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
      } finally {
        await lock.release();
      }
    } catch (err) {
      this.seen.delete(rowKey);
      throw err;
    } finally {
      this.inFlight.delete(rowKey);
    }
    return "written";
  }
}
```

⚠️ 既有的两段长注释（`Claimed HERE…`、`` `mode` here is masked…``）**逐字照抄原文**，上面贴的就是原文 —— 执行时用 `diff` 核对这两段在改动前后逐字节相同（例如把改动前后的文件各自 `sed -n` 出该段再 `cmp`）。
⚠️ 顶部 `import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";` 需加 `stat`。**这是对既有 import 行的修改** —— 它是代码不是注释，允许。
⚠️ **自己创建文件的那一次 append 会让身份从「无」变成有** ⇒ 之后第一次重复命中会重建一次，结果不变（盘上已有自己写的行）。这是预期，不是缺陷。

- [ ] **Step 6：跑判据看绿**（输出 `t5-green.txt`）：`15 passed`。再跑 `tests/panel` 整个目录（输出 `t5-panel.txt`）确认面板其余判据全绿。
- [ ] **Step 7：typecheck ＋ 字节扫描；核对两段既有注释逐字节未变。**
- [ ] **Step 8：提交**

```bash
/usr/bin/git add src/panel/reviewsStore.ts tests/panel/reviewsStore.test.ts
/usr/bin/git commit -m "fix(panel): reload the reviews dedupe set when reviews.jsonl is no longer the file it loaded"
```

---

### Task 6：verify:panel 的 PASS 13

**Files:**
- Modify: `scripts/verify-panel.ts`（**只追加**：一个新 helper，一段 PASS 13；既有步骤、编号、注释一个字节不动）

**Interfaces:**
- Consumes: `spawnPanelAndAwaitReady`、`killGroup`、`withTimeout`、`must`、`fail`、`pass`、`apiGet`、`apiPost`、`git`、`guardedRmRecursive`、`snapshotHomeOrca`、`readReviews`、`mkdir`、`mkdtemp`（均为脚本既有）
- Produces: `PASS 13 …` 一行；失败时 `FAIL 13 …`

- [ ] **Step 1：在 `runToExit` 函数之后追加 helper**

```ts
/**
 * Step 13's `orca compact-reviews --apply`: a one-shot CLI run that must exit
 * by itself. Kept separate from runToExit, whose timeout message is about the
 * bind guard and would misname a hang here.
 */
function runCliToExit(args: string[], env: NodeJS.ProcessEnv, deadlineMs: number): Promise<ExitedChild> {
  const child = spawnOrcaCli(args, env);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk));

  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killGroup(child);
      reject(
        new Error(
          `orca ${args[0]} (pid ${child.pid}) did not exit by itself within ${deadlineMs}ms; the whole process ` +
            `group was killed. stderr: ${stderr}`,
        ),
      );
    }, deadlineMs);

    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ pid: child.pid, code, stdout, stderr });
    });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}
```

- [ ] **Step 2：在 `pass(12, …)` 那一行之后、`} catch (err) {` 之前追加 PASS 13**

```ts
    // Step 13 (reviews compaction spec 2026-09-16, section 6.2). Not one of E3
    // spec section 7's twelve: it runs after them, on its OWN store directory
    // and its OWN panel process, because step 8 left an unresolvable
    // correction in the first store that makes every collect() refuse.
    // A running panel remembers a `reviewed` row; compaction moves it out while
    // the decision is archived; the decision comes back; agreeing again must
    // WRITE, not answer `duplicate` from memory.
    const storeDir13 = await mkdtemp(join(tmpdir(), "orca-panel-verify-store-"));
    cleanups.push({
      what: "remove step 13's throwaway ORCA_CORRECTIONS_DIR",
      run: () => guardedRmRecursive(storeDir13, "orca-panel-verify-store-"),
    });
    const env13: NodeJS.ProcessEnv = { ...process.env, ORCA_CORRECTIONS_DIR: storeDir13 };
    const {
      child: panel13,
      ready: ready13,
      exited: panel13Exited,
    } = spawnPanelAndAwaitReady(panelArgs, env13, 10_000);
    cleanups.push({
      what: "kill step 13's panel child's process group and confirm it exited",
      run: () => {
        killGroup(panel13);
        return withTimeout(
          panel13Exited,
          5_000,
          `step 13 panel child (pid ${panel13.pid}) did not confirm exit within 5000ms after SIGKILL`,
        ).then(() => undefined);
      },
    });
    const ready13Line = await must(13, "the step 13 panel prints its ready line", "orca-panel ready url=... token=...", ready13);
    const reviewedRows13 = async (decisionId: string): Promise<number> =>
      (await readReviews(storeDir13)).filter(
        (r) => r.projectKey === projectKey && r.decisionId === decisionId && r.action === "reviewed",
      ).length;

    const agree13 = await apiPost(ready13Line.url, "/api/reviews", { projectKey, decisionId: B }, ready13Line.token);
    if (agree13.status !== 200) fail(13, "the first agree succeeds", 200, agree13.status);
    if ((await reviewedRows13(B)) !== 1) fail(13, "the first agree records one 'reviewed' row", 1, await reviewedRows13(B));

    const ledgerName = "verify-panel-1.jsonl";
    const archivedRel = join(".decisions", "archive", "2020", ledgerName);
    await mkdir(join(fixture.repoPath, ".decisions", "archive", "2020"), { recursive: true });
    await git(fixture.repoPath, ["mv", join(".decisions", ledgerName), archivedRel]);
    const compaction = await must(
      13,
      "orca compact-reviews --apply exits by itself",
      "exit within 20000ms",
      runCliToExit(["compact-reviews", "--apply", "--repo", `${fixture.repoKey}=${fixture.repoPath}`], env13, 20_000),
    );
    if (compaction.code !== 0) fail(13, "orca compact-reviews --apply exits 0", 0, `${compaction.code}: ${compaction.stderr}`);
    if ((await reviewedRows13(B)) !== 0) {
      fail(13, "compaction moved the archived decision's 'reviewed' row out of reviews.jsonl", 0, await reviewedRows13(B));
    }
    await git(fixture.repoPath, ["mv", archivedRel, join(".decisions", ledgerName)]);

    const againRes = await apiPost(ready13Line.url, "/api/reviews", { projectKey, decisionId: B }, ready13Line.token);
    if (againRes.status !== 200) fail(13, "agreeing again succeeds", 200, againRes.status);
    const againBody = (await againRes.json()) as { result?: unknown };
    if (againBody.result !== "written") {
      fail(13, "the running panel writes the review again instead of answering duplicate from memory", "written", againBody.result);
    }
    if ((await reviewedRows13(B)) !== 1) fail(13, "exactly one 'reviewed' row is back on disk", 1, await reviewedRows13(B));
    const todo13 = (await (await apiGet(ready13Line.url, "/api/todo", ready13Line.token)).json()) as {
      rows: Array<{ id: string }>;
    };
    if (todo13.rows.some((r) => r.id === B)) fail(13, "the re-reviewed decision is off the to-do list", false, true);

    killGroup(panel13);
    await panel13Exited;
    const homeAfter13 = await snapshotHomeOrca();
    if (JSON.stringify(homeAfter13) !== JSON.stringify(homeBefore)) {
      fail(13, "~/.orca is unchanged by step 13 as well", homeBefore, homeAfter13);
    }
    pass(13, "a running panel writes a review again after compaction moved it out, and ~/.orca is still unchanged");
```

⚠️ 执行前现读：`panelArgs`、`projectKey`、`B`、`fixture`、`homeBefore` 都是 `main` 里 PASS 12 之前已定义、**作用域可达**的局部量（本计划写下时读过 `scripts/verify-panel.ts` 第 560–853 行）。
⚠️ 夹具仓库此时 git 工作树里有两次 `git mv`，最终回到原位 ⇒ `git status` 应为空；PASS 13 不断言它（PASS 6 已断言过「面板不碰仓库」，这里动仓库的是判据自己）。

- [ ] **Step 3：跑整条 verify:panel**

```bash
rtk proxy npm run build --workspace web > "$TMPDIR/t6-build.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/t6-build.txt"
rtk proxy npm run verify:panel > "$TMPDIR/t6-panel.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/t6-panel.txt"
ls ~/.orca > "$TMPDIR/t6-orca.txt" 2>&1; echo "LS_RC=$?" >> "$TMPDIR/t6-orca.txt"
```

期望：`PASS 0` … `PASS 13` 各一行，RC 0，`LS_RC=1`。
⚠️ **本步不可能先红**：Task 5 已落地。PASS 13 的牙齿由 Task 8 的 M11 证明（删掉身份核对 ⇒ `FAIL 13 … "written" vs "duplicate"`）。

- [ ] **Step 4：字节扫描；typecheck；提交**

```bash
/usr/bin/git add scripts/verify-panel.ts
/usr/bin/git commit -m "test(verify:panel): add step 13, a running panel re-recording a review that compaction moved out"
```

---

### Task 7：E3 spec 追加两条 ERRATUM

**Files:**
- Modify: `docs/superpowers/specs/2026-09-09-panel-design.md`（**只追加**）

- [ ] **Step 1：现测发布状态**（Global Constraints 4），预期已发布。
- [ ] **Step 2：锚点插入**（每个锚点断言命中 == 1）

```bash
python3 - docs/superpowers/specs/2026-09-09-panel-design.md <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
def insert_after(anchor, text):
    global s
    n = s.count(anchor); assert n == 1, (n, anchor[:60])
    s = s.replace(anchor, anchor + text)
insert_after(
    "都红在 `expected 'duplicate' to be 'written'`。上界随之变为 **2 × distinct `(projectKey, decisionId)`**，仍与运行时长无关。\n",
    "\n***ERRATUM (2026-09-16, run orca-dev-5e5985bc, reviews compaction)***\n"
    "上文「`reviews.jsonl` 没有留存策略」与「多进程下仍会重复写，有意接受」两句已被 "
    "`docs/superpowers/specs/2026-09-16-reviews-compaction-design.md` 接手：留存 ＝ 人手动 `orca compact-reviews --apply`"
    "（去重 ＋ 把**已归档**决策的行移进 `reviews-archive.jsonl`）；重复行不改数字这一点现有判据钉住（该文 C16）。\n"
    "⚠️ **本节「进程内已写集合（启动时读一次）」不再单独成立**：压实用 rename 替换文件后，面板会在「内存判重复」时核对文件身份并从盘上重建（该文 §5）。\n"
)
insert_after(
    "8. **E2 尚未实施** —— 本文建在它的 `compute.ts`、输出形状与闸门上。若实施推翻，**追加具名 ERRATUM，不就地改**。\n",
    "\n***ERRATUM (2026-09-16, run orca-dev-5e5985bc)***：第 4 项的「没有留存策略」已由 "
    "`docs/superpowers/specs/2026-09-16-reviews-compaction-design.md` 关掉；「多进程下有重复行」仍会发生，但现在有判据与清理手段。原文逐字保留。\n"
)
open(p, 'w', encoding='utf-8').write(s)
PY
```

- [ ] **Step 3：`git diff` 读回，确认只有两处纯新增行（`git diff --numstat` 的删除列为 0）；字节扫描；提交**

```bash
/usr/bin/git diff --numstat docs/superpowers/specs/2026-09-09-panel-design.md > "$TMPDIR/t7-numstat.txt"; cat "$TMPDIR/t7-numstat.txt"
/usr/bin/git add docs/superpowers/specs/2026-09-09-panel-design.md
/usr/bin/git commit -m "docs(spec): point E3's reviews retention and dedupe notes at the compaction spec"
```

---

### Task 8：变异（clone 副本）＋ 收尾验收

- [ ] **Step 1：建副本**

```bash
CLONE=$(mktemp -d "$TMPDIR/orca-mut-XXXXXX")/repo
/usr/bin/git clone -q --local /Users/biran/code/skills/loop/Orca "${CLONE:?}"
ln -s /Users/biran/code/skills/loop/Orca/node_modules "${CLONE:?}/node_modules"
cd "${CLONE:?}" && rtk proxy ./node_modules/.bin/vitest run tests/panel > "$TMPDIR/mut-base.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/mut-base.txt"
```

⚠️ **shell 状态不跨调用持久**：每个后续命令块开头重新 `CLONE=<上面打印出来的绝对路径>`，并一律 `"${CLONE:?}"`。
期望副本基线全绿（`tests/panel` 全部）。

- [ ] **Step 2：逐条变异** —— 每条：取 sha → 改 → 取 sha（不等才算落上）→ 读回变异行 → 跑点名文件（输出到 `mut-<id>.txt`，整份读回）→ `/usr/bin/git -C "${CLONE:?}" checkout -- <file>` 还原 → 取 sha 等于原值。
  ⚠️ **副本里的 `checkout` 不是主工作树**，Rule 15 的「零 stash／reset／checkout」管的是主工作树。

下表「红在」按**判据标题前缀**写，**「且仅」**指 `tests/panel` 全目录跑下只有这些红（所以每条都跑 `tests/panel` 整个目录，不只跑点名文件）。
⚠️ 每条预言写下前已问过三问：前面有没有断言先炸；被删那行还有谁在走；点名断言里的字面量从哪个字段来。**实施后逐条验收，不符即记更正，不改代码去迁就预言。**

| # | 文件 | 变异（精确改法） | 预言：红在（且仅） |
|---|---|---|---|
| M1 | `compactClassify.ts` | `const lines: ClassifiedLine[] = parts.map(` → `const lines: ClassifiedLine[] = [...parts].reverse().map(`，并在该 `map(...)` 的闭合 `)` 后加 `.reverse()` | C1；C5 leaves an unreadable…；C2；C14；CLI `with --apply` |
| M2 | `compactClassify.ts` | `if (view === undefined) return notJudged("repo-not-discovered", row);` → `if (view === undefined) return notJudged("decision-not-found", row);` | C3 |
| M3 | `ledgerViews.ts` | 删 `if (await decisionIdsIn(file, topLevelIds)) malformed = true;` 的 `if (…) malformed = true;` 外壳，只留 `await decisionIdsIn(file, topLevelIds);` | C4 |
| M3b | `ledgerViews.ts` | `decisionIdsIn` 里 `if (row.kind !== "decision") continue;` 之后加 `if (validateLine(row.raw).verdict === "rejected") continue;`（并 import `validateLine`） | C4b |
| M4 | `compactClassify.ts` | `.filter(({ l }) => l.cls.kind !== "duplicate" && l.cls.kind !== "orphan")` → 追加 `&& l.cls.kind !== "unreadable"` | C5 leaves an unreadable…；C5 keeps a torn… |
| M5 | `cli.ts` | 删 `if (!apply) { … return 0; }` 整块 | CLI `without --apply` |
| M6 | `compactReviews.ts` | 删「`duplicate === 0 && orphan === 0` ⇒ return」那个 `if` 块 | C8 |
| M7 | `compactReviews.ts` | `const fresh = classification.orphanLines.filter((line) => !already.has(line));` → `const fresh = classification.orphanLines;` | C10 |
| M8 | `compactReviews.ts` | 删 `await chmod(tmp, liveMode);` | C11 |
| M9 | `compactReviews.ts` | 把「`const tmp = …` 到 `await rename(tmp, live);`」四行整体挪到 `await hooks.beforeArchiveAppend?.();` 之前 | C13 |
| M10 | `compactReviews.ts` | 把 `const live = reviewsFile(dir);` 与 `const text = await readOrEmpty(live);` 两行挪到 `await hooks.beforeLock?.();` 之前 | C14 |
| M11 | `reviewsStore.ts` | `append` 里 `const current = …` 到第二个 `if (this.seen.has(rowKey)) return "duplicate";` 四行 → 换成一行 `return "duplicate";` | C17；C19；C20 ＋ **verify:panel `FAIL 13`**（另跑，见 Step 3） |
| M12 | `reviewsStore.ts` | `` return `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`; `` → `` return `${stats.dev}:${stats.ino}`; `` | C18 |
| M14 | `compactClassify.ts` | `[row.projectKey, row.decisionId, row.by, row.action]` → `[row.projectKey, row.decisionId, row.by]` | C15 |
| M15 | `compactClassify.ts` | 在 `const survivors = …;` 之后加 `survivors.reverse();` | C5 leaves an unreadable…；C5 keeps a torn…；C6；C14；CLI `with --apply` |
| M16 | `compactReviews.ts` | `await writeSynced(backup, "w", text);` → `await writeSynced(backup, "w", classification.liveText);` | C9 |
| M17 | `reviewsStore.ts` | `if (current === this.identity) return "duplicate";` → `if (current === undefined \|\| current === this.identity) return "duplicate";` | C20 |
| M18 | `compactReviews.ts` | 删 `if (fresh.length > 0) { … }` 整块 | C2；C2b；CLI `with --apply` |
| M19 | `cli.ts` | `if (arg === "--apply") { apply = true; continue; }` → `if (arg === "--apply") { continue; }` | CLI `with --apply` |
| M20 | `compactReviews.ts` | `const lock = await acquireReviewsLock(dir);` → `const lock = await acquireReviewsLock(dir).catch(() => ({ release: async () => undefined }));` | C12 |
| M21 | `compactReviews.ts` | `const separator = archived.length > 0 && !archived.endsWith("\n") ? "\n" : "";` → `const separator = "";` | C2b |
| M22 | `compactClassify.ts` | 删 `if (!atTopLevel && !view.archivedIds.has(row.decisionId)) return notJudged("decision-not-found", row);` | a row whose decision is in neither place；C4c；C4d；CLI `without --apply`；CLI `with --apply` |
| M23 | `coverage.ts` | `computePanelCoverage` 里改为按行计数：在 `const reviewed = new Set<string>();` 后加 `let rows = 0;`，`if (highTier.has(key)) reviewed.add(key);` → `if (highTier.has(key)) { reviewed.add(key); rows += 1; }`，返回 `reviewed_high_tier: rows` 与 `rate: … rows / highTier.size` | C15；C16 duplicate reviewed rows…；**以及下方 grep 找到的既有判据** |
| M24 | `reviewsStore.ts` | 删 `for (const claimed of this.inFlight) next.add(claimed);` | C19b |
| M25 | `ledgerViews.ts` | 删 `if (runId.includes("/") \|\| runId.includes("\\")) return undefined;` | C4d |
| M26 | `compactReviews.ts` | 删 `applyCompaction` 开头 `try { await stat(dir); } catch …` 整块 | C8b |

（M13 作废：单飞不落地，spec §5.2。）

**M23 的预言补全（写下预言前必须先跑，Global Constraints 8 的「普查写成可跑的 grep」）：**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/grep -n "reviewed_high_tier\|computePanelCoverage\|panel_review_coverage" tests/panel/*.test.ts scripts/verify-panel.ts > "$TMPDIR/m23-census.txt" 2>&1; cat "$TMPDIR/m23-census.txt"
```

对每个命中的判据读它的夹具：**同一 `(projectKey, id)` 有两行以上 `reviewed` 的才会红**。把结论写成「M23 另红在 X、Y」或「M23 不另红任何既有判据」，**写进台账后再跑 M23**。

**M24 的时序说明**：既有判据 `resolves exactly one of two concurrent appends…` 在 M24 下**预期绿** —— 第二个调用的真 `stat` 大概率在第一个调用建出文件之前返回（身份仍是「无」，不重建）。
**若它在 M24 下红了，那是时序、不是假红**：记进台账，并以 C19b 的红为 M24 的证据。

- [ ] **Step 3：M11 的端到端那一半**（副本里需先构建 web）

```bash
cd "${CLONE:?}" && rtk proxy npm run build --workspace web > "$TMPDIR/mut-build.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/mut-build.txt"
# 落 M11 后：
cd "${CLONE:?}" && rtk proxy npm run verify:panel > "$TMPDIR/mut-M11-panel.txt" 2>&1; echo "RC=$?" >> "$TMPDIR/mut-M11-panel.txt"
ls ~/.orca > "$TMPDIR/mut-M11-orca.txt" 2>&1; echo "LS_RC=$?" >> "$TMPDIR/mut-M11-orca.txt"
```

期望：`PASS 0`–`PASS 12` 后 `FAIL 13 the running panel writes the review again instead of answering duplicate from memory: "written" vs "duplicate"`，RC 1；`LS_RC=1`。
⚠️ 跑完清点残留进程：`pgrep -fl "src/cli.ts panel" > "$TMPDIR/mut-M11-procs.txt"; echo RC=$?` —— 期望 RC 1（无残留）。**teardown 的证据是守卫被删掉那次跑里的进程清点。**

- [ ] **Step 4：销毁副本前做判据文件字节比对**

```bash
for f in tests/panel/compactClassify.test.ts tests/panel/coverageDuplicates.test.ts tests/panel/ledgerViews.test.ts tests/panel/compactReviews.test.ts tests/panel/compactReviewsCli.test.ts tests/panel/reviewsStore.test.ts scripts/verify-panel.ts; do
  cmp "/Users/biran/code/skills/loop/Orca/$f" "${CLONE:?}/$f" && echo "same $f"
done > "$TMPDIR/mut-cmp.txt" 2>&1; cat "$TMPDIR/mut-cmp.txt"
/usr/bin/git -C "${CLONE:?}" status --porcelain > "$TMPDIR/mut-clone-status.txt"; wc -c < "$TMPDIR/mut-clone-status.txt"
/bin/rm -rf "$(dirname "${CLONE:?}")"
```

期望七行 `same`，副本 `status --porcelain` 0 字节（`node_modules` 符号链接若出现为 `??`，记录后照删 —— 它是 `.gitignore` 覆盖的则不会出现）。

- [ ] **Step 5：主仓库全量验收**

```bash
cd /Users/biran/code/skills/loop/Orca
ls ~/.orca > "$TMPDIR/end-orca-before.txt" 2>&1; echo "LS_RC=$?" >> "$TMPDIR/end-orca-before.txt"
rtk proxy npm run verify > "$TMPDIR/verify-end.txt" 2>&1; echo "VERIFY_RC=$?" >> "$TMPDIR/verify-end.txt"
ls ~/.orca > "$TMPDIR/end-orca-after.txt" 2>&1; echo "LS_RC=$?" >> "$TMPDIR/end-orca-after.txt"
/usr/bin/git status --porcelain > "$TMPDIR/end-status.txt"; wc -c < "$TMPDIR/end-status.txt"
```

期望：`VERIFY_RC=0`；npm test **100 files / 602 tests**（预言；不符则如实记录实测值，并逐文件核对差在哪）；scheduler 51/167；verify:panel PASS 0–13；web 8/26；两次 `LS_RC=1`；`status` 0 字节。
**整份读回 verify 日志**（逐行读；若改用穷尽式分类扫描，在台账里如实写明是哪一种）。

- [ ] **Step 6：台账** —— `.superpowers/sdd/2026-09-16-reviews-compaction/progress.md` 记：开工／收尾实测（带命令）、每条变异的 sha 前后与**实测红在**、与预言的逐条比对、所有更正。`git add -f` 后提交：

```bash
/usr/bin/git add -f .superpowers/sdd/2026-09-16-reviews-compaction/progress.md
/usr/bin/git commit -m "docs(sdd): record the reviews compaction round, its mutations and what they reddened"
```

---

## 自审（写完本计划后做的，2026-09-16）

**1. spec 覆盖**

| spec 条目 | Task |
|---|---|
| §3 子命令、四（五）分类、报告、退出码 | 1、2、3（报告）、4 |
| §3.1 R-E 正向证据、rejected 行照算 | 1（分类）、2（视图，C4b／C4c） |
| §4.1 顺序（锁内读、无事可做、备份、归档幂等 ＋ 补换行、tmp ＋ chmod ＋ rename） | 3 |
| §4.2 崩溃语义（归档先于 rename） | 3（C13 ＋ M9） |
| §4.3 mode | 3（C11） |
| §5.2 身份核对、`inFlight`、不单飞 | 5 |
| §5.2.1 `identityFromStats` | 5（C18） |
| §5.5 已发布注释追加 ERRATUM | 5 Step 5 |
| §6.2 C1–C21、C2b、C4b、C4c、C19b | 1–5；C21 拆成 CLI 五条 |
| §6.2 端到端 PASS 13 | 6 |
| §6.3 M1–M26（M13 作废） | 8 |
| §7 Rule 17 路径 | 3（paths ＋ 实现）；Global Constraints 2 |
| 头注：E3 spec 追加 ERRATUM | 7 |

**计划相对 spec 的增补（登记，不掩饰）**：
- **C8b ／ M26**：「目录不存在 ⇒ 什么都不做」。spec §7 只写了触发者与残留，没写「永不创建 store 目录」；加锁在缺目录时会抛裸 `ENOENT`。这是 Rule 17 的直接推论。
- **C4d ／ M25**：决策 id 的 run 部分含 `/` 时不拼进归档路径。spec §3.1 定了 `archive/<YYYY>/<run-id>.jsonl`，没说 id 来自数据、可能越出归档目录。
- **C7 的 CLI 一半**落在 Task 4（M5 打的是 CLI 的闸门，执行层的试跑函数本来就不写）。

**2. 占位扫描**：无 TBD／TODO；每个代码步骤都给了完整代码；M23 的预言**有意**留一个由 grep 普查补全的空 —— 它不是占位，是「普查写成可跑命令」那条纪律要求的先跑后写。

**3. 类型一致性**：`LedgerView`、`Classification`、`LineKind` 在 Task 1 定义，Task 2／3 按同名同形消费；`applyCompaction(dir, views, hooks)` 在 Task 3 定义、Task 4 调用；`IdentityOf`、`identityFromStats`、`statIdentity` 在 Task 5 桩与实现里签名一致；Task 3 判据 import 的 `reviewsLockDir` 是 `paths.ts` 既有导出。
