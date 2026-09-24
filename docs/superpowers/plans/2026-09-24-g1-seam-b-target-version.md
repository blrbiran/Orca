# G1 缝 B：`targetVersion` 统一为安全整数 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `targetVersion` 从 plan 文件到 start envelope 是同一个正安全整数，关掉 `start-envelope-conflict:run:targetVersion`。

**Architecture:** 只改 Orca。plan 文件 schema、`ControlPlanV1`／`WorkItemViewV1` schema、Web 类型收成整数；`planImport` 把 plan 的值写进列；
panel 视图撤掉 `union`／`String()` 胶布。ccloop 零改动、protocol 不升版本。

**Tech Stack:** TypeScript、zod、vitest、node:sqlite（ControlStore）。

**Spec:** `docs/superpowers/specs/2026-09-24-g1-seam-b-target-version-design.md`（**先读它**；本计划与 spec 冲突时 spec 优先）。

**归属**：Orca 控制器会话 `ae4061a5`，2026-09-24。观测锚点＝主题行
`docs(spec): fold the verified seam B review into the spec, and name the dispatch-driver gap`；**行号引用前现测**。

## Global Constraints

- *** **Task 2 开工前必须有人按人裁 88 的逐条授权**（见 §A）。没有授权，Task 2 不许动任何既有判据或夹具。 ***
- `targetVersion` 在 plan 侧：`safeInteger.positive()`（≥1，≤`Number.MAX_SAFE_INTEGER`），仍 `optional()`。
- **ccloop 一个字节都不改。** `src/control/startEnvelope.ts`、`commands.ts` 的 `putWork`、`budget.ts:99` 不改。
- 代码、注释、commit message 用英文；本计划与台账用中文。
- 每笔提交结尾两行归属（**写你自己的模型**，不许写成别的模型、不许写「Human authorization」除非引的是 §A 那条人裁原文）：
  `Co-Authored-By: <你的模型> <noreply@anthropic.com>` 与本会话 `Claude-Session:` 行。
- **禁令（子代理也适用）**：不许 push／amend／merge／删分支或 worktree；不许 kill 非己进程；
  看见清单外的问题**只报不修**；验证性跑一律**重定向到文件再整份读回**；计数用 python，不用 `grep`。
- 变异**只在 `git clone --local` 副本里**；主工作树零触碰。
- env（handoff §8.2）：`ORCA_CCLOOP_BIN`＝ccloop main 的 `clone --local`＋`npm run build` 后的 `dist/cli.js`；
  `ORCA_CCLOOP_ADAPTER_CONFIG`＝`/private/tmp/…` 下 0600 的 fake-codex 配置。

---

## §A 需要人逐条授权改写的既有判据（人裁 88：指名、整条改写不许放宽、改后写明编码哪条人裁）

扫描方法：TypeScript AST（`typescript` 包），找含 `targetVersion: <字符串字面量>` 的顶层 helper，求传递闭包，
再列回调引用闭包内 helper 的 `it`／`test`。脚本 `its-consuming.mjs` 在会话 scratchpad（不入库）。
⚠️ **盲区**：经 `beforeEach` 等间接调用的 helper 数不出 `it`（下表标「按 helper 授权」的两处）。

