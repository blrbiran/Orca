# 已登记的负载型 flake 与判别规则

> 本文是 Orca 已登记 flake 的**唯一清单**（2026-10-13 会话 `808feb6a` 起；此前散在 `handoff.md` §三，那一节已删，原文在 git 历史）。
> 活文档，允许就地改／删（Rule 13 三条件同 `handoff.md` 头部）。**不写当前哈希**；历史观测锚点照原样保留。

## 判别规则（**先读这条**）

1. 看到全量里红了一条：先问「是不是下面登记过的那条、而且是**同一种失败**（多为 `Test timed out in 5000ms` 或 `until` 等待超时）」。
   断言失败、不同错误、新出现的稳定红**一律不豁免**。
2. 是 ⇒ **单文件重跑**（`./node_modules/.bin/vitest run <file>`，重定向到文件再整份读回），**同时记 `uptime`**。
3. **等负载降下来再判**：`driverRecovery` 那条在负载约 37 时单文件也能连红 3 次 ⇒ 一次单跑红不说明是回归，一次单跑绿也不够——
   负载降到个位数后单文件连跑三次，3/3 绿 ⇒ **不是回归**；仍红 ⇒ 当回归查。
4. 登记**不等于**全量绿：照实报 failures／skips，写明哪几条是登记过的 flake、单跑结果和负载。不因登记就提高任何测试超时。
5. 新见到一条没登记的超时：完整输出、观测提交、`uptime`、单跑结果写进下表，再引用。
6. 机械判定：缝 B 那一轮的判定器（全套 json ⇒ smoke 全过、失败 ⊆ 已知名单、0 pending）代码全文在
   `docs/superpowers/plans/2026-09-24-g1-seam-b-target-version.md` 的 Task 4 Step 1，可直接抄；ccloop 有 `scripts/check-known-reds.mjs`。**名单本身会过期，引用前确认是哪一轮测的。**

## Orca 侧

| 文件 › 测试 | 现象 | 登记（会话／日期）与观测 |
|---|---|---|
| `tests/panel/controlShutdown.test.ts` › a real SIGTERM to a real panel › makes it exit cleanly, having written one shutdown row for its epoch | `expected 143 to be +0`（`:126`） | `ae4061a5` 2026-09-24：`verify:chain` 第二段全量红一次，单文件 5/5（6/6）绿；`f8281a60` 2026-09-27、`9d95e6c8` 2026-10-03、`08011394` 2026-10-04 全量里再见，单跑 3/3 绿。根因未查；未验证的推测：判据连发两次 SIGTERM，第二次经 tsx 转发晚于 `src/panel/server.ts` 在 `closed` 后摘处理器，内层 node 按默认处置死、tsx 转成 143（已排除「信号先于处理器安装」） |
| `tests/control/driverRequirementSplit.test.ts` › fails the third consecutive invalid draft as split-validation-exhausted, and a schema-invalid one as split-output-invalid | 5 s 超时 | `7fe6d61b` 2026-10-02：三次全量都红（负载 8–13），单文件 3/3 绿；走 fake port 不经 ccloop，单跑约 1.9 s（负载 19）。`08b1007d`、`08011394`、`6cc0c1e9` 全量里再见 |
| `tests/control/agentSelectionE2E.test.ts` › C3 "under fake claude, three parallel runs stopped mid-execute all continue…" | `timed out waiting for three continuations to land`（`until` 超时，不是断言） | `08011394` 2026-10-04：`verify:chain` 第二次全量红一次（5 分钟负载 13–15），同树第一次全量绿，负载约 6 单文件 3/3 绿 |
| `tests/chain/gateCheck.test.ts` › K13 | 5 s 超时 | `5b01dbd9` 2026-09-27：全量里红，单跑 3/3 绿；`9d95e6c8`、`08b1007d` 再见 |
| `tests/chain/gateCheck.test.ts` › K12 | 5 s 超时 | agent 选择一轮（2026-09-26／27）全量红一次，单跑绿 |
| `tests/control/driverRecovery.test.ts` › drives a retried run on from where it was blocked, to settled | 5 s 超时 | `e5f56bfe` 2026-09-25 登记；`1d7d9aa0` 2026-09-30 在负载 43 时红一次，单文件 3/3 绿；**反例：负载约 37 时单文件也能连红 3 次** |
| `tests/control/driverLanding.test.ts` › X1: lands while the person has orca/<group> checked out, leaving their files and index alone | 5 s 超时 | `1d7d9aa0` 2026-09-30：1 分钟负载 43／48，单文件 3/3 绿 |
| `tests/control/driverLanding.test.ts` › D，另有两条（`e5f56bfe` 登记；精确名字见 `.superpowers/sdd/2026-09-25-handoff-delivery/progress.md`，本文压缩前也未记名） | 5 s 超时 | `2f65a729` 2026-09-29 D 红一次；`e5f56bfe` 2026-09-25 登记两条 |
| `tests/control/driverProgress.test.ts` › R2: books exactly the usage of a collect without progress, and nothing twice | 5 s 超时 | `2f65a729` 2026-09-29：5 分钟负载 10.6，单文件 3/3 绿 |
| `tests/control/handoffE2E.test.ts` › G | 依赖 30 s 实时窗 | `e5f56bfe` 2026-09-25 |
| `tests/control/executionDriverE2E.test.ts` › R1 子场景 | 重负载（两份 clone 并跑变异）下 5/9 | `905e41ce` 2026-09-25：无负载单跑 3/3 绿 |
| `tests/control/ccloopPort.test.ts` | 5 s 超时 | `e604b1ba` 2026-10-01：全量红一次，单文件 3/3 绿 |
| `tests/control/retryTask.test.ts` › refuses a run blocked for any other reason: a succeeded run out of bounds, a transient failure, another step | 5 s 超时 | issue-fixes F2（人 2026-10-09 点名同意登记）：观测提交 `11027ab`（历史），隔离 clone 负载约 10；负载 5–6 单跑 3/3 绿。证据 `.superpowers/sdd/2026-10-08-issue-fixes/progress.md` Task F2 |
| `tests/control/retryTask.test.ts` › refuses a stopped group with stop-mode-conflict and a clarifying group with group-state-invalid | 同上 | 同上 |
| `tests/control/retryTask.test.ts` › refuses on either half of the stop guard alone: stopped without an intent, an intent without stopped | 同上 | 同上 |
| `tests/chain/gateCheck.test.ts` › K1 PreToolUse removed | 5 s 超时 | `6b7843ec` 2026-10-13 repin 分支根级全量（负载 12–17）红一次；单文件 3/3 绿（负载 6.9–8.2）。同一跑里 K12 也红（已登记） |
| `tests/control/schedulerBridge.test.ts` › runs a real conflicting graph through durable control: success | 30 s 超时 | `808feb6a` 2026-10-13 全量里见过（未逐名登记）；`6b7843ec` 同上全量再红，单文件 3/3 绿（负载 6.5–7.2） |
| `tests/control/settleUnknownUsage.test.ts` › D9 does not erase other frozen runs › keeps another run's unknown/open request blocker（silent=false 与 silent=true 两条） | 5 s 超时 | `6b7843ec` 同上全量红，单文件 3/3 绿（负载 5.3–7.9）。同一跑 `retryTask` 已登记的三条也红、单文件 3/3 绿 |
| `tests/control/requirementCommands.test.ts` › re-queues a failed draft as the next draft with a fresh retry count (Task 8 carry) | 同上 | 同上 |
| `web/tests/controlCommandRecovery.test.tsx` › drops the id when the lookup returns the command's retained result | 超时 | `e5f56bfe` 2026-09-25：单跑 3/3 绿 |
| `web/tests/memoryLayout.test.tsx`（scroll timing 那条） | 并发 web 运行里时序红一次 | OMP 一轮 2026-10-12：单跑 2/2 绿，随后全量 990/990（`docs/handoff/2026-10-12-oh-my-pi-acceptance.md`） |

