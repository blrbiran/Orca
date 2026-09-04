# Task 10 报告：落地进 W（S14 default ref 不动）

**执行者**：Claude Opus 5 (1M context)，session `01BfFQhczP5BorRwTag5cCxL`
**起始 commit**：`03c02b5`（Task 9 的收尾）
**结束 commit**：`1632b06`
**观测时点**：2026-09-04，Orca `1632b06`，ccloop `7f2c5f6`

---

## 1. 交付了什么

| 文件 | 内容 |
|---|---|
| `src/scheduler/land.ts`（新，189 行） | §4.3 第 6 步的 git 机制：`checkoutWorkBranch`（带 default 分支拒绝）、`landIntoW`（`git fetch <副本> <sha>:refs/orca/<run-id>` → `git merge --no-ff`，冲突则枚举 + `--abort`）、`commitLedgerOnW`、`workBranchTip`、`incomingRefOf`、`ConflictState` |
| `src/scheduler/run.ts`（新，428 行） | 编排：`loadRound` / `renderRound`（`plan` 与 `run` 共用的前半段）、`runRound`（锁 → 前置 → 建 W → 记账 → 逐层跑 → 逐个落地 → 处置副本 → 退出码） |
| `src/cli.ts` | 新增 `run` 子命令；`plan` 改为调用 `loadRound`/`renderRound`，**输出字节不变** |
| `src/scheduler/ccloopRunner.ts` | `DisposeOptions` 增加可选 `keepBecause`（见 §4 债 5） |
| `tests/scheduler/sandbox.ts` | `writeFileCheck`、`seedRunnablePlan`/`seedDisjointPlan`/`seedIntersectingPlan`、`readLedgerOnBranch`、`showFileAt`、`orcaIncomingRefs`、`taskWorkdirs`、`defaultBranchOf` |
| `tests/scheduler/scenarios/S14.test.ts`、`S1.test.ts`、`S2.test.ts`、`workdirDisposal.test.ts`（新）；`S21.test.ts`（补第二半） | 7 条新判据 |

**diffstat（`03c02b5..HEAD`）**：10 files changed, 1134 insertions(+), 73 deletions(-)

### 一条使整件事成立的现测（此前没人写下来）

**ccloop 的 `scripted` adapter 一个文件都不写**（`src/runtime/scriptedAdapter.ts` 只回放 frame），
所以此前所有场景的 attempt commit 都是空的 —— 而 §7 的 `harvest` 判定空树为
`succeeded_but_empty`、**不落地**。没有真改动就没有东西可以合进 W，S1/S2/S14 都无从谈起。

**唯一的路是 `verification.requiredChecks`**：现测 ccloop `7f2c5f6`，`runLoop.ts:175` 的
`runRequiredChecks` 用 `sh -lc <command>`、`cwd` = attempt worktree 执行每条检查，而
`publishAttemptCommit` 随后在同一个 worktree 里 `git add -A`。所以一条会写文件的 required check
就是 scripted 跑出**非空 attempt commit** 的那条路。

口径（在 `scratchpad/spike2` 的一次性仓里跑，主仓零触碰）：

```
requiredChecks: ["printf 'hello\n' > a.txt"]
⇒ loop-state.json status = succeeded
⇒ refs/ccloop/orca-T1-abc/attempts/1 = 4746bcb067a3b866f640033c29cb20380cc9a143
⇒ git diff --no-renames --name-only HEAD refs/ccloop/orca-T1-abc/attempts/1 ⇒ a.txt
```

同时现测：`git fetch <本地副本路径> <sha>:refs/orca/<run-id>` **可行**（rc=0，ref 建出来了），
不需要 `uploadpack.allowAnySHA1InWant`。

---

## 2. TDD 证据

### RED

实现代码是先写出来的，所以 RED 是**把实现从工作树里拿掉**之后跑出来的，不是想象出来的：
`mv src/scheduler/{land,run}.ts <scratchpad>/impl/` ＋ `git stash push -- src/cli.ts src/scheduler/ccloopRunner.ts`，
即让判据面对 `03c02b5` 那份没有 `orca run` 的代码。

**命令**：

```
npx vitest run tests/scheduler/scenarios/S1.test.ts tests/scheduler/scenarios/S2.test.ts \
  tests/scheduler/scenarios/S14.test.ts tests/scheduler/scenarios/S21.test.ts \
  tests/scheduler/scenarios/workdirDisposal.test.ts   # 重定向进文件后整份读回
```

**真实输出（rc=1）**：

```
 Test Files  4 failed | 1 passed (5)
      Tests  6 failed | 2 passed (8)

 FAIL  S1: two tasks with disjoint write sets share a layer, both land, and the round exits 0
AssertionError: expected 1 to be +0            ← `orca run` 不存在 ⇒ USAGE ⇒ exit 1
 FAIL  S14: a whole run leaves the default branch's ref byte-identical
AssertionError: expected 1 to be +0
 FAIL  S2: two tasks with intersecting write sets run serially and the ordering lands in the ledger
AssertionError: expected 1 to be +0
 FAIL  deletes a successful task's copy once its result has landed on W
AssertionError: expected 1 to be +0
 FAIL  keeps a non-successful task's copy and prints where it is
AssertionError: expected +0 to be 1            ← 没有任何副本被建出来
 FAIL  --keep-workdirs keeps even the copies of tasks that landed
AssertionError: expected 1 to be +0
```

**为什么这是期望的红**：`main()` 不认识 `run`，走到 USAGE 分支返回 1，什么都没跑，
所以既没有 W、也没有副本目录。六条都红在自己那一条断言上。

**⚠️ 诚实登记：S21 的第二半在这一轮是【绿】的。**
`orca run` 不存在时它也「没进 W」—— 那是一次空的绿。这一点是这条判据的性质决定的：
它是**变异喂养**的判据，不是 TDD 红的判据。两件事做了：

1. 加了一条**阳性对照**：锁释放之后，**同一份 plan** 再跑一次必须 exit 0 且 W 必须存在。
   这一条在上面那次 RED 里会红（当时 `orca run` 根本不工作）。
2. 用 `M-LOCK` 让它真的被看见红（见 §5）。

### GREEN