| 文件 | 改写点 | 受影响的 `it`（AST 扫得） |
|---|---|---|
| `tests/control/fixtures/web.ts` | `:22` `targetVersion?: string` → `number`；`:48` `?? "v1"` → `?? 1` | **共享夹具**，被 14 个文件 import：`confirmation`／`contextControl`／`estimator`／`proposal`／`stopIntent`／`webCcloopSmoke`／`webContinuation`／`webContinuationAccounting`／`webDispatch`／`webFaults`／`webMutations`（`tests/control/`）、`controlLifecycle`／`controlRecoveryApi`（`tests/panel/`）、`tests/panel/fixtures/controlPanel.ts` |
| `tests/panel/fixtures/controlPanel.ts` | `:97` `"v1"` → `1` | **共享夹具**，被 `webMutations`／`controlApi`／`controlRecoveryApi` import |
| `tests/control/planImport.test.ts` | `:68` `"v2"`→`2`、`:69` `"v1"`→`1`（helper `setup`） | 22 条，行 98／122／133／144／157／185／203／218／246／261／290／303／312／**330**／**347**／357／367／381／438／455／478／498。⚠️ **330、347 是空绿风险**（spec §4.3），改后要看见它们以各自理由拒收 |
| `tests/control/executionSnapshot.test.ts` | `:27` `"v1"`→`1`（helper `input`／`authority`） | 6 条，行 108／128／137／144／158／184 |
| `tests/control/webProtocol.test.ts` | `:116`、`:124`、`:396` `"v1"`→`1` | `validates normalized plans and rejects unsorted or duplicate sets`（L105）、`enforces canonical group allocation ownership and command revision nullability`（L343） |
| `tests/panel/controlReadApi.test.ts` | `:88` `"v2"`→`2`、`:89` `"v1"`→`1`（helper `setup`） | **按 helper 授权**（AST 数出 0 条：经 `beforeEach` 调用） |
| `web/tests/controlPanel.test.tsx` | `:48`、`:49` `"1"`→`1` | 13 条，行 76／85／92／100／122／133／140／146／159／168／176／184／196 |
| `web/tests/evidenceLink.test.tsx` | `:54` `"1"`→`1` | 3 条，行 114／124／134 |
| `web/tests/controlCommandRecovery.test.tsx` | `:62` `"1"`→`1` | **按 helper 授权**（helper `groupView`，AST 数出 0 条） |

**改后注释**（每处改写点上方一行，英文）：
`// Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.`

---

## Task 1：新判据文件，先看见红

**Files:**
- Create: `tests/control/targetVersion.test.ts`

**Interfaces:**
- Consumes: `loadPlan`（`src/scheduler/planFile.ts`）、`controlPlanSchema`／`workItemViewSchema`／`dispatchEnvelopeSchema`（`src/control/webProtocol.ts`）、
  `WebControlService`（`src/control/webService.ts`）、`scheduleStart`／`deliverScheduledStart`（`src/control/webDispatch.ts`）、
  `readControlGroup(store, epoch, groupId)`（`src/panel/controlViews.ts`）、`toStartEnvelope(envelope, run, work, contract)`（`src/control/startEnvelope.ts`）、
  `readCanonicalRecord`（`src/control/snapshot.js`）、`ControlError`（`.code`／`.detail`）、`webFixture`／`profileSnapshot`（`tests/control/fixtures/web.ts`）。
- Produces: 判据 N0–N9（spec §4.2 的 N1–N9，加一条正向对照 N0）。

- [x] **Step 1：写判据文件**

