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
- Task 14: fix round 1/5 (5 addressed, 0 open — slot schema cases, preview unavailable mode (波3 I-1), stepR via snapshot (波3 I-2), overrides recovery-blocked (M-1), group view reconcile (M-5); commits 7536a0d..2e87cd6)
- Task 14: complete (Orca commits 7e66947..2e87cd6, review clean after round 1). 实施席 214,754＋283,587 token。
- Task 14: minor (deferred): 确认时瞬时错误经面板映射为 500 `control-internal-error`（既有兜底，非本轮引入；T17 登记）；两条改写的组视图判据未给 `agents` 字段单独负向断言；`readConfirmedReconcileSlot` 类型层面把不可达的 null 断言为 FrozenSlot。
- Task 15: review → Approved with 1 Important：`unavailable` 槽触发每 2 s 无上限自动重读预览（每次拉起 ccloop），实施席自行扩的范围、风险未入顾虑。实施席 259,667 token。
- Task 15: Ruling: 去掉 `unavailable` 的自动轮询，改为手动「Re-read」按钮；同时加预览请求序号守卫（晚到旧答复不覆盖新的）—— 错的代价：安装恢复后需人点一下。fix round 1 发出。
- Task 15: minor (deferred): `AgentFields.tsx` fieldset 的 aria-label 与 legend 重复。
- Task 15: fix round 1/5 (1 addressed, 0 open — manual Re-read, one bounded retry, seq guard; commits c047651..6b62f22)
- Task 15: complete (Orca commits 673dc1a..6b62f22, review clean after round 1). 实施席 259,667＋301,011 token。
- Task 15: minor (deferred): `agentPreviewRefresh.test.tsx` 两条用固定 100 ms 真实等待（`settle()`），负载下理论上可能假绿；应改 `vi.waitFor`。agents／preferences 读失败无重试，需刷新页面。
- 波 4 复审（opus）：`wave4-review.md`，0 Critical／1 Important／6 Minor；契约双向一致；确认绑定成立（浏览器过期状态最多换来一次拒绝）；无无上限循环（一次预览／确认拉起 D×(ccloop＋CLI --version) 个进程，D＝去重 partial 数）。
- Ruling（波 4）：I-1（agents 读失败或端口未配置 ⇒ 编辑器卡在 Resolving…、Re-read 无效）与 M-1（`agent-selection-rejected` 拒绝后预览不作废、按钮仍可点）交接前修，续用 T15 实施席。给 T16 的更正（brief:158 偏好载荷带 expectedRevision 违反 P5；`confirmAgentGroup` 应比对存储里的冻结值而非预览本身）写进交接。其余 Minor 见 wave4-review.md。
- 🔴 2026-09-26 控制器现测（`/usr/bin/git ls-remote origin refs/heads/main`）：**ccloop 远端 ＝ af70fd6（本轮 ccloop 全部提交已在远端）；Orca 远端 ＝ d64342e（T15 第一笔；其后 a76b4b2…75b44c3 与台账提交只在本地）**。本会话无任何一席执行 `git push` ⇒ 推送来自会话外（人，或 handoff §九 记的 post-commit 钩子）。⇒ 本轮 spec／plan／已推代码与注释从此为**已发布文本**，只能追加具名更正。
- 波 4 修复：complete (Orca 6b62f22..75b44c3；复审 ADDRESSED ×2，无新的无上限循环)。实施席续用 T15 那一席（325,637 token）。复审席自报误写 `reverify-w4.log` 进 sdd 目录并随即删除（`git status --short` 核实无残留）。

## §6 交接点（2026-09-26，人：「T15完成后，我们先做一次交接」「先把波 4 复审也做完再交接」）

- **已完成**：ccloop T1–T6（含波 1、波 2 修复）；Orca T7–T15（含波 2、波 3、波 4 修复）。各 Task 的完成行、修复轮、`Ruling:` 行、deferred minor 都在上文。
- **未做（下一会话按顺序）**：T16（驱动环 E2E，fake claude＋fake codex 混组；含判据 8 的 `.argv --model` 一半、§9.11 reconcile 选择进 `.argv`）→ 波 5 复审 → T17（两仓全套门、疑似 flake 判定、控制器汇总 `mutations.md`、spec §13 实施期更正）→ 终审（opus）→ 报人（Ruling 清单、改写过的既有判据清单）。
- **给 T16 的更正（波 4）**：task-16-brief.md:158 的偏好载荷带 `expectedRevision` 违反 P5，只发 `{preferences}`；`confirmAgentGroup` 的断言应与存储里的冻结值比对，而不是与预览本身比（后者恒真）。
- **全量门本轮一次都没跑**（Rule 14）：各 Task 只跑了聚焦文件与邻居；现行全量基线仍是 ④ 轮的，已过期。

## §7 接手（2026-09-26，控制器会话 `ab5a693c`，Claude Opus 5.5；接在 §6 交接点之后）

