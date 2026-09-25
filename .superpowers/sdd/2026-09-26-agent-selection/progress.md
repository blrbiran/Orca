# agent 选择一轮 —— 进度台账（唯一进度源）

> 归属：Orca 控制器会话 `75ec878e`（Claude Opus 5.5），2026-09-26 起。
> spec：`docs/superpowers/specs/2026-09-26-agent-selection-design.md`。
> 本文件只追加（Rule 13）。`Ruling:` 行 ＝ 控制器替人做的决定，人要审；`Human:` 行 ＝ 人原话。

## §0 人裁（本会话）

- Human: 设计各节与三点确认、profile v2、面板 UI 本轮做全 —— 见 spec 头部「人裁」。
- Human（2026-09-26）：「这个session中，尽量将这些要做的task完整做完，这个session暂时不要考虑context大小」「review 完 spec后，如果有问题，先修复，然后做 writing-plan。接着使用 subagent-driven 的方式完成相关功能。（这一轮暂时不跑付费 claude ，留到下一轮跑）」「执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核」。
- Human（2026-09-26）：「同意修改几个仓库的现有test」—— 对两仓既有判据的**概括授权**（人裁 88 的 (a) 指名条件由此放宽为「事后逐条列名报人」）；(b) 整条改写不许放宽、(c) 改后写明编码的是哪条人裁 —— **照旧执行**。
- Ruling: 在人授权前，控制器曾决定「旧形态并列保留」以避开改既有判据；人授权后撤回，回到 spec §4.5「直接换掉」。

## §1 Task 0 现量（2026-09-26）

- **1M 怎么传给 claude**：本机 `claude` 2.1.282（`realpath $(command -v claude)` ＝ `…/@anthropic-ai/claude-code/bin/claude.exe`，Mach-O）。命令 `LC_ALL=C grep -a -o -E '.{0,120}\[1m\].{0,120}' <binary>`（结果重定向到文件整份读回，74 行）：含 `append [1m] to the model name for 1M`、别名表 `["sonnet","opus","haiku","fable","best","sonnet[1m]","opus[1m]","fable[1m]","opusplan"]`、全名 `claude-opus-5-5[1m]`、`claude-sonnet-5[1m]`、`claude-fable-5[1m]`。
  ⇒ **1M ＝ `--model <model>[1m]`**；`1_000_000` 档位本轮开启。
- **claude 默认 model 的合法写法**：人给的例子 `opus-5.5` 不是 CLI 认的拼写；全名 `claude-opus-5-5`（二进制内出现 `claude-opus-5-5[1m]`）。Ruling: 描述默认值用 `claude-opus-5-5`。
- **codex 默认 model**：`codex-cli 0.155.1`；二进制内 `gpt-6-*` 字面量只有 `gpt-6-astra`／`gpt-6-pro`（`grep -a -o -E 'gpt-6[-.][a-z0-9.-]+'`）；但人自己的 `~/.codex/config.toml:11` 是 `model = "gpt-6-sol"`，且 codex 把 model 字符串原样传服务端（④ 活体验收用过 `gpt-6-luna`）。Ruling: 描述默认值用 `gpt-6-sol`（人给的例子，与人本机配置一致）。
- **受影响的 ccloop 既有判据文件**（`grep -rln -E "adapter-config|'--adapter'|\"--adapter\"|protocol: 1|protocol: 2|parseCodexConfig|runControlCommand|acceptStart|runControlWorker|capabilities" tests scripts`，21 个）：tests/runtime/codex/{protocol,fileBoundary,abortedUsage}.test.ts、tests/cli/{cli,codex}.test.ts、tests/sweep/sweepRuns.test.ts、tests/control/{protocol,accept,workerLaunch,command,resultRepository,handoffDeadlineUsage,collect,handoff,materialize,worker,stopProof,endToEnd,handoffEnteredPhases}.test.ts、tests/validation/{evidence,prepareA04}.test.ts、scripts/validate-codex-adapter.mjs。**命中不等于要改**（很多只是用 codex 运行时）；实际改写的逐条列名记在后续各节。

## §2 spec 复审（2026-09-26）

