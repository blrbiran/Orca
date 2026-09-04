# P2 子系统 C —— 最终全分支评审的修复波（一轮，不再有第二轮）

**归属**：run `orca-final-fix-wave`，会话
`https://claude.ai/code/session_01BfFQhczP5BorRwTag5cCxL`，2026-09-04。
**落在**：`main`，两笔提交 —— `c91c603`（修复波本体）与 `730d775`（自审抓到的一处判据失效的修补）。
**起点**：`366ed92 docs(scheduler): close out P2 with the mutation re-run…`。
**未 push、未合并、未建也未删任何分支或 worktree。ccloop 仓库零改动（`git status --short` 为空，见 §6）。**

---

## 0. 一句话结论

评审提出的 12 项全部落地；新增 20 条判据，每条都点名了会打红它的变异，
**24 次变异实跑全部在断言上打红（不是崩溃）**；`npm run verify` 退出 0。
自审用「跑变异看它是不是还绿」的办法**抓到了一条被我自己这轮改动弄失效的老判据**（§5.1），已修并复跑。

---

## 1. 逐条改了什么

### Group A —— 输入校验簇（Important 1 / 2 / 5 ＋ 延后项 12）

| # | 位置 | 改动 |
|---|---|---|
| A1 | `src/scheduler/run.ts` `loadRound` | 契约的 `readFile` 与 `JSON.parse` **各自**加守卫，产出 `loadRound` 本来就在说的 `{ rejections }` 形状，code 为 `unreadable-contract`。两处分开，是因为「文件打不开」和「打开了但不是 JSON」是两条真不同的路径 —— 只包一半的修法会让第二条继续 exit 3。 |
| A2 | `src/scheduler/planFile.ts` `loadPlan` | 第 7 条当场拒 `unusable-task-id`：每个 `taskId` 用 `RUN_ID`（从 `src/ledger/writer.ts` **import**，不是抄一份）测一遍。原来只有层内循环深处的 `deriveRunId` 会抛。 |
| A3 | `src/cli.ts` `runPlan` | `preflightReport.rejections.length > 0` ⇒ **先打印报告，再 `return 1`**。§9.3 的「警告不影响退出码」讲的是**降级**（全串行仍然合法），不是失败的检查。 |
| A4 | `src/scheduler/preflight.ts` | `git status --porcelain` 的失败不再往外抛，改为 `dirty-worktree` 拒绝，消息明说是「读不出干净与否（是 git 仓库吗）」。**没有新造第 4 个运行时检查名**：`preflight.ts` 自己的 Ruling 1 注释就是为了防止「同一个检查的第四种拼法」，而该检查的主张本来就是「上工作区前必须**可验证地**干净」，一个读不出状态的目录确实不满足它。 |

### Group B —— 编排器正确性（Important 3 / 4 / 5 ＋ 被推翻的裁决）

| # | 位置 | 改动 |
|---|---|---|
| B5 | `run.ts` | 新增**唯一一个**回答「现在谁不能开工」的函数 `cannotStart(blocked)`，四个调用点全部走它：`stopRound` 的整层、`routeOutcome` 的 `upstreamNotRun`、以及**过去只 `continue` 的两处** —— `!verdict.land`（§6.2 `succeeded_but_empty` / §7.3 越界撞车）和 `!reconciled.landed`（§5.4 和解不成）。`descendantsOf` 从 `ccloopRunner.ts` 导出复用，不另写一份。 |
| B6 | `planFile.ts` / `planReport.ts` | `PLAN_LEVEL_CHECKS` 迁到 `planFile.ts` 作**唯一来源**，`loadPlan` 解构它来 push，`planReport.ts` 改为 re-export。镜像 `RUNTIME_CHECKS` 的方向。A2 的第七条**走同一个来源**。 |
| B7 | 新文件 `src/scheduler/pool.ts` ＋ `run.ts` | `mapWithPool(items, limit, fn)`：固定上限 `MAX_PARALLEL_TASKS = 4`（§1.3 的「v1 用固定上限」），**allSettled 语义**，输入序返回。`run.ts` 的层内并行改用它；抛出的任务变成 `LayerResult` 的 `{ taskId, error }` 分支，按 §6.1 `failed` 行处理（贡献 2、后代不能开工、同层其余任务照常处理）。 |
| B8 | `run.ts` `route.escalates` 分支 | `blocked_waiting_human` 现在**也**写 §5.4 的升人文件，用已存在的降级形状。旧裁决的前提（「两边意图和冲突块不存在，所以写不出」）是假的：`writeEscalationFile` 早就渲染降级形状，轮级异常路径就在用它。这里 `sides` 给一条（本任务的意图是已知的，比全空更诚实），`conflictBlocks: []` 渲染成「不是合并冲突」。副本路径被点名，而且**是真的还在**：`disposeWorkdir` 对任何非 succeeded 的 run 都保留副本。 |