- 开工现测（`/usr/bin/git ls-remote origin refs/heads/main` ＋ `fetch` 后 `rev-list --left-right --count HEAD...origin/main`）：Orca 本地领先远端 7 笔、不落后（远端尖端主题行 `feat(web): edit agent defaults and a proposal's agents, and confirm on the resolution shown`）；ccloop 领先 1、不落后（远端尖端 `fix(agents): keep an unobservable CLI version out of the named drift refusal`）；ccmem 领先 1、不落后。push 归人，本会话不 push。
- 真实 `~/.orca/agents.json`、`agents.json.draft.json` 仍在（0600、270B），按 §9.0c 不碰。
- 派发覆盖（impl-common.md 原文不改，派发里重申）：scratchpad 改为本会话的 `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/ab5a693c-690d-47ff-9b2d-04c2449d055e/scratchpad/impl/`；`Claude-Session` 尾行改为 `https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN`。
- Human（2026-09-26，会话 `ab5a693c`）：「好，按这个顺序继续。这个session中，尽量将这些要做的task完整做完，这个session暂时不要考虑context大小.」「这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」收尾时更新三仓 handoff（ccloop／ccmem 的 Orca 章节不许无限增长、不写死 HEAD），另在对话里给 ≤10 行的 executive summary（不落文件）。
- T16 实施席已派（opus，后台）。
- Task 16: implemented (Orca commits 5f65b17..1999e21，两笔)。实施席（opus）工具报数 242,107 token／70 次工具调用。控制器核原始日志：`scratchpad/impl/t16-e2e-2.log` 5 passed；M1／M2a／M3／M4w／M5／M6／M7 各见红，M2b（`dispatch.ts` startClaim）与 M4（`continuation.ts`）绿 —— 实施席判为驱动环不走的旧路径；全部 18 份还原 diff 0 字节。第二笔：CH／CC 原 brief 在确认后不改默认值 ⇒ 续跑判据不可能红，补了确认后改偏好。
- Ruling: 波 5 只含 T16（P21），任务复审与波 5 复审合并为一席 opus —— 同一范围派两席只是重复读同一份 diff；合并席按 review-common 的任务尺子 ＋ 跨 Task 契约（T3/T5/T7/T11/T12/T14）两件一起查，并点名判定 M2b／M4 的「旧路径」在生产里是否真不可达。
- 波 5 复审（T16＋波 5 合并，opus）：`wave5-review.md`，0 Critical／0 Important／5 Minor，Approved。M2b／M4 的旧路径经 python 逐行扫生产调用方判为生产不可达（`startClaim`／`claimContinuation` 只在 `ControlService` 内调用，`ControlService` 只在 recovery 构造且不走这两支；面板 continue-task 走 `WebControlService`）。
- Task 16: complete (Orca commits 5f65b17..1999e21, review clean)。
- Ruling（波 5）：m-1（旧路径无「活偏好不泄漏」判据，复审席条件泄漏变异 L2／L4 全绿）登记 spec §13，不补判据 —— 生产不可达；错的代价：将来有人把旧路径接回生产时无判据守。m-2（T7 `versionOf` 用 `execFileSync` 无超时）、m-3（零写入守卫抓不到只改 mtime、不查真 HOME）、m-4、m-5 记 deferred。
- Task 16: minor (deferred): 见 wave5-review.md m-2…m-5。

## §8 T17 门席：全套门、判定器、REWRITTEN 收口（2026-09-26，控制器会话 `ab5a693c` 派出的 T17 门席，Claude Opus 5.5）

> 归属：T17 门席（brief 步骤 1、2、5 ＋ REWRITTEN 收口；步骤 3 变异电池**未做**，归其后的变异席）。观测时 Orca HEAD `1999e21`（主题行 `test(control): move the operator's default while a fake claude run is parked, so its continuation proves it keeps the frozen selection`），ccloop main HEAD `87aef9a`（`docs(handoff): roll the Orca section: T1-T6 of agent selection landed here`）。脚本、日志、json 全在 scratchpad `…/ab5a693c-…/scratchpad/t17/`（不入库）；席报告 `task-17-gates-report.md`（同目录）。

- **ccloop build**：Orca 的 E2E 用 `scratchpad/impl/ccloop-build`（`t16-env.sh` 的 `ORCA_CCLOOP_BIN`），其 HEAD `87aef9a` ＝ ccloop main HEAD（P17 断言成立，写在 `gates/summary.txt` 第 3 行）。ccloop 的门全在新 `git clone --local` 副本 `t17/ccloop-gates`（HEAD `87aef9a docs(handoff): roll the Orca section: T1-T6 of agent selection landed here`）里跑，ccloop 主树零触碰。
- **环境**：每个测试进程的 HOME 与四个 XDG 根改道到 `t17/home/`；`ORCA_AGENTS_TABLE` 指向 scratchpad 里的 fake-codex 表（0700／0600）。
- **门表**（`t17/gates/summary.txt`，RC 与起止时刻照抄；条数照抄日志／json）：

| 段 | RC | 条数 | 起止 |
|---|---|---|---|
| ccloop-typecheck | 0 | — | 14:48:36–14:48:40 |
| ccloop-build | 0 | — | 14:48:40–14:48:43 |
| ccloop-test | 1 | json：81 文件，988 条，987 过、1 败、0 pending；唯一失败 ＝ 名单第 1 条 stopProof | 14:48:43–14:49:27 |
| ccloop-known-reds | 0 | `failed: 1`、`unexpected: 0` | 14:49:27 |
| ccloop-verify-control | 1 | `Test Files 1 failed \| 34 passed (35)`、`Tests 1 failed \| 363 passed (364)`，唯一 FAIL ＝ stopProof（名单第 1 条，稳定红） | 14:49:27–14:50:02 |
| web-build | 0 | — | 14:50:02–14:50:03 |
| typecheck | 0 | — | 14:50:03–14:50:09 |
| test | 1 | json：216 文件，1976 条，1975 过、1 败、0 pending；唯一失败 `tests/control/driverRecovery.test.ts` 的 recovery-retry 条（5000 ms 超时，已登记 flake 文件） | 14:50:09–14:58:35 |
| web-test | 0 | json：21 文件，105 条全过 | 14:58:35–14:58:41 |
| verify-control | 0 | `69 passed (69)`、`735 passed (735)` | 14:58:41–15:05:54 |
| web-control | 0 | `18 passed`、`198 passed` | 15:05:54–15:06:01 |
| web-control-consumer | 0 | `1 passed`、`5 passed` | 15:06:01–15:06:05 |
| scheduler | 0 | `52 passed`、`172 passed` | 15:06:05–15:06:24 |
| chain | 1 | 第一段 `13 passed`／`213 passed`；带链会话变量的全量重跑 `Tests 1 failed \| 1975 passed (1976)`，唯一失败同上 driverRecovery | 15:06:24–15:15:35 |
| panel | 0 | 15 行 `PASS` | 15:15:35–15:15:49 |
| ws-check | 0 | `21 passed`、`105 passed` | 15:15:49–15:15:57 |
| claude-md | 0 | `150/200 lines` | 15:15:57 |
| hooks-path | 0 | — | 15:15:57 |
| ledger | 2 | 降级（允许集 {0,2}） | 15:15:57 |
| rerun-1 driverRecovery 单跑 | 0 | 8 条全过 | 15:15:57–15:16:01 |
| check（判定器，本节 REWRITTEN 行在内） | 0 | `OK` | — |