- 复审席：brief `spec-review-brief.md`、报告 `spec-review.md`（同目录）。工具报数：271,738 token、72 次工具调用；美元未知。
- 结果 7 Critical／15 Important／10 Minor；控制器抽查 C1／C2／C3／C4／C5／I10 的引用属实（命令：`sed -n` 读 `ccloop/tests/fixtures/fake-codex.mjs:20-32`、`Orca/tests/control/fixtures/ccloopWorld.ts:70-80,125-135`、`webDispatch.ts:85,165`、`dispatch.ts:50-52,77`、`webService.ts:387`、`commandLedger.ts:24-40`）。
- Ruling: 全部接受、无驳回；spec 就地改（未发布、本会话所写）＋ §12 逐条处置表。具体裁定见 spec §12（C6 选 (b) 跑 `--version` 比对；C7 用「带结果完成的阶段计数」做通用闸；I6 字段改名 `contextWindow`；I8 形式定义与 `agent-unselected`；I9 estimator 失败退化不拒导入）。
- Ruling: 不再派 spec 二次复审 —— 人的指示是「review 完 spec 后，如果有问题，先修复，然后做 writing-plan」；计划写完另派一席复审，spec 的修正会在那一席里被间接复核。

## §3 计划写作（2026-09-26）

- 骨架 `plan-skeleton.md`（控制器写，含共用接口）；写作 brief `writer-brief.md`；六席 W1–W6 并行，各写 `plan-part-W<n>.md`。
- W2（T3、T6）交稿：工具报数 294,732 token、72 次工具调用。自报：副本 `scratchpad/W2/ccloop` 里以 T1 桩实跑，24 条具名变异全红，既有判据 0 红（**实施时须在真 T1 上重跑**）。
- W6（T14–T17）交稿：工具报数 426,820 token、60 次工具调用。自报 20 条对不上（W6-1…20），既有判据 1 条（`tests/panel/webParity.test.ts` 的编译期 `controlGroupWebToServer`）。
- Ruling（W2 的跨 Task 需求）：W2-1 fake codex 答 `--version` 归 T3；W2-2 `probeVersion` 调 `[...command,"--version"]`（`--version` 在末）；W2-3 `AgentError.message` 以码开头；W2-7 `resolveAgent` 默认探版本；W2-4 新码 `agent-selection-file-invalid`；W2-6 T5 补 worker 层的注册判据；W2-14 fake codex 加两行视为只加不改。已转 W1／W3。
- Ruling（W6-1…20）：全部采纳 W6 的建议栏，**W6-8 例外**：`set-agent-preferences` 的 payload 只有 `{preferences}`，不带 `expectedRevision`（以信封的为准）。W6-14：`probeVersion` 取 stdout 第一个 `/\d+\.\d+\.\d+(-[\w.]+)?/`，无则 `null`。已转 W1／W4／W5。
- W1（T1、T2、T4）交稿：工具报数 329,736 token、74 次工具调用。自报：副本 `scratchpad/W1/ccloop` 里实做三 Task，计划里的代码由脚本从副本抄出；新判据 85 条绿、E2E 6/6、59 条变异在终版代码上全红；既有判据 0 红（唯一红仍是名单内的 stopProof）。19 条对不上（W1-1…19）。
- Ruling（W1）：采纳全部建议栏 —— W1-3 `AgentDescriptor` 加 `draftInstallationExtras`（骨架接口改）；W1-5 detect 的两个系统目录不改道、判据注入 `probe` 且用 `platform:"linux"`；W1-6「全局可写」＝他人可写（`mode & 0o002`）；W1-9 `AGENT_ERROR_CODES` 全部并入全仓字面量（`agent-adapter-unavailable` 为 T3 之前的临时码，T3 删）；W1-10／W1-18 T3 换掉 claude `createAdapter` 桩并让 fake codex 答 `--version`；W1-17 `runLoop.ts` 观测加 `completedWithResult`；W1-19 T5 整条改写 T4 的 worker 判据（已转 W3）。
- W3（T5）交稿：工具报数见完成通知。自报：两份副本（原样／最小 T5）逐文件单跑，既有判据 **45 条／11 个文件**要改（25 条运行时红，其中 24 条实测、1 条为 T4 新判据按代码推；20 条只在类型层红），逐条全名＋改写写在 plan-part-W3.md；新判据 11 条；具名变异 16 条（M14 作废，见 D-W3-3）。
- Ruling（W3）：D-W3-4 采纳 —— T5 把选择 schema 从 `src/agents/types.ts` 挪到 `src/control/protocol.ts`、`types.ts` 再导出（防循环 import）；D-W3-2 具名 `AgentError` 退出码 2、stderr ＝ message（码在前），Orca 从 `2:<code>[: <detail>]` 取码；D-W3-7 类型改名照写；D-W3-9 T5 落地到 T7 落地之间 Orca 的真 ccloop 判据红，全套门在 T17；D-W3-11 人已概括授权，45 条在收尾报人审。
- W5（T8–T11）交稿：工具报数 626,377 token、126 次工具调用。自报 17 条对不上（W5-M1…M17）；既有判据**静态预测** 251 条（T9:1、T10:58、T11: 143 条因 confirm 改异步 ＋ 108 条其它，有重叠）——未实跑，实施时以实跑为准。
- Ruling（W5）：M1 Orca 顺序 T8 → T7；M2 采 (a)（T7 让 `router.probe(profile, selection?)` 可选、无选择走 T7 定义的**临时**路径，T11 改必填逐点换冻结选择）；M4 面板对组层／任务层**整层替换**、不与 plan 值逐字段合并（对 spec §6.2「逐字段」的登记偏离）；M5「删 `configHash`＋草稿 `null`」移进 T11；M9 T11 与 T15 之间面板确认按钮 fail closed（本轮内部过渡态）；M10 reconcile 的组层取整个 worker 组层；M12 闸门探测组内去重冻结选择、任一降级整组阻塞；M13 reestimate 冻结在估算记录的 `estimatorSlot`；M7 的额外导出（`applySetAgentPreferences`、`estimatorSlotFor`／`prepareEstimatorSlot`、`readConfirmedReconcileSlot`、`ObservedProfile.resolution`、`handoffGraceMsOf` 移 `driverHandoff.ts`、`WebServiceDeps.port`）并入骨架。已转 W4。
- Ruling（W5-M16，**偏离 spec，报人**）：**不选 A**（A 会放宽既有判据 `planImport.test.ts > immutable plan import > rechecks revision after a successful in-flight probe before source I/O`，人裁 88 (b) 不许放宽，人的概括授权只放宽了 (a)）。采 **B 的变体**：导入时 estimator 槽只解析操作者两层（worker 默认 < `operator.estimator`）；**plan 文件本轮不加 `estimatorAgent` 字段**；组级 estimator 只来自面板 `proposal-set-agent`（slot estimator），在 reestimate 时生效。依据：估算 run 今天无执行方（⑤），导入时 plan 层不生效无实际后果。
- W4（T7、T12、T13）交稿：工具报数 683,868 token、233 次工具调用。自报：副本 `scratchpad/W4/orca` 实做，tsc 0、96 个文件逐个单跑全绿、33 条变异 32 红 1 等价；依赖新 ccloop build 的 E2E／smoke 未跑。既有判据实测 147 条／28 个文件（另 2 条只在 typecheck、6 条受 `ORCA_CCLOOP_BIN` 门控）。W4 自报上下文越过每 task 330k（hook 报约 372k），确切值拿不到。
- Ruling（W4）：全部采纳建议栏 —— M-2 T7 判据侧三处「T7 bridge」，**T11 必须删净**（判据 `grep -rn "T7 bridge" tests scripts` 零命中）；M-3 按 W5(3)，T7 的 plan 行仍带 `configHash`（值取自 `resolveAgent`）；M-4 解冲突新形态挪进 T7（T7 依赖 T5＋T6），T12 只换来源为 `reconcileSlot`；M-5 T7 临时经端口问 `killGraceMs`，T11 换成冻结值；M-6 无选择的临时探测取表中 id 字典序第一条；M-8 `orca agents show` 不读控制 store；M-9 面板仍要求两个 env 都给，缺省路径只给 `orca agents`。

