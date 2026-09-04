# Task 9 report — 收产物 ＋ §7 双向事后核对（S5／S6／S7）

- **Run**: session `01BfFQhczP5BorRwTag5cCxL`, 2026-09-04
- **Commit**: `03c02b5` `feat(scheduler): reconcile declared against actual in both directions`
- **Base commit at start**: `9128d56`
- **ccloop at all times**: `7f2c5f63e9c83076e04c03ff691780e6f6f731a2`（未动，证据见最后一节）
- **Status**: DONE

---

## 1. 实现了什么

### `src/scheduler/harvest.ts`（新）

四个导出，两件互不相同的事，**刻意分开**：`harvest` 是**测量**（有 IO、会抛），
`disposition` 是**裁决**（纯函数）。

| 导出 | 是什么 |
|---|---|
| `Reconciliation { actualPaths, outOfBounds, declaredNotProduced, empty }` | §7.1 两个方向的一次测量 |
| `harvest(run, base, declared): Promise<Reconciliation>` | §7.2：在副本里 `git diff --no-renames --name-only -z <base> <attemptSha>` |
| `Disposition` | §7.3 的裁决 ＋ §6.3 的退出码贡献 |
| `disposition(r, siblingWriteSets): Disposition` | §7.3 的四条处置，纯 |
| `sameLayerWriteSets(graph, taskId)` | **接口表之外多的一个**，理由见 §1.3 |

#### 1.1 `harvest` —— C 自己量

`git diff --no-renames --name-only -z <base> <attemptSha>`，cwd 是 `cloneDirOf(run.workdir)`。

三个 flag 都是承重的，注释里逐条写了理由：

- **`--no-renames`**：git 的改名检测**默认开着**（`diff.renames` 自 2.9 起默认 true），
  开着时 `--name-only` **只打印改名的目的地**。源路径也是被写过的（被清空、被删掉），
  藏掉它就等于从核对里漏掉一条真实的越界写。显式传还让结果**不依赖本机的 `diff.renames` 配置**。
- **`-z`**：否则 git 会按 `core.quotePath` 给非 ASCII 路径加引号转义，
  一个普通的中文文件名会变成任何声明都不可能包含的带引号字符串。
- **排序**：git 本来就按树序输出，但那是 git 的实现细节、不是对我们的承诺。

⚠️ **代价照 §7.2 的要求写进注释而不是留给后人发现**：C 量的是**两笔 commit 之间的净改动**，
ccloop 量的是**过程中碰过的文件**。改了又改回去的文件在 ccloop 的表里、不在这张表里。
对 C 的目的（并行正确性 —— W 最终装了什么）这是**对的取舍**，
对安全审计（ccloop `evaluatePathPolicy` 的活）就是**错的取舍**。**两个目的两个数据源，不许合并。**

#### 1.2 `disposition` —— §7.3 的四条，不对称是故意的

```
净改动全空                 -> land false, exit 2   (succeeded_but_empty)
越界 ∩ 同层兄弟的写集 ≠ ∅   -> land false, exit 3   (拒绝落地 + 升人)
越界但与谁都不相交          -> land true,  exit 2   (照落地 + boundary 决策)
声明了却没产出              -> land true,  exit 0   (只警告)
```

`Disposition` **不带 reason 字段**：调用方手里已经有算出这个裁决的 `Reconciliation`，
台账条目从那个写，不从这里复制一份消息。

越界路径与兄弟比对时**走的是 §3.2 那棵字典树**（`normalizeClaim` + `intersect`），
不是字符串比较：越界写到 `src/x.ts` 撞上声明了 `src/**` 的兄弟，
和撞上点名了那个文件的兄弟**一样是撞**。这里用更弱的判定就会放过一次相交，
而那是 §7.3 唯一不许错的方向。

#### 1.3 多出来的 `sameLayerWriteSets(graph, taskId)`

brief 的接口表只有四项，这是第五个。**理由**：

`disposition` 收的是一个**已经建好的** `Map<string, ClaimedPath[]>`。
「这张表装的是**本层**的兄弟，不是全图」正是 §7.3 那段⚠️的全部内容 ——
只有同层任务才是从同一个 W HEAD 各自开工、互相看不见的；后续层从「已含本任务结果」的 W 开工，
它的重叠只是一次普通合并冲突（§5 接得住），把那个也升人会让每次普通冲突都变成一次人工中断。

如果让三个场景各自在测试里现搭这张表，**这条判断就只活在测试里，生产代码里一行都没有**，
于是**没有任何变异能删得掉它**。放进 `harvest.ts` 才让它可被删、可被打红。

#### 1.4 没有 attempt ref 的 run：**抛，不吞**

Task 8 实测：`blocked_waiting_human` 是唯一**一个 ref 都不发**的终态 ——
`publishAttemptCommit` 只从 cleanup 路径里跑，而 blocked 那一支**故意跳过 cleanup**。

**决定：`harvest` 抛错**，消息里带 run id、终态、和「按终态路由，别拿来 harvest」。