### Group C —— 计划报告告诉人 W 从哪儿开始（Important 7）

| # | 位置 | 改动 |
|---|---|---|
| C9 | `planReport.ts` | 新增 `Base:` 一行，打印**基点分支名 ＋ 该分支的 sha**。`opts.base` 是**必填**，不是可选 —— 可选会让「没有基点」和「调用方忘了传」打印成同一个样子，正是 fix round 1 被 `emptyRequiredChecksPairs` 咬过的那个形状。 |
| C10 | `run.ts` / `land.ts` / `preflight.ts` / `planFile.ts` / `README.md` | `defaultBranch` → `baseBranch`（**行为一字未改**）。报告明说 W 从「目标仓当前 checked out 的那条分支」切出来。解析仓库真正的 default branch 登记为后续工作，不在本波。 |

### 也修了的延后小项

| # | 位置 | 改动 |
|---|---|---|
| 11 | `planFile.ts` `isInsideRepo` | `rel === ""`（contract 就是 targetRepo）现在算**里面**。⚠️ **`realpath` 没做，理由写在函数注释里也写在这儿**：这一层是零 I/O 层，而且 `realpath` 对一个**尚不存在**的契约路径会抛 —— 那正好把 Group A 刚清掉的「输入错误变成 exit 3」重新装回去。登记为 I/O 层的后续项。**这是与评审建议的一处有意偏离，明写而不是悄悄跳过。** |
| 12 | `tests/.../S20.test.ts` | 补上「拒绝消息也点名 T1」的断言。§5.2 的机制是**两边都被点名**，只查一边等于只量了一半规则。 |

**明确没动**（评审判为「保持现状」的其余延后小项）：`refSha` 的宽 catch、`verify` 下调度判据跑两遍、
zod 失败塌成 `malformed`、`writeSetOf` 拼接不去重、前导 `/` 的诊断标签、不可达的 "no schedulable task" throw、
上限耗尽错误缺 `cause`、边界决策一条一提交（其时序对 first-parent 正确性是承重的）、`M-C` 的汇总行；
以及 `git()` 重复与 `ORCA_IDENTITY` / 终态名副本（那是另一轮「只做收敛」的后续工作）。

---

## 2. TDD 证据 —— 新增判据与它们的变异

**判据数（实测）**：修复前 `366ed92` 上 `npx vitest run tests/scheduler` = **141 条 / 42 个文件**（在 clone 里 detached 到该提交实测）；
修复后 = **161 条 / 47 个文件**（+20 条 / +5 个文件）。逐文件对比（`before-counts` vs `after-counts`）显示
**没有任何既有文件的判据数下降**。

### 2.1 变异表（**全部实跑**，每条附字面 patch 与红在哪条断言）

