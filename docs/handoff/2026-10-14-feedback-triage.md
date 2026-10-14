# 外部反馈 issue-20261008.md 的分诊（2026-10-14，会话 `7ea088aa`）

> 反馈原文：`/Users/biran/code/skills/orca/orca_archived_files/issue-20261008.md`（测试者 2026-10-14 更新，62+ 条；它顶部的「解决状态总结」以测试者快照 `4afd9d5b` 为准，**比本次核对时的 main 落后 33 笔**，部分已过期）。
> 核对方式：只读子代理逐条对照 Orca main（主题行 `Merge branch 'ui/panel-taste'`，2026-10-14 20:42）与 ccloop main（主题行 `test(omp): give the strict control preview criterion a 20 s timeout`），**没跑测试、没调模型**。行号是当时的，**引用前现测**。
> 控制器亲自复核过的只有 #53（下表标 ✅复核）；其余是子代理的读码结论，动手前按 Rule 8 自己再读一遍。
> **人裁（2026-10-14）**：下一轮做 omp single-call ＋ 下面优先级 1–7 全部；同意本文对测试者方案的取舍（「不采纳」各条）。

## 优先级 1–7（下一轮要做的）

| # | Issue | 现状与根因 | 做法（控制器意见，人已同意） |
|---|---|---|---|
| 1 | **#53** Start 按钮在任务运行后仍显示 | ✅复核：**后端状态缺口，不是刷新延迟**。`start` 只插 `scheduler_wakes` 行并 202（`src/control/webDispatch.ts` 约 163–166）；claim 时 `createStartingRun` 只把 **work item** 置 `running`（同文件约 425），group 状态不动 ⇒ Web 起的组整个首个 run 期间都是 `ready`，`web/src/ControlGroupView.tsx` 约 156 行 `state === "ready" && stopMode === null` 一直显示 Start。Overview 已经避开（`controlOverview.ts` 用 `pendingWake`／`executionBusy`） | claim 时把组置 running，或让按钮用与 Overview 同一谓词；先写能红的判据（fake ccloop）。也是 #47 一半的根：组停在 ready ⇒ 暂停／交接停止被放在「准备」区（`detailRegion.ts`） |
| 2 | **#56 ＋ #57**（含 #39 的剩余） | 重试、结算、saved-result 核验（`execution-format-failure-v1`）**都已存在**，但只在 Runs 表（`ControlGroupView.tsx` 约 391–397）与 TaskDetail 底部（约 274）；Overview 跳到 `problem` 区只有「打开 run」；有 task 被 block 时组显示 `review`（任何检查点都置 review，`checkpoints.ts` 约 103） | 同一个由 `retryRunOpen` 等门控的按钮放进 problem 行与 work-item 行；保留原始错误码可见（`RunReason`／`diagnosis` 已有友好说明）。快捷键 r、批量重试延后 |
| 3 | **README**（#54／#63／#64／#60） | 代码大多已有，缺的是文档：README 没提 OMP、只写了 `panel install`／`logs`、仍说「Projects are fixed at launch」、示例启动脚本带 `--repo`；`package.json` 没有 `bin` | 按真实枚举写生命周期表（**测试者给的表是错的**：`paused`、`handoff-complete` 是停止意图不是组状态，枚举见 `webProtocol.ts` 约 1061）；写 `node dist/cli.js panel …`；OMP 安装指向 ccloop README §6.4（**不抄**测试者给的 `bun install -g @anthropic-ai/omp`）；agents.json 各 kind 字段 |
| 4 | **#59** Runs 表按 UUID 排序 | `controlViews.ts` 约 826 `compareText(left.id, …)`；`snapshot.runsByRowid` 本来就是插入序，`startedAt` 已暴露 | 去掉排序（rowid 序）或按 `startedAt` 再 rowid |
| 5 | **#61** attempt 计数看不懂 | 有意按单个 run 计（`controlViews.ts` 约 630 注释「never mixed with Orca's grant」） | 不改字段语义；改标签为「本 run 内第 n 次」，表里加 `taskRunNumber`（TaskDetail 已有） |
| 6 | **#62／#45／#48（#49 是 #48 的截断重复）** 429 | 根因是 provider 的配额窗口（实测 3.4 小时后才恢复），不是 ccloop；退避 `[30s,60s,120s]` 硬编码；after-work 429 仍失败；Orca 无 `codex-rate-limited` 专门文案 | **先做文案**「被限流，稍后重试」。**不采纳加长退避**：退避被 `min(timeoutMs, timeRemainingMs)` 截断且占着租约。可选：每安装可配延迟；远期：Orca 侧带 not-before 的延后重试 |
| 7 | **#58** OMP 选择解析慢、报错笼统 | `PROBE_TIMEOUT_MS = 10_000`、无缓存、stderr 丢弃、所有失败压成 `omp-model-catalog-unavailable`（ccloop `ompModels.ts`）；`materialize.ts` 每次解析都重跑 `omp models --json`；Orca 侧变成 `control-peer-exit`；模型输入框无目录下拉；继承来源标签已有（`AgentFields.tsx`） | 每安装 TTL 缓存、错误带 stderr 尾、Orca 具名文案、模型 datalist。**只把超时加到 30 s 不采纳**（只是等更久）。⚠️ 与 omp single-call 计划同改 `ompModels.ts`，先做 single-call 再做它 |