理由（写进了注释）：能「吞」的方式只有一种 —— **报成空的改动集** ——
而那是**所有选项里最坏的一个**：`disposition` 会把一个正在等人的 run 判成
`succeeded_but_empty` 并贡献 exit 2，而 **§6.3 原话就是「把 3 降级成 2 会让那件必须做的事
消失在一堆失败里」**。§7.5 从结构上说的是同一件事：整个 §7 建立在 C 拿得到两笔真 commit 上，
没有结果 commit，方向二就分不清「采集失败」和「agent 真的没干活」。

这条**有自己的判据**（`harvest.test.ts` 第三条），M-C 下也打红。

### `src/scheduler/pathTrie.ts`（改 1 行 ＋ 注释）

`contains` 从私有改成导出。**不是顺手改的**：

`classify()` 回答不了 `harvest` 要问的问题。`classify` 是**双向**的（两边任一方向包含都算），
而「这条实际路径在不在任务声明的范围里」是**有方向的** ——
声明 `src/a/b.ts`、实际路径 `src/a`，两者有关系但**不在界内**。
在 `harvest` 里重新推一遍段containment，就等于让 §3.2 的规则在树里有两个独立读者，
而 `planFile.ts` 的 `detectCycle` 注释里已经记着本仓库把这种重复当缺陷。

### `tests/scheduler/sandbox.ts`（加法为主）

| 改动 | 为什么 |
|---|---|
| `ContractSpec.verifierType?: "command" \| "agent"` | **唯一能跑出「重试」的路**，见 §4 |
| `ScriptedFrameSpec.approved` / `.safeToRetry` | 同上：`approved:false` ＋ `safeToRetry:true` 是 `stopController` 判 `retryable` 的那一对 |
| 抽出 `seedTasks(s, specs)`，`seedFanOutPlan` 委托给它 | §7 的场景要的是**两个任务同层**，而 Task 8 的 `seedFanOutPlan` 写死了 T1→T2 那条边，**正好是 §7.3 说它的升人 NOT 该管的那个形状** |

---

## 2. TDD 证据

### 2.1 RED

第一次跑（模块不存在）只证明了 import 失败，**没证明任何一条断言**，所以补了一次真 RED：
写一个**返回正确形状但什么核对都不做**的 stub，让每一条断言都真的被执行、真的失败。

**命令**（未过滤，整份重定向后读回）：
```
npx vitest run tests/scheduler/harvest.test.ts tests/scheduler/scenarios/S5.test.ts \
  tests/scheduler/scenarios/S6.test.ts tests/scheduler/scenarios/S7.test.ts
```
**EXIT=1，7 failed / 7**。真实失败输出（节选，全份在 `scratchpad/red2.txt`）：

```
 ❯ tests/scheduler/scenarios/S5.test.ts (1 test | 1 failed) 626ms
     → expected false to be true // Object.is equality        [r.empty]
 ❯ tests/scheduler/scenarios/S6.test.ts (1 test | 1 failed) 627ms
     → expected [] to deeply equal [ 'a.txt', 'stray.txt' ]
 ❯ tests/scheduler/scenarios/S7.test.ts (1 test | 1 failed) 627ms
     → expected [] to deeply equal [ 'a.txt', 'b.txt' ]
 ❯ tests/scheduler/harvest.test.ts (4 tests | 4 failed) 1945ms
     → expected [] to deeply equal [ 'src/a.ts' ]
     → expected [ …(5) ] to deeply equal [ …(2) ]
     → promise resolved "{ actualPaths: [], …(3) }" instead of rejecting
     → expected [] to deeply equal [ 'a.txt' ]
```

**为什么这是预期的红**：stub 里 `harvest` 不测量、`disposition` 一律 `{land:true, exit:0}`，
所以每一条「量到了什么」和每一条「判成了什么」都必然对不上。

**这一跑还抓到我自己一条判据写坏了**：多 ref 那条本来断言副本里**全部** ref 只有两条，
实际输出是 5 条（还有 `refs/heads/main`、`refs/remotes/origin/HEAD`、`refs/remotes/origin/main`）。
已改成只看 `refs/ccloop/` 前缀 —— 钉住分支布局会让这条判据因为与 attempt 无关的原因而红。

### 2.2 GREEN

同一条命令，实现落地后：**EXIT=0，7 passed / 7**（`scratchpad/green1.txt`）。

`npm run verify`：**EXIT=0**（`scratchpad/verify-final.txt`）。
- 全量 `vitest run`：**211 passed / 211**（本任务前是 204，新增 7 条）
- `verify:scheduler`：**92 passed / 92**
- `.decisions/orca-dev-09cc3ea1.jsonl` 的 **7 行 `downgraded to tier 0`** 照常打印、照常 exit 0（设计如此）
- 早先各任务的判据**一条没动、全绿**

---

## 3. 🔴 `M-C` 的结果，直说

**`M-C` 真的跑了，不是 `describe.skip`。**

**结果：整个 §7 核对被跳过后，S5、S6、S7 三条全红，另加 `harvest.test.ts` 的四条也全红 —— 7/7 红。**

也就是说：**确实有判据在量核对本身**，本条通过。没有出现「删光照绿」的情况。

M-C 的写法（判它是否忠实的关键）：把 `harvest` 换成「不测量、返回一个什么问题都没有的
`Reconciliation`」，把 `disposition` 换成「一律落地、exit 0」。
这就是「这一节从来没被写过、一切照落地」的字面含义，
不是为了让它红而设计的 —— 我没有动任何判据，只动了被测代码。