```ts
import { describe, expect, it } from "vitest";
import { loadPlan } from "../../src/scheduler/planFile.js";
import { controlPlanSchema, dispatchEnvelopeSchema, workItemViewSchema } from "../../src/control/webProtocol.js";
import { WebControlService } from "../../src/control/webService.js";
import { scheduleStart, deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ControlError } from "../../src/control/errors.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { toStartEnvelope } from "../../src/control/startEnvelope.js";
import type { ControlStore } from "../../src/control/store.js";
import { webFixture, profileSnapshot } from "./fixtures/web.js";

// Seam B (spec docs/superpowers/specs/2026-09-24-g1-seam-b-target-version-design.md): one
// targetVersion, a positive safe integer, from the human-written plan to the start envelope.

const planWith = (targetVersion: unknown) => ({
  targetRepo: "/abs/repo", ccloopBin: "/abs/cli.js", runsDir: "/abs/runs", workBranch: "orca/w/x",
  policy: "local-merge", ledgerMode: "in-repo",
  tasks: [{ taskId: "T1", contract: "/abs/t1.json", dependsOn: [], targetVersion, configHash: "a".repeat(64) }],
});

function malformedAt(result: ReturnType<typeof loadPlan>): string[] {
  if (!("rejections" in result)) return [];
  return result.rejections.filter((r) => r.code === "malformed").map((r) => r.message);
}

/** The error a rejected call threw, or a failure if it did not throw a ControlError at all. */
function thrown(run: () => unknown): ControlError {
  try { run(); } catch (error) { if (error instanceof ControlError) return error; throw error; }
  throw new Error("expected a ControlError, the call returned");
}

function setBody(store: ControlStore, table: "work_items" | "runs", where: string, id: string, patch: Record<string, unknown>): void {
  const row = store.db.prepare(`SELECT body FROM ${table} WHERE ${where}=?`).get(id)!;
  store.db.prepare(`UPDATE ${table} SET body=? WHERE ${where}=?`).run(JSON.stringify({ ...JSON.parse(String(row.body)), ...patch }), id);
}

/** A confirmed group "g" whose only task "a" was imported with targetVersion 3 (not 1, so a hard-coded 1 is visible). */
async function importedAt3() {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a", targetVersion: 3 }]);
  const service = new WebControlService(h.deps);
  service.confirm(h.command("confirm", h.confirmPayload()));
  return h;
}

async function claimedAt3() {
  const h = await importedAt3();
  const deps = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
  await scheduleStart(deps, h.command("start", {}));
  const outcome = await deliverScheduledStart(deps, "g");
  if (outcome.kind !== "claimed") throw new Error(`claim did not start a run: ${outcome.kind}`);
  return { h, runId: outcome.runId };
}

const contract = {
  objective: { taskId: "a", goal: "ship", successCondition: "passes", nonGoals: [] },
  context: { repoPath: ".", targetPaths: ["a.ts"], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
  executionPolicy: { autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 120_000, tokenBudget: 1_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
  safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 1, humanGateConditions: [] },
  verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
  escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
};

describe("plan file targetVersion (seam B)", () => {
  it("N0 accepts a positive integer, so the refusals below are about the value and not the fixture", () => {
    expect(malformedAt(loadPlan(planWith(1), "main"))).toEqual([]);
  });

  it("N1 refuses a string by name, at the field", () => {
    const messages = malformedAt(loadPlan(planWith("v1"), "main"));
    expect(messages).toHaveLength(1);
    expect(messages[0].startsWith("tasks.0.targetVersion:")).toBe(true);
  });

  it.each([["zero", 0], ["a fraction", 1.5], ["an unsafe integer", Number.MAX_SAFE_INTEGER + 1]])("N2 refuses %s", (_label, value) => {
    const messages = malformedAt(loadPlan(planWith(value), "main"));
    expect(messages).toHaveLength(1);
    expect(messages[0].startsWith("tasks.0.targetVersion:")).toBe(true);
  });
});

describe("imported targetVersion reaches the column, the body and the wire (seam B)", () => {
  it("N3 writes the plan's value into the column and the body alike", async () => {
    const h = await importedAt3(); try {
      const row = h.store.db.prepare("SELECT target_version, body FROM work_items WHERE group_id='g' AND id='a'").get()!;
      expect(Number(row.target_version)).toBe(3);
      expect(JSON.parse(String(row.body)).targetVersion).toBe(3);
    } finally { await h.dispose(); }
  });

  it("N4 carries it onto the run row and into the start envelope's claim", async () => {
    const { h, runId } = await claimedAt3(); try {
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
      expect(run.targetVersion).toBe(3);
      const outbox = h.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='work-claim'").get(`work:g:${runId}`)!;
      const envelope = dispatchEnvelopeSchema.parse(JSON.parse(readCanonicalRecord(h.store, JSON.parse(String(outbox.body)).envelopeHash)));
      const built = toStartEnvelope(envelope, run, { sourceDir: "/tmp/src", targetRepo: "/tmp/src", base: "main" }, contract);
      expect(built.claim.targetVersion).toBe(3);
    } finally { await h.dispose(); }
  });
});

describe("the panel refuses a targetVersion that is not the plan's integer (seam B)", () => {
  it("N5 refuses a string in the work body as invalid, not as an authority mismatch", async () => {
    const h = await importedAt3(); try {
      setBody(h.store, "work_items", "id", "a", { targetVersion: "3" });
      const error = thrown(() => readControlGroup(h.store, "epoch-test", "g"));
      expect(error.code).toBe("recovery-blocked");
      expect(error.detail?.startsWith("work-item-invalid:a:")).toBe(true);
    } finally { await h.dispose(); }
  });

  it("N6 refuses a work body whose integer differs from the plan", async () => {
    const h = await importedAt3(); try {
      setBody(h.store, "work_items", "id", "a", { targetVersion: 2 });
      const error = thrown(() => readControlGroup(h.store, "epoch-test", "g"));
      expect(error.code).toBe("recovery-blocked");
      expect(error.detail).toBe("work-item-authority:a");
    } finally { await h.dispose(); }
  });

  it("N8 refuses a string in the run body as invalid", async () => {
    const { h, runId } = await claimedAt3(); try {
      setBody(h.store, "runs", "id", runId, { targetVersion: "3" });
      const error = thrown(() => readControlGroup(h.store, "epoch-test", "g"));
      expect(error.code).toBe("recovery-blocked");
      expect(error.detail?.startsWith(`run-invalid:${runId}:`)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("N9 refuses a run whose integer differs from its work item", async () => {
    const { h, runId } = await claimedAt3(); try {
      setBody(h.store, "runs", "id", runId, { targetVersion: 2 });
      const error = thrown(() => readControlGroup(h.store, "epoch-test", "g"));
      expect(error.code).toBe("recovery-blocked");
      expect(error.detail).toBe(`run-work-identity:${runId}`);
    } finally { await h.dispose(); }
  });

  it("N0b the unmodified group reads, so N5/N6/N8/N9 are refusals of the edit and not of the fixture", async () => {
    const { h } = await claimedAt3(); try {
      const view = readControlGroup(h.store, "epoch-test", "g");
      expect(view.workItems.map((w) => w.targetVersion)).toEqual([3]);
    } finally { await h.dispose(); }
  });
});

describe("wire schemas refuse a string targetVersion (seam B)", () => {
  const task = { taskId: "a", dependencyTaskIds: [], configHash: "c".repeat(64), originalContractHash: "c".repeat(64), originalContractCanonicalJson: '{"schema":"orca-task-contract-v1"}' };
  const plan = (targetVersion: unknown) => ({ schema: "orca-control-plan-v1", repoId: "repo", planId: "plan", goal: "ship", successConditions: ["checks pass"], tasks: [{ ...task, targetVersion }] });

  it("N7 ControlPlanV1 takes 3 and refuses \"3\"", () => {
    expect(controlPlanSchema.safeParse(plan(3)).success).toBe(true);
    expect(controlPlanSchema.safeParse(plan("3")).success).toBe(false);
  });

  it("N7b WorkItemViewV1 takes the view the panel built and refuses it with a string", async () => {
    const h = await importedAt3(); try {
      const item = readControlGroup(h.store, "epoch-test", "g").workItems[0];
      expect(workItemViewSchema.safeParse(item).success).toBe(true);
      expect(workItemViewSchema.safeParse({ ...item, targetVersion: "3" }).success).toBe(false);
    } finally { await h.dispose(); }
  });
});
```