- ⚠️ brief 的判定句要求 `ccloop-verify-control` RC 0；只要名单第 1 条（stopProof，稳定红）还红，它不可能是 0。本席按「失败 ⊆ 名单」判它过（日志唯一 FAIL 就是这一条），**不是**机械判定 —— 报控制器。
- **判定器红证**（`t17/check-agents.py`，EXPECTED 按报告推导而非 brief 数：agentSelectionApi 12、webParity 3、agentSelectionE2E 5、agentSettings 5、agentSelectionEditor 10，与本轮 json 全部一致）：
  - (a) 开工前的 json（`git clone --local` 于 Orca `545f452`、ccloop `f4e49a2`，本席现跑）＋本轮 `added.txt`＋本节 REWRITTEN 行 ⇒ **RC 1**，104 行：EXPECTED 4 行 `expected N passed, got []`（webParity 开工前已有 3 条且全过，所以这一格不红 —— brief 预言的「五行」里 webParity 那行只在 brief 的 4 条下才会红，该格对本轮无判别力）、新增判据文件 27 行、REWRITTEN 18 行、开工前的失败 53 行、pending 1 行、flake 未单跑 1 行。
  - (b) 本轮 Orca json 把 agentSelectionApi 第一条改成 `failed` ⇒ **RC 1**：EXPECTED 行、新增文件行、`orca unexpected failure` 行各一。
- **flake**：`runCodexPhase > kills a TERM-ignoring process before returning abort` 在 ccloop-test 与 ccloop-verify-control 两次全量里都**过了**（json 194.7 ms），不需要单跑；注意它**已经在** ccloop `check-known-reds.mjs` 的名单里（`Codex phase process > kills a TERM-ignoring process before returning abort`，历史 load flake 条目），T5 报告说「不在名单里」与名单原文不符。Orca 侧 driverRecovery 在 test 与 chain 各败一次、单跑 8/8 绿。
- **真 `~/.orca`**：门前后 `stat -f '%N %m %z %p'` 逐字节相同（`cmp` rc=0）；两个残留文件 mtime 仍为 1790362284／1790362289，未碰。
- **REWRITTEN 收口**：各报告共 277 条 REWRITTEN 行，转成判定器格式后与 json 全名**精确**对上的去重 220 行（orca 174、ccloop 45、web 1；含 1 条 `(compile-time half)`，文件里有改写注释），另 13 条重复；**45 条对不上**（助手函数／夹具级条目 28；旧名 11 —— 其中 7 条是 T7 报告内已另起行更正的旧名，其余 4 条改名后报告没给新全名：T3 registry、T12 driverReconcile、T7 errorClassification 的 `it.each`、波 2 修复 materialize 的 describe 写成了 `probing an installed CLI's version`；`…`／占位 describe 3；`%s` 模板或复合条 3），逐条列在 `task-17-gates-report.md` 与 `t17/rw-unmatched.txt`，**不改名迁就**，交控制器。下列 220 行即判定器读的行：