**诚实登记**：`M-C` 里 `harvest` 返回的是 `empty: false`。如果改成 `empty: true`，
S5 会**假绿**（它期望的就是 `land:false / exit 2`）。但那不叫「跳过核对」，
那叫「把核对换成一条一律判空的假规则」—— 是另一条变异，不是 M-C。
`empty: false` 才是「没做过任何测量、没有理由认为它是空的」的中性返回。这一点值得复审时盯一下。

---

## 4. 多 ref 的 run 是怎么拿到的（Task 8 遗留项）

**拿到了真的多 ref run。** 证据是 RED 那一跑里 vitest 打出来的实际 ref 列表：

```
Array [
  "refs/ccloop/orca-T1-d1a09c06/attempts/1",
  "refs/ccloop/orca-T1-d1a09c06/attempts/2",
  ...
]
```

**怎么拿到的** —— 三个条件缺一不可，都是读 ccloop 7f2c5f6 的源码推出来再实测确认的：

1. **`verifierType: "agent"`**。在 `"command"` 下 `runLoop` 根本不调 `adapter.verify`，
   而 `runRequiredChecks` 自己那条拒绝**写死 `safeToRetry: false`**
   ⇒ 命令验证的 run **永远到不了 `retryable`**，永远只发一条 ref。
   这也解释了 Task 8 为什么每个 run 都只有一条 ref。
2. **frame 1 `approved:false` ＋ `safeToRetry:true`**：
   `stopController.evaluateStopDecision` 判 `retryable` 的**唯一**一组输入
   （`attemptNumber >= maxAttempts` 先查、`!safeToRetry` 再查、`attemptNumber > 1` 最后查）。
3. **`maxAttempts: 2`**：否则第 2 条会被第 1 条先截成 `exhausted`。

**怎么让「选错 ref」看得见**：required check 是
```
printf x > "$(basename "$(pwd)").txt"
```
它以**本次 attempt 自己的 worktree 名**命名文件（`<runDir>/worktrees/attempt-<n>`）,
于是两次 attempt 产出**不同的树**：attempt 1 写 `attempt-1.txt`，attempt 2 写 `attempt-2.txt`。
判据断言 `r.actualPaths === ["attempt-2.txt"]` ⇒
**取第一条 / 取编号最小的那条都会得到 `["attempt-1.txt"]`，红。**
（`for-each-ref` 按 refname 排序，两条时 refname 序与数字序重合，所以「取第一条」确实等于「取 1」。）

判据里还有一条**护栏**：先断言 `refs/ccloop/` 下**恰好**是 attempts/1 和 attempts/2。
一条 ref 的 run 上所有选择规则都同答案，那样这条判据就是空的 ——
如果 ccloop 哪天不再发被拒 attempt 的 ref，这条会在护栏处红，而不是悄悄变成假绿。

---

## 5. 变异表（四条，全部在 `git clone --local` 副本里跑）

副本：`$SCRATCH/mut`，从 `03c02b5` clone；`node_modules` 是指向主树的符号链接；
主工作树**全程零触碰**。每条变异后都用 `cat pristine > target` 还原并 `shasum` 验证。

| 变异 | 删掉什么 | 喂它的场景 | 结果 | 红在哪 |
|---|---|---|---|---|
| **M-A1** | §7.3 方向一的**相交**检查 | S7 | **红** EXIT=1 | `S7.test.ts:66` `expected true to be false`（`d.land`）|
| **M-A2** | §7.3 方向一的**分档**（一律照落地）| S7 | **红** EXIT=1 | `S7.test.ts:66` `expected true to be false`（`d.land`）|
| **M-B1** | §7.3 方向二的「净改动全空」检查 | S5 | **红** EXIT=1 | `S5.test.ts:55` `expected true to be false`（`d.land`）|
| **M-C** | **整个 §7 核对跳过** | S5 ＋ S6 ＋ S7 全跑 | **7/7 全红** EXIT=1 | 见 §3 |

### 5.1 M-A1 —— 字面 patch
```diff
--- a/src/scheduler/harvest.ts
+++ b/src/scheduler/harvest.ts
@@ -190,8 +190,7 @@ export function disposition(r: Reconciliation, siblingWriteSets: Map<string, Cla
     // sibling that claimed "src/**" just as surely as with one that named the
     // file. Using anything weaker here would let a collision through, which is
     // the one direction §7.3 refuses to be wrong in.
-    const oob = r.outOfBounds.map(normalizeClaim);
-    const collides = [...siblingWriteSets.values()].some((sibling) => intersect(oob, sibling).length > 0);
+    const collides = false;
     if (collides) {
```
命令：`npx vitest run tests/scheduler/scenarios/S7.test.ts` ⇒ **EXIT=1**
```
 ❯ tests/scheduler/scenarios/S7.test.ts (1 test | 1 failed) 447ms
AssertionError: expected true to be false // Object.is equality
 ❯ tests/scheduler/scenarios/S7.test.ts:66:22
     66|       expect(d.land).toBe(false);
```
还原后 `shasum -a 256 src/scheduler/harvest.ts` = `627112f0…08fb7`（与 pristine 相同）。

