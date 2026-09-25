# 执行驱动一轮 —— 终审修复席报告（I1–I6）

- 席位：Claude Opus 5.5（1M context），受控制器会话 `905e41ce` 派出，2026-09-25。单席，未派子 agent。
- BASE `73d23c7`；本席 6 笔提交（按顺序）：
  `fe36530`（I1）→ `06e5945`（I2）→ `000bea1`（I3）→ `62e5310`（I4）→ `bf4dbb2`（I5）→ `850d8a1`（I6）。
- ccloop 未改动。主工作树未做任何变异：红证据一律「先写判据、在修复前的代码上跑红」，修复后同一命令跑绿。
  红跑时工作树 = 上一笔提交 + 只加了新判据（尚未改生产代码）。
- 输出文件都在会话 scratchpad（`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/905e41ce-94af-4c74-b8c8-8c091a60e72b/scratchpad/`，下称 `$S`），全部重定向到文件后整份读回。

---

## I1 —— settle 不再解除超额阻断；被阻断的组不补 wake、不开始 provider 调用（`fe36530`）

**改动**
- `src/control/checkpoints.ts` `commitCandidate`：`"planHash" in group && group.status==="blocked"` 时保持 `blocked`，否则照旧置 `review`（遗留组不受影响，它们用 `stopped`）。
- `src/control/executionDriver.ts`：新增 `groupHeld(store, groupId)` ＝ `groupStopped || group.status==="blocked"`，A1（预留 provider attempt 前）与 B（发 accept 前）改用它；run 原地等待，不被 block。
  `replenishStartWakes` 本就只对 `DISPATCHABLE_GROUP_STATES`（不含 `blocked`）补 wake，未改。
- 夹具：`tests/control/fixtures/driverPort.ts` 加 `workTokens` 选项（默认仍 10），`driverHarness.ts` 透传。

**判据**（`tests/control/driverSettle.test.ts` 新 describe「a group blocked by a budget breach (final review I1)」）
1. 两个 task（b 依赖 a）；a 的 work usage 报成 `grant.work.tokens + 1`；驱动到 a `cleanedUp` ⇒ a `settled`、`breaches` 非空、work a `done`；再两轮 ⇒ 组 `status==="blocked"`、`drive:%` wake 数 0、组内 run 数仍 1。
2. 组被置 `blocked` 后，已领的 run 五轮内停在 `starting`、`providerAttemptOrdinal 0`、accept 0 次（A1 守卫）。
3. run 到 `prepared` 后组被置 `blocked`，五轮内仍 `start-pending`、accept 0 次（B 守卫）。

**RED**：`npx vitest run tests/control/driverSettle.test.ts > $S/fix-i1-red.txt` ⇒ rc=1，3 条红：
「expected 'review' to be 'blocked'」；A1：`state:"landed", providerAttemptOrdinal:1`；B：`'settled'` ≠ `'start-pending'`。
**GREEN**：同命令 `> $S/fix-i1-green.txt` ⇒ rc=0，12/12。另 `checkpoints`/`usage`/`executionDriver` 34/34（`$S/fix-i1-more.txt`）。

## I2 —— 只有尖端真的移动才下轮重来；其余 CAS 失败按名阻断（`06e5945`）

**改动**
- `src/control/workspace.ts` `compareAndSwap`：`update-ref` 失败后再 `rev-parse` 一次分支；`current!==null && current!==old` 才返回 `false`；否则抛 `Error("cas-failed:<ref>: <git stderr，空白折叠>")`。
- `src/control/driverLanding.ts`：D 与 R 两处调用点逻辑不变（抛错由驱动环 generic handler 按 `stepOf` 阻断在 D／R，原因即上面的 message），只补注释。

**判据**
- `tests/control/driverLanding.test.ts`：run 到 `collected` 后在目标仓库放真的 `.git/refs/heads/orca/g.lock` ⇒ 5 轮内 `blocked`，`blockedAt:"D"`，`blockedReason` 匹配 `^cas-failed:refs/heads/orca/g: .*g\.lock`，分支不动，落地工作区已删。
- `tests/control/driverReconcile.test.ts`（新 describe「…final review I2」）：一个 run `reconciling`（fake 持续 800 ms）时放同样的锁 ⇒ 阻断在 `R`、原因同上、分支不动、spawn 只 1 次。

**RED**：`npx vitest run tests/control/driverLanding.test.ts tests/control/driverReconcile.test.ts -t "leftover" > $S/fix-i2-red.txt` ⇒ rc=1，2 条红（均为「did not reach the expected state」：D 停在 `collected` 空转；R 回 `collected`→再冲突）。
**GREEN**：`npx vitest run tests/control/driverLanding.test.ts tests/control/driverReconcile.test.ts tests/control/workspace.test.ts > $S/fix-i2-green.txt` ⇒ rc=0，33/33（既有的「尖端被移动后下一轮落在新尖端」仍绿）。

## I3 —— 解冲突 `ccloop run` detached、输出进文件、unref（`000bea1`）