| 变异 | 字面 patch（核心行） | 目标判据 | 红在 |
|---|---|---|---|
| `M-CONTRACT-GUARD` | `run.ts`：整段契约守卫 → `contracts.set(task.taskId, JSON.parse(await readFile(task.contract, "utf8")));` | inputRejections #1 #2 | `expect(rc).toBe(1)`（收到 `'ENOENT: no such file…'` / `"Expected property name…"`），`inputRejections.test.ts:58` 与 `:96` |
| `M-TASKID-UPFRONT` | `planFile.ts`：第 7 条拒绝整段 → `void UNUSABLE_TASK_ID;` | inputRejections #3 | `expect(rc).toBe(1)` 收到 **3**，`:134` |
| `M-PLAN-EXIT1` | `cli.ts`：删 `if (preflightReport.rejections.length > 0) return 1;` | inputRejections #4 #5 | `expect(dirty.result).toBe(1)` 收到 `+0`，`:169`／`:198` |
| `M-PREFLIGHT-THROW` | `preflight.ts`：`porcelainOf` 的 try/catch → 裸 `execFileAsync` | inputRejections #5 | `expect(rc).toBe(1)` 收到 `'Command failed: git status --porcelai…'`，`:198` |
| `M-LATE-REJECT` | `planFile.ts` 第 7 条失效 ＋ `run.ts` 在 `checkoutWorkBranch` **之后**补一个同名拒绝并 `return 1` | inputRejections #3 | **`expect(await allRefShas(...)).toEqual(refsBefore)`**，`:137` —— 专门用来证明「目标仓一字未动」那条断言本身是活的（退出码仍是 1，红的是 ref 集合） |
| `M-DRIFT` | `planFile.ts`：清单里 `"cycle"` → `"cycle-detected"`，同时把 push 处写死回字面量 `"cycle"`（＝修复前的手抄副本状态） | planFile 漂移判据 | 集合比较 `toEqual`，`planFile.test.ts:147` |
| `M-INSIDE-EMPTY` | `planFile.ts`：`return !rel.startsWith("..")…` → `return rel !== "" && !rel.startsWith("..")…` | planFile「contract 就是 targetRepo」 | `toContain('contract-inside-target-repo')`，`:103` |
| `M-NOTRUN-LAND` | `run.ts`：删 `!verdict.land` 分支里的 `cannotStart(descendantsOf(graph, taskId));` | upstreamNotRun #1 | `expect(stdout).toContain("T2: upstream_not_run")`，`:68` |
| `M-NOTRUN-RECONCILE` | `run.ts`：删 `!reconciled.landed` 分支里的同一行 | upstreamNotRun #2 | `expect(stdout).toContain("T3: upstream_not_run")`，`:103` |
| `M-POOL-CAP` | `pool.ts`：池体 → `Promise.all(items.map(...))` | pool #1 | `expect(maxInFlight).toBe(3)` 收到 **12**，`pool.test.ts:31` |
| `M-POOL-SETTLED` | `pool.ts`：worker 的 try/catch 去掉，直接 `results[index] = { status: "fulfilled", … }` | pool #2 | `expect(outcome.ok).toBe(true)` 收到 false，`:60` |
| `M-POOL-DROP-v2` | `run.ts`：`settled.map(...)` → `settled.slice(0, MAX_PARALLEL_TASKS).map(...)` | upstreamNotRun #4（生产接线） | `expect(await showFileAt(..., "f5.txt")).toBe("v5\n")` 收到 null，`:239` |
| `M-SETTLE` | `run.ts`：`mapWithPool` → `(await Promise.all(runnable.map(...))).map(v => ({status:"fulfilled", value:v}))` | upstreamNotRun #3 | `expect(rc).toBe(2)` 收到 **3**，`:198` |
| `M-BLOCKED-ESC` | `run.ts`：删 `route.escalates` 分支里的 `writeEscalationFile` 调用 | blockedEscalation | `expect(names).toHaveLength(1)` 收到 `[]`，`:64`（判据里的 `readdir(...).catch(() => [])` 就是为了让它红在断言而不是 ENOENT） |
| `M-BLOCKED-SIDES` | `run.ts`：`sides: [intentOfContract(round.contracts, taskId)]` → `sides: []` | blockedEscalation | `expect(text).toContain("**T1**")`，`:77` |
| `M-BASE-LINE` | `planReport.ts`：删 `lines.push(\`Base: …\`)` | planReport #1 #2 | `toContain('main')`，`:217`；`toContain('<no branch checked out>')`，`:232` |
| `M-BASE-WIRING` | `run.ts`：`base: { branch: round.baseBranch, sha: round.baseSha }` → `base: { branch: "", sha: null }` | planPrintsBase | `toContain(branch)`，`:31` —— 证明打出来的是**目标仓真实读到的值**，不是调用方随手给的 |
| `M-S20-BOTH` | `reconcile.ts`：拒绝消息去掉 `for ${a.taskId} x ${b.taskId}` | S20 #1 | 新增的 `toContain("T1")`，`S20.test.ts:52` |
| `M-BOOTSTRAP` | `cli.ts`：删 bootstrap 的 `(err: unknown) => {…}` 拒绝臂 | roundFailure #3 | `rejects.toMatchObject({ code: 3 })`，`:176` |
| `M-ROUND-STATE`（v2，见 §5.1） | `run.ts`：`log(await describeRepoState(plan));` → `void describeRepoState;` | roundFailure #1 | `expect(stateLine).toBeDefined()`，`:83` |