### 5.2 M-A2 —— 字面 patch
```diff
--- a/src/scheduler/harvest.ts
+++ b/src/scheduler/harvest.ts
@@ -190,15 +190,6 @@ export function disposition(r: Reconciliation, siblingWriteSets: Map<string, Cla
     // sibling that claimed "src/**" just as surely as with one that named the
     // file. Using anything weaker here would let a collision through, which is
     // the one direction §7.3 refuses to be wrong in.
-    const oob = r.outOfBounds.map(normalizeClaim);
-    const collides = [...siblingWriteSets.values()].some((sibling) => intersect(oob, sibling).length > 0);
-    if (collides) {
-      // The parallelism verdict for this layer was computed from declarations
-      // this run has just proved wrong, so no landing order can be argued to be
-      // safe and the two tasks may already have broken each other. Refuse, and
-      // escalate: a human has to look (exit 3).
-      return { land: false, exitContribution: 3 };
-    }
     // Second tier. Nobody else in this layer claims these paths, so nobody
```
命令：`npx vitest run tests/scheduler/scenarios/S7.test.ts` ⇒ **EXIT=1**，同上一条的断言与行号。
另跑 `S6.test.ts` ⇒ **EXIT=0**（正确：M-A2 喂的是 S7，S6 的第二档没被改）。
还原后 shasum 相同。

⚠️ **诚实登记一处**：M-A1 与 M-A2 在 S7 上**产生完全相同的可观测结果**（都变成 land true / exit 2）。
这是设计使然而非判据不足：两档之间**唯一**的区别就是那个相交检查，
删掉检查和删掉分档必然收敛到同一支。两条的**字面 patch 不同**，但**不要**把它们读成两条独立证据。

### 5.3 M-B1 —— 字面 patch
```diff
--- a/src/scheduler/harvest.ts
+++ b/src/scheduler/harvest.ts
@@ -179,10 +179,6 @@ export function disposition(r: Reconciliation, siblingWriteSets: Map<string, Cla
   // failure here. The contract field that would declare that does not exist
   // today, and of the two possible mistakes this repository has already paid
   // for the other one.
-  if (r.empty) {
-    return { land: false, exitContribution: 2 };
-  }
-
   if (r.outOfBounds.length > 0) {
```
命令：`npx vitest run tests/scheduler/scenarios/S5.test.ts` ⇒ **EXIT=1**
```
AssertionError: expected true to be false // Object.is equality
 ❯ tests/scheduler/scenarios/S5.test.ts:55:22
     55|       expect(d.land).toBe(false);
```
还原后 shasum 相同。

### 5.4 M-C —— 字面 patch（**逐字节，未缩写**）

> **修订（fix round 1）**：本节先前贴的是**转述**（`[§7.5 的 attemptSha === null 守卫，17 行]`
> 这类方括号缩写），而 M-A1／M-A2／M-B1 贴的都是字节级 patch。
> M-C 是本计划标为存在性检查的那一条，「七条全红」这句话整个任务都压在它上面 ——
> 读者必须能逐字符核对它。**控制器裁决：贴字面 patch。** 下面这份不是事后凭记忆重写的。

**这份 patch 的来历（可复验）**：原始 M-C 的 `MC.patch` 与 `MC.out` 两个 scratch 产物都还在，
但那个副本已经拆掉了，谁也没法再回去查。于是**重开了一个 `git clone --local` 副本，
在【同一次 bash 调用】里生成 patch 并跑出失败输出**（`MC2.patch` / `MC2.out`），
下面贴的 patch 与输出都来自那一次。

两次跑互为佐证：

```
$ shasum -a 256 $SCRATCH/MC.patch $SCRATCH/MC2.patch
e5b81a6641fe59967c5c4c552b951e5ead13b235f80acd2189146200d0bd2375  .../MC.patch
e5b81a6641fe59967c5c4c552b951e5ead13b235f80acd2189146200d0bd2375  .../MC2.patch
```
⇒ 重生成的 patch 与原始那份 **byte-identical**，说明原始产物是真的、且可复现。

失败清单与失败消息也逐行相同（去掉耗时与并发顺序后 `diff` 退出 0）：
```
$ diff <(awk '/×/{sub(/ [0-9]+ms$/,""); print}' MC.out  | sort)        <(awk '/×/{sub(/ [0-9]+ms$/,""); print}' MC2.out | sort)   ⇒ exit 0
$ diff <(awk '/AssertionError|promise resolved/{print}' MC.out)        <(awk '/AssertionError|promise resolved/{print}' MC2.out)   ⇒ exit 0
```

⚠️ patch 里的 `@@ -116,105 +116,9 @@` **是 git 自己的 hunk 头，不是我对某一行的引用**。
它说的是「旧文件第 116 行起的 105 行，换成 9 行」；
`export async function harvest` 实际在**第 118 行**（现测：
`grep -n "^export async function harvest" src/scheduler/harvest.ts` ⇒ `118:`），
落在这个 hunk 内部。复审提到的「line 116」指的就是这个 hunk 头。

#### 字面 patch