**改动**
- `src/scheduler/ccloopRunner.ts`：`RunTaskOptions` 新增可选 `detachedLogDir`。设了才走新的 `spawnDetached`：`detached:true`、stdio `["ignore", fd, fd]` 指向该目录下新建的 `ccloop.stdout.log`／`ccloop.stderr.log`（`openSync(..., "w", 0o600)`）、`child.unref()`；子进程结束后从文件读回 stdout/stderr，其余（`readTerminalStatus` 等）不变。
  **不设（`orca run`）时代码路径逐字不变。**
- `src/control/driverLanding.ts` `stepR`：传 `detachedLogDir: workdir`（＝`<workspacesRoot>/reconcile-<runId>/<reconcileRunId>`，在它的 runs 目录里）。
- 「重启后等活着的 pid、它活着时不删 loop state」：既有逻辑（`reconcileNextAction` 的 `wait`；`rm(workdir)` 只在 `spawn` 分支）已满足，未改；由新判据覆盖。

**判据**（`tests/control/driverReconcile.test.ts`「spawns the reconciliation as its own process group…」）
fake 持续 1500 ms；第一个驱动环跑到记下 pid ⇒ `ps -o pgid= -p <pid>` 等于 pid（自成进程组组长）；两个日志文件存在且 mode `0600`；`await first.stop()`；新建第二个驱动环跑到两 run 都落地 ⇒ `reconcile` 仍是同一 pid、`outcome:"succeeded"`，spawn 计数 1。

**RED**：`npx vitest run tests/control/driverReconcile.test.ts -t "own process group" > $S/fix-i3-red.txt` ⇒ rc=1：「expected 28736 to be 30959」（pgid 是 vitest 的组，不是子进程自己）。
**GREEN**：`npx vitest run tests/control/driverReconcile.test.ts > $S/fix-i3-green.txt` ⇒ rc=0，18/18；`tests/scheduler/ccloopRunner.test.ts` 12/12（`$S/fix-i3-sched.txt`）。

## I4 —— R 处的人工 retry 真的重跑；记账键为持久化的 spawn 序号（`62e5310`）

**改动**
- `src/control/driveRecord.ts`：`reconcileRecordSchema` 加 `spawnSeq: safeInteger.default(0)`（旧记录照常解析）；`resumeBlockedDriverRun` 在 R 处**保留** `outcome`（仍清 `spawning`/`pid`/`attemptSha`），`spawnSeq` 自然保留。
- `src/control/driverLanding.ts`：
  - `beginReconcile` 记录 `spawnSeq: 0`；spawn 分支在起之前一次写入 `{spawning:true, pid:null, outcome:null, attemptSha:null, spawnSeq: n+1}`（`rm(workdir)` 丢弃旧终态照旧在可负担性检查之后）。
  - `reconcileNextAction` 加可选入参 `collected`（＝`record.outcome!==null`）：终态且未收 ⇒ `collect`；终态且已收（已被拒）⇒ pid 活着 `wait`，否则 `spawn`。可选是为了不改写既有的 D17 决策表判据。
  - 记账键改为 `spawn-${record.spawnSeq ?? 0}`（不再用 attemptSha／pid）。

**判据**（`tests/control/driverReconcile.test.ts` 新 describe「a person's retry of a run blocked at R (final review I4)」＋决策表）
1. 解冲突以 `failed` 结束 ⇒ `reconcile-terminal:failed`、1 笔记账；改 fake 为 `succeeded`，发真实的 run 级 `recovery-retry`（`service.recoveryRetry`）⇒ `resolved:true` ⇒ 两 run 都落地、再两轮 ⇒ spawn **2**、`reconcile-usage` 行 **2** 且键互不相同、`used.tokens` 34（10+10+7+7）、`orca/g:shared.txt` 为 `A\nB`。
2. 已收的解冲突落地时 CAS 被锁拒（I2 路径，`outcome` 未置）⇒ 删锁、retry ⇒ 落地，spawn 仍 **1**、记账仍 **1**、`used` 27（保护「retry 不把同一次 spawn 记两次、也不无谓重跑」）。
3. 新决策表 4 行：`collected:true` 且无活 pid ⇒ `spawn`（两行）；`collected:true` 且 pid 活 ⇒ `wait`；`collected:false` ⇒ `collect`。

**RED**：`npx vitest run tests/control/driverReconcile.test.ts -t "final review I4" > $S/fix-i4-red.txt` ⇒ rc=1：判据 1 红（「did not reach the expected state before the deadline」—— retry 后只重收旧终态、永不重跑）；判据 2 在修复前即绿（它是守护，不是这个缺陷的红）。决策表是修复后加的（入参 `collected` 修复前不存在）。
**GREEN**：`npx vitest run tests/control/driverReconcile.test.ts tests/control/driveRecord.test.ts tests/control/driverRecovery.test.ts > $S/fix-i4-green.txt` ⇒ rc=0，43/43；决策表 `$S/fix-i4-table.txt` 4/4。

## I5 —— 面板对驱动环阻断的 run 给 Retry（`bf4dbb2`）