### 2.2 被本波改动「碰过」的旧变异，已复跑（第 3 条要求）

| 旧变异 | 为什么要复跑 | 结果 |
|---|---|---|
| `M-MAIN` | 我改了 `land.ts` `checkoutWorkBranch` 的**那几行**（参数改名 ＋ 报错措辞），条件本身 `plan.workBranch === baseBranch` 一字未动 | **v1 形式（只删 checkout 守卫）不成立** —— 轮子在 `landIntoW` 的第二道守卫上抛，S14 红在退出码（`:39`）而不是 ref sha。**v2 形式（两道守卫都删 ＋ 停在基点分支上合并）红在 `S14.test.ts:33` 的 default-branch ref sha**，即 `M-MAIN` 文档所写的那条断言。改名后保护仍然有效。⚠️ 顺带记一条**既有事实**：`M-MAIN` 的文档描述「删掉它、传 default branch」不足以复现，必须同时删 `landIntoW` 的 head 检查 —— 这不是本波引入的，是原描述不完整。 |
| `M-MARKERS-CALL` | 它的 `!reconciled.landed` 汇流分支被本波加了一行 | 复跑：`markersRemaining` 结果强制为空 ⇒ `S3escalations.test.ts:48` 的 `expect(rc).toBe(3)` 收到 2，红。 |

**未复跑、并说明理由**：`M-EXIT`（`exitCode.ts` 未改）、`M-EMPTYCHK` / `M-RECON`（`reconcile.ts` 仅 §2.1 的 `M-S20-BOTH` 那一句消息未改动地保留）、
`M-OTHERSIDE`（`otherSideOf` 未改）、`M-LOCK`（`repoLock.ts` 未改）、`M-FIRSTPARENT`（落地循环的串行顺序与边界决策时序未改）、
`M-LEDGER`（sandbox 帮手未改其行为）、`M-OPT`（其目标行 —— `if (!result.merged)` 与 `reconcileAndLand` 调用 —— 逐字未改）。
以上七条的目标代码在本波 diff 里没有被触碰。

### 2.3 判据里为让变异「红在断言」而做的形状调整

- `inputRejections` 的四处 `runCli(...).catch((err: Error) => err.message)`：不这样写，恢复守卫的变异会让判据在**任何断言跑之前**就崩，§0.3 不接受崩溃当证据。
- `blockedEscalation` 的 `readdir(dir).catch(() => [])`：同理，否则红的是 ENOENT。
- `pool` 的 settle 判据把 `mapWithPool` 的结果收成 `{ ok, value }`：同理。

---

## 3. 本波对既有行为的两处**有意**改变（不是回归）

1. **`roundFailure` 第一条判据的 fixture 换了**（`c91c603`）。原来靠 `chmod(runsDir, 0o500)` 让 `allocateRunId` 的 mkdir 报 EACCES 来制造**轮级**异常 —— 而 B7 之后那是**任务级**异常（这正是要的），不再产生轮级异常。改为用无法解析的 `ccloopBin` 制造轮级异常（`ccloopEvidence` 在 `roundId` 派生后、任何 spawn 之前抛），`runsDir` 仍然不可写，于是「升人文件自己也写不进去、但不许掩盖原始错误」这半边判据原样成立。**判据的每一条主张都保留了。**
2. **`roundFailure` 第三条判据的 fixture 换了**（`c91c603`）。它原来用「契约文件不存在」制造 `main()` 的 rejection —— 而 A1 之后那是干净的 exit 1，够不到 bootstrap 的拒绝臂了。改用 `orca validate` 读一个 `stat` 得到、`read` 读不到的文件（chmod 000），那条 `readFile` 是本波**有意没碰**的。`M-BOOTSTRAP` 复跑证明拒绝臂仍被量到。

---

## 4. 变异隔离与还原证明