```
npm run verify   ⇒ rc=0
  npm test              : Test Files 35 passed (35), Tests 218 passed (218)
  npm run verify:scheduler: Test Files 28 passed (28), Tests  99 passed (99)
  wall clock（`time npm run verify`）: 12.746s total（37.17s user / 32.79s system，多核并行）
```

---

## 3. `undoHowIsExecutable` 审计（🔴 债 3 / Ruling R7）

审计**不是**读源码判断的，是把 `orca run` 真的写进 W 的每一条 decision 从**台账文件里读出来**、
逐条喂 `src/ledger/undoExecutable.ts` 的真谓词，同时报 `validateLine` 的判定。
脚本：`scratchpad/undo-audit.mts`（一次性，不进仓）。

**真实输出**：

```
=== disjoint (S1 shape: landing-order decision) — exit 0, 1 ledger line(s) ===
  PASS  id=orca-round-38ba489b/1 kind=scheduling
        undo.how = "git reset --hard dbb5618b75dbce2384073b75e3af5dbdbbefe305"
        validateLine verdict = ok

=== intersecting (S2 shape: implicit-edge decision) — exit 0, 1 ledger line(s) ===
  PASS  id=orca-round-b3761dbc/1 kind=scheduling
        undo.how = "edit src/scheduler/graph.ts: swap the implicit edge direction between T1 and T2"
        validateLine verdict = ok

2 decision(s) audited, 0 failed the undoHowIsExecutable gate      （rc=0）
```

**过闸的确切字符串**：

- 本任务新写的那条（落地顺序）：`git reset --hard dbb5618b75dbce2384073b75e3af5dbdbbefe305`
  —— 过的是 `hasCommandShape`：相邻对 `reset` / `--hard`，前者匹配 `PROGRAM_WORD`，后者以 `-` 开头。
- 沿用 graph.ts 既有的那条（隐式边定向）：
  `edit src/scheduler/graph.ts: swap the implicit edge direction between T1 and T2`
  —— 过的是相邻对 `edit` / `src/scheduler/graph.ts:`（含 `/`）。

**谓词一个字没改。** 之所以选 `git reset --hard <layerBase>` 而不是 `git branch -f <W> <sha>`：
后者在 W **正被 checkout** 时 git 直接拒绝（"Cannot force update the branch checked out at ..."），
写下去是一条**看着可执行、实际执行不了**的 undo —— 那正是 §1.1.1 这道闸门要挡的东西。
`cost` / `blast_radius` 如实写了它会丢掉本层已落地的合并。

---

## 4. 五条债怎么还的

### 债 1（R6）：`src/scheduler/run.ts` ＋ `run` 子命令，且与 `plan` 是同一份代码

`loadRound(planPath)` 做「读 → 校验 → 读契约 → `buildGraph`」，`renderRound(round, preflight, verbose)` 做打印。
`cli.ts` 的 `plan` 与 `run.ts` 的 `runRound` **调用的是同一对函数**，不是两份实现（§9.4 第 1 条）；
`runRound` 在 spawn 任何东西之前**总是**打印那份报告（§9.4 第 2 条）。
`plan` 的输出字节未变（S17、`planWiresPreflight`、`emptyRequiredChecksWarning` 三条既有判据仍绿）。

判据：S1 断言 `run` 的 stdout 里有 `layer 0: T1, T2 (parallelism: 2)`，S2 断言有
`layer 0: T1 (parallelism: 1)` ＋ `layer 1: T2 (parallelism: 1)`。

### 债 2（R6）：编排层的 `scheduling` 决策写进 W

- 走 `appendEvent(decisionsDir, roundId, event)`，**没有一行手写 JSONL**（§8.2）。
- 台账文件名 `orca-round-<hash8>.jsonl`，由 `deriveRunId("round", planBytes, base)` 推出 ——
  与任务自己的 `orca-<taskId>-<hash8>.jsonl` **不同名**，A′ §3.1「结构上不可能冲突」仍成立（§8.0）。
- 两处决策：
  1. **隐式边定向**（§2.4）：直接调用 graph.ts 既有的 `implicitEdgeDecisions`，**在第一次 spawn 之前**写完并单独提交。
  2. **落地顺序**（§4.3）：只在**一层里落地了 ≥2 个任务**时写。层里只落一个 ⇒ 没有 alternatives ⇒
     按 A′ §3.5 它**不是决策**，不写。
- S2 用**真校验器**从**W 上真文件**读回：先断言 `lines.length > 0`（`every` 对空数组恒真，这是空绿的入口），
  再断言全部 `verdict === "ok"`，再断言存在 `kind === "scheduling"`。
- 变异 `M-LEDGER` 证明这三条不是装饰（§5）。

**Task 13 仍然拥有**：两类台账的完整分家、`evidence` 字段（ccloop HEAD）、`exitCode.ts` 的归约、
`out-of-repo` 的正式处理。本任务的 `roundExitCode` 是同一条规则的内联版（注释里点名了 Task 13 会替换它）。

### 债 3（R7）：`undo.how` 闸门 —— 见上面第 3 节。

### 债 4（Task 6）：S21 的第二半

`tests/scheduler/scenarios/S21.test.ts` 新增一条：持锁时 `orca run`
① `refs/heads/orca/w/x` **必须仍不存在**（第一条断言，故意排在退出码前面），
② 目标仓 HEAD 仍在原来的分支上，
③ 退出码非 0；
④ 释放锁后**同一份 plan** 再跑 exit 0 且 W 出现（阳性对照）。
Task 6 里那条「deferred to Task 10」的注释已删除（它已经过期，让它过期的就是这一笔）。
变异 `M-LOCK` 让 ① 被看见红。

### 债 5（Task 8）：§4.5 的副本处置

`disposeWorkdir` 在**`git fetch` 进 W 成功之后**才被调用 —— Task 8 拒绝在 `runTask` 里调用它是对的，
attempt commit 在 fetch 之前只在副本的对象库里可达。三档行为各有判据（`workdirDisposal.test.ts`）：

| 行为 | 判据 | 变异 |
|---|---|---|
| 成功且落地 ⇒ 删 | `taskWorkdirs(s)` 为 `[]` | `M-DISPOSE-a` |
| 非成功 ⇒ 留 ＋ 打印路径 ＋ exit 2 | 目录还在、stdout 含该路径、rc=2 | `M-DISPOSE-b` |
| `--keep-workdirs` ⇒ 全留 | 两个目录都在 | `M-DISPOSE-c` |

