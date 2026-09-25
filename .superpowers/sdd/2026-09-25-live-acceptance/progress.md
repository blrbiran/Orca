# 执行驱动的真 codex 活体验收 —— 台账

> **归属**：Orca 控制器会话 `af3dc0d3`（Claude Opus 5.5），2026-09-25。
> **人裁（本会话原话）**：「第二件先开A再开B」；模型「用 gpt-6-luna 测试暂时不需要用那么贵的模型」；范围「只跑一个任务」；
> 上限「组上限 300k token」；`~/.codex` 读写「接受」；付费跑「跑」（一次，不重试）。
> 本台账历史一个字不改（Rule 13）；写错了另起一节记更正。

## 1. 做了什么

- 脚本 `scripts/live-driver-acceptance.ts`（主题行 `test(control): add a live acceptance script for the execution driver`）：
  一个 soft Web 组、一个任务（写 `answer.txt` ＝ `42\n`，agent verifier ＋ requiredCheck `test "$(cat answer.txt)" = 42`），
  经装配好的控制运行时（与 `orca panel` 同一套 service／wake pump／驱动环，不走 HTTP）从 import 跑到 settle。
  **判据 ＝ 脚本退出码**，0 当且仅当 `checks` 全真。
- ccloop：`git clone --local` 到会话 scratchpad、软链 `node_modules`、`npm run build`；观测时 ccloop HEAD ＝ `f9267cb`（含 C1–C4）。
- Orca 观测锚点：`7160bc2`（脚本那一笔）。

## 2. 实测结果（只抄工具报数）

命令：
```
tsx scripts/live-driver-acceptance.ts --ccloop-bin <scratchpad>/ccloop-main/dist/cli.js \
  --codex /Users/biran/.nvm/versions/node/v22.13.1/bin/codex --model gpt-6-luna \
  --output <scratchpad>/live-1 --group-tokens 300000 --task-tokens 150000 --deadline-ms 900000
```
codex-cli 0.155.1。开始 2026-09-25T02:41:52Z，结束 02:43:05Z。**RC 0，`failed: []`**（16 项；`fakeCallsExact` 只在 fake 模式有）。

| 阶段 | input | cached_input | output | reasoning_output | 合计(input+output) | 退出 |
|---|---:|---:|---:|---:|---:|---|
| plan | 40,664 | 19,200 | 569 | 314 | 41,233 | code 0，stderr 0 字节 |
| execute | 42,375 | 20,224 | 332 | 143 | 42,707 | code 0，stderr 0 字节 |
| verify | 41,307 | 20,224 | 417 | 254 | 41,724 | code 0，stderr 0 字节 |

- ccloop 证据合计 **125,664 token**；Orca 台账 `ledger.used` ＝ `{tokens:125664, activeMs:63820, attempts:1, sessions:1}` —— **两边相等**。
- **美元成本：未知**（工具不报；不自估）。
- ccloop 收到的 `loop-contract.json`：`tokenBudget 150000, maxAttempts 1, totalRuntimeBudgetMs 600000`。未超 soft 预算。
- `orca/g:answer.txt` ＝ `42\n`；`main..orca/g` 只改 `answer.txt`；人的 HEAD／index／status 不变；`dispatchBlocked` 假；projection 与 task-handoff outbox `delivered=1`；`~/.orca` 快照不变；`shutdown()` 为 true；看门狗未杀任何进程组。
- ⚠️ **模型只证到「请求的是 gpt-6-luna」**（三次调用的 argv 都是 `--model gpt-6-luna`）；codex 事件流不回显模型名，provider 是用户 `~/.codex/config.toml` 里的 Azure，部署名映射不可见。
- 证据副本：`evidence/live-1-summary.json`、`evidence/live-1-{plan,execute,verify}-outcome.json`；原件在会话 scratchpad `live-1/`（`/private/tmp` 会被系统清理）。

## 3. 判据先看见红（Rule 9；全部在 Orca 的 `git clone --local` 副本里，fake codex）

| # | 变异 | RC | 红的检查 |
|---|---|---|---|
| 基线 | 无（`dry-5`） | 0 | 无 |
| M1 | fake 答案 `41\n` | 1 | runSettled、workDone、cleanedUp、landedBytes、onlyAnswerChanged、published、threeProviderCalls、fakeCallsExact（run `blocked`＝`terminal:exhausted`） |
| M2 | 去掉 confirm 前的 `proposal-edit` | 1 | **只有** ccloopPolicyCapped（ccloop 收到 `tokenBudget 3000000, maxAttempts 3`） |
| M3 | `--deadline-ms 2000`（不改代码） | 1 | notTimedOut 及其后果（run 停在 `collected`） |
| M4 | 检查前 `git add plan.json` | 1 | **只有** humanUntouched |
| M5 | `orcaHome` 改指临时目录并在 3 s 时写入 | 1 | **只有** orcaHomeUntouched |

副本还原：`git diff`／`git diff --cached` 各 0 字节。主树 `git status --porcelain` 0 字节。
⚠️ 没有独占变异的检查：`ledgerMatchesCcloop`、`everyCallHasUsage`、`ledgerKnown`、`dispatchNotBlocked`、`shutdownClean`（未造只让它红的变异，登记）。
第一次写 M1 锚点转义错、匹配数 0 未改文件 —— 辅助脚本按「命中数≠1 即退出」拦下，重跑后才算数。

## 4. 本轮发现（登记）

- 🔴 **Web 派活在 estimate `blocked-capability` 下默认给每个任务 `complex-1m-default`：work 3,000,000 token、3 attempts、4 h；goal-review 另占 1,000,000；组上限 5,460,000。**
  confirm 用这些值**覆盖** contract 自己的 `tokenBudget`／`maxAttempts`／`totalRuntimeBudgetMs`（`src/control/executionSnapshot.ts` 的 `deriveContract`）。
  ⇒ 真 codex 下，人在面板上直接点 confirm，单任务的 soft 上限就是 3M token、可重试 3 次。**要封顶只能在 confirm 前 `proposal-edit`**（本脚本就这么做，M2 证明它承重）。是否改默认值／面板是否提示 —— 归人。
- 全仓 `src/` 没有任何生产者起 goal-review run（python 逐行扫，唯一命中是 `schema.ts` 的枚举）⇒ 它的分配只占预留、不花钱；脚本把它压到 1 token。
- `set-limit` 在 confirm 后不能把组上限压到已承诺预留之下（`group-budget-unavailable`）—— 按设计，记在此处免得下次再撞。
- plan 文件必须在目标仓库内（`controlConfig.ts` 的 `control-path-escape`）。

## 5. 诚实的验收表述（只能这么说）

在 **真 codex（codex-cli 0.155.1，请求模型 gpt-6-luna，用户自己的 provider 配置）**、**soft 组**、**单任务无冲突**、
**配置了一个预估得 `blocked-capability` 的 estimator**、**confirm 前用 `proposal-edit` 封顶** 的条件下，
Web 派活的服务层（不含 HTTP／浏览器）一次从 import 跑到 settle，结果落到目标仓库的 `orca/g`，台账用量与 ccloop 报数一致。
**没有验过**：冲突与解冲突 run（`ccloop run --adapter codex`）、依赖任务、崩溃恢复、面板 HTTP／UI、strict 组、④ handoff、⑤ 预估链、多次重复（n＝1）。
⇒ 仍然**不说「Web 派活可用」**；可以说「真 codex 下单任务主链跑通过一次」。
