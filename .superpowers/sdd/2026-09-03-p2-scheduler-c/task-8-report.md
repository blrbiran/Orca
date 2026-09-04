# Task 8 报告：跑一个任务（clone ＋ spawn ＋ 读状态）

**归属**：run `session_01BfFQhczP5BorRwTag5cCxL`，2026-09-04，
起点 `50e2b8a`（Task 7 收尾），终点 `f254c74`。ccloop 观测时点 HEAD `7f2c5f6`。

---

## 1. 实现了什么

### `src/scheduler/ccloopRunner.ts`（新建）

| 导出 | 责任 |
|---|---|
| `CcloopOutcome` | ccloop 的五个终态字面量 |
| `TaskRun { runId, workdir, outcome, attemptSha }` | 计划里钉死的形状，**一字未改** |
| `RunTaskOptions { adapter, adapterConfig }` | 见 §6 决策 D-8.1 |
| `runTask(plan, task, base, runId, options)` | spec §4.3 第 2、3 步 |
| `cloneDirOf(workdir)` / `loopDirOf(workdir, runId)` | 目录布局，Task 9／10 要用 |
| `OutcomeRouting` ＋ `routeOutcome(graph, taskId, outcome)` | spec §6.1 的四态路由，纯函数 |
| `disposeWorkdir(run, options)` ＋ `Disposal` | spec §4.5 的副本留删 |

一次 `runTask` 的流程：

```
<runsDir>/<runId>/            ← workdir（run-id 由 Task 7 的 allocateRunId 占好）
  repo/                       ← git clone --local --no-checkout <targetRepo>
                                 ＋ git checkout --detach <base>
  contract.json               ← 原契约的【副本】，context.repoPath 改写成 repo/
  loop/<runId>/               ← ccloop 的 --run-dir
    loop-state.json           ← 唯一的终态来源
```

`loop/<runId>` 这一层的叶子名**必须是 runId**：ccloop 的 `attemptRefName` 用
`refs/ccloop/<run-dir 的 basename>/attempts/<n>` 造 ref，所以叶子名决定了 ref 长什么样。
`attemptSha` 就是从 clone 里 `for-each-ref refs/ccloop/<runId>/attempts` 取**编号最大**的那条。

### `tests/scheduler/sandbox.ts`（追加）

`headOf`、`commitOnTop`、`ScriptedFrameSpec` ＋ `writeScriptedConfig`、`planThatSpawns`、
`seedFanOutPlan`；`ContractSpec` 增两个可选字段 `maxAttempts` / `denylistPaths`；
`resolveCcloopBin` 加 `ORCA_CCLOOP_BIN` 覆盖（见 §5）。

### 判据文件

- `tests/scheduler/ccloopRunner.test.ts`（9 条）
- `tests/scheduler/scenarios/S8.test.ts`（1 条）
- `tests/scheduler/scenarios/S9.test.ts`（1 条）
- `tests/scheduler/sandbox.test.ts` 增 2 条（`ORCA_CCLOOP_BIN`）

---

## 2. 🔴 现测：`scripted` 跑法怎么落到每个终态

**没有猜。** 先读 ccloop 源码定位分支，再写一个独立探针脚本**真跑**一遍四种配置。

探针：`node <scratchpad>/probe.mjs`（临时脚本，不入库），
被测二进制 `/Users/biran/code/skills/loop/ccloop/dist/cli.js`，
ccloop HEAD `7f2c5f63e9c83076e04c03ff691780e6f6f731a2`。每个 case 都是
`git clone --local` ＋ `checkout --detach <base>` ＋ `ccloop run --adapter scripted`。

| 终态 | 怎么走到 | 实测退出码 | 实测 `loop-state.json` 的 `stopReason` | attempt ref |
|---|---|---|---|---|
| `succeeded` | `requiredChecks: ["true"]` | **0** | `success condition satisfied` | 有 |
| `exhausted` | `requiredChecks: ["false"]`，`maxAttempts: 1` | **2** | `attempt limit reached` | 有 |
| `failed` | `requiredChecks: ["false"]`，`maxAttempts: 2` | **2** | `verifier rejection with no safe retry path` | 有 |
| `blocked_waiting_human` | `denylistPaths: ["forbidden.txt"]` ＋ 脚本帧 `changedFiles: ["forbidden.txt"]` | **2** | `denylist match: forbidden.txt` | **无** |

⇒ **四个非成功终态全是退出码 2** —— spec §6.0 的现测在本轮被重新复现，
这就是 `M-STATUS` 要删掉的那条读状态的价值所在。

### 三条读源码得出、并被上表证实的机制

1. **`maxAttempts` 决定 `exhausted` 还是 `failed`。**
   `src/stop/stopController.ts:60` 的 `evaluateStopDecision` 里
   `attemptNumber >= maxAttempts`（⇒ `exhausted`）**排在** `!verifier.safeToRetry`（⇒ `failed`）**之前**。
   `maxAttempts: 1` 时第一次 attempt 就撞上前者 ⇒ 永远拿不到 `failed`。
   **S8 需要 `failed`，所以它的契约必须 `maxAttempts: 2`。**

2. **`verifierType: "command"` 下 adapter 的 `verify` 帧【压根不会被调用】。**
   `src/controller/runLoop.ts` 的 `runVerification`（:249）：`requiredChecks` 全过 ⇒ 直接
   `{ approved: true, pauseSignals: [], stopSignals: [] }` 返回，只有 `verifierType: "agent"`
   才走 `adapter.verify(context)`。
   ⇒ ***「契约写 `pauseOn` ＋ 脚本帧写 `pauseSignals`」这条通往 `blocked_waiting_human` 的路在
   `command` 验证器下是死的***。**唯一能走通的是 `evaluatePathPolicy`**：
   `runLoop.ts:1425` 在 execute 之后、verify 之前用脚本帧的 `execution.changedFiles`
   跑 `src/policy/pathPolicy.ts` 的黑名单／白名单／`maxFilesTouched` 三条，
   命中就 `persistTerminalState(..., "blocked_waiting_human", ...)` 并**直接 return**。

3. **`blocked_waiting_human` 不产 attempt ref，是机制决定的，不是偶然。**
   `publishAttemptCommit` 只在 `cleanupAttemptWorkspaceWithStatus` / `...OrThrow` 里被调用
   （`runLoop.ts:351` / `:391`），而 `blocked_waiting_human` 那两条 return 路径
   （`:1436` 的 pathPolicy 分支、`:1579` 的 `if (decision.kind !== "blocked_waiting_human")`）
   **都跳过 cleanup**。⇒ worktree 留在 `<runDir>/worktrees/attempt-<n>`，ref 不写。
   ⇒ **`TaskRun.attemptSha` 在 blocked 时为 `null` 是设计事实，Task 9 的 harvest 必须按这个来。**