web 测试默认超时现为 15 s（`web/vite.config.ts`），上表 web 两条的历史观测早于或独立于此。

- **2026-10-13 会话 `7f37d261`（D 分支 `codex/unmetered-settlement`，与 ccloop 全量并跑，负载峰值 156）**：根级全量 48 红中 45 条超时、1 条 `tests/panel/security.test.ts` 进程 5 s 未退、2 条 `taskResultPaired`（环境红）。
  23 个红文件逐个单跑各 3/3 绿（负载 5–24，日志 `/private/tmp/rerun/`，会话结束即可删）：`chain/gateCheck`、`checkpoint/resume`、`control/{archivedWakePerformance,driverLanding,driverProgress,driverRecovery,driverRequirementSplit,retryTask,schedulerBridge,settleUnknownUsage,webMutations}`、
  `panel/{agentSelectionApi,auth,controlApi,controlOverview,controlOverviewApi,controlPollPerformance,controlSocketGate,correctApi,decisionsApi,integrationApi,metricsApi,security}`。
  ⚠️ 同一轮第一次全量里 `controlPollPerformance` 与 `webProtocol` 的红**不是** flake：是 D 自己引入的（`unmeteredRuns` 另查库、夹具缺字段），已修（提交 `fix(control): count unmetered runs from the view, …`）。