- [x] **Step 2：跑它，看见红（改动前）**

```bash
cd /Users/biran/code/skills/loop/Orca
OUT="${SCRATCH:?set SCRATCH to the session scratchpad}/task1-red.log"
./node_modules/.bin/vitest run tests/control/targetVersion.test.ts > "$OUT" 2>&1; echo "RC=$?" >> "$OUT"; cat "$OUT"
```

**预言**（逐条，改动前）：N0 红（整数被 string schema 拒）；N1 红（字符串被接受）；
⚠️ **N2 三格改动前就是绿的**（数字本来就过不了 string schema）—— 它们的红证只能来自 Task 3 的 V2／V2b，**不在这里**；
N3、N4、N5、N6、N8、N9、N0b、N7b 红（`webFixture` 写出整数 plan，导入被拒，夹具抛错）；
N7 红（`"3"` 被接受、`3` 被拒）。**把实际红集合与此表逐条比，不一致就停下报告，不要改判据迁就。**

- [x] **Step 3：不提交。** 进入 Task 2（本文件随 Task 2 一起提交）。

---

## Task 2：生产改动 ＋ §A 的改写（**要先有 §A 授权**）

**Files:**
- Modify: `src/scheduler/planFile.ts:13,35,106`；`src/control/webProtocol.ts:383,821`；`src/control/planImport.ts:214`；
  `src/panel/controlViews.ts:61,112,388,488`；`web/src/controlTypes.ts:78`