⚠️ **`cancelled` 没有实测。** 它要么靠 `stopOn` ∩ `verification.stopSignals`
（需要 `verifierType: "agent"`，见上第 2 条），要么靠给进程组发停止信号。
**本任务没跑出过一次真的 `cancelled`**，它的路由只有纯函数判据覆盖（见 §4）。**如实登记，不冒充实测。**

### G13 遵守情况
全程 `--adapter scripted`。**一次真 agent 都没跑，没花模型的钱。**

---

## 3. TDD 证据

### RED-1（模块还不存在）

```
npx vitest run tests/scheduler/ccloopRunner.test.ts tests/scheduler/scenarios/S8.test.ts \
  tests/scheduler/scenarios/S9.test.ts tests/scheduler/sandbox.test.ts    # exit=1
```
输出是三个 `Failed to load url ../../src/scheduler/ccloopRunner.js`。
**这不算「看见判据红」** —— 它红在模块解析上，每条判据自己的断言一次都没跑。

### RED-2（放一个 stub，让每条判据红在它自己的断言上）

先写一个只返回固定值的 `ccloopRunner.ts` stub，再跑同一条命令：

```
exit=1
 Test Files  3 failed (3)
      Tests  8 failed (8)
```

逐条（原样抄自 `scratchpad/red-2.txt`）：

| 判据 | 红在哪 |
|---|---|
| reads the terminal status… | `expected 'succeeded' to be 'blocked_waiting_human'`（:75） |
| rewrites the contract's repoPath… | `Error: spawn git ENOENT` —— stub 没建 clone，`headOf(workdir/repo)` 的 cwd 不存在 |
| fails loud when ccloop leaves no terminal status | `promise resolved "{ runId: 'orca-T1-cba9fb73', …(3) }" instead of rejecting`（:160） |
| disposeWorkdir removes a successful clone | `expected false to be true`（:188） |
| disposeWorkdir keeps a failed clone ＋ 打印 | `expected '' to contain '/var/folders/…/orca-DISPOSE-failed'`（:206） |
| disposeWorkdir `--keep-workdirs` | `expected '' to contain '/var/folders/…/orca-DISPOSE-succeeded'`（:219） |
| **S8** | `expected 'succeeded' to be 'failed'`（S8:42） |
| **S9** | `expected 'succeeded' to be 'blocked_waiting_human'`（S9:43） |

⚠️ **上表的行号是 RED-2 那一跑当时文件的行号，原样保留（它是证据）。**
判据文件此后动过两次（`4c10aaf` 加了一行 import，`9128d56` 追加了三条判据），
所以到 commit `9128d56` 为止的对应关系是：

| RED-2 当时 | HEAD `9128d56` | 断言 |
|---|---|---|
| `:75` | **`:76`** | `expect(blocked.run.outcome).toBe("blocked_waiting_human")` |
| `:160` | `:160`（未移动） | 「无 loop-state.json 时 fail loud」的 `rejects.toThrow` |
| `:188` | **`:256`** | `expect(result.removed).toBe(true)` |
| `:206` | **`:274`** | 失败副本留下时的 `expect(stdout).toContain(run.workdir)` |
| `:219` | **`:287`** | `--keep-workdirs` 的同一条 |
| S8 `:42` / S9 `:43` | 未移动 | `expect(r1.outcome).toBe(…)` |

### GREEN

实现落地后同一条命令：

```
exit=0
 Test Files  3 passed (3)
      Tests  8 passed (8)
```

### 门

```
npm run verify        # exit=0
 Test Files  27 passed (27)
      Tests  201 passed (201)
```
七行 `downgraded to tier 0` 照旧出现（历史记录，设计如此），退出码仍是 0。
Task 1–7 的判据一条没动、一条没红。

---

## 4. 🔴 `ContractSpec` 扛住了第一次真 spawn 吗？

**扛住了 —— 契约的【形状】一个字节没改。**

Task 1 按 ccloop `src/contract/schema.ts` 的 `.strict()` 手写的那份契约，
在本轮第一次真 spawn 时**被 ccloop 原样接受**：九次真 spawn（探针 4 次 ＋ 判据 5 次）
没有一次报过 schema 错误。`writeContract` 产出的 JSON 逐字段对上 `loopContractSchema`：
`objective` / `context` / `executionPolicy` / `safetyPolicy` / `verification` / `escalationAndExit`
六个 `.strict()` 对象、`targetPaths` 与 `buildTestCommands` 与 `requiredChecks` 与 `rejectOn` 的
`.min(1)`、`terminalStates` 的「必须恰好是全部五个」refinement，全部满足。

**改动只有两处追加**，都是为了让场景能把 ccloop 驱动到别的终态，不是修正：
`ContractSpec` 增可选 `maxAttempts?: number` 与 `denylistPaths?: string[]`，
分别接到 `executionPolicy.maxAttempts`（原写死 1）和 `safetyPolicy.denylistPaths`（原写死 `[]`）。
默认值一字未改 ⇒ **Task 2–7 的既有调用行为完全不变。**

---

## 5. 承接的 deferred minor：`ORCA_CCLOOP_BIN`

`resolveCcloopBin()` 现在先读 `process.env.ORCA_CCLOOP_BIN`，读不到才回落到兄弟目录路径；
具名错误在两条路上都保留，并**说清这个路径是哪来的**（`(from ORCA_CCLOOP_BIN)` /
`(from the sibling-directory default)`）。

它当场就被用上了：**本任务全部变异跑都在 `git clone --local` 副本里**，
副本不在 ccloop 的兄弟位置，所以每一次变异跑都是
`ORCA_CCLOOP_BIN=/Users/biran/code/skills/loop/ccloop/dist/cli.js npx vitest run …`。
没有这个覆盖，Task 8 的变异根本没法在副本里跑。

---

## 6. 本任务自己做的两条决策

### D-8.1 —— `runTask` 多一个必填的 `options` 参数

**问题**：ccloop 的 `run` 必须同时给 `--adapter` 和 `--adapter-config`，
而 plan 文件的形状（spec §2.3）**没有任何字段承载它们**。

**选项**：(a) 在 plan schema 里加字段 —— 越界进 Task 2 的模块；
(b) 约定契约旁边的同名 `.adapter.json` —— 凭空发明一条没人写过的约定，且**这条默认分支不会被任何判据覆盖**；
(c) 由调用方传。

**选了 (c)**，两个必填字段，没有默认值：不发明约定、不留无判据的分支，
并把「真跑时这份配置从哪来」这个产品决策**明摆着推给编排那一步（Task 13／14）**，
而不是在这里悄悄替它决定。**可逆**（改签名即可），按 CLAUDE.md Rule 1 第 2 档自行判。