## §4 计划复审（2026-09-26）

- 复审席 brief `plan-review-brief.md`、报告 `plan-review.md`。工具报数 142,070 token、20 次工具调用（主席另派五个只读子席，子席报数未单列）。结果 8 Critical／14 Important／12 Minor。
- 🔴 **C1 已实测属实**（控制器 `stat`）：写作期 W4 的变异 M13-10 往**真实** `~/.orca/` 写了 `agents.json`（02:51:24）与 `agents.json.draft.json`（02:51:29），0600，内容是判据夹具（`"command":["/opt/claude"]`）。**未删**，列入 awaitingHuman（删除用户目录下的文件归人）。根因：计划代码缺省路径用 `os.homedir()` 而非传入的 `env.HOME`。⇒ Rule 17 被破一次。
- Ruling：全部接受；以计划新增的「§0.2 计划复审更正」P1–P23 落实（优先于分节正文）；骨架 L139 与 T15 生产代码里的 `expectedRevision` payload 就地改。不让写作席重出 17.6k 行：实施是在真实树上逐 Task 做，实施席按内容锚点适配，§0.2 的相关条目在每个派发里重申。

## §5 执行（subagent-driven；本文件即 SDD ledger，plan ＝ docs/superpowers/plans/2026-09-26-agent-selection.md）