- **2026-10-14 会话 `b39a5527`（repin 分支 `codex/repin-ccloop-3069dbf`，观测提交＝主题行 `test(control): show the stop-mode refusal's diff instead of a TypeError`；`ORCA_CCLOOP_BIN`＝ccloop `3069dbf` 的 build clone）**：
  根级全量（负载 16–44）19 红：17 条超时（`gateCheck` K13、`archivedWakePerformance`、`driverLanding` 「leaves the branch alone when it moved between the merge and the swap…」、`driverRecovery`、`driverRequirementSplit`、`retryTask` stop guard、`schedulerBridge`、`settleUnknownUsage` D9 两条、`tokenPolicyStop`「a fresh retry preserves prior finite attempts and sessions under unlimited tokens」、`controlOverview`「keeps queued estimates out of human preparation…」、`controlRecoveryApi` 三条、`integrationApi`「refuses set-group-integration from an agent…」）＋ 2 条 `taskResultPaired` 环境红。
  同树第二次全量（负载约 20）只剩那 2 条环境红。红文件负载 5–18 下逐个单跑 3/3 绿（日志 `/private/tmp/og-b395/rerun/`，会话结束即可删）。
  ⚠️ **两条断言形状、未豁免的候选**（n＝1，都红在被测停止动作**之前**的前置状态上，像真 ccloop 下的时序竞争，未证成）：`agentSelectionE2E` C3 `expected [ 'b', 'd' ] to deeply equal [ 'a', 'b', 'd' ]`（`:292`，与上表 C3 的 `until` 超时**不是同一形状**）；
  `handoffE2E` H5 `expected [ 'collected', 'collected' ] to deeply equal [ 'collected', 'accepted' ]`（`:260`）。两文件各单跑 3/3 绿（6/6、12/12 执行，无跳过）。**再见就当新问题查。**

### 已修、不再豁免的（再红就当新问题查）

- `tests/control/driverSettle.test.ts` 真 git 场景：全量＋并发下撞 5 s，已给 30 s。再红要查。
- `tests/control/estimateE2E.test.ts` › E2：曾以 `SyntaxError: Unexpected end of JSON input` 红（夹具读到 fake 已建未写的日志），已由
  `test(fixture): read a fake CLI log created but not yet written as no lines` 修（`logLines` 跳过空行，判据 `ccloopWorldLogLines.test.ts` 对旧读法见红）。
  机制是读码得出、撕裂读本身没复现过 ⇒ **若再红，说明还有别的原因（例如半行），要重新查**。

### 环境依赖的红（不是 flake，换对环境就绿；不要登记成 flake）

- 没 `npm run build --workspace web` 就跑 `tests/panel` ⇒ `panel-dist-missing`。
- `ORCA_AGENTS_TABLE` 的 fake codex 不是 `integration` 模式，或用了真实 agent 表 ⇒ `tests/control/ccloopProtocol.integration.test.ts` 红。
- `taskResultPaired` 两条硬编码旧配对二进制路径；用本地 ccloop 构建（如 OMP 分支）跑会红（2026-10-12～13 观测）。
- 普通沙箱下 `spawnSync ps EPERM`／`listen EPERM` 大面积红（2026-10-10、10-12）⇒ 用本机进程权限重跑。
- `TMPDIR` 太长（tsx socket 超 104 字节、`EADDRINUSE`）或是软链（git 报真实路径）⇒ 各约 7 条假红；用短真目录。
- `check-tmp-leak.mjs` 每次留 1 个只含空 `orca-ccmem-*`／`orca-test-control-*` 的 `orca-tmp-*`：`agentUpdatePaired` 用 `describe.skipIf` 在收集期整文件跳过（没设 `ORCA_TASK9_*` 时）⇒ 由提交 `test(control): skip the paired update criterion at run time …` 修（2026-10-14 `b39a5527`，在 repin 分支上，随它合进 main）。再见就找别的收集期整文件跳过。

## ccloop 侧（供 Orca 跑 ccloop 全量时对照；**权威名单在 ccloop 仓自己的 handoff 与 `scripts/check-known-reds.mjs`**）

- 2026-10-13 会话 `808feb6a`，`codex/omp-agent-integration` 原生全量（1632/1639、1635/1639、1635/1639）里红过、单跑 3/3 绿（负载 10–33）的文件：
  `verifySavedResult`、`codexAdapter`、codex adapter、`cli parseArgs`、`savedResultRecovery.native`（dist 重建竞态）。
- 2026-10-13 会话 `7f37d261`，`codex/codex-rate-limit-backoff` 全量 1627/1669、35 红（与 Orca 全量并跑，负载峰值 205）：14 个红文件逐个单跑，12 个 3/3 绿；
  `ompUpdates`（下条那条）2/3；`verifySavedResult` › "r1 command interruption modified=true …" 2/3（一条匹配断言，不是超时；文件不含 codex 代码；之后 main 3/3、分支 3/3 绿）⇒ **n＝1、未证成的候选 flake，不归因 C**。
- `ompUpdates` › "preserves the unavailable reason…"：单跑 3.1–3.3 s，负载下超时一次；**未改写**（不在人的授权内），改写要人点名。
- 2026-10-12 OMP 一轮：一条 5 s 更新判据全量与整文件都超时、单例 4.3 s 过；四条 saved-result worker 全量里未及时封口、整文件 28/28。
- 更早：`codexWatchdog` 在负载 33 下红过（ccloop 人裁 139：负载下 1.5 s 太紧）；`runLoop.integration.test.ts` 里 19 条 `perAttemptTimeoutMs: 20` 的真 plan／verify 判据
  在重负载下可能红，特征 "… phase exceeded per-attempt timeout of 20ms"（agent 选择台账 §18）。