`disposeWorkdir` 那条「不许删不属于本 run 的路径」的守卫**一个字没动**。
新增的是一个可选的 `keepBecause` 理由串：ccloop 报 `succeeded` 但**没能进 W** 的三种情况
（§7.3 空树、§7.3 越界相交、§5 合并冲突）副本必须留，而打印
`kept (--keep-workdirs)` 在这三种情况下都是假话。

---

## 5. 变异表（全部在 `git clone --local` 副本里跑，主工作树全程零触碰）

副本：`<scratchpad>/mut`，`node_modules` 用符号链接接过去，跑之前 `ORCA_CCLOOP_BIN` 指向真 ccloop。

| 变异 | 删掉什么 | 喂它的场景 | 结果 |
|---|---|---|---|
| 🔴 `M-MAIN` | default ref 保护（两处守卫）＋ 故意 checkout default 分支 | **S14** | 红在 default ref 断言本身 |
| 🔴 `M-LOCK` | `runRound` 里的仓库锁 | **S21（第二半）** | 红在「W 必须不存在」 |
| `M-DISPOSE-a` | 落地后的 `disposeWorkdir` 调用 | 副本处置① | 红 |
| `M-DISPOSE-b` | `disposeWorkdir` 的 `outcome !== "succeeded"` 留档 | 副本处置② | 红 |
| `M-DISPOSE-c` | cli 对 `--keep-workdirs` 的传递 | 副本处置③ | 红 |
| `M-SERIALISE` | 层内并行（改成一任务一层） | **S1** | 红在「T2 的树里不该有 a.txt」 |
| `M-LAYERBASE` | 每层重取 W 的滚动 HEAD（改成恒用 run 起始基点） | **S2** | 红在「T2 的树里必须有 src/t1.txt」 |
| `M-LEDGER` | 编排层决策的 `appendEvent` ＋ 记账提交 | **S2** | 红在 `lines.length > 0` |

### 5.1 `M-MAIN` —— 逐字补丁

```diff
diff --git a/src/scheduler/land.ts b/src/scheduler/land.ts
@@ -71,13 +71,7 @@ export interface ConflictState {
  * if it does instead of silently reusing someone else's branch.
  */
 export async function checkoutWorkBranch(plan: PlanFile, defaultBranch: string, base: string): Promise<void> {
-  if (plan.workBranch === defaultBranch) {
-    throw new Error(
-      `orca: refusing to check out ${JSON.stringify(plan.workBranch)} — it is the default branch of ` +
-        `${plan.targetRepo}, and landing onto the default branch is Tier 0 (spec §4.5)`,
-    );
-  }
-  await git(plan.targetRepo, ["checkout", "-b", plan.workBranch, base]);
+  await git(plan.targetRepo, ["checkout", defaultBranch]);
 }
 
 /**
@@ -116,14 +110,6 @@ export async function landIntoW(
   // stretch of minutes in which a bug (or a person) could leave HEAD
   // somewhere else. Merging onto the wrong branch is exactly the failure
   // §4.5 forbids, and it is invisible afterwards except as a moved ref.
-  const head = (await git(plan.targetRepo, ["symbolic-ref", "--short", "HEAD"])).trim();
-  if (head !== plan.workBranch) {
-    throw new Error(
-      `orca: refusing to merge into ${JSON.stringify(head)} — the target repo must be on the work branch ` +
-        `${JSON.stringify(plan.workBranch)} before anything lands (spec §4.2.1)`,
-    );
-  }
-
   const copyPath = cloneDirOf(run.workdir);
   const incomingRef = incomingRefOf(run.runId);
   await git(plan.targetRepo, ["fetch", copyPath, `${run.attemptSha}:${incomingRef}`]);
```

**命令**：`ORCA_CCLOOP_BIN=... npx vitest run tests/scheduler/scenarios/S14.test.ts`（rc=1）

**真实输出**：

```
 FAIL  tests/scheduler/scenarios/S14.test.ts > S14 (spec §4.5) > S14: a whole run leaves the default branch's ref byte-identical
AssertionError: expected '91a1dcf4f558e067e4e423a2651a066b32355…' to be '1992b100efda799390a14cf0567294d845eb7…'
Expected: "1992b100efda799390a14cf0567294d845eb73e0"
Received: "91a1dcf4f558e067e4e423a2651a066b32355ac0"
 ❯ tests/scheduler/scenarios/S14.test.ts:33:73
     33|       expect(await refSha(s.targetRepo, `refs/heads/${defaultBranch}`)…
```

#### 🔴 这条变异跑了两遍，第一遍抓出了判据自己的一个缺陷

**第一遍**（`624b097` 那版 S14）红在别处：

```
Error: Command failed: git rev-parse orca/w/x
fatal: ambiguous argument 'orca/w/x': unknown revision or path not in the working tree.
```

变异让整轮**合到 default 分支上之后**再去找一个从没建出来的 W，抛错逃出 `runCli`，
判据在 `runCli` 那一行就死了 —— **它要量的那条 ref 断言根本没被求值**。
这正是 §10.3 那句「红在哪条断言不是可靠的判别方式」。
修法是 `f845305`：把整轮的失败**捕获**下来（`.catch((err) => err.message)`），
先比 ref，再 `expect(outcome).toBe(0)`。§4.5 禁止的是 default 分支动，**不管这一轮还干了什么**。
修完重跑，红落在第 33 行的 ref 断言上（上面那段输出）。

### 5.2 `M-LOCK` —— 逐字补丁

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -237,13 +237,7 @@ export async function runRound(planPath: string, options: RunOptions = {}): Prom
   // preflight included — is only meaningful while no second orca can be
   // moving W underneath it. Failing to acquire is exit 1: the round was
   // refused before it started, not run and found broken.