⚠️ **这是一条要交接的缺口**：`orca run` 落地前必须回答「adapterConfig 从哪来」。

### D-8.2 —— `disposeWorkdir` 不由 `runTask` 调用

**这是本任务对 brief 字面读法的唯一一处偏离，明写在这里。**

brief ruling 5 说「默认删掉成功任务的副本」。但 spec §4.3 的六步里，
**第 4 步收产物、第 6 步 `git fetch <副本> <sha>` 都在 spawn 之后**，
而 attempt commit **只在副本的对象库里可达**。
⇒ 在第 3 步结尾就把成功任务的副本删掉，等于把第 4–6 步唯一要读的东西删了。

⇒ 删除策略作为**独立导出** `disposeWorkdir(run, options)` 落地，语义完全照 §4.5
（成功删／非成功留并打印路径／`--keep-workdirs` 全留／`/bin/rm -rf` 绝对路径），
三条分支各有判据；**由编排层在落地之后调用**。

---

## 7. 变异表

全部在 `git clone --local` 副本里做，主工作树全程零触碰。
副本：`<scratchpad>/mut`，克隆自本仓库 `4c10aaf`（M-STATUS／M-REPOPATH／M-ROUTE／M-IMPLICIT）
与 `f254c74` 前的同一份（M-BIN／M-BIN-b）；`node_modules` 用符号链接，
拆时先 `/bin/rm -f` 链接本身再 `/bin/rm -rf` 副本。
每次跑法：`cd <mut> && ORCA_CCLOOP_BIN=… npx vitest run <喂它的判据文件>`，
**输出整份重定向到文件再读回，不过滤**。

副本基线先跑一次：`exit=0`，`Tests 11 passed (11)`。

### `M-STATUS` 🔴 —— 删掉读 `loop-state.json`，改成只看退出码

```diff
--- a/src/scheduler/ccloopRunner.ts
+++ b/src/scheduler/ccloopRunner.ts
@@ -239,7 +239,8 @@ export async function runTask(
     options.adapterConfig,
   ]);
 
-  const outcome = await readTerminalStatus(loopDir, spawned);
+  // M-STATUS: read the exit code instead of loop-state.json.
+  const outcome: CcloopOutcome = spawned.code === 0 ? "succeeded" : "failed";
   const attemptSha = await latestAttemptSha(clone, runId);
   return { runId, workdir, outcome, attemptSha };
 }
```

`exit=1`，`Tests 3 failed | 5 passed (8)`：

- 读状态那条：`expected 'failed' to be 'blocked_waiting_human'`（ccloopRunner.test.ts:76）
- **S9**：`expected 'failed' to be 'blocked_waiting_human'`（S9.test.ts:43）
- 附带：`fails loud when ccloop leaves no terminal status` ——
  `promise resolved "{ runId: 'orca-T1-8bf210b6', …(3) }" instead of rejecting`

S8 在这条变异下保持绿 —— 预期之内：S8 要的就是 `failed`，而变异体把非 0 一律叫 `failed`，
**恰好蒙对**。这正是 spec §10.3 要求「每条变异点名喂它的场景」的理由：
`M-STATUS` 的具名场景是**读状态那条 ＋ S9**，两条都红了。

### `M-REPOPATH` 🔴 —— 删掉改写 `repoPath`

```diff
--- a/src/scheduler/ccloopRunner.ts
+++ b/src/scheduler/ccloopRunner.ts
@@ -222,7 +222,8 @@ export async function runTask(
     context?: Record<string, unknown>;
     [key: string]: unknown;
   };
-  const rewritten = { ...original, context: { ...original.context, repoPath: clone } };
+  // M-REPOPATH: copy the contract without rewriting context.repoPath.
+  const rewritten = { ...original };
   const contractPath = contractCopyPath(workdir);
   await writeFile(contractPath, JSON.stringify(rewritten, null, 2));
```

`exit=1`，`Tests 2 failed | 6 passed (8)`：

- 改写那条：`expected null not to be null`（ccloopRunner.test.ts:122，`run.attemptSha`）
- 附带：读状态那条的 `exhausted.run.attemptSha` 同样为 null

🔴 **一条必须写下来的发现：brief 给的那句断言在这条变异下【不会红】。**

brief 的 Step 1 写的是 `expect(await headOf(join(r.workdir, "repo"))).toBe(base)`。
但**副本无论如何都会被建出来并 checkout 到 base**，变异只是让契约继续指向 targetRepo
⇒ 这句断言在变异体下照绿。实测确认（行号按 commit `9128d56`）：它排在 `:116`，**跑过去了**，
红的是 `:123`。⇒ 判据里补了三条真正在量「ccloop 到底在哪个仓库里干活」的断言：

1. `run.attemptSha` 非 null（ref 只会写进 ccloop 的 worktree 所属的那个仓库）；
2. `refSha(clone, "<attemptSha>^") === base`（attempt 的父提交＝那个仓库当时的 HEAD）；
3. `targetRepo` 里没有任何 `refs/ccloop/*`。

其中 **`:125`（第 3 条）才是真正承重的那条**：`:123` 与 `:124` 在这条变异下红的理由是同一个
代理量（`attemptSha` 为 null），而 `:125` 直接量「ref 落在了哪个仓库」。

因为断言会短路，**第 3 条是不是也在量这条变异，我单独探了一次**：
把它挪到最前面重跑同一个变异体 ——

```
AssertionError: expected [ Array(1) ] to deeply equal []
+ Array [ "refs/ccloop/orca-T1-b7a1463a/attempts/1" ]
  ❯ tests/scheduler/ccloopRunner.test.ts:124
```

⇒ ***不改写 `repoPath` 时，ccloop 真的把 attempt ref 写进了【用户的目标仓库】。***
这条探针只在副本里做，未入库。

### `M-ROUTE` —— §6.1 四态路由压成「非 succeeded 一律后代全 blocked」

```diff
--- a/src/scheduler/ccloopRunner.ts
+++ b/src/scheduler/ccloopRunner.ts
@@ -314,21 +314,15 @@ function descendantsOf(graph: TaskGraph, taskId: string): string[] {
 export function routeOutcome(graph: TaskGraph, taskId: string, outcome: CcloopOutcome): OutcomeRouting {
+  // M-ROUTE: the crude rule spec 6.1 withdrew -- anything but succeeded is a
+  // failure and blocks every remaining task, with no per-state routing.
   if (outcome === "succeeded") {
     return { countsAsFailure: false, escalates: false, upstreamNotRun: [], stopRound: false };
   }
-  if (outcome === "cancelled") {
-    return {
-      countsAsFailure: true,
-      escalates: false,
-      upstreamNotRun: allTaskIds(graph).filter((id) => id !== taskId),
-      stopRound: true,
-    };
-  }
   return {
-    countsAsFailure: outcome !== "blocked_waiting_human",
-    escalates: outcome === "blocked_waiting_human",
-    upstreamNotRun: descendantsOf(graph, taskId),
+    countsAsFailure: true,
+    escalates: false,
+    upstreamNotRun: allTaskIds(graph).filter((id) => id !== taskId),
     stopRound: false,
   };
 }
```