- 全部变异在 `git clone --local` 的副本里做：
  `/private/tmp/claude-501/.../scratchpad/mut`，`node_modules` 用 symlink 指回主树。
- 副本销毁前先 `/bin/rm -f <copy>/node_modules` 摘掉 symlink，再 `/bin/rm -rf <copy>`。两次都如此。
- **主工作树逐字节还原证明**（`shasum -a 256`，对 `git ls-files src tests README.md package.json` 的 **85** 个文件，
  逐个比对「工作树文件的 sha256」与「`git cat-file blob HEAD:<file>` 的 sha256」）：

  - 第一轮变异后：**85/85 OK，0 DIFF**，`git status --porcelain` 为空。
  - 第二轮变异后：**84/85 OK，1 DIFF**，唯一的差异是 `tests/scheduler/scenarios/roundFailure.test.ts` ——
    那是 §5.1 自审修补**有意**的改动，不是变异残留；随后作为 `730d775` 提交，之后 `git status --porcelain` 再次为空。
- 期间没有对主工作树跑过任何变异。

---

## 5. 自审（用新眼睛读自己的 diff）

### 5.1 🔴 抓到一条**被本波自己弄失效**的老判据

`roundFailure` 第一条判据里 `expect(captured.stdout).toContain(tip!)`。本波给报告加了 `Base:` 行（Important 7），
而那个 fixture 里**没有任何东西落地**，所以 W 的 tip **就是**基点 sha —— 于是「删掉 `log(await describeRepoState(plan))`」
之后整条判据**照绿**（`M-ROUND-STATE` v1 实测 exit=0）。它已经不是判据了。

修法（`730d775`）：把断言**限定到 `describeRepoState` 自己那一行**上 ——
先 `find(l => l.includes("is left on branch"))`，再要求这一行同时带 workBranch 和 tip sha。
`M-ROUND-STATE` v2 复跑：红在 `expect(stateLine).toBeDefined()`（`roundFailure.test.ts:83`），是断言不是崩溃。

**这条是「跑变异看它是不是还绿」抓到的，不是读代码抓到的** —— 和本项目历史上七次的抓法一致。
我另外扫了全仓所有 `stdout).toContain(` 断言（见 §7 的命令），只有这一处会被 `Base:` 行影响。

### 5.2 逐条点名：新增断言各自的变异

上表 §2.1 覆盖了每条新判据的**主**断言。以下是**未实跑但能点名**的次级断言，如实登记：

| 断言 | 能打红它的变异（未跑） |
|---|---|
| `pool` #1 的 `results.map(...)` 顺序/完整性 | 让 worker 跳过尾部条目（已由 `M-POOL-DROP-v2` 在**生产侧**证明同一性质） |
| `pool` #3 `toMatch(/limit of at least 1/)` | 删掉 `limit < 1` 的守卫 ⇒ 返回 `"resolved"` |
| `pool` #4 `MAX_PARALLEL_TASKS >= 1` / `isFinite` | 把常量设成 `0` 或 `Infinity`（＝「悄悄把上限关掉」的那种回归） |
| planFile「`t.1-a` 不被拒」这半边 | 让第 7 条拒绝一切 ⇒ 反例半边红 |
| planFile「`/abs/repo-2/x.json` 仍算外面」这半边 | `isInsideRepo` 改成恒真 |
| planReport 的 `not.toContain("default branch")` | 把 `Base:` 行措辞改回「the default branch」 |
| inputRejections #1 #2 的 refs/porcelain 逐字节断言 | 与 `M-LATE-REJECT` 同形（已在 #3 上实跑并红在 `allRefShas`） |
| blockedEscalation 的「文件里带副本路径」 | 把 reason 里的 `${run.workdir}` 换成泛泛措辞 |

**没有一条新断言是我点不出变异的。**

### 5.3 我自己复查过、确认不是「排在被测调用之前读回自己写的值」的形状

新判据里所有的 `expect` 都发生在被测调用（`runCli` / `loadPlan` / `renderPlanReport` / `mapWithPool`）**之后**，
读的是被测代码的输出（stdout / stderr / 退出码 / 磁盘上的文件 / git ref），没有一条是读回测试自己刚写进去的值。
`inputRejections` 里的 `refsBefore` / `porcelainBefore` 是**被测调用之前**采样、**之后**比对，属于前后对比，不是自证。