```diff
diff --git a/src/scheduler/harvest.ts b/src/scheduler/harvest.ts
index bde1a86..3291e57 100644
--- a/src/scheduler/harvest.ts
+++ b/src/scheduler/harvest.ts
@@ -116,105 +116,9 @@ async function netChangeSet(clone: string, base: string, attemptSha: string): Pr
 }
 
 export async function harvest(run: TaskRun, base: string, declared: ClaimedPath[]): Promise<Reconciliation> {
-  // Measured in Task 8: `blocked_waiting_human` is the one terminal status that
-  // leaves NO attempt ref — runLoop persists it and returns without entering
-  // any cleanup path, and publishAttemptCommit only ever runs from inside
-  // cleanup. So this is a real, expected state, not a corrupt one.
-  //
-  // It still has to be refused rather than absorbed. There is exactly one
-  // plausible way to absorb it — report an empty change set — and that is the
-  // worst available answer: disposition would then call a run that is waiting
-  // on a human `succeeded_but_empty` and contribute 2, and §6.3 says in as many
-  // words that downgrading a 3 to a 2 makes the thing a human must do vanish
-  // into a pile of failures. §7.5 makes the same point structurally: all of §7
-  // rests on C holding two real commits, and without the result commit
-  // direction two cannot tell "collection failed" from "the agent did nothing".
-  //
-  // The caller routes on the outcome (§6.1) first and only harvests a run that
-  // produced something. Reaching here with a null sha is a scheduler bug, and
-  // Rule 12 says it should say so.
-  if (run.attemptSha === null) {
-    throw new Error(
-      `orca: run ${run.runId} (outcome ${run.outcome}) published no attempt commit, so there is nothing ` +
-        `to reconcile against ${base}; route it by its terminal status instead of harvesting it`,
-    );
-  }
-
-  const actualPaths = await netChangeSet(cloneDirOf(run.workdir), base, run.attemptSha);
-
-  // Direction one. `contains` rather than a string prefix, and the shared one
-  // from pathTrie rather than a second copy: "src/a" must not swallow
-  // "src/ab.ts", and that single case is the reason §3.2 is a segment trie at
-  // all. A claim normalized to the empty prefix (a bare `**`) contains
-  // everything, so a task that claimed the whole repository has no
-  // out-of-bounds paths, which is exactly right.
-  const outOfBounds = actualPaths.filter((path) => !declared.some((claim) => contains(claim.normalized, path)));
-
-  // Direction two. Reported by the RAW declared string, not the normalized
-  // prefix: spec §3.3's rule, for the reason it gives — a task that declared
-  // "src/**" being told it failed to produce "src/" reads as a tool bug.
-  // De-duplicated by that same raw string, because targetPaths and
-  // allowlistPaths are unioned into the write set and a contract may legally
-  // name one path in both.
-  const declaredNotProduced: string[] = [];
-  for (const claim of declared) {
-    if (actualPaths.some((path) => contains(claim.normalized, path))) continue;
-    if (declaredNotProduced.includes(claim.declared)) continue;
-    declaredNotProduced.push(claim.declared);
-  }
-
-  return { actualPaths, outOfBounds, declaredNotProduced, empty: actualPaths.length === 0 };
+  return { actualPaths: [], outOfBounds: [], declaredNotProduced: [], empty: false };
 }
 
 export function disposition(r: Reconciliation, siblingWriteSets: Map<string, ClaimedPath[]>): Disposition {
-  // §7.3 direction two, first: `succeeded_but_empty`. ccloop said the task
-  // succeeded and the tree is byte-identical to the base, so whatever the exit
-  // code claimed, nothing was produced. A failure (exit 2), not a quiet
-  // success — publishAttemptCommit commits with `--allow-empty` on purpose, so
-  // an empty run still leaves a real commit behind a real ref and no layer
-  // below this one can tell the difference.
-  //
-  // ⚠️ Known cost, registered in §6.5 rather than hidden: a task that
-  // legitimately changes nothing ("confirm X is already correct") is judged a
-  // failure here. The contract field that would declare that does not exist
-  // today, and of the two possible mistakes this repository has already paid
-  // for the other one.
-  if (r.empty) {
-    return { land: false, exitContribution: 2 };
-  }
-
-  if (r.outOfBounds.length > 0) {
-    // §7.3 direction one, first tier. The out-of-bounds paths are compared
-    // against siblings as CLAIMS, through the same trie the layering decision
-    // itself was made with (§3.2): a stray write to "src/x.ts" collides with a
-    // sibling that claimed "src/**" just as surely as with one that named the
-    // file. Using anything weaker here would let a collision through, which is
-    // the one direction §7.3 refuses to be wrong in.
-    const oob = r.outOfBounds.map(normalizeClaim);
-    const collides = [...siblingWriteSets.values()].some((sibling) => intersect(oob, sibling).length > 0);
-    if (collides) {
-      // The parallelism verdict for this layer was computed from declarations
-      // this run has just proved wrong, so no landing order can be argued to be
-      // safe and the two tasks may already have broken each other. Refuse, and
-      // escalate: a human has to look (exit 3).
-      return { land: false, exitContribution: 3 };
-    }
-    // Second tier. Nobody else in this layer claims these paths, so nobody
-    // else can have been broken by them. The money is already spent and there
-    // is no "un-write" to roll back to, so discarding the work would be pure
-    // waste — it lands, with a tier-1 `boundary` decision in the ledger and a
-    // visible exit 2. This is §0.2's trade made explicit: declaring too
-    // narrowly is common and mostly harmless, right up until it collides.
-    return { land: true, exitContribution: 2 };
-  }
-
-  // Everything declared-but-not-produced ends here, on purpose: a warning and
-  // a ledger entry, never a failure. snakemake raises MissingOutputException in
-  // this situation and is right to — its outputs are rule-declared and
-  // machine-precise. `targetPaths` is a human-written intent range, usually
-  // written wide. Applying a precise contract's strictness to a coarse one
-  // trains people to write targetPaths as narrow as they can get away with,
-  // and §3.1 is explicit that a narrow declaration is the UNSAFE direction:
-  // it is what makes the layering miss a real overlap.
   return { land: true, exitContribution: 0 };
 }
```