`exit=1`，`Tests 4 failed | 5 passed`：

- **S8**：`expected [ 'T2', 'T3' ] to deeply equal [ 'T2' ]`（S8.test.ts:48）
- **S9**：`expected false to be true`（S9.test.ts:46，`route.escalates`）
- `routeOutcome > gives each of ccloop's five terminal states its own verdict`
- `routeOutcome > stops the whole round when a task is cancelled`

同样因为短路，**「其它分支照跑」这条断言是不是也在量它，我单独探了一次**：
在副本里删掉排在前面的断言重跑 ——

- S8 的 `expect(stillRunnable).toEqual(["T3"])` ⇒ `expected [] to deeply equal [ 'T3' ]`（:53）
- S9 的 `expect(route.countsAsFailure).toBe(false)` ⇒ `expected true to be false`（:47）

⇒ 两条场景各自都有**不止一条**断言在量这条变异。

### 变异跑发现的一处真缺口 ⇒ 追加判据 ＋ 一处真 bug

第一轮 `M-ROUTE` 只红了 S8／S9。**`cancelled` 那一行被删掉却没有任何判据红** ——
因为 S8／S9 一个是 `failed` 一个是 `blocked`，两条都够不着「人按了停」。
按 Rule 9 与 spec §0.3（**每新增一个分支，点名删掉它自己的变异并看见红**），
补了三条纯函数判据（五个终态各自的裁决、`cancelled` 整轮停、隐式边后代）。

写这三条时抓到一个真 bug：`allTaskIds` 返回 `graph.layers.flat()`（**分层序**），
而 `descendantsOf` 返回排序后的结果 ⇒ **同一组 taskId，走不同分支出来的顺序不一样**。
判据当场红：

```
- Array [ "T2", "T3" ]      ← expected
+ Array [ "T3", "T2" ]      ← received
```

修法：`allTaskIds` 也排序。落在 `4c10aaf`。

### 追加变异 `M-IMPLICIT` —— `descendantsOf` 只跟显式边

```diff
--- a/src/scheduler/ccloopRunner.ts
+++ b/src/scheduler/ccloopRunner.ts
@@ -284,7 +284,7 @@ function allTaskIds(graph: TaskGraph): string[] {
 function descendantsOf(graph: TaskGraph, taskId: string): string[] {
   const out = new Map<string, string[]>();
   for (const [from, to] of graph.explicit) out.set(from, [...(out.get(from) ?? []), to]);
-  for (const edge of graph.implicit) out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);
+  // M-IMPLICIT: follow dependsOn edges only, ignoring write-set edges.
```

`exit=1`：`counts an implicitly-downstream task as a descendant` ⇒
`expected [] to deeply equal [ 'B' ]`（ccloopRunner.test.ts:312）。
⇒ 那条判据确实在量「隐式边也算后代」，不是被别的分支顺带掠过。

### `M-BIN` / `M-BIN-b` —— 给 `ORCA_CCLOOP_BIN` 两条判据补红

这两条判据是**先实现后写判据**的（deferred minor 顺手落的），所以必须补一次「被看见红」。

`M-BIN`（忽略覆盖，回到写死的兄弟路径）：

```diff
-  const bin = override ?? resolve(dirname(new URL(import.meta.url).pathname), "../../../ccloop/dist/cli.js");
+  // M-BIN: ignore the override, back to the hard-coded sibling path.
+  const bin = resolve(dirname(new URL(import.meta.url).pathname), "../../../ccloop/dist/cli.js");
```
⇒ `lets ORCA_CCLOOP_BIN override the sibling-directory assumption` 红
（`ccloop bin not found at <scratchpad>/ccloop/dist/cli.js`）。

`M-BIN-b`（把「路径是哪来的」标签写死）：

```diff
-    const source = override === undefined ? "the sibling-directory default" : "ORCA_CCLOOP_BIN";
+    // M-BIN-b: drop the "which source" half of the named error.
+    const source = "the sibling-directory default";
```

🔴 ***第一次跑 `M-BIN-b`：`exit=0`，六条判据全绿。***
第二条判据写的是 `toThrow(/ORCA_CCLOOP_BIN/)`，而错误信息的结尾那句建议
（`or point ORCA_CCLOOP_BIN at its dist/cli.js`）**无论标签是什么都含这个词** ——
⇒ **一条「声称的目的不是它实际在量的东西」的判据**，正是自查要扫的第 (b) 种形状。

改成匹配字面量 `(from ORCA_CCLOOP_BIN)` 后对同一个变异体重跑：

```
AssertionError: expected [Function] to throw error matching /\(from ORCA_CCLOOP_BIN\)/
 but got 'ccloop bin not found at … (from the sibling-directory default). …'
```
⇒ 红了。落在 `f254c74`。

### 变异总表

| 变异 | 喂它的场景 | 结果 |
|---|---|---|
| `M-STATUS` 🔴 | 读状态那条 ＋ S9 | **红**（两条都红，另附带红了「无终态时 fail loud」那条） |
| `M-REPOPATH` 🔴 | 改写那条 | **红**（brief 字面那句断言不红，补的三条断言红；单独探针确认 ref 被写进了目标仓） |
| `M-ROUTE` | S8 ＋ S9 | **红**（各两条断言独立确认；并暴露 `cancelled` 分支无判据 ⇒ 已补） |
| `M-IMPLICIT`（本轮追加） | routeOutcome 隐式边那条 | **红** |
| `M-BIN`（本轮追加） | `ORCA_CCLOOP_BIN` 覆盖那条 | **红** |
| `M-BIN-b`（本轮追加） | `ORCA_CCLOOP_BIN` 具名错误那条 | **第一次绿 ⇒ 判据改写后红** |

---

## 8. 还原证明

主工作树**全程零触碰** —— 所有变异都在 `<scratchpad>/mut` 里做。

变异开始前（commit `1695922` 刚落）与全部变异跑完之后的 `shasum -a 256`：