- REWRITTEN: ccloop:tests/control/protocol.test.ts > control protocol v1 > round-trips the strict payload for every method
- REWRITTEN: ccloop:tests/control/protocol.test.ts > control protocol v1 > names unsupported protocol versions separately from invalid requests
- REWRITTEN: ccloop:tests/control/command.test.ts > control command boundary > rejects a relative agents table before dispatch
- REWRITTEN: ccloop:tests/control/command.test.ts > control command boundary > maps named protocol rejections to exit 2 without contaminating stdout
- REWRITTEN: ccloop:tests/control/command.test.ts > control command boundary > maps malformed JSON and non-protocol failures to exit 1
- REWRITTEN: ccloop:tests/control/command.test.ts > control command boundary > does not print until a handler result passes the response schema
- REWRITTEN: ccloop:tests/control/command.test.ts > control command boundary > routes the real CLI through control before legacy parsing and emits one JSON value
- REWRITTEN: ccloop:tests/control/accept.test.ts > durable control acceptance > seals the materialized agent config so later table drift has no effect
- REWRITTEN: ccloop:tests/control/handoff.test.ts > named handoff request > watches a latched deadline through packet, zero handoff usage, seal, and released lease
- REWRITTEN: ccloop:tests/control/handoffDeadlineUsage.test.ts > deadline-aborted execute with observed usage (Orca handoff delivery C-3) > books the observed tokens as a known cumulative and still hands off a partial candidate that answers its request
- REWRITTEN: ccloop:tests/control/phasesCompleted.test.ts > the control worker counts completed phases > writes one count per phase a registering adapter completed, and the run still proves isolation
- REWRITTEN: ccloop:tests/control/protocol.test.ts > control protocol v1 > rejects unsafe integers, malformed identities, and malformed hashes
- REWRITTEN: ccloop:tests/control/protocol.test.ts > control protocol v1 > requires a canonical absolute sourceDir with no symlink ancestor
- REWRITTEN: ccloop:tests/control/protocol.test.ts > control protocol v1 > keeps an input bundle inside the canonical source input directory
- REWRITTEN: ccloop:tests/control/protocol.test.ts > control protocol v1 > derives the control root from the accepted source directory
- REWRITTEN: ccloop:tests/control/accept.test.ts > durable control acceptance > persists accepted before one exclusive worker claim and replays idempotently
- REWRITTEN: ccloop:tests/control/accept.test.ts > durable control acceptance > serializes concurrent identical accepts into one durable launch
- REWRITTEN: ccloop:tests/control/accept.test.ts > durable control acceptance > refuses the same identity with a different envelope
- REWRITTEN: ccloop:tests/control/accept.test.ts > durable control acceptance > recovers a dropped accept response through inspect without another worker
- REWRITTEN: ccloop:tests/control/accept.test.ts > durable control acceptance > keeps an intended crash ambiguous and never launches a replacement
- REWRITTEN: ccloop:tests/control/accept.test.ts > durable control acceptance > rejects a claim config hash mismatch before creating a worker
- REWRITTEN: ccloop:tests/control/endToEnd.test.ts > control protocol through the built CLI > keeps one execution identity across dropped/duplicate accept and exposes complete evidence
- REWRITTEN: ccloop:tests/control/endToEnd.test.ts > control protocol through the built CLI > deduplicates named handoff and rejects old generation or changed envelope without another phase
- REWRITTEN: ccloop:tests/control/endToEnd.test.ts > control protocol through the built CLI > recovers the synchronized SIGKILL boundary: accepted-fsynced
- REWRITTEN: ccloop:tests/control/endToEnd.test.ts > control protocol through the built CLI > recovers the synchronized SIGKILL boundary: worker-claimed
- REWRITTEN: ccloop:tests/control/endToEnd.test.ts > control protocol through the built CLI > recovers the synchronized SIGKILL boundary: handoff-fsynced
- REWRITTEN: ccloop:tests/control/endToEnd.test.ts > control protocol through the built CLI > recovers the synchronized SIGKILL boundary: candidate-fsynced
- REWRITTEN: ccloop:tests/control/handoff.test.ts > named handoff request > fsyncs before an idempotent ack and rejects changed or stale identity
- REWRITTEN: ccloop:tests/control/handoff.test.ts > named handoff request > starts no phase when already latched and starts no next phase after a cooperative boundary
- REWRITTEN: ccloop:tests/control/handoff.test.ts > named handoff request > persists an external deadline abort as handoff interruption rather than failure or exhaustion
- REWRITTEN: ccloop:tests/control/handoff.test.ts > mechanical handoff packet > derives blocked facts and explicit logs without an LLM call
- REWRITTEN: ccloop:tests/control/handoff.test.ts > mechanical handoff packet > allows request:null only for natural terminal runs and retains handoff refs for every result
- REWRITTEN: ccloop:tests/control/workerLaunch.test.ts > worker process identity > does not accept a recycled live PID with a mismatched UTC start identity
- REWRITTEN: ccloop:tests/control/collect.test.ts > control collection > filters afterSeq without renumbering
- REWRITTEN: ccloop:tests/control/collect.test.ts > bounded evidence reads > rechecks the content hash on every read
- REWRITTEN: ccloop:tests/control/collect.test.ts > bounded evidence reads > rejects traversal, symlink, FIFO, and evidence over 16 MiB
- REWRITTEN: ccloop:tests/control/handoffEnteredPhases.test.ts > handoff packet of a run stopped between phases (ccloop C7) > does not list the execute and verify files of an attempt stopped at the boundary after plan
- REWRITTEN: ccloop:tests/control/handoffEnteredPhases.test.ts > handoff packet of a run stopped between phases (ccloop C7) > does not list the verify file of an attempt stopped after execute, once execute was entered and wrote its file
- REWRITTEN: ccloop:tests/control/handoffEnteredPhases.test.ts > handoff packet of a run stopped between phases (ccloop C7) > still lists an entered phase whose file is absent: execute, and verify after execution_finished
- REWRITTEN: ccloop:tests/control/handoffEnteredPhases.test.ts > handoff packet of a run stopped between phases (ccloop C7) > counts only the current attempt's events as entered
- REWRITTEN: ccloop:tests/control/handoffEnteredPhases.test.ts > handoff packet of a run stopped between phases (ccloop C7) > does not list an entered phase's file as missing when a handoff deadline interrupted it (D-C7' (α))
- REWRITTEN: ccloop:tests/control/handoffEnteredPhases.test.ts > handoff packet of a run stopped between phases (ccloop C7) > keeps requiring all three phase files for terminal runs, with or without a request
- REWRITTEN: ccloop:tests/control/handoffEnteredPhases.test.ts > handoff candidate of a deadline-interrupted run (ccloop C6 with C7) > answers its request: result stays partial, no unresolved request on candidate or packet, nothing missing
- REWRITTEN: ccloop:tests/control/resultRepository.test.ts > the result repository a control run materializes (Orca execution driver C1/C2) > C2 reads its own run's attempt ref, not the shared path-derived one a later run overwrote
- REWRITTEN: ccloop:tests/control/resultRepository.test.ts > the result repository a control run materializes (Orca execution driver C1/C2) > C1 shares the object store by hard links instead of copying it
- REWRITTEN: orca:tests/control/blockedStaysPut.test.ts > a blocked run keeps the step it was blocked at through a later error (final fix wave FR-C2) > a conflict-parked run whose H-settle throws once stays at D; a retry resumes it at D and it is parked held, its change in a checkpoint
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > answers a profile probe through the router instead of being reported as a failed probe
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > does not invent a substitute source for a peer's observation -- an overridden field passes through unchanged
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > uses direct argv plus stdin JSON and validates successful responses
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > propagates exit 2 stably and refuses malformed or oversized stdout
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > validates evidence identity, base64 and hash
- REWRITTEN: orca:tests/control/commands.test.ts > control commands > rejects dangling dependencies, duplicate task IDs and cycles while preserving approved graph
- REWRITTEN: orca:tests/control/commands.test.ts > control commands > latches stop and retains a proposal instead of replacing an active contract
- REWRITTEN: orca:tests/control/continuation.test.ts > continuation claims > exports and binds the verified resume bundle before starting and replays one new run
- REWRITTEN: orca:tests/control/dispatch.test.ts > durable starts > recovers the accepted identity after the peer drops its response, without another launch
- REWRITTEN: orca:tests/control/dispatch.test.ts > durable starts > writes the full immutable intent before handing off to the peer and rejects altered identity
- REWRITTEN: orca:tests/control/dispatch.test.ts > durable starts > keeps unknown ownership despite a dead service PID, expired clock or unavailable inspect
- REWRITTEN: orca:tests/control/dispatch.test.ts > durable starts > does not send an absent start after stop is latched
- REWRITTEN: orca:tests/control/dispatch.test.ts > durable starts > rechecks stop after asynchronous capability discovery before creating a start intent
- REWRITTEN: orca:tests/control/driverHandoff.test.ts > a landing whose worktree removal failed after the swap (controller ruling T4-I1) > leaves a run blocked at R whose reconciled merge is already on orca/g to a person: its request stays open
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > RC1: a separate run resolves the conflict and it lands as a merge of the tip and the run's own attempt
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > books the reconciliation's spend on the group once, and the ledger still conserves
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > blocks the conflict before any reconciliation run when the group cannot afford it
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > blocks a reconciliation that leaves conflict markers, and orca/<group> keeps only the first landing
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > blocks a reconciliation that ended failed, and still books its spend on the group
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > blocks at R, before spawning, a reconciliation the group can no longer afford
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > waits for a reconciliation still running, and collects it once it ends, with one spawn
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > after a restart, waits on a recorded live reconciliation process instead of spawning a second one
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > spawns the reconciliation as its own process group with its output in files, and a new driver after stop() finishes it with one spawn
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > after a restart with a spawn recorded but no process id, blocks instead of running a second reconciliation
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > a reconciliation whose landing swap fails without the tip moving (final review I2) > blocks at R naming the leftover lock, and spawns no second reconciliation
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > a person's retry of a run blocked at R (final review I4) > re-runs a failed reconciliation: two spawns, two distinct bookings, never three
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > a person's retry of a run blocked at R (final review I4) > retries a collected reconciliation whose landing failed without running it again or booking it twice
- REWRITTEN: orca:tests/control/driverReconcileN.test.ts > N1u: the other side of a conflict is every landed task it touches (spec §5.2 N1) > answers both landed tasks, sorted by task id, where the two-sided rule escalated "2"; none still escalates "0"
- REWRITTEN: orca:tests/control/driverReconcileN.test.ts > three runs conflicting on one file (spec §5.2 N1, N2) > lands all three with exactly two reconciliations, the second against both landed tasks
- REWRITTEN: orca:tests/control/driverReconcileN.test.ts > three runs conflicting on one file (spec §5.2 N1, N2) > N2: while one run of the group is reconciling, a sibling collected run does not land until the reconciliation has
- REWRITTEN: orca:tests/control/driverReconcileN.test.ts > a reconciliation reset by a moved tip and spawned again (spec §11 I7, §13.2 I-6) > books both spawns on the group under two distinct keys
- REWRITTEN: orca:tests/control/driverReconcileN.test.ts > the spawn key after a spawn that died unbooked (controller ruling D-SPAWNKEY, 2026-09-25) > resumes above the largest booked spawn number, not the number of booked spawns
- REWRITTEN: orca:tests/control/endToEnd.test.ts > rejects a malformed peer capability answer the guard clauses never read
- REWRITTEN: orca:tests/control/finalReview.test.ts > final review regressions > requires explicit observations of both budget buckets: none
- REWRITTEN: orca:tests/control/finalReview.test.ts > final review regressions > requires explicit observations of both budget buckets: work
- REWRITTEN: orca:tests/control/finalReview.test.ts > final review regressions > requires explicit observations of both budget buckets: handoff
- REWRITTEN: orca:tests/control/finalReview.test.ts > final review regressions > requires explicit observations of both budget buckets: both
- REWRITTEN: orca:tests/control/finalReview.test.ts > final review regressions > claims the newly approved target version while preserving same-version idempotence
- REWRITTEN: orca:tests/control/finalReview.test.ts > final review regressions > refuses recovery while live service orchestration owns the store
- REWRITTEN: orca:tests/control/handoffTransaction.test.ts > handoff transaction > persists one immutable request intent before RPC and retries the same request
- REWRITTEN: orca:tests/control/handoffTransaction.test.ts > handoff transaction > keeps both reservations and ownership when no quiet proof is available
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > normalizes sets, archives contracts, and keeps imported authority unchanged after source edits
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > replays the original result without rereading a changed source or changed server defaults
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > replays asynchronously before capability I/O and cannot hang on a lost-response retry
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > returns a same-id raw conflict before capability I/O
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > durably rejects an initially stale import before any defaults, profile, probe, or source callbacks
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > rechecks revision after a successful in-flight probe before source I/O
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > rechecks command identity after an in-flight probe and creates no duplicate effects
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > persists and replays a durable missing profile rejection across a later config change
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > persists and replays a durable changed profile rejection across a later config change
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > lets a concurrent same-id commit win when an in-flight probe rejects durably
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > persists revision conflict before a failing in-flight probe and replays it before changed defaults
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > does not persist an unexpected asynchronous preparation failure
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > does not persist an transient asynchronous preparation failure
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > turns a real probe failure into a terminal import without optimistic capability
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > persists a terminal blocked-capability preflight without a scheduler wake
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > persists a terminal input-too-large preflight without a scheduler wake
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > rejects duplicate task and leaves the group completely absent
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > rejects duplicate dependency and leaves the group completely absent
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > rejects dangling dependency and leaves the group completely absent
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > rejects a contract outside the closed ccloop V1 schema
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > rolls back every import row when interrupted before commit
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > rejects a plan inode swap between trusted resolution and descriptor validation
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > is absent or fully replayable after real SIGKILL before-commit
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > is absent or fully replayable after real SIGKILL after-commit
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > fails closed when an archived content-addressed plan is missing or damaged
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > fails closed on structurally valid but malformed proposal and estimate authority
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > fails closed on noncanonical proposal bytes and an estimate request hash mismatch
- REWRITTEN: orca:tests/control/planImport.test.ts > immutable plan import > persists non-allowlisted source rejection without creating a group
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > rejects stale, missing, and unavailable profiles before claim state or provider invocation
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > persists the binding and starts only through the selected profile port
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > freshly rejects stale, missing, and unavailable profiles at start without invoking a provider
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > freshly validates the persisted profile before reconciling an unknown start
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > rejects strict profiles whose matching proof omits the tokens work dimension
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > rejects a task-only profile where a separate handoff profile is required
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > lets drain pass a hanging claim probe, then rejects its writer
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > lets drain pass a hanging reconcile probe, then rejects its writer
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > lets drain pass a hanging start call and forbids its post-I/O status write
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > lets drain pass hanging evidence I/O and rejects every later evidence writer
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > lets drain pass a hanging handoff call and rejects its later evidence writer
- REWRITTEN: orca:tests/control/profiledService.test.ts > profiled service execution > releases admission after reconcile and claim exceptions
- REWRITTEN: orca:tests/control/profiles.test.ts > trusted execution profiles > routes only an allowlisted work kind with the exact frozen hash
- REWRITTEN: orca:tests/control/profiles.test.ts > trusted execution profiles > rejects forged router entries and refuses to probe a profile from another router
- REWRITTEN: orca:tests/control/profiles.test.ts > trusted execution profiles > owns immutable snapshot and port method bindings after construction
- REWRITTEN: orca:tests/control/profiles.test.ts > trusted execution profiles > preserves the original receiver for captured port methods
- REWRITTEN: orca:tests/control/profiles.test.ts > trusted execution profiles > degrades a failed or malformed capability probe to wholly unavailable
- REWRITTEN: orca:tests/control/projectionJournal.test.ts > projection journal > projects claim, starting, and accepted run/work transitions once per transaction
- REWRITTEN: orca:tests/control/projectionJournal.test.ts > projection journal > projects starting and unknown run transitions without changing authority
- REWRITTEN: orca:tests/control/schedulerBridge.test.ts > reserves reconciliation once from remaining group budget and refuses stopped groups
- REWRITTEN: orca:tests/control/schedulerBridge.test.ts > gets capabilities from the peer before a service claim
- REWRITTEN: orca:tests/control/schedulerBridge.test.ts > runs a real conflicting graph through durable control: success
- REWRITTEN: orca:tests/control/schedulerBridge.test.ts > runs a real conflicting graph through durable control: budget
- REWRITTEN: orca:tests/control/schedulerBridge.test.ts > runs a real conflicting graph through durable control: stopped
- REWRITTEN: orca:tests/control/schedulerBridge.test.ts > runs a real conflicting graph through durable control: crash
- REWRITTEN: orca:tests/control/startEnvelope.test.ts > translating a frozen dispatch envelope into a start envelope > copies the claim from the run row and the contract hash from the ledger, field by field
- REWRITTEN: orca:tests/control/startEnvelope.test.ts > translating a frozen dispatch envelope into a start envelope > drops the run row's own extra columns instead of smuggling them onto the wire
- REWRITTEN: orca:tests/control/startEnvelope.test.ts > translating a frozen dispatch envelope into a start envelope > translates a handoff-phase envelope with the same claim and the same ledger hash
- REWRITTEN: orca:tests/control/startEnvelope.test.ts > translating a frozen dispatch envelope into a start envelope > carries a continuation's ledger hash rather than the predecessor's
- REWRITTEN: orca:tests/control/startEnvelope.test.ts > the translation refuses before anything is dispatched > refuses a run row missing a claim field, rather than dispatching the string "undefined"
- REWRITTEN: orca:tests/control/startEnvelope.test.ts > the translation refuses before anything is dispatched > refuses when the envelope and the run name different runs
- REWRITTEN: orca:tests/control/startEnvelope.test.ts > the translation refuses before anything is dispatched > refuses when they disagree about the generation, not only the run id
- REWRITTEN: orca:tests/control/unconfiguredPort.test.ts > the unconfigured execution port > refuses every method it has, not merely the obvious ones
- REWRITTEN: orca:tests/control/unconfiguredPort.test.ts > the unconfigured execution port > refuses a second time exactly as it refused the first, holding no state
- REWRITTEN: orca:tests/control/webCcloopSmoke.test.ts > the frozen dispatch envelope reaches a real process (task 10 step 4) > carries the ledger's claim identity byte-for-byte and is durably accepted once
- REWRITTEN: orca:tests/control/webCcloopSmoke.test.ts > the frozen dispatch envelope reaches a real process (task 10 step 4) > latches the stop under the ledger's request identity and returns evidence the store re-hashes
- REWRITTEN: orca:tests/panel/controlAssemblyDriver.test.ts > the execution driver in the panel's assembly (spec §2.1) > knows its own repository for set-workspace-mode only with a configured port (configured=true)
- REWRITTEN: orca:tests/panel/controlAssemblyDriver.test.ts > the execution driver in the panel's assembly (spec §2.1) > is present with a configured port, with its roots created 0700 beside the store directory, and shuts down cleanly
- REWRITTEN: orca:tests/panel/controlAssemblyDriver.test.ts > the execution driver in the panel's assembly (spec §2.1) > stops the driver on a close with no shutdown before it, and a stopped driver stays stopped (ruling P10)
- REWRITTEN: orca:tests/panel/controlConfig.test.ts > trusted panel control config > resolves only stable repository and plan IDs and never exposes trusted paths
- REWRITTEN: orca:tests/panel/controlConfig.test.ts > trusted panel control config > rejects allowlisted plan escapes and symlinked path components at startup
- REWRITTEN: orca:tests/panel/controlConfig.test.ts > trusted panel control config > rejects a plan or ancestor swapped to a symlink after startup
- REWRITTEN: orca:tests/panel/controlConfig.test.ts > trusted panel control config > rejects duplicate IDs and invalid trusted executable paths before serving config
- REWRITTEN: orca:tests/panel/controlConfigPort.test.ts > the served config states whether an execution port is configured > serves "unconfigured" when the panel was started without one
- REWRITTEN: orca:tests/panel/controlConfigPort.test.ts > the served config states whether an execution port is configured > serves "configured" when it was
- REWRITTEN: orca:tests/panel/controlConfigPort.test.ts > the served config states whether an execution port is configured > does not answer the port question from a profile's probe failure
- REWRITTEN: orca:tests/panel/controlConfigPort.test.ts > the served config states whether an estimator was chosen > serves null defaults rather than refusing to build
- REWRITTEN: orca:tests/panel/controlConfigPort.test.ts > the served config states whether an estimator was chosen > still refuses an estimator that was named and does not resolve
- REWRITTEN: orca:tests/panel/controlConfigPort.test.ts > the two pairs cannot disagree > refuses an unconfigured port that still carries one, which is the other direction
- REWRITTEN: orca:tests/panel/controlConfigPort.test.ts > the two pairs cannot disagree > refuses half an estimator in both directions
- REWRITTEN: orca:tests/panel/controlOptions.test.ts > resolveControlOptions reports whether an execution port is configured > calls the port configured only when both are set and non-empty
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > authenticates reads, enforces canonical sinceChangeSeq spelling, and keeps immediate kill absent
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > returns sorted complete, incremental, ahead, and retained-gap summaries
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > reloads confirmed profiles, snapshot hashes, estimate output, and paused state without exposing trusted paths
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > fails closed when confirmed allocation or derived-contract authority is missing, forged, or belongs to another task
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > accepts a globally deduplicated derived contract when each group snapshot independently proves its authority
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > rejects malformed or cross-record-inconsistent persisted run authority instead of synthesizing display values
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > requires canonical stop authority and preserves revision and blocker evidence on group read failures
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > rejects budget and graph legacy stopped flags without canonical stop intents
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'checkpoint' evidence collection containing a 'null' element
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'checkpoint' evidence collection containing a 'invalid' element
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'outbox' evidence collection containing a 'null' element
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'outbox' evidence collection containing a 'invalid' element
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'handoff' evidence collection containing a 'null' element
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'handoff' evidence collection containing a 'invalid' element
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'recovery' evidence collection containing a 'null' element
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > blocks a 'recovery' evidence collection containing a 'invalid' element
- REWRITTEN: orca:tests/panel/controlReadApi.test.ts > canonical control read API > returns persisted command results, sorted recovery, verified evidence manifests, and exact typed misses
- REWRITTEN: web:web/tests/controlPortBanner.test.tsx > the panel says when it has no execution port > shows it, and names the two variables that fix it
- REWRITTEN: orca:tests/control/capabilitySchema.test.ts > capabilityViewSchema > is the closed seven-key view that capabilities protocol 3 carries untagged
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > passes the peer's own capabilities-v3 view through, substituting nothing
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > therefore, with a peer answering the default view, keeps handoffControl durable and handoffExecution non-null through intersectCapabilities
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > requires absolute canonical regular binary and agents table files
- REWRITTEN: orca:tests/control/unconfiguredPort.test.ts > the unconfigured execution port > exposes the probe, so a missing port is never reported as a missing capability
- REWRITTEN: orca:tests/panel/assemblyHandoffGrace.test.ts > the handoff grace the driver waits (spec §3) > is the agent's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable
- REWRITTEN: orca:tests/panel/controlOptions.test.ts > resolveControlOptions reports whether an execution port is configured > needs both variables, not either one
- REWRITTEN: orca:tests/control/webCcloopSmoke.test.ts > the shipped consumer answers for its own capabilities (task 10 step 4) > claims phase-end usage and soft enforcement, and the ledger opens no strict run on it
- REWRITTEN: orca:tests/control/webCcloopSmoke.test.ts > the shipped consumer answers for its own capabilities (task 10 step 4) > blocks only at delivery when the observation degrades after a clean schedule
- REWRITTEN: orca:tests/control/webCcloopSmoke.test.ts > the shipped consumer answers for its own capabilities (task 10 step 4) > refuses an envelope that is not V2 and reads a well-formed one as no execution yet
- REWRITTEN: orca:tests/control/workspaceSettings.test.ts > repository workspace mode (execution driver §3.2) > migrates a version 3 store by adding the settings table
- REWRITTEN: orca:tests/control/confirmation.test.ts > atomic confirmation > freezes every profile and derived grant and invalidates confirmation on prestart edit
- REWRITTEN: orca:tests/control/confirmation.test.ts > atomic confirmation > updates the reserved goal-review grant and rejects understated live commitments
- REWRITTEN: orca:tests/control/confirmation.test.ts > atomic confirmation > reads only archived derived execution authority after the original source changes
- REWRITTEN: orca:tests/control/confirmation.test.ts > atomic confirmation > confirms against remaining active estimate commitment after accounted usage
- REWRITTEN: orca:tests/control/confirmation.test.ts > atomic confirmation > rejects model-assisted handoff without all required grant dimensions
- REWRITTEN: orca:tests/control/confirmation.test.ts > atomic confirmation > set-limit changes only live ceiling/reserve and preserves readable frozen authority
- REWRITTEN: orca:tests/control/confirmation.test.ts > atomic confirmation > rolls back confirmation for unknown usage, invalid context and publication failure
- REWRITTEN: orca:tests/control/estimator.test.ts > frozen estimator > holds gaps/unknown usage and refunds only settled remainder after confirmed usage
- REWRITTEN: orca:tests/control/estimator.test.ts > frozen estimator > freezes exact input formula, contract constants, and checks later degradation
- REWRITTEN: orca:tests/control/proposal.test.ts > proposal commands > checks proposal version before domain state and applies allocation plus limit atomically
- REWRITTEN: orca:tests/control/proposal.test.ts > proposal commands > validates explicit model field provenance again at confirmation
- REWRITTEN: orca:tests/control/proposal.test.ts > proposal commands > serves closed mutation envelopes with exact durable statuses and replay lookup
- REWRITTEN: orca:tests/control/targetVersion.test.ts > wire schemas refuse a string targetVersion (seam B) > N7 ControlPlanV1 takes 3 and refuses "3"
- REWRITTEN: orca:tests/control/stopIntent.test.ts > model-assisted handoff attempts > settles the request unrecoverably when the frozen handoff profile disappears
- REWRITTEN: orca:tests/control/webFaults.test.ts > commit boundaries (task 10 step 3) > dies before the confirmation commit with an editable proposal, and the retry confirms once
- REWRITTEN: orca:tests/control/profiles.test.ts > trusted execution profiles > changes profileHash when any resolved execution byte changes
- REWRITTEN: orca:tests/control/profiles.test.ts > trusted execution profiles > refuses a v2 snapshot that carries adapter: "codex"
- REWRITTEN: orca:tests/control/webProtocol.test.ts > Web control protocol > validates normalized plans and rejects unsorted or duplicate sets
- REWRITTEN: orca:tests/control/webProtocol.test.ts > Web control protocol > accepts an explicit Codex phase-end plus soft profile snapshot
- REWRITTEN: orca:tests/control/webProtocol.test.ts > Web control protocol > validates a complete, canonically ordered execution snapshot
- REWRITTEN: orca:tests/control/webProtocol.test.ts > Web control protocol > enforces canonical group allocation ownership and command revision nullability
- REWRITTEN: orca:tests/control/driverHandoff.test.ts > nothing arrives (spec §3 grace, §11 I3) > turns the request outcome-unknown past deadline + grace, keeps collecting without killing, and H-settles a late candidate
- REWRITTEN: orca:tests/control/driverHandoff.test.ts > the grace is the run's own agent killGraceMs plus the fixed minute (spec §3; agent selection spec §6.6) > does not call a request outcome-unknown before the killGraceMs ccloop answers for the run's selection has passed
- REWRITTEN: orca:tests/panel/controlApi.test.ts > web control acceptance over a real panel (task 10 step 1) > takes a plan from import to a continued task, and the ledger's own state is durable at every boundary
- REWRITTEN: orca:tests/panel/webParity.test.ts > (compile-time half) controlGroupWebToServer