- 两仓都在 `main` 上落本地提交，不开 worktree（CLAUDE.md：删 worktree 需人单独授权；历轮同此）。
- 派发材料：`impl-common.md`（通用禁令与约定）、`plan-rulings.md`（计划头部＋§0＋§0.2）、`measure-W<n>.md`、`task-<N>-brief.md`；报告 `task-<N>-report.md`。
- 模型：实施席 sonnet（计划含完整代码，转写＋测试；跨文件整合的 T5／T7／T10／T11 用 opus）；任务复审 sonnet；终审 opus。
- 预检（pre-flight）：计划复审（§4）已按接缝逐对查过共享文件／接口 —— 共享文件对：T1/T3（`src/agents/claude.ts`、codex `extraEnv`：P2／P3）、T1/T5（`protocol.ts` schema：R4）、T2/T6（`cli.ts`：内容锚点）、T4/T5（`worker.ts`、`phasesCompleted.test.ts`：R4）、T7/T10（`fixtures/web.ts`：P6）、T7/T11（`driverHandoff.ts`、`temporaryProbeSelection`、legacy 名：P10）、T7/T16（`ccloopWorld.ts`：P13）、T7/T11/T12（桥：P9）、T9/T14/T15/T16（payload：P5）、T10/T14（面板夹具：P8）、T11/T15（`BudgetEditor`：P11）、T9–T11/T14（web 镜像：P12）。自洽问题见 §0.2 各条。Ruling: 以 §0.2 为执行依据，不重出计划 —— 若错，代价是实施席多一轮适配。
- Task 1: complete (ccloop commits f4e49a2..8bfedf3, review clean). 实施席报数 173,762 token／52 次工具调用；复审席 sonnet（报数见通知）。
- Task 1: minor (deferred): `src/agents/table.ts` 的 1 MiB 上限分支无判据、无变异。
- Task 1: minor (deferred): `parseInstallation` 无 kind／`getDescriptor` 包装、`tableShape` 顶层、`resolveAgent` 的 `installation === undefined` 分支没有具名变异（有间接覆盖）。
- Task 2: complete (ccloop commits 8bfedf3..60d06e0, review clean). 实施席 143,547 token／49 次。实施席按派发补了 P23 m7 零写入判据（brief 原文没有），已在报告中说明。
- Task 2: minor (deferred): `detect.ts` 的 `isFile()`／`isDirectory()` 两个守卫无具名变异、无专门场景。
- Task 4: complete (ccloop commits 60d06e0..927e768, review clean). 实施席 143,248 token／55 次。
- Task 3: review → Needs fixes（2 Important，均为证据纪律）。循环 import `claude.ts`⇄`claudeAgentAdapter.ts` 复审判安全（跨模块引用都在函数体内）。
- Task 3: Ruling: 复审 I-2「brief Step 3.6.1 要求写 `mutations.md` 未做」—— 本轮变异台账以各报告的 `MUTATION:` 行为准（`impl-common.md` 已这样规定，与计划 brief 冲突，以控制器的执行文件为准），T17 由控制器汇总成 `mutations.md` —— 错了的代价：T17 多一次汇总。
- Task 3: minor (deferred): 把 `claudeModelArgument`／`ONE_MILLION`／`CONTEXT_OPTIONS` 挪进 `src/agents/types.ts` 以结构性消除循环 import；dist 检查只走了 adapter 先加载的方向。
- Task 3: fix round 1/5 (1 addressed, 0 open — P2 restore-the-throw mutation evidence run in clone; no commits; re-review haiku ADDRESSED)
- Task 3: complete (ccloop commits 927e768..6439eb2, review clean after round 1). 实施席 292,245＋305,166（续用同一席，累计口径以工具为准）token。
- 波 1（T1–T4）完成：ccloop f4e49a2..6439eb2；派波次复审（P21），与 T6 并行（复审只读固定 diff 文件）。
- 波 1 复审（opus）：`wave1-review.md`，0 Critical／2 Important／9 Minor。
- Ruling: 波 1 的 I-1（runner 把 `CCLOOP_CLAUDE_*` 泄漏给 claude 及其子进程 ⇒ 将来 claude agent 在 ccloop 里跑测试会让旧适配器判据调真 claude）与 I-2（handoff 证据包只收 `run/codex/`，漏 `run/claude/`）并入 T5 一起做（T5 本来就碰 handoff 与 worker；runner 的剥离是 T3 代码的小改）—— 错的代价：T5 范围略大。I-1 必须在付费 claude 那一轮之前落地。Minor 记为 deferred，见 wave1-review.md。
- Task 6: review → Approved with 2 Important (plan-inherited).
- Task 6: Ruling: I-1 退出码语义冲突 —— `ccloop run --agents` 的拒绝全部退 1（2 ＝ run 跑完未成功），与 `ccloop control` 的具名拒绝退 2 相反；T7／T12 的解冲突路径**必须自己解释 `run --agents` 的退出码**（1 ⇒ 读 stderr 首段的码并按具名拒绝 block；2 ⇒ run 完成未成功），不许复用 `ccloopPort` 的 `"2:"` 前缀判定 —— 写进 T7／T12 派发，并登记 spec §13（P20）。错的代价：真的哈希不符会被当 unknown 反复重试。
- Task 6: fix round 1 → 补 `src/cli.ts` 选择文件 `JSON.parse` 的 try/catch 判据＋变异（I-2）。
- Task 6: fix round 1/5 (1 addressed, 0 open — malformed-JSON criterion + T6M8; commits 5955e27..988f82b)
- Task 6: complete (ccloop commits 6439eb2..988f82b, review clean after round 1). 实施席 212,318＋229,914 token。
- Task 5: complete-pending — review (opus): spec ✅, 0 Critical, 1 Important (表被删 ⇒ 挡住 inspect/collect/handoff/read-evidence，违背 spec §4.2／I4 的本意)。抽查 20 条改写全部不放宽。实施席 331,553 token／86 次。
- Task 5: fix round 1 → I-1（`assertAgentsTablePath` 对 ENOENT 放行、悬空软链仍拒）＋ M-a（`config.json` 非 JSON ⇒ `agent-config-invalid`）＋ M-c（verify 脚本 fixture 守卫收紧为 `command[0]===process.execPath` 且 `command[1]` 为 fixture，防误调真 claude）。
- Task 5: minor (deferred): codex 的 capabilities 应答在 control 层无断言（T1 已覆盖）；`runCodexPhase > kills a TERM-ignoring process before returning abort` 在一次 verify:control 中红一次（疑似新 flake，T17 判定）。
- Task 5: fix round 1/5 (3 addressed, 0 open — table-deletion ENOENT pass, non-JSON config ⇒ agent-config-invalid, verify guard tightened; commits 8937454..a8037ad)
- Task 5: complete (ccloop commits 988f82b..a8037ad, review clean after round 1). 实施席 331,553＋355,578 token。
- Task 5: minor (deferred): 缺失文件经软链目录到达时路径检查放行（复审实验确认；对不读表的方法无后果）。
- ccloop 侧 T1–T6 全部完成：ccloop f4e49a2..a8037ad。