| 文件 | before | after | 说明 |
|---|---|---|---|
| `tests/scheduler/scenarios/S8.test.ts` | `d766030f…51aa87` | `d766030f…51aa87` | **逐字节相同** |
| `tests/scheduler/scenarios/S9.test.ts` | `0a7d815e…c9fbab` | `0a7d815e…c9fbab` | **逐字节相同** |
| `tests/scheduler/sandbox.ts` | `e3c47be0…40f5d9` | `e3c47be0…40f5d9` | **逐字节相同** |
| `src/scheduler/ccloopRunner.ts` | `4a70c58f…483721` | `882737… e89bfb` | 差异＝ commit `4c10aaf` 的 `allTaskIds` 排序修复 |
| `tests/scheduler/ccloopRunner.test.ts` | `70f75dca…a2b2af` | `b5a3fa96…bc4150` | 差异＝ commit `4c10aaf` 追加的三条 routeOutcome 判据 |
| `tests/scheduler/sandbox.test.ts` | `14d5f188…9416e7` | `8ee644ae…9181fc` | 差异＝ commit `f254c74` 的判据改写 |

后三行的差异**全部由具名提交解释**，不是变异残留：

```
/usr/bin/git status --short      # exit=0，零输出
```

副本拆除：先 `/bin/rm -f <mut>/node_modules`（只删符号链接，不碰主仓的 `node_modules`），
再 `/bin/rm -rf <mut>`；`ls | grep node_modules` 退出 1（链接已不在），`[ -e <mut> ]` ⇒ `no`。

⚠️ 期间踩了一次本机的 `cp` alias：`cp a b` 弹出 `overwrite …? (y/n [n]) not overwritten`
并**静默地没有复制**，导致一次变异跑读的还是旧文件。改用 `cat pristine > target` ＋
`shasum` 对拍两端相同后重跑。**CLAUDE.md 里那条 `-i` alias 的警告是真的。**

---

## 9. ccloop 仓库未被改动

```
/usr/bin/git -C /Users/biran/code/skills/loop/ccloop status --short
# exit=0，零输出
/usr/bin/git -C /Users/biran/code/skills/loop/ccloop rev-parse HEAD
# 7f2c5f63e9c83076e04c03ff691780e6f6f731a2
```

本轮在 ccloop 里只做了一件事：`npm run build`（只写 gitignore 掉的 `dist/`）。
构建后立即查了一次 `status --short`，零输出；全部工作结束后再查一次，仍然零输出，
HEAD 与开工时同一笔。**一个被跟踪的字节都没变。**

---

## 10. 耗时实测

口径：`npm run verify` 那一跑（commit `f254c74`），整份输出重定向后读回。

| 判据文件 | spawn 次数 | 实测 |
|---|---|---|
| `tests/scheduler/ccloopRunner.test.ts`（9 条） | 5 | **2495 ms** |
| `tests/scheduler/scenarios/S8.test.ts`（1 条） | 2 | **1375 ms** |
| `tests/scheduler/scenarios/S9.test.ts`（1 条） | 2 | **1162 ms** |
| 单条最慢：`reads the terminal status…`（2 次 spawn） | 2 | **1180 ms** |
| `npm test` 整体 | 9 | **Duration 2.84 s**（27 files / 201 tests） |
| `npm run verify:scheduler` | 9 | **Duration 2.68 s**（20 files / 82 tests） |

⇒ **没有慢到威胁可用性。** 一次真 spawn 大约 250–400 ms。
**没有任何一条被跳过、被标 skip、或为了省时间砍掉覆盖。**
（spec §10.1 预留的 `verify` / `verify:fast` 分档目前**不需要动用**；这是 Task 15 的判断，本轮只提供数字。）

---

## 11. 改了哪些文件

| 文件 | 动作 |
|---|---|
| `src/scheduler/ccloopRunner.ts` | 新建，约 350 行 |
| `tests/scheduler/ccloopRunner.test.ts` | 新建，9 条判据 |
| `tests/scheduler/scenarios/S8.test.ts` | 新建 |
| `tests/scheduler/scenarios/S9.test.ts` | 新建 |
| `tests/scheduler/sandbox.ts` | 追加 5 个 helper ＋ `ContractSpec` 两个可选字段 ＋ `ORCA_CCLOOP_BIN` |
| `tests/scheduler/sandbox.test.ts` | 追加 2 条判据（既有 4 条一字未动） |

**没碰**：`src/ledger/**`、`scripts/githooks/**`、`.decisions/**`、`src/cli.ts`、
`src/scheduler/` 下其它任何文件、ccloop 的任何被跟踪文件。

提交：

```
1695922 feat(scheduler): run one task in its own clone and read its real terminal status
4c10aaf test(scheduler): pin every row of the §6.1 routing table, including cancelled
f254c74 test(scheduler): make the ccloop-bin error criterion measure what it claims
```

未 push、未合并、未建分支或 worktree。

---

## 12. 自查

读了自己的 diff，逐条扫两种被咬过的形状：

**(a) 排在被测调用之前、读回测试自己刚写进去的值的断言。**
只有两处「前置断言」，都不是这个形状：
- `expect(laterHead).not.toBe(base)` —— 量的是 `commitOnTop` 真的推进了 HEAD，
  是**夹具守卫**（夹具坏了它会红），不是把被测函数的输出提前读回来。
  而且它守的正是本判据不至于空转的那个前提。
- `expect(existsSync(run.workdir)).toBe(true)` —— 同理，守 `seedWorkdir` 真的建出了副本。

**(b) 声称的目的不是它实际在量的东西。**
抓到一条，就是 §7 的 `M-BIN-b`：`toThrow(/ORCA_CCLOOP_BIN/)` 声称在守「错误要说清路径是哪来的」，
实际上匹配的是错误信息尾巴上那句建议。已改写并复跑变异确认红。
另外主动删掉了一句纯重言的断言（`expect(cloneDirOf(w)).toBe(join(w, "repo"))` ——
两边算的是同一件事，永远不可能红）。

**残留物。** 每个 sandbox 都在 `finally` 里 `cleanup()`，
`cleanup` 是对 `root` 的 `rm -rf`，而 clone、ccloop 的 run 目录、blocked 跑剩下的 attempt worktree
**全都在 `root` 底下** ⇒ 一次 `cleanup` 全清。跑完 `npm run verify` 后主仓 `git status` 零输出。
`disposeWorkdir` 的三条判据也各自在沙盒里。

**够不到 ccloop 的被跟踪文件。** `runTask` 只 clone `plan.targetRepo`（一次性沙盒仓）、
只以只读方式 spawn `plan.ccloopBin`。判据里的 `plan.targetRepo` 永远是 `mkdtemp` 出来的临时目录。
`git status` 双向核对见 §9。

**语言。** `src/` 与 `tests/` 本轮所有改动**零个中日韩字符**（脚本逐行扫过，命中 0）。

---

## 13. 遗留与担忧

1. **`adapterConfig` 从哪来，没有答案。** 见 D-8.1。`orca run` 落地前必须回答。
   现在是调用方必填，不会静默。