---

## 6. 最终验证

```
$ npm run verify        # 全量，未过滤，重定向到文件后整份读回
VERIFY EXIT=0
  Test Files  54 passed (54)        # 全仓
  Tests      280 passed (280)
  Test Files  47 passed (47)        # verify:scheduler 那一遍
  Tests      161 passed (161)
  ok: 1 ledger file(s)
  ok: append-only
  ok: CLAUDE.md is 135/200 lines
  ok: core.hooksPath is scripts/githooks
```

- 调度判据：修复前 **141 / 42 文件** → 修复后 **161 / 47 文件**。**既有 141 条全部仍然通过**（逐文件计数对比无一下降）。
- ccloop 仓库：`/usr/bin/git status --short` 输出为空（跑于本波开始与结束两次）。
- 主仓 `git status --porcelain` 为空，HEAD = `730d775`。

---

## 7. 用到的测量命令（供复核，均为观测时 commit `730d775`）

```
/usr/bin/git clone --local /Users/biran/code/skills/loop/Orca <copy>
ln -s /Users/biran/code/skills/loop/Orca/node_modules <copy>/node_modules
ORCA_CCLOOP_BIN=/Users/biran/code/skills/loop/ccloop/dist/cli.js npx vitest run <file>   # 在 <copy> 里
/usr/bin/git checkout HEAD -- .                                                          # 每条变异后还原
/bin/rm -f <copy>/node_modules && /bin/rm -rf <copy>
shasum -a 256 <file>  vs  /usr/bin/git cat-file blob HEAD:<file> | shasum -a 256          # 85 个文件
npm run verify > verify-final2.txt 2>&1                                                   # 不过滤，整份读回
grep -rn "stdout).toContain" tests/                                                       # §5.1 的影响面扫描
```

变异的完整 patch 与完整日志留在本次会话的 scratchpad
（`.../scratchpad/mutations/*.patch`、`*.log`，50 个文件）；它们不是仓库产物，不入库。

---

## 8. 顾虑（如实登记，供 scoped 复审判定）

1. **A4 复用了 `dirty-worktree` 这个 code**，没有新造第四个运行时检查名。理由写在 §1 与 `preflight.ts` 注释里。
   如果复审认为「不是 git 仓库」必须有自己的 code，那是一处 code 名的增补 ＋ `RUNTIME_CHECKS` 的一处扩列，
   代价小，但会把 §9.1(4) 的检查计数再动一次，并且会让「repo 不是 repo 时另外两个运行时检查打 `[pass]`」这个假绿冒出来
   —— 那正是 Important 4 抱怨的形状。**我选了不新造。**
2. **延后项 11 的 `realpath` 没做**，理由见 §1 表格与函数注释：零 I/O 层 ＋ 对不存在路径会抛。**这是与评审建议的有意偏离。**
3. **并发上限的「数值」只在单元层被量到**（`M-POOL-CAP`）。生产侧只证明了「池接进去了、且一条都不丢」
   （`M-POOL-DROP-v2`）。端到端观测 5 次真实 ccloop spawn 的重叠是时序相关的，**一条 flaky 判据比没有判据更坏**，
   所以没有写。已在判据注释里明写这条限制。
4. **§9.1(4) 的「九条」计数与 spec 不再一致**（现在是 7 条 plan 级 ＋ 3 条运行时 ＋ 一条不入表的 `unreadable-contract`）。
   这是评审要求加第七条的必然结果。已作为 erratum 写进 `planReport.ts` 注释与 `README.md`，**没有悄悄漂移**。
5. **`M-MAIN` 的历史描述不完整**（§2.2）：只删 `checkoutWorkBranch` 的守卫复现不出它文档写的那条红，
   必须连 `landIntoW` 的 head 检查一起删。**这是既有事实，不是本波引入的**，登记在此。
6. **测试侧仍留着 `defaultBranchOf` / 局部变量名 `defaultBranch`**（`sandbox.ts`、S11/S14/S18/S19/S21）。
   它们说的是「`git init` 建出来的那条分支」，注释也是这么写的，且 S11/S14 的场景名逐字来自 spec §10.2 的表。
   按 Rule 3（外科手术式改动）没有一起改名。如果复审要求测试侧也统一，那是纯改名。
