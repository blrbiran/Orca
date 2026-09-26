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
- Task 8: complete (Orca commits 37cebf0..c23f262, review clean). 实施席 125,954 token。
- Task 7: review (opus) → Needs fixes: I1 `profiledService.test.ts` 三条「unavailable」判据被改写放宽（复审在副本实测：删 `service.ts:92` 的 `||observed.handoffControl!=="durable"`，BASE 3 红、HEAD 全绿）；I2 REWRITTEN 清单漏项且改名的只列旧名；I3 legacy 路径选择路由（workAgents／claimLegacy／parentAgent／requestHandoff／continueTask／reconcileStartForRun／stopIntent probe）无变异、夹具不断言所问选择。实施席 264,518 token／104 次。
- Task 7: fix round 1 → I1＋I2＋I3＋Minor「exit 1 无可解析码时丢了 stderr、退化自 `reconcile-spawn:`」。
- Task 7: minor (deferred): `graceByRun` 把失败的 resolveAgent 缓存成 60 s、`deps.handoffGraceMs` 无人设置（T11 换冻结值时一并处理）；「eight-field」字样（应为 7 键）；`dispatch.test.ts:2923` 近读回形状；`unconfiguredPort` 的 `typeof resolveAgent` 恒真；套话注释未说明各判据编码什么；SQLite ExperimentalWarning 等噪声早于 T7。
- Task 7: Ruling: 新阻塞码 `reconcile-refused:<code>` 接受（`drive.blockedReason` 自由串、`reconcile-*` 家族内、不撞名），T17 登记进 spec §13 —— 错的代价：面板显示一个未入 spec 的码。
- Task 7: fix round 1/5 (4 addressed, 1 open — profiled-branch run.agent/predecessor.agent in requestHandoff/continueTask unpinned (reviewer mutation: all green); commits 8de4d6f..111d06f)
- Task 7: fix round 2/5 (1 addressed, 0 open — profiled-branch criteria + F2-1..F2-3; commits 111d06f..b549a58)
- Task 7: complete (Orca commits c23f262..b549a58, review clean after round 2). 实施席续用同一席，工具报数累计见各通知（264,518／341,602／350,256）。复审席自报曾误写 `.claude_scratch_report.txt` 到 Orca 根目录并随即删除（控制器 `git status --untracked-files=all` 现核：只剩本台账）。
- 波 2（T6、T5、T7）完成：ccloop 988f82b..a8037ad、Orca c23f262..b549a58；派波次复审（P21），与 T9 并行。
- 2026-09-26：波 2 复审席与 T9 实施席均被 API 周额度（HTTP 429）中途打断；控制器现核两仓零改动、零新提交、无报告 ⇒ 两席原样重派。
- 波 2 复审（opus，重派）：`wave2-review.md`，0 Critical／3 Important／7 Minor；过线的词两边一致（证据：clone 里真 ccloop build 的定点探测）。
- Ruling（波 2 I-1）：Orca `ccloopPort.ts` 构造时拒绝不存在的表，使 ccloop T5「删表不挡回收」在真实路径上失效 ⇒ 端口构造只核路径形状（绝对、非软链），存在性交 ccloop 的 capabilities／accept 判 —— 错的代价：启动时表不存在要到第一次调用才报。
- Ruling（波 2 I-2）：codex `run --agents` 非拒绝型 exit 1 的 stderr 首行恒为 budget 提示 ⇒ Orca 取首个非 budget 提示行作原因；`fake-ccloop-run` 照真 peer 打印该提示，使判据不空。
- Ruling（波 2 I-3）：版本探测失败（`probeVersion` 返回 null）不再作具名拒绝 `agent-version-drift`，改为非具名失败（control 退 1 ⇒ Orca 视为 unknown 可重试；`run --agents` ⇒ `reconcile-spawn`）；只有观测到版本且不等才是 `agent-version-drift` —— 错的代价：一个永久缺失的二进制会被反复重试（由现有 unknown 次数上限兜底）。
- 三条合为一个「波 2 修复」派发，等 T9 落地后做（两仓；避免与 T9 并行改 Orca）。Minor 见 wave2-review.md（`named()` 白名单漏 `agent-unselected` 等码并入该修复；T11 收尾 grep 加 `T7 hook`）。
- Task 9: complete (Orca commits 7e04de1..b0a2814, review clean). 实施席 230,866 token／148 次。未先见模块缺失的 RED（测试与实现同写），复审核过 7 条变异原始日志，判为足够替代。P7 放宽为 group/task/run 正向白名单，复审逐一核对与旧排除式等价。
- Task 9: minor (deferred): `operatorRevision` 的防御式守卫与 `applySetAgentPreferences` 的 `target.kind!=="operator"` 半支按构造不可达、无变异（与既有 repositoryRevision 同惯例）；`preferenceModelSchema` 与 schema.ts 内联的 model 约束重复一份字面量。
- 波 2 修复：complete (ccloop a8037ad..af70fd6; Orca b0a2814..24e8c8e; 复审全部 ADDRESSED，独立复测数字与报告一致；null 探测 ⇒ unknown ⇒ `INSPECT_UNKNOWN_LIMIT=10` 兜底，已核)。修复席 198,826 token。改写 1 条既有 ccloop 判据（`tests/agents/materialize.test.ts` > … > "refuses an installation whose CLI no longer reports the table's version"，加严不放宽）。
- 波 2 修复: minor (deferred): 真 peer 坏合同时 reconcile-spawn 原因为 zod JSON 的 `[`；`ccloop agents` 诊断仍把不可观测版本报成 drift；`probeFailureCode` 对「探不到版本」从 `agent-version-drift` 退化为 `control-peer-exit`（诊断粒度变粗）。
- Task 10: implementer DONE (Orca 24e8c8e..353a9c1). Ruling: 既有 store 里的估算记录缺 `estimatorSlot` ⇒ 读为 recovery-blocked、不写迁移（spec §5.1「升级不跨越在飞的 run」，项目未上线）—— 错的代价：一个已有 store 的在飞估算需人重建。Ruling: T10→T14 之间面板导入／重估一律 `agent-selection-rejected:estimator:agent-unselected`（无偏好入口），本轮内部过渡态。
- Task 10: complete (Orca commits 24e8c8e..353a9c1, review clean). 实施席 370,482 token／100 次。受保护判据经 `cmp` 与 BASE 逐字节相同；T10-M3 实跑红。
- Task 10: minor (deferred): `planImport.test.ts:319-326`「turns a real probe failure…」未按 brief 加强到异步路径钉码；reestimate 不在事务内重核操作者层（竞态）；`queries.ts` 接受 `agent-selection-rejected:estimator:` 后任意后缀；`webService.ts` 对损坏的 `agentOverrides` 抛 ZodError 而非 `recovery-blocked`；`agentPlanImport.test.ts` 一条 `toMatchObject` 读回自写值（真正判别在 toThrow 两例）。
- Task 11: implementer DONE (Orca c97a4b6..106eaf9)。实测既有判据红 267 条（W5 静态预测 251）。Ruling: 无迁移 —— 确认于 T11 之前的组、v1 profile 文件、带 `configHash` 的 plan 文件一律拒／blocked（与 §5.1、T10 同一裁定）；T11→T15 面板不能确认、HTTP 判据用夹具 `Panel.selectionsHash()` 代 T14 预览路由（过渡态）；W5-M15（上下文阈值仍按 profile 声明窗口判）未改，T17 登记 spec §13。
- Task 11: review (opus) → Needs fixes: I1 spec §9 判据 8 只观测了闸门探测，`claim.agent` 读回存储；I2 瞬时／具名分支（`agentFreeze.ts:337-338`）与 `failure` 重抛无判据。抽查约 60 条改写无放宽；事务内 `currentPartials` 重核经变异证明承重。实施席 568,754 token／156 次。
- Task 11: Ruling: 判据 8 的「fake `.argv --model`」一半归 T16（计划 F1 场景本就覆盖），T11 只补「经 driverHarness 真发 claim、观测 envelope `claim.agent` ＝ 冻结值」—— 错的代价：若 T16 漏做，argv 一半无人观测（T16 派发里重申）。
- Task 11: fix round 1 → I1（envelope 一半）＋ I2 ＋ Minor 3（`control-port-unconfigured` 原名透出）＋ Minor 4（事务内同时重核 provenance）。
- Task 11: minor (deferred): 无冻结字段的 work item 在 webDispatch 闸门抛非持久 `recovery-blocked`（与无迁移裁定同源）；「keeps the canonical identity of what it froze」无分支无变异；`webProtocol.test.ts:4158` 标题仍说 Codex；`profiledService.test.ts:3333` `proofDocumentContentHashes` 改值无注释。
- Task 11: fix round 1/5 (4 addressed, 0 open — claim envelope observed, transient rethrow, no-port by name, provenance re-check; commits 106eaf9..2236991; re-review replayed F1–F4 itself)
- Task 11: complete (Orca commits c97a4b6..2236991, review clean after round 1). 实施席 568,754＋589,087 token。
- Task 11: minor (deferred): 判据「sends ccloop the frozen selection in the claim…」的 preview 取于 driverHarness 内部确认**之后**（靠夹具确定性才等价；应改读 driverHarness 确认前的解析或 mock 的记录）。
- Task 12: complete (Orca commits daa04af..06a1953, review clean). 实施席 192,225 token。「T7 bridge|T7 hook」grep rc=1（六处删净）。复审确认 spec §9.11「reconcile 选择进 `.argv`」不在 T12、归 T16（T16 派发重申）。
- Task 13: review → Needs fixes: P23 m7 HOME＋四个 XDG 根改道零写入断言缺；P1 新增的 HOME 缺省／拒绝两支无变异。复审确认全仓无 homedir 回落、真 ~/.orca 未动。实施席 237,191 token。fix round 1 发出。
- Task 13: fix round 1/5 (2 addressed, 0 open — XDG zero-write + P1 mutations; commits cb88485..23d4446)
- Task 13: complete (Orca commits 06a1953..23d4446, review clean after round 1). 实施席 237,191＋280,685 token。真 ~/.orca 两个残留文件的 mtime 仍为 02:51:24／02:51:29（控制器 stat 现测）。
- 波 3（T8–T13）完成；派波次复审（P21），与 T14 并行。
- Task 14: implementer DONE (Orca 7e66947..868ca7f)，实施席 214,754 token；复审进行中。
- 波 3 复审（opus）：`wave3-review.md`，0 Critical／3 Important／9 Minor；选择生命周期一致；确认后无派活路径读活偏好；Rule 17 无破口。
- Ruling（波 3 I-1）：`resolveGroupSelections` 加预览／确认两种模式：预览把瞬时失败记为逐槽 `unavailable`（hash 为 null、不可确认），确认仍抛出重试 —— 错的代价：预览 schema 多一支。
- Ruling（波 3 I-2）：`driverLanding.ts` 的 stepR 改用 `readConfirmedReconcileSlot`，不一致 ⇒ `reconcile-agent-unfrozen` 阻塞；判据：篡改组记录的 reconcileSlot ⇒ 不起解冲突 run。
- Ruling（波 3 I-3）：写进 T15 派发 —— 收到 `agent-selection-changed` 或预览请求失败 ⇒ 作废并重取该组预览。
- Ruling：波 3 I-1／I-2 ＋ M-1（`agentOverrides` 损坏 ⇒ `recovery-blocked` 而非 400 non-json）＋ M-5（组视图带冻结的 reconcile 选择）合入 T14 修复轮一次做。其余 Minor（M-2 来源不在 hash 内、M-3、M-4 W5-M15 且交集已可得、M-6 新阻塞码 `reconcile-agent-unfrozen` 等）T17 登记 spec §13。
- Task 14: review → Needs fixes: 1 Important（`slot-task-mismatch` 分支无判据无变异）；预览／确认同函数同操作者 id（复审核）。fix round 1 发出，合入波 3 I-1／I-2／M-1／M-5。