2. **`cancelled` 没有端到端场景。** 只有纯函数判据。真跑一次 `cancelled` 需要
   `verifierType: "agent"`（走 `stopOn`）或给进程组发信号，两条都超出本任务。
   spec §10.2 的场景表里也确实没有 `cancelled` 的场景。**登记，不掩饰。**

3. **「S9 不调 ccloop 的 `resume`」是结构性事实，不是判据。**
   spec §6.4 要求 C 自己升人、不去 resume 一个 `blocked_waiting_human` 的 run。
   `ccloopRunner.ts` 里**根本没有 `resume` 这个字符串**，所以它成立；
   但**没有一条判据在量它** —— 要量得有一个 spawn 参数的注入缝，
   那是只为判据存在的生产代码，本轮判断不值。**如实登记为「结构保证，非实测」。**

4. **`blocked_waiting_human` 会在副本里留下一个注册着的 ccloop worktree。**
   `disposeWorkdir` 对这种副本是「留」，所以不会被删掉；
   真删的时候 `/bin/rm -rf` 连 clone 带 worktree 一起清，不需要 `git worktree remove`。
   已实测（沙盒 cleanup 就是这么清的）。**但 Task 10 若改成先 `git worktree prune` 再删，需要重测。**

5. **`latestAttemptSha` 取的是编号最大的 attempt。**
   本轮所有真跑都只产生一条 attempt ref（`maxAttempts: 2` 那次也是第一次 attempt 就终态），
   ⇒ **「多条 ref 时取最大」这条逻辑没有被真跑覆盖过**，只被代码走查覆盖。
   要覆盖它得造一次真的 retry（`safeToRetry: true` ＋ `verifierType: "agent"`）。登记。

6. **`ContractSpec` 的 `maxFilesTouched` 仍写死 `targetPaths.length`。**
   本轮的 blocked 场景走的是 denylist，没依赖这条；
   但若以后有场景想靠 `maxFilesTouched` 触发人闸，得先把它变成可覆盖的。

7. **Task 9 必须知道的两件事**（都在 §2 实测过）：
   `blocked_waiting_human` 的 `attemptSha` 恒为 `null`；
   `succeeded` 的 attempt commit 是 `--allow-empty` 的 ——
   `scripted` adapter 一个文件都不写，所以那笔 commit 的树与 base 一模一样。**这条是实测的**：
   `git -C <probe clone> rev-parse <attemptSha>^{tree} <base>^{tree}`
   两行都是 `2d2805be0106da973023879415a3ba82b35018ab`。
   ⇒ **spec §6.2 的 `succeeded_but_empty` 在 `scripted` 下是【常态】，不是异常。**
   Task 9 的 S5 会正面撞上这一点。

---
---

# 修复轮 1（fix round 1）

**归属**：同一个 run `session_01BfFQhczP5BorRwTag5cCxL`，2026-09-04。
起点 `f254c74`（首轮收尾），本轮落在 `9128d56`。ccloop 仍是 `7f2c5f6`，未动。

四项：复审三条 Important ＋ 协调者按 Task 6 的既有裁定追加的一条。
**§1–§13 原文逐字保留**，只有两处行号在原地更正（§7 的 `:115`/`:122`，
以及 §3 RED-2 表下新增的行号对照表）—— 更正本身在本节 §F5 记账。

---

## F1（Finding 1）—— 非终态守卫补上判据与变异

**问题**：`readTerminalStatus` 里那条「status 不在五个终态里就抛」的分支，
首轮**没有任何判据**。删掉它，`"executing"` 会一路流进 `routeOutcome`，
落到默认那一行，被报成 `countsAsFailure: true` —— 一次**从没跑完的 run 被算成失败**，
而且没有任何东西会察觉。这正是 spec §0.1 说的静默降级。

**新判据**：`ccloopRunner.test.ts` 的
`fails loud when ccloop leaves a status that is not terminal`。
沿用首轮已有的 stub-bin 手法：一个 `.mjs` 从 argv 里取 `--run-dir`，
写下 `{"status":"executing"}`，然后 ***`process.exit(0)`***。
退出码 0 是刻意的 —— **读退出码的实现会说「成功」，无脑信字符串的实现会说「失败」，两个都错**，
这条判据量的既不是前者也不是后者。

### 变异 `M-NONTERMINAL`

```diff
--- a/src/scheduler/ccloopRunner.ts
+++ b/src/scheduler/ccloopRunner.ts
@@ -145,12 +145,7 @@ async function readTerminalStatus(loopDir: string, spawned: SpawnResult): Promis
   }
 
   const status: unknown = (JSON.parse(raw) as { status?: unknown }).status;
-  if (typeof status !== "string" || !TERMINAL_OUTCOMES.includes(status)) {
-    throw new Error(
-      `orca: ccloop left a non-terminal status ${JSON.stringify(status)} in ${statePath} ` +
-        `(exit ${String(spawned.code)}, signal ${String(spawned.signal)})`,
-    );
-  }
+  // M-NONTERMINAL: trust whatever status is on disk, terminal or not.
   return status as CcloopOutcome;
 }
```

`exit=1`：

```
   × ccloopRunner … > fails loud when ccloop leaves a status that is not terminal 234ms
     → promise resolved "{ runId: 'orca-T1-efdf4afb', …(3) }" instead of rejecting

AssertionError: promise resolved "{ runId: 'orca-T1-efdf4afb', …(3) }" instead of rejecting
+ Object {
+   "attemptSha": null,
+   "outcome": "executing",          ← 正是那条被指出的静默降级，字面出现在返回值里
+   "runId": "orca-T1-efdf4afb",
+   "workdir": "/var/folders/…/runs/orca-T1-efdf4afb",
+ }
 ❯ tests/scheduler/ccloopRunner.test.ts:202:92
```

---

## F2（Finding 2）—— `/bin/rm -rf` 前面加所有权守卫

**问题**：`disposeWorkdir` 对 `run.workdir` 直接 `/bin/rm -rf`，**什么都不检查**。
而 `runTask` 里 `workdir = join(plan.runsDir, runId)` 也不校验 `runId`
⇒ 空串或 `"."` 形状的 runId ⇒ `workdir === plan.runsDir`
⇒ **一次 dispose 会删掉本轮每个任务的副本和每一份契约拷贝。**
且 `TaskRun` 是要被编排层跨 §4.3 第 4–6 步搬运的值，本仓库自己的判据也已经在手工构造它
⇒ **到达 rm 的那个值不总是 `runTask` 刚返回的那个。**

**改法（两处）**：

1. `disposeWorkdir` 开头：`run.runId` 非空 **且** `basename(run.workdir) === run.runId`，
   否则抛。**排在 keep/remove 判断之前**，不只是排在 rm 之前。
   为什么用「目录名等于 run id」而不是「路径在 runsDir 之下」：
   **前缀判定对 `runsDir` 自己会说「是」**，而 `runsDir` 自己正是必须被拒的那个值；
   顺带也拒掉了带分隔符的 runId（join 之后 basename 就不等于它了）。