**改动**：`web/src/ControlGroupView.tsx` 在 Runs 表的 state 格里，对 `state==="blocked" && blockedReason` 的 run 渲染「Retry run <taskId|runId>」按钮，发 `{verb:"recovery-retry", groupId, expectedRevision, payload:{scope:"run", runId}}`；服务端路由 `/api/control/recovery/retry` 按 payload 的 `scope:"run"` 把 target 定为该 run（`src/panel/controlApi.ts` 既有逻辑，未改）。
**判据**：新文件 `web/tests/driverRetry.test.tsx`（jsdom＋testing-library）：一个带 `blockedReason` 的 blocked run 与一个 running run ⇒ 恰 1 个「Retry run」按钮，点击 ⇒ `onCommand` 恰被调 1 次、参数逐字等于上面的 action；无 `blockedReason`（含 blocked 但 reason 为 null）⇒ 0 个。
**RED**：`cd web && npx vitest run tests/driverRetry.test.tsx > $S/fix-i5-red.txt` ⇒ rc=1（找不到按钮；第二条修复前即绿）。
**GREEN**：`cd web && npx vitest run tests/driverRetry.test.tsx tests/workspaceMode.test.tsx > $S/fix-i5-green.txt` ⇒ rc=0，5/5。

## I6 —— spec 文末追加 §12（`850d8a1`）

`docs/superpowers/specs/2026-09-25-execution-driver-design.md` 末尾追加 `## 12. 终审后的更正（2026-09-25，控制器裁定）`，中文；`git diff --stat` 为 18 行纯新增、0 删除（上文逐字未动）。内容：(a) §3.5 补登 `conflict-<runId>`／`reconcile-<runId>`（含 I3 的日志文件）、settle 后保留、每个解冲突 run 一对、无上限、清理推后；(b) 验收表述加 D12（抬 token 上限）与 C4（ccloop 在主题行「fix(control): report zero usage for a verify phase that calls no provider」那一笔或之后 —— 本席在 ccloop 里读到它是 `9a91d2b`）；(c) I1–I5 各一行。

---

## 总验证（HEAD `850d8a1`，均先 `source $S/env-t2.sh`）

| 命令 | 输出文件 | 结果 |
|---|---|---|
| `npm run typecheck` | `$S/final-tc.txt` | rc=0 |
| `npx vitest run tests/control/driver*.test.ts tests/control/executionDriver*.test.ts tests/panel/controlAssemblyDriver.test.ts tests/scheduler tests/control/checkpoints.test.ts tests/control/usage.test.ts tests/control/workspace.test.ts --reporter=json …` | `$S/final-targeted.{txt,json}` | rc=0，275/275，0 skipped；`executionDriverE2E` 9/9 **passed（非 skipped）** |
| `npm run --ws check` | `$S/final-wscheck.txt` | rc=0，web 16 文件 75/75 |
| 全量 `npx vitest run --reporter=json …` | `$S/final-full.{txt,json}` | rc=0，1756/1756，0 failed、0 pending；已知 flake 本次未红 |

## 偏离与需要知道的事

- **偏离**：I4 的 `collected` 入参做成可选，以免改写既有 D17 决策表判据（house rules：只能改 brief 点名的判据）。I1 在 A1／B 用 `groupHeld` 让 run 原地等，而不是 block 它（可逆，Rule 1 第 2 档）。
- **一处纪律瑕疵**：I3 时有一次把 typecheck 输出经 `tail` 读（退出码另外单独取得 rc=0）；之后的 typecheck 全部整份读回，最终 `$S/final-tc.txt` 为整份。
- 没有修 brief 以外的任何东西。

## 看到但不在范围内（未修，仅报）

1. **超额阻断之后没有人工出口**：`setLimit` 只接受 `ready/running/review` 的组（`webService.ts` setLimit 内的状态检查），所以被 breach 阻断的 Web 组只能走 stop／recover。I1 之后这一点变得实际可达，建议登记或给面板一句提示。
2. **泵本身不看组的 `blocked`**：`deliverScheduledStart` 只查 stop intent 与 `usageUnknown`；breach 之前已挂着的 wake 仍会造出一个 `starting` run。I1 之后驱动环在 A1 按住它（不预留 attempt、不花钱），但它会一直停在 `starting`。
3. **I3 未做评审建议的第二半**：一次起过、非终态死掉（pid 已死、无终态 loop state）的解冲突，重派前仍不入账（`rm(workdir)` 连同花费证据一起删）。控制器裁定未包含；detached 之后这条路只剩真崩溃／被杀，但仍是「少记真钱」的形状。
4. 升级前已在飞的解冲突记录没有 `spawnSeq`，会以 `spawn-0` 记账（`?? 0`）；与之后的 `spawn-1..` 不撞。
5. `processAlive` 的 pid 复用（台账 T6）仍在；detached 后进程更长寿，窗口不变。
6. 评审 m1–m13 与 m5／m6 的登记均未动。其中 m1（`check-driver.py` 的 `EXPECTED`）现在更不准：本席新增判据后 `driverSettle` 12 条、`driverReconcile` 24 条、`driverLanding` 5 条、web 多一个文件 `driverRetry.test.tsx`（2 条）—— 条数来自上表 json 现量。