#### 命令与真实失败输出

```
$ ORCA_CCLOOP_BIN=.../ccloop/dist/cli.js npx vitest run \
    tests/scheduler/harvest.test.ts tests/scheduler/scenarios/S5.test.ts \
    tests/scheduler/scenarios/S6.test.ts tests/scheduler/scenarios/S7.test.ts
EXIT=1

 ❯ tests/scheduler/scenarios/S6.test.ts (1 test | 1 failed) 646ms
   × S6 ... > S6: out-of-bounds writes that touch nobody else land anyway, with a boundary decision
     → expected [] to deeply equal [ 'a.txt', 'stray.txt' ]
 ❯ tests/scheduler/scenarios/S5.test.ts (1 test | 1 failed) 646ms
   × S5 ... > S5: a task ccloop calls succeeded but whose tree equals the base does not land
     → expected false to be true // Object.is equality
 ❯ tests/scheduler/scenarios/S7.test.ts (1 test | 1 failed) 646ms
   × S7 ... > S7: out-of-bounds writes that intersect a sibling in the same layer refuse to land and escalate
     → expected [] to deeply equal [ 'a.txt', 'b.txt' ]
 ❯ tests/scheduler/harvest.test.ts (4 tests | 4 failed) 
   × measures the actual change set itself instead of consuming ccloop's changedFiles
     → expected [] to deeply equal [ 'src/a.ts' ]
   × harvests the highest-numbered attempt ref, not the first one it finds
     → expected [] to deeply equal [ 'attempt-2.txt' ]
   × refuses a run that published no attempt ref instead of reporting an empty change set
     → promise resolved "{ actualPaths: [], …(3) }" instead of rejecting
   × declared-but-not-produced is a warning and a ledger entry, never a failure
     → expected [] to deeply equal [ 'a.txt' ]

 Test Files  4 failed (4)
      Tests  7 failed (7)
```

完整未过滤输出：`scratchpad/MC2.out`（179 行）与 `scratchpad/MC.out`（179 行）。

副本已还原（`shasum` 与 pristine 一致）并拆除；主工作树全程零触碰。

### 5.5 还原证明（看字节，不看 `git diff`）

副本还原后重跑四个文件：**EXIT=0，7 passed / 7**。

```
$ shasum -a 256 $MUT/src/scheduler/harvest.ts $SCRATCH/harvest.pristine.ts
627112f008bc5198a66aea63357811d2024fe8481fe9a3c67ef62a459c408fb7  .../mut/src/scheduler/harvest.ts
627112f008bc5198a66aea63357811d2024fe8481fe9a3c67ef62a459c408fb7  .../harvest.pristine.ts
```

副本已拆除（先 `/bin/rm -f` 掉 `node_modules` 符号链接，再 `/bin/rm -rf` 目录）。

**主工作树逐字节未动**：
```
$ shasum -a 256 /Users/biran/code/skills/loop/Orca/src/scheduler/harvest.ts $SCRATCH/harvest.pristine.ts
627112f008bc5198a66aea63357811d2024fe8481fe9a3c67ef62a459c408fb7  /Users/.../Orca/src/scheduler/harvest.ts
627112f008bc5198a66aea63357811d2024fe8481fe9a3c67ef62a459c408fb7  .../harvest.pristine.ts

$ /usr/bin/git -C /Users/biran/code/skills/loop/Orca status --short
(空)
$ /usr/bin/git -C /Users/biran/code/skills/loop/Orca log --oneline -1
03c02b5 feat(scheduler): reconcile declared against actual in both directions
```

---

## 6. ccloop 未被触碰

```
$ /usr/bin/git -C /Users/biran/code/skills/loop/ccloop status --short
(空)
$ /usr/bin/git -C /Users/biran/code/skills/loop/ccloop rev-parse HEAD
7f2c5f63e9c83076e04c03ff691780e6f6f731a2
```
ccloop 仓库**只被读过**（`sed`/`grep` 读源码）与**被 spawn 过**（`dist/cli.js`，测试沙箱里）。
未提交、未修改、HEAD 仍是 `7f2c5f6`。

---

## 7. 实测耗时（只抄工具报的数）