- Modify（§A 授权后）：§A 表中九个文件
- Test: `tests/control/targetVersion.test.ts`（Task 1）

**Interfaces:**
- Produces: `PlanTask.targetVersion?: number`；`SchedulerControlPlanSource.tasks[].targetVersion: number`；
  `ControlPlanV1.tasks[].targetVersion: number`；`WorkItemViewV1.targetVersion: number`（server 与 `web/src`）。

- [x] **Step 1：`src/scheduler/planFile.ts`**

在 import 区加一行（`schema.ts` 只 import `zod`，无环 —— spec §3）：

```ts
import { safeInteger } from "../control/schema.js";
```

`:13` 与 `:35`：

```ts
  targetVersion?: number;
```
```ts
    targetVersion: number;
```

`:106`：

```ts
    targetVersion: safeInteger.positive().optional(),
```

- [x] **Step 2：`src/control/webProtocol.ts`** —— `:383` 与 `:821` 都改成：

```ts
          targetVersion: positiveSafeInteger,
```

（`:821` 缩进是四格：`    targetVersion: positiveSafeInteger,`）

- [x] **Step 3：`src/control/planImport.ts:214-215`** —— 列写 plan 的值：

```ts
        deps.store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES (?,?,?,?)")
          .run(payload.groupId, task.taskId, task.targetVersion, JSON.stringify(work));
```

（先现读 `:214-215` 原文，确认第二行是 `.run(payload.groupId, task.taskId, JSON.stringify(work));` 再改；不是就停下报告。）

- [x] **Step 4：`src/panel/controlViews.ts`**

`:61` 与 `:112`：

```ts
  targetVersion: safeInteger.positive(),
```

`:388` 那一行里的 `String(body.targetVersion) !== task.targetVersion` → `body.targetVersion !== task.targetVersion`；
`:488` 那一行 `|| String(work.targetVersion) !== String(run.targetVersion)` → `|| work.targetVersion !== run.targetVersion`。
**按整行锚点改、断言命中数 == 1**（handoff 教训：子串替换会在句子中间切开）。

- [x] **Step 5：`web/src/controlTypes.ts:78`**

```ts
  targetVersion: number;
```

- [x] **Step 6：§A 九个文件逐处改写**（每处加 §A 那行英文注释）。改完用 python 全仓复扫，**期望零命中**：