## 不采纳测试者方案的（人已同意）

- **#63 删 `--repo`／`--root`**：不删。不带参数的 `orca panel` 本来就是文件模式（`~/.orca/projects.json`）。人的 UI 被锁是因为装的服务 `~/.orca/panel/run.sh` 带了 `--repo orca=…` ⇒ 去掉它重装服务＋README 写清。文件模式只能增、改名；删项目和改路径要重启（`projectRegistry.ts`）。
- **#50 去 `--ephemeral`＋`resume --last`**：并发 run 串会话、任务 prompt 落进人的 CODEX_HOME、续跑会重发上下文所以省不了多少、破坏阶段隔离与记账。真要做：按显式会话 ID、只在 execute 阶段、每 run 私有会话目录阶段末删；或复用 Orca 已有的检查点续跑。L 级，延后。
- **#39 用模型「智能修复」输出**：不做。缺 `result` 包装已自动解开（ccloop `executionNormalizer.ts`，`strict-execution-v1`）；有歧义的输出按设计失败关闭。剩余只是入口难找（并入优先级 2）。
- **#65 浏览器上传计划**：不做。计划带 check 命令，登记计划是信任边界 ⇒ 改为 owner 在 projects.json 里登记计划（路径限在项目仓库内、文件记哈希）。M 级，排在 1–7 之后。

## 延后／设计轮／无需再做

- **#55 多工作目录（`--add-dir`）**：L、高风险（额外目录在 worktree 隔离、检查点、合并之外，且破坏 OMP「changedFiles 必须等于 git 可见变化」）；要做先从只读额外目录开始。延后。
- **#32 关注点／通知**：Overview「需要你」队列已覆盖大部分；缺队列内直接操作、推送通知、「即将超时」。设计轮（`2026-10-10-feedback-status.md` 第 32 行）。
- **#34 向导、#35 仪器控制台风格、#66 多 agent 协同借鉴**：设计轮／以后 brainstorming。
- **#15**：plan prompt 已禁编辑、沙箱只读、候选 JSON 提取已在；不遵指令的模型失败是对的。代码不再动，文档可加兼容说明。
- **#41**：(1) activity 路由在 HTTP 与 socket 都有、返回 `{schema, runId, entries:[]}`，**复现不了**，要测试者给原始命令、面板版本与原始响应；(2) 已部分由 `RunReason` 解决。
- **#46、#52**（抽查）：已解决属实。#52 另：`~/.orca/agents.json` 现在根本没有 omp 条目，要人在面板应用 omp「新增安装」（handoff §4.1）。

## 查不清的

- #53 测试者是否双击了 Start（`ready` 时第二次 start 会被接受并再加一个 wake）——要真跑或 fake ccloop 判据。
- #58 `control-peer-exit` 的时序——要面板 stderr 与人机器上 `omp models --json` 的耗时。
- #48 provider 配额窗口——只有 Token Switch／token-hub 日志能说清。