| 跑什么 | 命令报的数 |
|---|---|
| `npm run verify` 整体 | `/usr/bin/time -p` ⇒ **real 9.60s**（user 25.96 / sys 17.15）|
| 全量 `vitest run`（211 条）| Duration **3.56s**（tests 16.54s，并发）|
| 本任务 7 条判据单独跑 | Duration **2.27s** |
| S5 | 593ms / 777ms / 793ms（三次观测）|
| S6 | 618ms / 779ms / 798ms |
| S7 | 619ms / 846ms / 893ms |
| harvest：changedFiles 那条 | 618ms / 823ms / 897ms |
| harvest：多 ref 那条（**跑两次 attempt**）| 629ms / 1108ms / 1203ms |
| harvest：无 ref（blocked）那条 | 281ms / 330ms / 445ms |
| harvest：声明未产出那条 | 412ms / 433ms / 469ms |
| M-A1 跑 S7 | 743ms |
| M-A2 跑 S7 | 742ms |
| M-B1 跑 S5 | 750ms |
| M-C 跑全部 4 个文件 | 2.25s |

每个场景都是**真的 spawn 了 ccloop**（`scripted` adapter，不花模型钱）。
一条也没跳过、一条也没为了省时间删掉。

---

## 8. 改了哪些文件

| 文件 | 新/改 | 说明 |
|---|---|---|
| `src/scheduler/harvest.ts` | **新** | §7 全部 |
| `src/scheduler/pathTrie.ts` | 改 | `contains` 改为导出（1 行 ＋ 注释）|
| `tests/scheduler/harvest.test.ts` | **新** | 4 条判据 |
| `tests/scheduler/scenarios/S5.test.ts` | **新** | |
| `tests/scheduler/scenarios/S6.test.ts` | **新** | |
| `tests/scheduler/scenarios/S7.test.ts` | **新** | |
| `tests/scheduler/sandbox.ts` | 改 | `verifierType`、frame 的 `approved`/`safeToRetry`、抽出 `seedTasks` |

`7 files changed, 701 insertions(+), 21 deletions(-)`。

**没有碰**：`src/ledger/**`、`scripts/githooks/**`、`.decisions/**`、既有 CLI 子命令、
Task 1–8 的任何一条判据。S8/S9 里那两条已删的惰性断言**没有被复活**。

---

## 9. 自审发现（读自己的 diff）

按项目被咬过的两个形状逐条扫过：

**(a) 排在被测调用之前、读回测试自己刚写进去的值的断言 —— 没有。**
逐条查过 7 条判据里的每一个 `expect`：
- 每条里**唯一**出现在被测调用之前的断言，是 `run.outcome`、`graph.layers`、
  `run.attemptSha`、以及多 ref 那条的 ref 列表 —— 这些**全部**是 ccloop 或 `buildGraph`
  产出的值，不是测试自己写进去的，而且它们都是**护栏**（fixture 失效时在这里红，
  而不是让主断言假绿）。
- 每条的**主断言**（`r.actualPaths` / `r.outOfBounds` / `r.empty` /
  `r.declaredNotProduced` / `d.land` / `d.exitContribution`）全部排在
  `harvest(...)` / `disposition(...)` 之后。

**(b) 判据声称的目的与它实际量的东西不一致 —— 修掉了一处。**
「C 自己量、不消费 ccloop 的 changedFiles」这条，如果 scripted frame 的
`changedFiles` 和 required check 真写的文件**一样**，那么「消费 ccloop 的表」和
「自己量树」两种实现**会给出同一个答案**，判据的名字就是假的。
所以 frame 里**故意填了一个谎**（`changedFiles: ["ccloop-said-this.txt"]`，
没有任何 attempt 写过它），而 check 真写的是 `src/a.ts`。现在这条判据**真的**在量它宣称的东西。

**自审中改掉的另外两处**：
1. 多 ref 判据原本断言副本里**全部** ref 只有两条 —— 实测是 5 条（还有 main 与 origin 的）。
   钉住分支布局会让它因为与 attempt 无关的原因红。已收窄到 `refs/ccloop/` 前缀，并写明为什么收窄。
2. 从 `seedFanOutPlan` 抽出 `seedTasks` 时，**原来那段解释三任务扇出形状的注释被留在了
   `TaskSpec` 头上**，读起来像在描述一个通用类型。已把它搬回 `seedFanOutPlan`，
   `seedTasks` 另写自己的。

**每条新断言都对上了应该让它红的那条变异**：
S7 的两条 ← M-A1/M-A2；S5 的两条 ← M-B1；全部 7 条 ← M-C；
多 ref 那条 ← 「取第一条 / 取编号最小」（实测会得到 `attempt-1.txt`）；
无 ref 那条 ← 「吞成空改动集」（M-C 下确实红了：`promise resolved … instead of rejecting`）。

---

## 10. 关切 / 留给后续

1. **M-A1 与 M-A2 可观测结果相同**（§5.2 已登记）。不是缺陷，是 §7.3 的结构使然，
   但**别把它们当两条独立证据数**。
2. **`disposition` 不产出台账条目**。§7.3 说越界照落地要记 Tier 1 `kind: boundary`、
   相交要升人 —— 本任务只给出**裁决**，写台账是 §8 的接线（Task 11+）。
   `Disposition` 刻意不带 reason，写台账的人从 `Reconciliation` 取材。
   ⇒ **「boundary 决策真的进了台账」目前没有判据**，那条判据属于接台账的那个任务。