```bash
cd /Users/biran/code/skills/loop/Orca
python3 - <<'EOF' > "${SCRATCH:?}/task2-rescan.txt" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/task2-rescan.txt"
import os,re
hits=0
for root,ds,fs in os.walk('.'):
    ds[:]=[d for d in ds if d not in('node_modules','.git','.superpowers','docs','dist','.orca')]
    for f in fs:
        if not f.endswith(('.ts','.tsx','.mjs','.js','.json')): continue
        p=os.path.join(root,f)
        for i,l in enumerate(open(p,errors='replace'),1):
            if re.search(r'targetVersion"?\s*:\s*["\'`]',l) or re.search(r'targetVersion\??\s*:\s*string',l) or re.search(r'targetVersion\s*\?\?\s*["\'`]',l):
                hits+=1; print(p,i,l.strip()[:120])
print('HITS',hits)
EOF
cat "${SCRATCH:?}/task2-rescan.txt"
```

- [x] **Step 7：跑 typecheck 与 Task 1 判据，看见绿**

```bash
cd /Users/biran/code/skills/loop/Orca
npm run typecheck > "${SCRATCH:?}/task2-tsc.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/task2-tsc.log"; cat "${SCRATCH:?}/task2-tsc.log"
./node_modules/.bin/vitest run tests/control/targetVersion.test.ts > "${SCRATCH:?}/task2-green.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/task2-green.log"; cat "${SCRATCH:?}/task2-green.log"
```

Expected：两个 RC 都是 0，Task 1 全部判据通过。

- [x] **Step 8：`planImport.test.ts` 的 330／347 不是空绿** —— 在它们的回调里临时打印 `JSON.stringify(result)`，
确认拒收理由分别是 `duplicate-task-id`／`duplicate-dependency`／`dangling-dependency`（或其对应的控制面码）与 contract schema，
**而不是** `malformed`。量完删掉打印，`git diff` 确认该文件只剩 §A 的改写。

- [x] **Step 9：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add tests/control/targetVersion.test.ts src/scheduler/planFile.ts src/control/webProtocol.ts src/control/planImport.ts src/panel/controlViews.ts web/src/controlTypes.ts \
  tests/control/fixtures/web.ts tests/panel/fixtures/controlPanel.ts tests/control/planImport.test.ts tests/control/executionSnapshot.test.ts tests/control/webProtocol.test.ts tests/panel/controlReadApi.test.ts \
  web/tests/controlPanel.test.tsx web/tests/evidenceLink.test.tsx web/tests/controlCommandRecovery.test.tsx
/usr/bin/git commit -F "${SCRATCH:?}/task2-msg.txt"
```

`task2-msg.txt` 内容（主题行＋正文＋两行归属，归属写**你自己的**模型）：

```
fix(control): make targetVersion one positive safe integer from plan file to start envelope

The plan's string and the control plane's revision shared a name; planImport put the string in
the work body and 1 in the column, so Web dispatch sent "v1" and the envelope refused it.
Existing criteria rewritten under ruling 88 as named by the human on 2026-09-24.
```

---

## Task 3：变异电池（`git clone --local` 副本）

**Files:** 无（只在副本里改；主工作树零触碰）

- [x] **Step 1：建副本并跑出绿基线**

```bash
C="${SCRATCH:?}/orca-mut"
/usr/bin/git clone --local /Users/biran/code/skills/loop/Orca "$C" > "${SCRATCH:?}/mut-clone.log" 2>&1
ln -s /Users/biran/code/skills/loop/Orca/node_modules "$C/node_modules"
ln -s /Users/biran/code/skills/loop/Orca/web/node_modules "$C/web/node_modules"
cd "$C" && ./node_modules/.bin/vitest run tests/control/targetVersion.test.ts > "${SCRATCH:?}/mut-base.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/mut-base.log"; cat "${SCRATCH:?}/mut-base.log"
```

绿基线 RC 0 才往下走。

- [x] **Step 2：逐条变异**。每条：`shasum -a 256` 记前值 → python 整行锚点替换、断言命中 == 1 → 记后值（**相等当场停**）→
跑「期望红」列的文件 → 记红在哪几条 → `cat` 原文件还原 → 再 `shasum` 等于前值。

| V | 文件 | 旧 → 新 | 跑 | 期望红（**且仅**） |
|---|---|---|---|---|
| V1 | `src/scheduler/planFile.ts` | `targetVersion: safeInteger.positive().optional(),` → `targetVersion: z.string().min(1).optional(),` | targetVersion.test | N0、N1、N3、N4、N5、N6、N8、N9、N0b、N7b |
| V2 | 同上 | `safeInteger.positive().optional()` → `safeInteger.optional()` | 同上 | N2[zero] |
| V2b | 同上 | `safeInteger.positive().optional()` → `z.number().positive().optional()` | 同上 | N2[a fraction]、N2[an unsafe integer] |
| V3 | `src/control/planImport.ts` | `VALUES (?,?,?,?)")` → `VALUES (?,?,1,?)")` 且 `.run(payload.groupId, task.taskId, task.targetVersion, JSON.stringify(work))` → `.run(payload.groupId, task.taskId, JSON.stringify(work))` | 同上 | N3 |
| V4 | `src/control/webDispatch.ts:281` | `targetVersion: work.targetVersion,` → `targetVersion: 1,` | 同上 | N4 与 N0b（run 1 vs work 3 ⇒ 视图在 `:488` 以 `run-work-identity` 拦下 N0b 的读）；N8／N9 自己改 run body，应仍绿 |
| V5 | `src/panel/controlViews.ts:61` | `targetVersion: safeInteger.positive(),` → `targetVersion: z.union([z.string().min(1), safeInteger]),` | 同上 | N5 |
| V6 | `src/panel/controlViews.ts:388` | 删掉 `|| body.targetVersion !== task.targetVersion` | 同上 | N6 |
| V7 | `src/control/webProtocol.ts:383` | `targetVersion: positiveSafeInteger,` → `targetVersion: nonemptyString,` | 同上 | N7，**以及所有经导入的判据**（N3–N6、N8、N9、N0b、N7b：`planImport` 的 `controlPlanSchema.safeParse` 会拒整数）⇒ N7 是唯一**直接**钉 schema 的，但这条变异**不独占** |
| V7b | `src/control/webProtocol.ts:821` | 同上（四格缩进那一行） | 同上 | N7b；**若视图出口按 `groupViewSchema` 校验**，N5／N6／N8／N9／N0b 也会红（错误形状变了）—— 实施时量，写「红在 X 与 Y」 |
| V8 | `src/panel/controlViews.ts:112` | `targetVersion: safeInteger.positive(),` → `targetVersion: z.union([z.string().min(1), safeInteger]),` | 同上 | N8 |
| V9 | `src/panel/controlViews.ts:488` | 删掉 `|| work.targetVersion !== run.targetVersion` | 同上 | N9 |

⚠️ V5 与 V8 的旧串相同（`:61` 与 `:112` 同形）⇒ **锚点必须带行号**：先按行号取那一行、断言它等于旧串、只改那一行。
⚠️ **表里的「期望红」是预言。** 实测与预言不一致 ⇒ 记实测，**不改判据迁就**；若某条变异零红，登记为「该分支无独占判据」并报告。

- [x] **Step 3：还原证明** —— 副本里 `/usr/bin/git diff | wc -c` 与 `/usr/bin/git diff --cached | wc -c` 都是 0；
副本 `tests/control/targetVersion.test.ts` 与主树同名文件 `cmp` 相同。删副本前 `/bin/rm -f` 两个软链，再 `/bin/rm -rf "$C"`。

- [x] **Step 4：把变异表（前后 sha256 全 64 位、红集合、RC）写进台账** `.superpowers/sdd/2026-09-24-g1-seam-b/progress.md`，
`/usr/bin/git add -f` **单独**加，单独提交（主题行 `docs(sdd): record the seam B mutation battery`）。

---

## Task 4：收口 —— 成功判据、Web spec 更正、handoff

- [x] **Step 1：写机械判定器**（放 scratchpad，**不入库**），先在**改动前**的树上看它红：

```python
# check-seamb.py <vitest-json>
import json, sys
d = json.load(open(sys.argv[1]))
FLAKE = {"a real SIGTERM to a real panel makes it exit cleanly, having written one shutdown row for its epoch"}
failed = {a["fullName"] for f in d["testResults"] for a in f["assertionResults"] if a["status"] == "failed"}
smoke = [a for f in d["testResults"] if f["name"].endswith("tests/control/webCcloopSmoke.test.ts") for a in f["assertionResults"]]
problems = []
if d["numPendingTests"] or d["numTodoTests"]: problems.append(f"pending={d['numPendingTests']} todo={d['numTodoTests']}")
if len(smoke) != 5 or any(a["status"] != "passed" for a in smoke): problems.append(f"smoke={[a['status'] for a in smoke]}")
if not failed <= FLAKE: problems.append(f"unexpected={sorted(failed - FLAKE)}")
print("OK" if not problems else "\n".join(problems)); sys.exit(1 if problems else 0)
```

红证：拿本会话开头那份改动前的 `test.json`（`scratchpad/gates/test.json`）喂它，**必须退 1**（smoke 有 2 条红）。

- [x] **Step 2：跑成功判据**（spec §4.1，逐段单跑，每段各取 RC，全部重定向到文件再整份读回）：
`npm run typecheck`；`vitest run --reporter=json --outputFile=…` ＋ `python3 check-seamb.py …`；`npm run verify:control`；
`verify:web-control`；`verify:web-control:consumer`；`verify:scheduler`；`verify:chain`；`npm run build --workspace web`；
`verify:panel`；`npm run --ws check`；`check-claude-md-lines`；`check-hooks-path`；ledger validate（RC ∈ {0,2}）。
可直接复用本会话 scratchpad 里的 `gates.sh` 形状。

- [x] **Step 3：Web spec 更正** —— `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` **文末追加**：

```markdown
## ERRATUM (G1 seam B, 2026-09-24)

Three statements above are superseded by `docs/superpowers/specs/2026-09-24-g1-seam-b-target-version-design.md`
(human ruling 2026-09-24: one targetVersion, a positive safe integer, from plan file to wire). The original text is kept verbatim.

- `WorkItemViewV1.targetVersion: string` (the `WorkItemViewV1` type in the read-model section) is now a positive safe integer.
- `ControlPlanV1.tasks[].targetVersion: string` (section 4.2) is now a positive safe integer.
- "`targetVersion` is the source plan's nonempty opaque version string and is not numerically coerced" (section 4.2) no longer holds:
  the source plan writes a positive safe integer, the import stores it unchanged in both the work-item column and body, and a
  string is refused as `malformed`.
```

- [x] **Step 4：handoff 滚动** —— Orca `docs/handoff/handoff.md` §三（基线按实测重写、回绿定义兑现）、§四（缝 B 做完；
**下一件是 spec §1.0 的执行驱动缺口**，并改掉「accept 卡在缝 B」这句）、§4.2 表的缝 B 列；ccloop／ccmem 的「Orca 那条线」各一句。
改完把 `git diff` 的 `-` 行单独抽出来逐条读（handoff §6.7）。

- [x] **Step 5：提交**（两笔：Web spec 更正一笔、handoff 一笔），收尾再跑一次三仓 `ls-remote`。

---

## §A 授权记录（追加于发布之后，2026-09-24，会话 `ae4061a5`）

✅ *** **§A 已授权**：人 2026-09-24 原话「§A 九个文件都授权改写」（在 §A 表摆出之后）。 ***
授权范围＝§A 表九个文件的所列改写点，**仅限把字符串 `targetVersion` 整条改写成整数**；表外任何判据仍需另行指名。