2. `runTask` 开头：`runId` 非空，否则抛 —— 在 clone 之前。

**两条新判据**：
- `disposeWorkdir … refuses a workdir that is not the run's own directory, and deletes nothing`
- `ccloopRunner … refuses an empty run id before it builds anything`

前者按复审要求**同时断言「什么都没被删」**：先在 runsDir 下造一个诱饵目录
`orca-SOMEONE-ELSE-1/repo`，再拿一个 `workdir === s.runsDir` 的手工 `TaskRun` 去 dispose，
拒绝之后断言 runsDir 与诱饵都还在。

### 变异 `M-GUARD`（整条守卫删掉）

```diff
@@ -392,12 +392,7 @@ export async function disposeWorkdir(run: TaskRun, options: DisposeOptions = {})
-  if (run.runId.length === 0 || basename(run.workdir) !== run.runId) {
-    throw new Error(
-      `orca: refusing to dispose of ${JSON.stringify(run.workdir)} — it is not a directory named ` +
-        `after run id ${JSON.stringify(run.runId)}, so deleting it could take the whole runs directory with it`,
-    );
-  }
+  // M-GUARD: delete the ownership check entirely.
```

`exit=1`：

```
   × disposeWorkdir (spec §4.5) > refuses a workdir that is not the run's own directory, and deletes nothing 84ms
     → promise resolved "{ removed: true, …(1) }" instead of rejecting
+ Object {
+   "removed": true,
+   "workdir": "/var/folders/…/orca-sched-ZzCBcN/runs",     ← 整个 runs 目录被删了
+ }
 ❯ tests/scheduler/ccloopRunner.test.ts:316:42
```

### 变异 `M-GUARD-LATE`（同一条检查，挪到 rm 之后）

**这条才是在证「deletes nothing 那两条断言不是装饰」。**

```diff
-  if (run.runId.length === 0 || basename(run.workdir) !== run.runId) {
-    throw new Error( … );
-  }
+  // M-GUARD-LATE: the same check, moved to after the rm.
 
@@
   await execFileAsync("/bin/rm", ["-rf", run.workdir]);
+  if (run.runId.length === 0 || basename(run.workdir) !== run.runId) {
+    throw new Error( … );
+  }
   return { removed: true, workdir: run.workdir };
```

`exit=1`：

```
   × disposeWorkdir (spec §4.5) > refuses a workdir that is not the run's own directory, and deletes nothing 78ms
     → expected false to be true // Object.is equality
 ❯ tests/scheduler/ccloopRunner.test.ts:317:37
    316|       await expect(disposeWorkdir(forged)).rejects.toThrow(/refusing t…
    317|       expect(existsSync(s.runsDir)).toBe(true);
       |                                     ^
```

⇒ ***`:316` 的 `rejects` 照过（异常确实抛了），红的是 `:317`。***
一条「删完再抛」的守卫能骗过 `rejects`，骗不过这条 —— **所以它确实在量「守卫排在删之前」。**

### 变异 `M-RUNID`（`runTask` 的空 id 检查删掉）

```diff
@@ -213,9 +213,7 @@ export async function runTask(
-  if (runId.length === 0) {
-    throw new Error("orca: runTask needs a non-empty run id; an empty one names the whole runs directory");
-  }
+  // M-RUNID: accept any run id, empty included.
   const workdir = join(plan.runsDir, runId);
```

`exit=1`：

```
   × ccloopRunner … > refuses an empty run id before it builds anything 417ms
     → promise resolved "{ runId: '', …(3) }" instead of rejecting
+ Object {
+   "attemptSha": null,
+   "outcome": "succeeded",
+   "runId": "",
+   "workdir": "/var/folders/…/orca-sched-DR9lp5/runs",      ← runs 目录被当成了本任务的副本
+ }
 ❯ tests/scheduler/ccloopRunner.test.ts:227:89
```

⇒ `M-RUNID` 与 `M-GUARD` 合起来正是复审描述的那条完整灾难链：
**空 id ⇒ workdir 就是 runs 目录 ⇒ dispose 把整轮删光。** 两端各有一道守卫，各有一条判据。

---

## F3（Finding 3）—— §4.5 的副本删除策略，指名交接给 Task 10

**无代码改动。** 协调者维持了首轮 D-8.2 的判断（`runTask` 不删，否则毁掉 §4.3 第 4–6 步
唯一能读的对象库），但指出这条保证目前**只写在一段理由里，没有主人**。
按要求把它挪进「遗留」，见本节末 §F6 第 8 条。

---

## F4（Finding 4）—— 删掉 S8／S9 两条不可能红的断言

`S8.test.ts:67` 与 `S9.test.ts:65` 断言「runsDir 里没有 T2 的运行目录」。
但**这两个测试自己从不创建它**，而且本任务里没有任何代码决定「跑哪些任务」
（那是编排层，Task 14 才有）⇒ **本模块的任何变异都不可能让这两条红。**

复审判 Minor；协调者判 Important，理由是 Task 6 对 S21 里**同一形状**的断言就是这么处理的
（删掉，把性质挪到它变得可测的那个任务）—— 同一形状两种判法会让规则失效。**同意，照办。**

两处各删一条断言，原地留一行注释说明「这条性质要等编排层才可测，延到 Task 14」，
**其余断言一字未动**（S8 的 `:42/:45/:46/:48/:53`、S9 的 `:43/:46/:47/:49/:54` 全部保留）。
两个文件的 `readdir` import 随之移除（否则 `noUnusedLocals` 之外也是死 import）。

⚠️ **没有造替代品。** 复审明确禁止「自己把目录建出来再断言它不在」——
那是在量自己的夹具。

---

## F5 —— 报告里的行号更正（协调者点名）

首轮 §7 的 `M-REPOPATH` 那段散文写的是「它排在第 115 行……红的是第 122 行」。
**那两个数来自第一轮变异跑（`4c10aaf` 之前的文件），而报告贴的是最终一轮的输出** ——
数对不上，等于证据不可核。已在原地改成 `:116` / `:123`（口径：commit `9128d56`），
并补了一句指明 **`:125` 才是承重那条**（`:123`、`:124` 在这条变异下红的是同一个代理量
`attemptSha === null`，只有 `:125` 直接量「ref 落进了哪个仓库」）。

§3 的 RED-2 表**没有就地改**（那是当时那一跑的真实输出，是证据本身），
改为在表下补一张 RED-2 行号 → HEAD 行号的对照表。

现测口径（`/usr/bin/grep -n … > 文件` 后整份读回，commit `9128d56`）：