3. **`exitContribution` 目前没有消费者**。§6.3 已诚实登记过「退出码 2 没有消费者、
   `set -e` 与 `&&` 把 1 和 2 一样地当停」，3 同理。整轮退出码的合成（3 > 2 > 1 > 0）
   要等编排器（Task 14）。本任务**没有**写成「shell 会区别对待」的判据。
4. **`sameLayerWriteSets` 是我在 brief 的四项接口之外加的第五个**（理由见 §1.3）。
   如果复审认为它该并进 `disposition` 或搬去 `graph.ts`，那是可逆的改动。
5. **净改动 vs 过程改动的代价**（§1.1 的⚠️）是**真代价**，不是理论风险：
   一个任务把某文件改坏再改回来，C 完全看不见。§7.2 明确说这是对的取舍，
   但它意味着 **C 的核对不能被当成安全审计用**。已写进模块注释。
6. **`verifierType: "agent"` 只在测试沙箱里出现**，生产计划仍然全是 `command`。
   它是为了造出重试而开的口子，不是对 v1 契约形状的改变。

---

## 11. 更正记录（fix round 1，2026-09-04，在 `03c02b5` 上）

本轮**没有任何代码改动** —— 只修一个证据产物，外加两条行号的核对。
按 Rule 13，更正另起一节记，不就地改历史。

### 11.1 §5.4 的 M-C patch：转述 → 字面（**已改，控制器裁决**）

原 §5.4 贴的是方括号缩写的转述。**裁决正确，已按裁决替换成逐字节的 patch。**
M-C 是存在性检查，「七条全红」这句话整个任务都压在它上面，
读者必须能逐字符核对；一条转述的 patch 和一条 `describe.skip` 在可审计性上是同一种亏空。

未凭记忆重写：新开 `git clone --local` 副本，**在同一次调用里**生成 patch 并跑出输出
（`MC2.patch` / `MC2.out`），且证明了
`shasum -a 256 MC.patch MC2.patch` **两份相同**（`e5b81a66…d2375`），
失败清单与失败消息 `diff` 退出 0。⇒ 原始产物是真的，新贴的这份就是产生那份输出的那份 patch。
贴进报告后又程序化校验了一次：**报告里的 patch 块与产物文件逐字节相同**。

### 11.2 `harvest.ts` 的「line 116」：**不是行号引用，是 git 的 hunk 头**

复审说「line 116 处并没有 `export async function harvest`，它在 118」。
**现测确认 118 是对的**：

```
$ /usr/bin/grep -n "^export async function harvest" src/scheduler/harvest.ts
118:export async function harvest(run: TaskRun, base: string, declared: ClaimedPath[]): Promise<Reconciliation> {
```
（观测 commit `03c02b5`。）

但 `116` 从来不是我写下的行号引用 —— 它是 `git diff` 自己输出的 hunk 头
`@@ -116,105 +116,9 @@`，意思是「旧文件第 116 行起 105 行 → 9 行」，
函数声明在这个 hunk 内部的第 118 行。**贴上字面 patch 后这一点自证**，
§5.4 里也加了一条⚠️写明。⇒ **无需更正，但已在 §5.4 显式说明，避免下一个读者再被绊一次。**

### 11.3 `S5.test.ts:55`：**复审记错了，原引用是对的**

复审说「`S5.test.ts:55` 处的 `d.land` 断言实际在 56 行」。**现测：不成立，它就在 55 行。**

```
$ /usr/bin/grep -n "expect(r.empty)\|expect(d.land)\|expect(d.exitContribution)" tests/scheduler/scenarios/S5.test.ts
52:      expect(r.empty).toBe(true);
55:      expect(d.land).toBe(false);
56:      expect(d.exitContribution).toBe(2);
```
（观测 commit `03c02b5`。）

56 行是 `expect(d.exitContribution).toBe(2)`，不是 `d.land`。
而且 §5.3 里那个 `55` **不是我数出来的，是 vitest 自己打的**：
`scratchpad/MB1.out` 里逐字是 `❯ tests/scheduler/scenarios/S5.test.ts:55:22`。

⇒ **不改。** 把一个经实测为真的行号改成假的，才是真正让证据不可审计的那个动作
（CLAUDE.md Rule 12 / Rule 14）。这里按 Rule 7 摆证据、分胜负，而不是照单执行。

### 11.4 控制器已裁掉、我这边确认接受的几条

- `TaskGraph` 字段语义（`graph.ts:12-17`）—— 与 `sameLayerWriteSets` 的假设一致，确认。
- 新判据确实被 `npm run verify` 执行（204 → 211）—— 确认。
- `sameLayerWriteSets` 第五个导出判为正当 —— 接受。
- **M-A1 与 M-A2 的等价性比我登记的更强**：控制器指出两者对**所有输入**都是同一个函数
  （删掉 `if (collides)` 分支 ≡ 硬写 `collides = false`），不只是在 S7 上。
  **接受这个更强的表述**，§5.2 里我原来的措辞（「在 S7 上产生相同可观测结果」）说轻了。
  ⇒ **一条证据、两种讲法，别当两条数。**

### 11.5 本轮的状态

代码零改动，`03c02b5` 未变，主工作树 `git status --short` 为空，
`src/scheduler/harvest.ts` 仍是 `627112f0…08fb7`；
ccloop `status --short` 为空、HEAD 仍 `7f2c5f6`。两个变异副本都已还原并拆除。