-  let lock;
-  try {
-    lock = await acquireRepoLock(plan.targetRepo);
-  } catch (err) {
-    logError((err as Error).message);
-    return 1;
-  }
+  const lock = { release: async (): Promise<void> => {} };
 
   try {
     const preflightReport = await preflight(plan, defaultBranch);
```

**真实输出**（rc=1）：

```
 FAIL  S21 > S21: with the lock held, a second orca run never enters W
AssertionError: expected 'bec379c08888fa3d011c4448cb18970b9fa5b…' to be null
- Expected: null
+ Received: "bec379c08888fa3d011c4448cb18970b9fa5bfb0"
 ❯ tests/scheduler/scenarios/S21.test.ts:39:74
     39|         expect(await refSha(s.targetRepo, `refs/heads/${p.workBranch}`…
```

### 5.3 `M-DISPOSE-a`（副本处置①）

```diff
@@ -392,11 +392,6 @@ export async function runRound(planPath: string, options: RunOptions = {}): Prom
         landed.push(taskId);
 
-        // spec §4.5, and the reason Task 8 refused to call this from runTask:
-        // the attempt commit is reachable only from inside the copy until the
-        // fetch above puts it in the target repo's object store. This line is
-        // the first moment the copy is genuinely finished with.
-        await disposeWorkdir(run, { keepWorkdirs: options.keepWorkdirs, log });
       }
```

```
 FAIL  deletes a successful task's copy once its result has landed on W
AssertionError: expected [ 'orca-T1-94237f65', …(1) ] to deeply equal []
+ Array [ "orca-T1-94237f65", "orca-T2-69c84046" ]
 ❯ workdirDisposal.test.ts:29:37
```

### 5.4 `M-DISPOSE-b`（副本处置②）

```diff
@@ -413,7 +413,7 @@ export async function disposeWorkdir(run: TaskRun, options: DisposeOptions = {})
   const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
-  const keep = options.keepWorkdirs === true || options.keepBecause !== undefined || run.outcome !== "succeeded";
+  const keep = options.keepWorkdirs === true || options.keepBecause !== undefined;
```

```
 FAIL  keeps a non-successful task's copy and prints where it is
AssertionError: expected +0 to be 1
 ❯ workdirDisposal.test.ts:59:27
```

### 5.5 `M-DISPOSE-c`（副本处置③）

```diff
@@ -151,7 +151,7 @@ async function runRun(args: string[]): Promise<number> {
   return runRound(planPath, {
     verbose: args.includes("--verbose"),
-    keepWorkdirs: args.includes("--keep-workdirs"),
+    keepWorkdirs: false,
```

```
 FAIL  --keep-workdirs keeps even the copies of tasks that landed
AssertionError: expected +0 to be 2
 ❯ workdirDisposal.test.ts:76:46
```

### 5.6 `M-SERIALISE`（喂 S1，证明「并行」那条断言不是装饰）

```diff
@@ -292,7 +292,7 @@ export async function runRound(planPath: string, options: RunOptions = {}): Prom
-    for (const [layerIndex, layer] of graph.layers.entries()) {
+    for (const [layerIndex, layer] of graph.layers.flatMap((l) => l.map((id) => [id])).entries()) {
```

```
 FAIL  S1: two tasks with disjoint write sets share a layer, both land, and the round exits 0
AssertionError: expected 'a1\n' to be null
 ❯ tests/scheduler/scenarios/S1.test.ts:34:66
     34|       expect(await showFileAt(s.targetRepo, refs[t2!], "a.txt")).toBeN…
```

### 5.7 `M-LAYERBASE`（喂 S2，证明「串行」那条断言不是装饰）

```diff
@@ -306,7 +306,7 @@ export async function runRound(planPath: string, options: RunOptions = {}): Prom
       // spec §4.2: one base per layer, read from W's rolling HEAD. ...
-      const layerBase = (await git(plan.targetRepo, ["rev-parse", "HEAD"])).trim();
+      const layerBase = base;
```

```
 FAIL  S2: two tasks with intersecting write sets run serially and the ordering lands in the ledger
AssertionError: expected null to be 't1\n'
 ❯ tests/scheduler/scenarios/S2.test.ts:31:71
```

### 5.8 `M-LEDGER`（喂 S2，证明台账断言不是装饰）

```diff
@@ -280,13 +280,7 @@ export async function runRound(planPath: string, options: RunOptions = {}): Prom
     const edgeDecisions = implicitEdgeDecisions(graph, roundId);
-    for (const decision of edgeDecisions) {
-      await appendEvent(decisionsDir, roundId, decision);
-      decisionSeq += 1;
-    }
-    if (edgeDecisions.length > 0) {
-      await commitLedgerOnW(plan, `orca: record ${edgeDecisions.length} scheduling decision(s) for ${roundId}`);
-    }
+    decisionSeq += edgeDecisions.length;
```

```
 FAIL  S2: two tasks with intersecting write sets run serially and the ordering lands in the ledger
AssertionError: expected 0 to be greater than 0
 ❯ tests/scheduler/scenarios/S2.test.ts:40:28
     40|       expect(lines.length).toBeGreaterThan(0);
```

#### 🔴 这条变异也抓出了判据的一个缺陷

第一遍红在 `readLedgerOnBranch` 抛出的
`fatal: Not a valid object name orca/w/x:.decisions` —— 助手函数崩了，
`lines.length` 那条断言没被求值。修法是 `1632b06`：树里没有 `.decisions/` 时返回 `[]`。
重跑后红落在第 40 行的断言上。

---

## 6. 还原证明（`shasum -a 256`）

- 变异开始前（`624b097`）对 `src` / `tests` / `scripts` / `package.json` / `vitest.config.ts` / `tsconfig.json`
  下全部 **66 个文件**取 sha256：`scratchpad/main-before.sha256`
- 全部变异跑完、副本删掉之后再取一次：`scratchpad/main-after.sha256`
- `diff` 结果**只有两行**，且都是**本轮故意提交的两次判据修正**（见 §5.1 / §5.8）：

```
45c45
< 35f2ef4e...  tests/scheduler/sandbox.ts        （M-LEDGER 抓出的修正，1632b06）
> a6817546...  tests/scheduler/sandbox.ts
49c49
< de5f7a3a...  tests/scheduler/scenarios/S14.test.ts   （M-MAIN 抓出的修正，f845305）
> c663b40f...  tests/scheduler/scenarios/S14.test.ts
```

其余 **64 个文件逐字节相同**。补充证据（不看肉眼）：

```
git status --porcelain   ⇒ 0 字节
git diff | wc -c         ⇒ 0
git diff --cached | wc -c⇒ 0
```

副本按 G8 处置：先 `/bin/rm -f <mut>/node_modules`（解符号链接），再 `/bin/rm -rf <mut>`。

---

## 7. ccloop 未被触碰

```
cd /Users/biran/code/skills/loop/ccloop
git status --short  ⇒ 0 字节
git rev-parse HEAD  ⇒ 7f2c5f63e9c83076e04c03ff691780e6f6f731a2   (7f2c5f6)
```

本轮对 ccloop 只做了**读**（`sed` / `grep` 源码）和**spawn**（`node dist/cli.js run ...`，
全部在 `/private/tmp` 的一次性沙盒仓上）。

---

## 8. 实测耗时

| 项 | 值 | 口径 |
|---|---|---|
| `npm run verify` 全程 | **12.746s** wall（37.17s user / 32.79s system） | `time npm run verify`，`1632b06` |
| `npm test`（218 条） | Test Files 35，Tests 218 | 同上一次跑 |
| `npm run verify:scheduler`（99 条） | Test Files 28，Tests 99 | 同上 |
| S14（1 次 run，2 次真 ccloop spawn） | **2017 ms** | 上一行那次跑的逐条计时 |
| S1（1 次 run，2 次 spawn） | **2096 ms** | 同上 |
| S2（1 次 run，2 次 spawn，两层） | **2649 ms** | 同上 |
| S21（3 次 run 尝试，其中 1 次真跑 2 次 spawn） | **2353 ms**（2 tests） | 同上 |
| `workdirDisposal`（3 次 run，5 次 spawn） | **4291 ms**（3 tests） | 同上 |

**⚠️ 花费拿不到。** 本轮全程 `scripted` adapter，没有任何模型调用；hook 报的会话累计
金额是整个会话的，不是本任务的，按 Rule 14 不做拆分估算。

---

## 9. 自查（读自己的 diff）

### 扫两个被咬过的形状

**(a) 排在被测调用之前、读回自己刚写的值的断言** —— 逐条扫过 7 条新判据：
所有断言都排在 `runCli(...)` 之后。唯一在调用前取的值是 S14 的 `before`（default ref 的 sha）
和 `defaultBranch`（分支名），它们是**读仓库既有状态**、不是测试自己写进去的，且不是断言。
S21 的第一条断言（`refSha(...) === null`）在 `runCli` 之后 —— `M-LOCK` 证明了它会红。

**(b) 判据宣称的目的与它实际量的东西不一致** —— 逐条点名能让它红的变异：

| 断言 | 能让它红的变异 | 跑过没有 |
|---|---|---|
| S14 default ref 未动 | `M-MAIN` | ✅ 跑过 |
| S14 `outcome === 0` / W 存在 / a.txt、b.txt 在 W 上 | `M-DISPOSE-a` 之外任何让 run 挂掉的改动；直接由 RED 那一轮见过红 | ✅ |
| S1 两个文件都在 W 上 | 删掉 `landIntoW` 调用 | RED 轮见过红 |
| S1 T2 的树里没有 a.txt（并行） | `M-SERIALISE` | ✅ 跑过 |
| S1 stdout 含 `layer 0: T1, T2 (parallelism: 2)` | 去掉 §9.4(2) 的 `log(renderRound(...))` | RED 轮见过红 |
| S2 T2 的树里有 src/t1.txt（串行） | `M-LAYERBASE` | ✅ 跑过 |
| S2 `lines.length > 0` / 全 `ok` / 有 `scheduling` | `M-LEDGER` | ✅ 跑过 |
| S2 两层各 parallelism 1 | 同 `M-SERIALISE` 一族 | — |
| S21 W 不存在 | `M-LOCK` | ✅ 跑过 |
| S21 阳性对照（释放后能跑成） | RED 轮见过红 | ✅ |
| 副本处置三条 | `M-DISPOSE-a/b/c` | ✅ 全跑过 |

**没有一条断言我指不出让它红的变异。**

### 自查中改掉的两处

1. `landIntoW` 的 catch 原本无差别地把任何 `git merge` 失败报成冲突。
   非冲突失败（"not something we can merge"、拒绝覆盖未跟踪文件）留不下 unmerged 条目，
   那样会把硬失败降级成一次安静的升人，而随后的 `merge --abort` 还会用自己的
   "there is no merge in progress" 盖掉真错误。改成：`conflictedPaths` 为空 ⇒ 原样重抛。
2. 非落地路径原本同时传 `keepWorkdirs` 与 `keepBecause`，打印出的理由会变成
   `--keep-workdirs` 而不是真实原因。改成只传 `keepBecause`。

---

## 10. 已知缺口与顾虑（登记，不掩饰）

1. 🔴 **§7.3 方向一第二档的 `boundary` 决策没有写进台账。** `disposition` 会返回
   `{land: true, exitContribution: 2}`，`run.ts` 打印了那些越界路径、也贡献了 exit 2，
   但**没有写 `kind: "boundary"` 的 decision**。§8.1 要求它。
   ⇒ **归 Task 13（台账接线）**，本任务按债 2 的指示只写「S2 需要的最小集」。
2. **`ledgerMode: "out-of-repo"` 目前是「响亮地拒绝」（stderr ＋ exit 1），不是 §8.5 的实现。**
   计划把它划给 Task 13。选择拒绝而不是照 in-repo 写，是因为后者会静默无视 plan 说的话。
3. **合并冲突走的是「升人 exit 3 ＋ 留副本」，不是 §5 的和解主干。** Task 11／12 拥有 §5。
   `ConflictState` 在 `land.ts` 里只带 `copyPath` / `wTip` / `incomingRef` / `conflictedPaths`
   四个字段 —— 那是 `land.ts` 在冲突那一刻真正握有的四个事实；
   §5.2 的 `conflictCommit` 与 `blocks` 由 `reconcile.ts` 在副本里物化，**不在这里预留**。
4. **退出码归约是内联的 `Math.max`**（3>2>1>0 恰好是数值序）。`exitCode.ts` 与 `M-EXIT` 归 Task 13。
   注释里点名了这一点，免得 Task 13 以为要跟一份「另一套语义」的实现打架。
5. **`--adapter-config` 是整轮一份，不是每任务一份。** plan 文件（§2.3）没有这个字段，
   本任务不发明一个。scripted 下每个 ccloop 进程各自读一遍同一份文件、各消费自己的第一帧，
   所以一份单帧配置对 N 个任务都成立。真跑（`claude` adapter）时它不带任何信息，无害。
6. **`runRound` 中途抛错时，目标仓会停在 W 上、锁已释放、W 未删。** 这是诚实的终态
   （§4.5 明说 W 不删），但它意味着人要自己 checkout 回去。没有为此加自动回滚 ——
   自动 checkout 回 default 分支正是 `M-MAIN` 要禁的那类动作。
7. ⚠️ **台账里的散文用中文，`undo.how` 用英文** —— 与 `src/scheduler/graph.ts` 里既有的
   `implicitEdgeDecisions` **逐字同款**。任务指令说「`src/` 里不要中文」，但这两类决策
   **落进同一个 `.decisions/*.jsonl` 文件**、被 S2 一起读回，半中半英是本仓库自己警告过的
   「半改比不改坏」。按 Rule 11 选了「合乎既有约定」，并按 Rule 7 在这里明写出来供推翻。
   代码、注释、CLI help、commit message **全是英文**；注释里引用 spec 原句时保留中文原文，
   这也是 `graph.ts` / `harvest.ts` 既有的做法。
8. **`git clone --local` 硬链接对象库**：跑到一半在源仓 `git gc --prune` 会剪掉副本依赖的对象。
   已知并接受（spec 登记过），本任务没有为此设计任何东西。

---

## 11. 三笔提交

```
1632b06 test(scheduler): let readLedgerOnBranch answer "no decisions" instead of throwing
f845305 test(scheduler): let S14 measure the default ref even when the round crashes
624b097 feat(scheduler): land each task into the work branch, one at a time
```

后两笔是**变异抓出来的判据修正**，各自的 commit message 里写清了是哪条变异、红在哪、为什么那个红是假的。
未 push、未合任何默认分支、未建也未删任何分支或 worktree。

---
---

# Fix 轮 1 —— 两条 Important

**执行者**：同上，session `01BfFQhczP5BorRwTag5cCxL`
**起始 commit**：`1632b06`　**结束 commit**：`1ab2882`
**观测时点**：2026-09-04，Orca `1ab2882`，ccloop `7f2c5f6`

---

## Finding 1 —— 运行时生成的台账散文必须是英文

**接受裁定，并且接受它划的那条线。** 我原来的 Rule 11 论证（「跟 `graph.ts` 保持一致」）
指错了方向：判准是**谁读它**，不是它住在哪个文件里。

- Orca 自己的开发台账 `Orca/.decisions/*.jsonl` ＝ 造 Orca 时的内部笔记，与 handoff 同类 ⇒ 中文对。
- 调度器**在运行时生成、落进目标仓库**的决策 ＝ 产品输出，落在别人的仓库里 ⇒ 与 CLI help、
  README 同一档 ⇒ **英文**。

Task 10 只是第一个真的把这份输出送进真实目标仓库的任务，所以它在这里才显形。

### 改了什么

| 位置 | 字段 |
|---|---|
| `src/scheduler/run.ts` `landingOrderDecision` | `question` / `chose` / `alternatives[].why_not` / `because` / `undo.cost` / `undo.blast_radius` |
| `src/scheduler/graph.ts` `implicitEdgeDecisions` | `question` / `chose` / `because` **＋ `alternatives[].why_not` / `undo.cost` / `undo.blast_radius`** |

⚠️ **裁定点名的是 graph.ts 的 `question` / `chose` / `because` 三个字段，我多译了三个**
（`why_not`、`undo.cost`、`undo.blast_radius`）。理由：它们和那三个是同一条决策里的同类散文、
落进同一个目标仓库的同一行 JSON，只译一半正是本仓库自己警告过的「半改比不改坏」。
如果这属于越界，说一声，我把那三个还原。

`undo.how` **一个字没动**（它本来就是英文可执行串）。
`.decisions/*.jsonl` 里**任何既有记录一行未碰**（append-only）。

### 判据：`tests/scheduler/graph.test.ts` 跑过，没有假设

```
npx vitest run tests/scheduler/graph.test.ts tests/cli/cli.test.ts   ⇒ rc=0
 Test Files  2 passed (2)
      Tests  20 passed (20)
```

Task 4 的判据断言的是 `kind`、`alternatives` 长度、真校验器的 verdict —— 没有一条断言散文，
所以译文安全，**这是跑出来的，不是推出来的**。

⚠️ **本条没有点名变异**：它改的是数据的自然语言，不是分支。没有任何一条「删掉它自己」的变异
存在 —— 能量到的只有「决策还在不在、合不合法」，那正是 `M-LEDGER` 已经在量的东西。
如实登记，不假装有。

### 重跑 `undoHowIsExecutable` 审计（裁定要求）

```
=== disjoint (S1 shape: landing-order decision) — exit 0, 1 ledger line(s) ===
  PASS  id=orca-round-6a1bcb9d/1 kind=scheduling
        undo.how = "git reset --hard 8b9b02d21ff02720ba9178656a55b200695dbe49"
        validateLine verdict = ok

=== intersecting (S2 shape: implicit-edge decision) — exit 0, 1 ledger line(s) ===
  PASS  id=orca-round-e3d9b77c/1 kind=scheduling
        undo.how = "edit src/scheduler/graph.ts: swap the implicit edge direction between T1 and T2"
        validateLine verdict = ok

2 decision(s) audited, 0 failed the undoHowIsExecutable gate      （rc=0）
```

### 译后落进 W 的两条决策全文（从真仓库 `git show` 出来的）

```json
{
  "ev": "decision",
  "id": "orca-round-b5bdeb34/1",
  "at": "2026-09-03T21:44:27.149Z",
  "run": "orca-round-b5bdeb34",
  "question": "layer 0 has 2 tasks to land on orca/w/x, and nothing about them says which should be merged first",
  "chose": "land them one at a time in taskId lexicographic order: T1 -> T2",
  "alternatives": [
    {
      "option": "land them in the reverse order: T2 -> T1",
      "why_not": "same-layer tasks share one base commit and cannot see each other, so both orders are legal; taskId lexicographic order is the deterministic default, and the scheduler is not allowed to pick an order silently on a person's behalf"
    }
  ],
  "because": "spec §4.3 lands one task at a time rather than in a batch: one merge commit per task, so attribution needs no bisection. The order decides which task hits a conflict first (§5), which makes it a real choice rather than a mechanism",
  "undo": {
    "how": "git reset --hard 11444e60a75e11765c6edebc61779e3a8f49d6f3",
    "cost": "discard the 2 merge commits this layer already landed and re-merge them in the other order",
    "blast_radius": "the 2 merge commits layer 0 put on orca/w/x"
  },
  "scope": "repo",
  "kind": "scheduling"
}
{
  "ev": "decision",
  "id": "orca-round-5b022d50/1",
  "at": "2026-09-03T21:44:27.533Z",
  "run": "orca-round-5b022d50",
  "question": "the write sets of T1 and T2 intersect (src/**), and nothing about the pair says which of them should run first",
  "chose": "T1 runs before T2",
  "alternatives": [
    {
      "option": "T2 runs before T1",
      "why_not": "neither direction is more correct than the other; taskId lexicographic order puts the smaller one first as a deterministic default (T1 < T2), and the scheduler is not allowed to make that choice silently on a person's behalf"
    }
  ],
  "because": "an implicit edge has no natural direction (spec 2.4); this implementation's convention is taskId lexicographic order, and T1 < T2, so T1 goes first",
  "undo": {
    "how": "edit src/scheduler/graph.ts: swap the implicit edge direction between T1 and T2",
    "cost": "change one direction choice and re-run the affected layering",
    "blast_radius": "the execution order of T1 and T2 within this run"
  },
  "scope": "task",
  "kind": "scheduling"
}
```

`src/scheduler/run.ts` 与 `src/scheduler/graph.ts` 里现在只剩下**注释里逐字引用 spec 原句**的中文
（`graph.ts:117-128`、`run.ts:148/206/313`），这是本仓库既有做法（`graph.ts:117` 早于本任务），
且不是运行时输出。口径：`grep -n "[一-龥]" src/scheduler/run.ts src/scheduler/graph.ts`。

---

## Finding 2 —— 抛异常时把人扔在 W 上，且退出码不受控

裁定是对的，而且比我 §10 第 6 条登记的更严重：不只是「人要自己 checkout 回去」，
而是**没有任何一行 orca 写的话说了分支和 tip**，退出码还由 node 决定。
§4.2.1 允许 C 碰人的工作树，是因为设计承诺会**明说自己碰了**；中途静默撒手，
毁的正是这条承诺里让它成立的那一半。

### 两半都改了

**1. `runRound` 加 `catch`**（`src/scheduler/run.ts`）：

- `logError` 报**原始错误**（`err.stack ?? err.message`）—— **不吞**，只停止传播；
- `log(await describeRepoState(plan))` 打印**当前分支**与**W 的 tip**；
  `describeRepoState` 里每一次 git 读都**各自**被 catch 成 `"<unreadable>"`，
  这样「W 根本没建出来」「.git 本身坏了」这类二次失败**盖不住**把我们带到这儿的那个错；
- `return 3`。为什么是 3 不是 2：§6.3 里 2 是「这条路断了，读日志就够」，
  3 是「有人必须回来做一件事」。没人预料到的异常按定义是后者，降成 2 正是 §6.3 明写要禁的消失。

**2. `src/cli.ts` bootstrap 加 rejection arm**：

```ts
void main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err: unknown) => {
    process.stderr.write(`orca: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 3;
  },
);
```

**`validate` / `check-append-only` 的处理函数一个字没动。**
`tests/cli/cli.test.ts`（12 条，含两条真进程退出码）全绿，见上面那次跑。

### 新判据：`tests/scheduler/scenarios/roundFailure.test.ts`（2 条）

**① 进程内那一半**：`chmod(runsDir, 0o500)` —— 故意选**真实的 EACCES**，不是 stub：
`allocateRunId` 的 `mkdir` 是本轮对 `runsDir` 的**第一次写**，而它只认得 `EEXIST`（递增），
`EACCES` 会原样抛出。而且这个时点**在 W 建出来之后、任何任务跑起来之前**，
正好是「人被扔在 W 上」的那个现场。断言顺序（承重的排前面）：

1. `stdout` 含 workBranch；
2. `stdout` 含 **W 的真实 tip sha**（不是措辞匹配 —— 只提分支名、不说它在哪的消息不该通过）；
3. `stderr` 含 `the round failed`；
4. `stderr` 匹配 `/EACCES|permission denied/i`（原始错误没被吞）；
5. 退出码 `=== 3`。

⚠️ 和 S14 同款处理：**把 rejection 捕获成值**（`.catch((err) => err.message)`）。
不这么做的话，`M-CATCH` 一上，判据在 `runCli` 那一行就死了，五条断言一条都不会被求值。

**② 真进程那一半**：bootstrap 的 rejection arm **只在进程里存在**，`main()` 的返回值量不到它。
用 `npx tsx src/cli.ts plan <plan.json>`，plan 里的契约文件不存在 ⇒ `loadRound` 的 `readFile`
抛 ENOENT ⇒ `main()` reject。断言真进程退出码 `=== 3`。

```
npx vitest run tests/scheduler/scenarios/roundFailure.test.ts   ⇒ rc=0，2 passed
```

---

## Fix 轮的变异（全部在 `git clone --local` 副本里，主工作树零触碰）

| 变异 | 删掉什么 | 喂它的场景 | 结果 |
|---|---|---|---|
| 🔴 `M-CATCH` | `runRound` 整个 `catch` 块 | roundFailure ① | 红在「stdout 含 W 的 tip」 |
| 🔴 `M-BOOT` | `src/cli.ts` bootstrap 的 rejection arm | roundFailure ② | 红：node 给的 1，不是定义好的 3 |
| 🔴 `M-MAIN`（复跑） | default ref 保护（catch 加进来之后行为变了，必须重验） | **S14** | 仍红在 default ref 断言本身 |

### `M-CATCH` —— 逐字补丁

```diff
diff --git a/src/scheduler/run.ts b/src/scheduler/run.ts
@@ -450,21 +450,6 @@ export async function runRound(planPath: string, options: RunOptions = {}): Prom
     // 15), so the round ends by saying where it is.
     log(`orca: work branch ${plan.workBranch} is at ${await workBranchTip(plan)}`);
     return roundExitCode(contributions);
-  } catch (err) {
-    // Fix round 1, finding 2. Without this the exception propagated out of
-    // main() as an unhandled rejection: node picked the exit code instead of
-    // §6.3's 3 > 2 > 1 > 0, and the line that tells the human where their
-    // repository was left never ran at all.
-    //
-    // 3, not 2: §6.3's 2 means "this path is dead, read the log" and its
-    // consumers are meant to read a task's log. An exception nothing
-    // anticipated is by definition the other thing — a person has to come back
-    // and look — and demoting it to 2 is exactly the disappearance §6.3
-    // forbids. The original error is reported, not swallowed; only the
-    // *propagation* is stopped.
-    logError(`orca: the round failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
-    log(await describeRepoState(plan));
-    return 3;
   } finally {
     await lock.release();
   }
```

真实输出（rc=1）：

```
 FAIL  roundFailure > exits 3, reports the original error, and still says where the repository was left
AssertionError: expected 'Plan: 2 task(s), policy=local-merge, …' to contain '7542fc826763b36ccd6af6d9775e6583bcee5…'
- 7542fc826763b36ccd6af6d9775e6583bcee5f0c
+ Plan: 2 task(s), policy=local-merge, workBranch=orca/w/x
  ...
```

（`stdout` 里还有 plan 报告，所以「含 workBranch」那条仍绿 —— 红准确地落在
「含 **tip**」那条上，这正是加那条 sha 断言而不是措辞断言的理由。）

### `M-BOOT` —— 逐字补丁

```diff
diff --git a/src/cli.ts b/src/cli.ts
@@ -199,19 +199,7 @@ export async function main(argv: string[], stdinText?: string): Promise<number>
 // Only runs when invoked directly as `tsx src/cli.ts`. Not executed on import.
 if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
-  void main(process.argv.slice(2)).then(
-    (code) => {
-      process.exitCode = code;
-    },
-    // Fix round 1, finding 2. Without this arm a rejection out of main() is an
-    // unhandled promise rejection: node decides the exit code, not this
-    // program, and the error text lands in node's own crash format. 3 is spec
-    // §6.3's escalation code and is the honest answer for an exception no
-    // handler anticipated — 1 would claim "the input was rejected", which is a
-    // diagnosis this arm has no way to make.
-    (err: unknown) => {
-      process.stderr.write(`orca: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
-      process.exitCode = 3;
-    },
-  );
+  void main(process.argv.slice(2)).then((code) => {
+    process.exitCode = code;
+  });
 }
```

真实输出（rc=1）：

```
 FAIL  roundFailure > a rejection out of main() becomes a defined exit code in a real process
AssertionError: expected Error: Command failed: npx tsx src/cli.ts… { …(6) } to match object { code: 3 }
- Object { "code": 3, }
+ Error  { "code": 1, }
 ❯ tests/scheduler/scenarios/roundFailure.test.ts:84:7
```

`1` 就是 node 对未处理 rejection 的默认状态码 —— 这条判据量的正是「**由谁**决定退出码」。

### `M-MAIN` 复跑（补 `catch` 之后行为变了，必须重验）

补丁与首轮**逐字相同**（`land.ts` 的两处守卫 ＋ 故意 checkout default）。真实输出（rc=1）：

```
 FAIL  S14: a whole run leaves the default branch's ref byte-identical
AssertionError: expected '3a38836c71218a5839145200d481230ade451…' to be '86046205eac56041585b65870d00f044fd854…'
Expected: "86046205eac56041585b65870d00f044fd854261"
Received: "3a38836c71218a5839145200d481230ade451dfe"
 ❯ tests/scheduler/scenarios/S14.test.ts:33:73
```

新 `catch` 把 `workBranchTip` 的抛错变成了 exit 3，但 S14 的红**仍然落在第 33 行的 ref 断言上**
（它排在退出码断言前面）。首轮那个「红在崩溃处」的坑没有回归。

---

## 还原证明（`shasum -a 256`）

- 变异前（`1ab2882`）：`scratchpad/fix1-main-before.sha256`，**67 个文件**
- 全部变异跑完、副本删掉后：`scratchpad/fix1-main-after.sha256`

```
diff fix1-main-before.sha256 fix1-main-after.sha256   ⇒ rc=0，无任何输出
```

**67 个文件全部逐字节相同。** 补充：

```
git status --porcelain    ⇒ 0 字节
git diff | wc -c          ⇒ 0
git diff --cached | wc -c ⇒ 0
```

副本按 G8 处置：先 `/bin/rm -f <mut>/node_modules` 解链接，再 `/bin/rm -rf <mut>`。

## ccloop 未被触碰

```
git status --short  ⇒ 0 字节
git rev-parse --short HEAD ⇒ 7f2c5f6
```

## `npm run verify`

```
time npm run verify   ⇒ rc=0，13.406s wall（38.80s user / 33.41s system）
  npm test               : Test Files 36 passed (36), Tests 220 passed (220)
  npm run verify:scheduler: Test Files 29 passed (29), Tests 101 passed (101)
  `orca validate .decisions` 打出 7 行 downgraded to tier 0（预期，全是
  .decisions/orca-dev-09cc3ea1.jsonl 第 8-14 行缺 taskId/runId 的历史记录）；
  另有 3 行来自 tests/fixtures/ledger/downgraded.jsonl，是判据 fixture，不是台账。
```

实测耗时（取上面那次跑的逐条计时）：`roundFailure` 2 条 **1405 ms**，
`graph.test.ts` 8 条 **6 ms**，`cli.test.ts` 12 条 **1297 ms**。

## 未改的两条（裁定明说延后）

- `land.ts:18` 与 `run.ts:23` 之间逐字相同的 `git()` 助手 —— **未合并**。
- `readLedgerOnBranch` 的 catch 比它注释里那一种失败宽 —— **未收窄**。

两条都留给整支复审。

## 本轮提交

```
1ab2882 fix(scheduler): English ledger prose at runtime, and a round that fails loudly
```

未 push、未合任何默认分支、未建也未删任何分支或 worktree。