```
76:      expect(blocked.run.outcome).toBe("blocked_waiting_human");
116:      expect(await headOf(cloneDirOf(run.workdir))).toBe(base);
123:      expect(run.attemptSha).not.toBeNull();
125:      expect(Object.keys(await allRefShas(s.targetRepo)).filter((r) => r.startsWith("refs/ccloop/"))).toEqual([]);
160:      await expect(runTask(…)).rejects.toThrow(    ← 无 loop-state.json
202:      await expect(runTask(…)).rejects.toThrow(    ← 非终态 status
227:      await expect(runTask(plan, task, base, "", …)).rejects.toThrow(   ← 空 run id
256:      expect(result.removed).toBe(true);
316:      await expect(disposeWorkdir(forged)).rejects.toThrow(/refusing to dispose/);
317:      expect(existsSync(s.runsDir)).toBe(true);
318:      expect(existsSync(join(decoy, "repo"))).toBe(true);
```

---

## F6 —— 本轮的跑与证明

### 判据

```
npx vitest run tests/scheduler/ccloopRunner.test.ts \
  tests/scheduler/scenarios/S8.test.ts tests/scheduler/scenarios/S9.test.ts
# exit=0   Test Files 3 passed (3)   Tests 14 passed (14)
```

### 门

```
npm run verify        # exit=0
 Test Files  27 passed (27)
      Tests  204 passed (204)      ← 首轮 201，本轮 +3
```
七行 `downgraded to tier 0`（`.decisions/orca-dev-09cc3ea1.jsonl:8–14`）照旧出现，退出码仍是 0。

### 变异总表（本轮新增四条）

| 变异 | 删／改了什么 | 喂它的判据 | 结果 |
|---|---|---|---|
| `M-NONTERMINAL` 🔴 | 非终态守卫整条 | 非终态那条 | **红**（返回值里字面是 `outcome: "executing"`） |
| `M-GUARD` 🔴 | dispose 的所有权守卫整条 | dispose 守卫那条 | **红**（`removed: true` on `…/runs`） |
| `M-GUARD-LATE` 🔴 | 同一条守卫挪到 rm 之后 | 同上 | **红在 `:317`**，`:316` 的 rejects 照过 ⇒ 证明「删之前」被量到了 |
| `M-RUNID` | `runTask` 的空 id 检查 | 空 id 那条 | **红**（`workdir` 就是 runs 目录） |

副本：`<scratchpad>/mut2`，`git clone --local` 自 `9128d56`，`node_modules` 用符号链接，
`ORCA_CCLOOP_BIN` 指向真 ccloop。副本基线先跑 `exit=0 / 12 passed`。
拆除：先 `/bin/rm -f` 链接、再 `/bin/rm -rf` 副本；`[ -e mut2 ]` ⇒ `no`。

### 还原证明

变异开工前（`9128d56` 刚落）与全部变异跑完之后的 `shasum -a 256`，
六个文件逐行对拍：

```
diff <before.sha> <after.sha>
# exit=0，零输出 ⇒ 六个文件全部逐字节相同
9000eae51ad867c4e082117d4724198b9c0feafb40a4178ad371a8f8bb022173  src/scheduler/ccloopRunner.ts
00bd8f9b529a23965d26f6a92b55ece55acef4cb9246079e0c3d3be8626a976b  tests/scheduler/ccloopRunner.test.ts
51bd3539e321791d751cc1fd1628103cfd6f21d6c51a07544e1b51744727d71d  tests/scheduler/scenarios/S8.test.ts
484f2df0b57135c63f15348ca4cb88d0ddc762fa2ec045d32988abe57970fc10  tests/scheduler/scenarios/S9.test.ts
e3c47be0db8e2dfa01affde2adf0f9d4f58c076e03b28623fcebd6722840f5d9  tests/scheduler/sandbox.ts
8ee644aed5311724eea3df407ab50e77b2bf193aa26a0c1411d9fb64569181fc  tests/scheduler/sandbox.test.ts
```

`git status --short` 零输出（本仓库）。

### ccloop 仍未被改动

```
/usr/bin/git -C /Users/biran/code/skills/loop/ccloop status --short   # exit=0，零输出
/usr/bin/git -C /Users/biran/code/skills/loop/ccloop rev-parse HEAD   # 7f2c5f63e9c8…
```
本轮**一次都没有进过 ccloop 仓库写东西**，连 `npm run build` 都没再跑。

### 耗时

`ccloopRunner.test.ts` 从 9 条涨到 12 条：**2843 ms**（首轮 2495 ms）。
新增三条里两条要 spawn（非终态 stub、无终态 stub 已有），一条纯内存。
`npm test` 整体 `Duration 3.19 s`（首轮 2.84 s）。**仍未接近需要 `verify:fast` 分档的程度。**

---

## F7 —— 明确没有动的东西

协调者点名 deferred、本轮**一律没碰**：`loop-state.json` 的裸 `JSON.parse`；
spawn 子进程没有超时／kill、stdout/stderr 无上限缓冲；
`adapter: "scripted" | "claude"` 联合类型里那个 v1 无路径的取值；
clone 与 checkout 的裸 `execFile` 错误未具名；硬链接对象库与目标仓 `git gc --prune` 的相互作用；
`latestAttemptSha` 取最大编号这条逻辑在 Task 9 之前无法覆盖；
`ccloopRunner.test.ts:78` 与 `:105` 的重言断言；`S8.test.ts:45` 那个用不到的第二个脚本帧；
两条判据把 `makeSandbox()` 放在 `try` 之外。**全部留给整支复审。**

首轮 §13 的 1–7 条遗留**全部仍然成立**，另加一条：

8. 🔴 **spec §4.5 的副本删除策略没有调用方 —— 主人是 Task 10 的落地步。**
   `disposeWorkdir` 在 `src/` 里只有它自己的定义这一处引用。
   不由 `runTask` 调用的理由（协调者已确认成立）：attempt commit 只在副本的对象库里可达，
   §4.3 第 4 步收产物、第 6 步 `git fetch` 都在 spawn 之后 ——
   在第 3 步结尾删掉成功任务的副本，等于删掉第 4–6 步唯一要读的东西。
   ⇒ **Task 10 在 `git fetch <副本> <sha>:refs/orca/<run-id>` 落进 W 之后**
   （那是副本第一次真正用完的时刻）**必须调用 `disposeWorkdir`，并兑现 §4.5 的三条行为**：
   成功的副本默认删；不成功的留下并打印路径；`--keep-workdirs` 全留。
   三条在本任务里各有判据，Task 10 只需要接上调用与 `--keep-workdirs` 这个开关的来源。
   协调者已把同一条指派记进 SDD 台账并会带进 Task 10 的派发 —— **这是交接，不是指望。**