## §9 T17 收尾补记（控制器会话 `ab5a693c`，2026-09-26）

- ccloop `verify:control` 机械判定（门席报 RC 1、唯一红为 stopProof，属读日志判断）：控制器在同一副本 `$S/t17/ccloop-gates`、同一 env 下按 `scripts/verify-control-protocol.mjs` 的同一组文件（`tests/control`、`tests/controller/codex.integration.test.ts`、`tests/runtime/codex`）以 json 重跑：vitest RC 1；`node scripts/check-known-reds.mjs <json>` **RC 0**（roster 13／failed 1／unexpected 0，唯一红 `quiet execution proof > does not treat leader exit as group quiet and proves only after the full tree is gone`）。日志 `$S/t17/gates/ccloop-verify-control-knownreds.log`。
- Ruling: 门席未匹配的 45 条 REWRITTEN 中，改名后现名可确认的（控制器逐文件读注释与 `it` 核对，difflib 最近名经人工核实）补成判定器格式如下；28 条助手／夹具级、3 条 `…`／`%s` 复合条目不是单条判据，判定器格式表达不了，留在各报告里人审 —— 错的代价：这些改写没有机械的「仍在且通过」检查（它们所在文件的全部判据在全量里通过）。
- REWRITTEN: ccloop:tests/agents/registry.test.ts > agent descriptors > builds a ClaudeAgentAdapter from the claude descriptor
- REWRITTEN: orca:tests/control/capabilitySchema.test.ts > capabilityViewSchema > is the closed seven-key view that capabilities protocol 3 carries untagged
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > passes the peer's own capabilities-v3 view through, substituting nothing
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > therefore, with a peer answering the default view, keeps handoffControl durable and handoffExecution non-null through intersectCapabilities
- REWRITTEN: orca:tests/control/ccloopPort.test.ts > production ccloop execution port > requires absolute canonical regular binary and agents table files
- REWRITTEN: orca:tests/control/errorClassification.test.ts > control error classification > classifies helper-mediated control-binary-invalid as internal
- REWRITTEN: orca:tests/control/errorClassification.test.ts > control error classification > classifies helper-mediated control-agents-table-invalid as internal
- REWRITTEN: orca:tests/control/unconfiguredPort.test.ts > the unconfigured execution port > exposes the probe, so a missing port is never reported as a missing capability
- REWRITTEN: orca:tests/panel/assemblyHandoffGrace.test.ts > the handoff grace the driver waits (spec §3) > is the agent's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable
- REWRITTEN: orca:tests/panel/controlConfigPort.test.ts > the two pairs cannot disagree > refuses a configured port with no agents table
- REWRITTEN: orca:tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding the group's frozen reconcile selection with its configHash (agent selection spec §4.9, §6.1)
- REWRITTEN: orca:tests/control/webProtocol.test.ts > Web control protocol > enforces canonical group allocation ownership and command revision nullability
- REWRITTEN: web:web/tests/agentPreviewRefresh.test.tsx > App re-reads a group's agent preview when the one on screen can no longer be confirmed (wave 3 I-3) > does not re-read a preview in which a slot was unavailable for now until the operator asks, and then reads it once
- REWRITTEN: ccloop:tests/agents/materialize.test.ts > resolving a selection against the table > refuses an installation whose CLI no longer reports the table's version
- 判定器复跑（门席的 json ＋ 本节补的行）：`python3 $S/t17/check-agents.py …` **RC 0 `OK`**（`$S/t17/check-final2.log`）。红证：把本节两条补行的名字各改一个字喂它 ⇒ **RC 1**，两行 `rewritten criterion missing or not passed`（`$S/t17/check-red3.log`）—— 证明补行确实被检查。
- 🔴 现场发现：本机有 75ec878e 会话留下的孤儿进程（PPID 1）：三个 `ccloop-agents-version-*/cli.mjs --version`（fixture 内容 `setInterval(() => {}, 1000)`，来自 `ccloop/tests/agents/materialize.test.ts` 的挂起探测；起于 01:56／02:08／03:23，早于本会话）与两个 `worker.js`（路径在 75ec878e scratchpad 的 `t5-mut`、`ccloop-w2fix` 副本里，即变异副本）。本会话 T17 两次全量之后 `pgrep` 未见新增 ⇒ 判为旧变异／写作期残留，非现行代码泄漏（未证实）。Ruling: 不杀（不是本会话起的进程），列 awaitingHuman；变异电池席要在前后各 `pgrep` 一次、只清自己 scratchpad 路径下的进程。
- T17 门席：complete（Orca `docs(sdd): record the agent selection gates and judge`，§8）。工具报数 260,770 token／80 次工具调用。门席收尾时 `ls-remote`：ccloop 远端已到本地 HEAD 那一笔（主题行 `docs(handoff): roll the Orca section: T1-T6 of agent selection landed here`），Orca 远端到 T16 第二笔 —— 会话中途又被会话外推动；本会话无一席 push。
- T17 变异电池：两席并行（ccloop sonnet、Orca opus），共同指令 `$S/battery-common.md`（每席一次一个 vitest；红必须是被变异断言，超时不算）。Ruling: 两仓并行而非串行 —— 两个聚焦 vitest 的负载有限，且判红规则排除超时；错的代价：负载型假红被当成真红，由「超时不算、重跑一次」兜住。
- 变异电池（ccloop，sonnet）：`battery-ccloop-report.md`。工具报数 416,801 token／189 次工具调用。**109 条全部按预言见红**，0 target gone，0 无独占判据，0 超时；T6M3 在终树上红 2 条（波 2 修复新增判据共用同一 `resolveAgent`）。席自报事故：驱动脚本对两条脚本级检查（M15、F4）传空文件列表，`vitest run` 因此在副本里跑了一次全套；发现后停掉并手工重做两条。副本 diff 0 字节、主树未动、副本已删。
- 孤儿进程归因（控制器现测）：本会话 15:44 新出现一个 `ccloop-agents-version-*/cli.mjs --version`（PPID 1），时刻落在电池 T1 段，而 T1-M24（删掉 `probeVersion` 的超时 kill）正是让挂起 fixture 不被杀的变异 ⇒ 那三个旧孤儿同形，判为历次变异残留，不是现行代码泄漏。本会话那一个（pid 4929）已由控制器 `kill`；旧的三个与两个旧 `worker.js` 不是本会话起的，留给人。
- 变异电池（Orca，opus）：`battery-orca-report.md`。工具报数 270,336 token／83 次工具调用。名单 213 条：**207 按预言红**、1 红但集合变了（T11-M4：`probes and claims with the frozen selection…` 现绿，另红 T11 fix 1 加的 `sends ccloop the frozen selection in the claim…`，按实测登记）、3 绿且预言本就绿（M13-6 等价变异；T16-M2b／M4 旧路径，见 §7 波 5 Ruling）、**0 条预言红却绿**、2 条 target gone（M7-4 `temporaryProbeSelection` 已由 T11 删；T15-M22 自动重读已由 F1T15 有意删，其反向变异 F1T15-M1 红）；17 条锚点过期、改锚到终树等价分支（逐条在报告表内）；跨 Task 红证 T16-M2a／M3／M4w 真的重跑、全红；0 超时；两副本 diff 0／0 字节。副本留在 `$S/battery-orca/`（scratchpad，未删）。
- 该席留下一个孤儿 `worker.js`（pid 43085，路径在本会话 `$S/impl/ccloop-build`，16:13:24 起，正是 W2F-M1 变异那次运行结束时刻）⇒ 变异运行的残留；控制器已 `kill`。旧会话同形的 96061（`orca-port-missing-table`）同理，留给人。T17 两次全量（未变异）之后未见新增。
- Task 17: complete（门、判定器、变异电池、`mutations.md` 汇总）。spec §13 由控制器追加（下一笔）。
