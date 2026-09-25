# ④ handoff 投递＋续跑＋N 路并行落地＋m5：让 `handoff-stop` 真的停下、留下检查点、并能接着跑 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 fake codex、soft 组下，对驱动环在跑的 group 发 `handoff-stop`，每个被冻结的 run 按它所处的步收口、group 到 `handoff-complete`；`resume-from-handoff` 之后选中的任务由驱动环从各自的检查点续跑、落到 `orca/<g>`，N 路并行时最终内容含每一路的改动；优雅关闭不再冻住驱动环的 group。

**Architecture:** ccloop 侧三处只加不改（C5 fake codex 的 `delayMs`／续跑键／`.tasks` 日志；C6 handoff 的 `unresolvedRequestIds` 不列自己；C7 handoff 候选只要求当前 attempt 进入过的阶段文件）＋ 一处**待裁**的 C-3（被 deadline 中止的阶段的 usage）。Orca 侧：stop 侧零件（T3）→ 驱动环新增一步 H（新文件 `src/control/driverHandoff.ts`，T4）→ 续跑的 A1／A2（T5）→ N 元解冲突与组内落地串行（T6）→ 关闭跳过（T7）→ `RunViewV1.continuable` 与面板（T8）→ 装配与真 ccloop 的端到端（T9）→ 收口（T10）。**没有未完 handoff 请求的 run，每一轮的行为与今天逐字节相同。**

**Tech Stack:** TypeScript、zod、vitest、node:sqlite（ControlStore）、git CLI、React（`web/`）；ccloop 的 fake codex（`tests/fixtures/fake-codex.mjs`）。

**Spec:** `docs/superpowers/specs/2026-09-25-handoff-delivery-design.md`（**先读它**；优先级 **§13 ＞ §12 ＞ §11 ＞ 正文**。§13 在写本计划时只在主树工作树里、尚未提交）。上游：`2026-09-25-execution-driver-design.md`（其 §11、§12 优先于其正文）、`2026-09-19-web-recoverable-control-design.md`。本计划与 spec 冲突时 spec 优先 —— 本计划查出的 spec 与代码不符之处**全部**列在 §0.1，由控制器裁定，不许静默偏离。

**归属**：Orca 控制器会话 `e5f56bfe` 派出的计划席（Claude Opus 5.5），2026-09-25。观测锚点：Orca `264f967`（主题行 `chore(checkpoint): orca-dev-af3dc0d3, level 390658 of 1000000 (T1 330000, T2 450000, band 1)`）＋ 工作树里 spec 的 §13；ccloop `a5dc529`（主题行 `docs(handoff): roll the Orca section: real codex ran through control once; Orca's handoff slice needs C5 and C6 here`）。**行号会移动 ⇒ 引用前现测。** T3、T4、T5 的代码与判据在计划席的副本 `scratchpad/planner/orca-val` 里整份跑过（见各 Task 的 Expected）；T1、T6、T7／T8、T9 由计划席派出的写作席在各自副本里验证（见各 Task）。

---

## §0 现量结果（Task 0，计划席在写计划前自己量的）

探针全部只在 `scratchpad/planner/` 下：Orca 副本 `orca/`（基线）、`orca-probe/`（行为改动探针）、`orca-val/`（T3–T5 实现验证）；ccloop 副本 `ccloop/`（基线）、`ccloop-probe/`（C6＋C7 探针）；日志同目录。代码位置一律 python 逐行读取定位。

| # | 问题（spec 出处） | 现量结论 | 证据（file:line ＋ 命令／日志） |
|---|---|---|---|
| (1) | §3 L63：`requestHandoff` 的重放语义 | 同一请求（按整个请求的 `canonicalHash` 比）重放：candidate 未出 ⇒ `latched`，已出 ⇒ `complete`；不同请求 ⇒ `control-handoff-conflict`；前提：已 accept（否则 `control-handoff-not-accepted`）、envelope 哈希一致。复审席的答案复核成立 | ccloop `src/control/handoff.ts:137`（函数）、`:145`、`:152`、`:158` |
| (2) | §3 L64：`settleHandoffRequest` 对 Web run 要求什么；是否同步 Web 台账 | 它**不检查也不写**检查点、`checkpointId`、`recoverable`、usage、stopProof —— 全归 H-settle（T4）。recoverable 支把分配置 `held` 且**额改成剩余**、`work.grant` 改成剩余、run `active=0`，不动 group 的 reserved（台账自洽）。**新发现**：这次「改额」与三处「确认后不变」的比对冲突 —— `readConfirmedTaskExecution`（`executionSnapshot.ts:268`）与读模型（`controlViews.ts:305`、`:494`）⇒ H-settle 之后同组任何 A2 抛 `recovery-blocked`、面板整组拒读 ⇒ §0.1 D-SNAP、D-VIEW | `src/control/stopIntent.ts:622-648`、`:650`、`:670`、`:672`；探针：`scratchpad/planner/orca-val` 里只做 H-settle 时 A2 栈顶 `executionSnapshot.ts:268`（`dbg.log`），读模型 `run-work-identity`（`val-view.log` 之前那一跑）；加上 D-SNAP／D-VIEW 后 `val-t45.log`、`val-t5c.log` 全绿 |
| (3) | §4 L70：续跑记账与 A1 预留的衔接 | A1 只把 `providerAttemptOrdinal` 加一，不挪数额；续跑 run 的 grant 取 `work.grant`，即前任收口时的剩余 ⇒ 不重复扣、不漏扣。唯一风险是某一维用尽（§13.2 I-5：注册时被拒，面板剔除后再发） | `src/control/webDispatch.ts:353-370`（注释原话 "It moves no amount"）、`:265`；`stopIntent.ts:672` |
| (4) | §4 L73：`toStartEnvelope` 对续跑填什么 | 写死 `inputCheckpoint: null` ⇒ T5 加第五个参数 | `src/control/startEnvelope.ts:91` |
| (5) | §4.1 L83：面板是否显示「C 等 A」 | 没有显式标记；任务表有 status 列与 depends-on 列，A 显示 `held`、C 显示 `ready` 且依赖 A，人能推出来 ⇒ **登记，不在本片加 UI** | `web/src/ControlGroupView.tsx:66`、`:72`、`:75` |
| (6) | §5.2 L100：N-parity 能否逐字节一致 | **能**。N 元合成器对一个对方写出的文件名与字节都与两元的相同；三方时 taskId `reconcile-a-b-d`、checks 为首次出现序的并集、tokenBudget 取 max；并集为空时的升级原话与两元相同 | 探针 `scratchpad/planner/nparity.log`（`sameFileName:true`、`sameBytes:true`、`planParity:true`）；typecheck `nparity-tsc.log` RC 0 |
| (7) | §6 L109：shutdown 条目 schema 是否封闭 | 封闭：`disposition` 是 enum、条目 `.strict()`；成功体入账本前经 `commandSuccessSchema` 解析 ⇒ 新值要同时加到 `webProtocol.ts`、`controlLifecycle.ts` 的 `Disposition`、`web/src/controlTypes.ts`；面板组件不渲染 `disposition` | `src/control/webProtocol.ts:1116-1123`、`:1131`；`src/panel/controlLifecycle.ts:52`；`web/src/controlTypes.ts:246` |
| (8) | §8 L128：解冲突 run 的 fake codex 脚本键 | 键 ＝ prompt 里 `task X` 的 X，即解冲突 contract 的 `objective.taskId`；N 元按 §11 M5 为 `reconcile-<本任务>-<对方按 id 排序以 - 连接>`（N＝1 与今天逐字相同）。三个阶段的 prompt 都带 taskId（plan／execute／verify 各一种句式），C5 因此能按阶段取 `delayMs` | ccloop `tests/fixtures/fake-codex.mjs:26-27`；`src/runtime/claude/prompts.ts:15`（plan）、`:33`（execute）、`:55`（verify）；Orca `src/scheduler/reconcile.ts:361` |
| (9) | §13.1 C-2（C7）：「当前 attempt 进入过某阶段」怎么机械判 | plan：`currentAttempt>0`（`consumeAttemptBudget` 在 plan 之前就把它落盘）；execute：`events.jsonl` 里有 `type:"execute_started"`、`detail:"attempt <n>"`；verify：有 `type:"execution_finished"`、`detail:"attempt <n>"`（它在 verify 启动前发出，没有 `verify_started` 事件）。`loop-state` 的 `status` 不可用（`verification_rejected` 后回到 `planning` 而 `currentAttempt` 仍指旧 attempt；终态丢阶段）。落点：`buildHandoffPacket` 的 `:261-270`。**探针**：C6＋C7 打上后 ccloop 全套只多红 C6 那一条 | ccloop `src/controller/runLoop.ts:1348`、`:1409`、`:1589`；`src/control/handoff.ts:261-270`；探针 `scratchpad/planner/c67-summ.txt`、`c67-kr.log` |
| (10) | §13.1 C-3：deadline 中止时手里有什么；真／假 codex 能拿到什么 usage | **中止路径**：worker 的 `AbortController`（`worker.ts:111`、`:121-129`）经 `AbortSignal.any` 进阶段（`runLoop.ts:326-331`）；`runCodexPhase` 杀进程组（`runCodexPhase.ts:85-86`、`:49`、`:59-65`），返回的 `PhaseOutcome` **没有 usage 字段**（类型 `:11-14`）；plan／verify 抛 `codex-aborted`（`codexAdapter.ts:15-16`）⇒ `PhaseExecutionError` ⇒ `runLoop.ts:1828-1838` 以无结果结算 ⇒ `tokenUsage:null`（`:1228`）；execute 被中止返回 `null`（`codexAdapter.ts:31`）⇒ `:1421-1423` 同样 null。**真 codex**：stdout 边到边追加进 `<evidenceDir>/events.jsonl`（`runCodexPhase.ts:43`、`:71`），但 usage 只从 `turn.completed.usage` 解（`protocol.ts:41-73`），且只在 `completed` 时解；ccloop 自报 `usageObservation:"phase-end"`（`command.ts:146`）、预算 `soft`（`command.ts:147`、`cli.ts:324`）⇒ 单 turn 的 `codex exec` 被中途杀，日志里多半**没有**任何 usage 行（推测，repo 里没有留下真 codex 的 events.jsonl 可证）。**fake codex**：唯一的 usage 行在最后打印（`fake-codex.mjs:38`、`:48`），在写文件与 final 之后 ⇒ 任何现有模式被中途杀都拿不到 usage | 读源（写作席只读调查，日志 `scratchpad/planner/c3/vitest-handoff-codex.log`：`handoff.test.ts`＋`tests/runtime/codex/` 7 文件 69 条全绿）；方案与建议见 §0.1 D-C3 |
| (11) | §13.2 I-7：续跑 prompt 里能否看到 continuation 约束 | **能**（plan 与 execute）：`prepareContinuationContract` 把 `CONTINUATION_CONSTRAINT` 追加进 `contract.context.constraints`（`materialize.ts:146`、`:151`），worker 在 `inputCheckpoint!==null` 时用它（`worker.ts:150-153`），plan／execute 的 prompt 打印 constraints（`prompts.ts:23`、`:39-40`）；verify 的 prompt **不**打印（`:50-71`）。fake codex 从 stdin 读 prompt（`fake-codex.mjs:6-9`）⇒ `<task>#continuation` 可行，verify 阶段退回 `<task>`。另：`continuation-input.json` 不进任何 prompt（只在 `relevantDocs`）——ccloop 侧的缺口，**登记** | ccloop 源，行号同左 |
| (12) | C6 之后 Orca 消费 `unresolvedRequestIds` 的所有位置 | `src/` 里：`schema.ts:37`、`types.ts:59`（类型）；`executionDriver.ts:405`（stepE 原样抄）；`checkpoints.ts:76`（settled 要求为空）；`cleanup.ts:11`；`handoff.ts:11`、`:19`（导出 packet 的值）；`schedulerBridge.ts:83`、`:97`、`:100`（legacy 路径，`?? ["terminal-evidence"]`）。C6 之后 handoff 候选恒为 `[]` ⇒ `checkpoints.ts:76` 与 H-settle 的第三条硬条件可满足；packet 与 candidate 两处一起改，导出的 handoff 与检查点不矛盾（§13.2 I-9）。**Orca 侧无需改码** | python 逐行扫描 `scratchpad/planner/scan/unresolved-orca.txt`（tests 里的命中全是夹具构造，不是消费方） |
| (13) | §13.2 C-1：规范字节能否同时满足三个读者 | 能：`canonicalBytes(c)` 与 `JSON.stringify(JSON.parse(canonicalBytes(c)))` 逐字节相同，行 hash ＝ `sha256Canonical(c)`；`JSON.stringify(c)` 与之不同（键序是 schema 的） | 探针 `scratchpad/planner/c1probe.log`：`{"equalBytes":true,"rowHashEqualsCanonical":true,"exportHashEquals":true,"stringifyDiffers":true}` |
| (14) | 会红的既有判据（现跑） | 见下方「会红的既有判据」两节 | `probe-summ.txt`、`probe-ws.log`、`probe-tsc.log`、`c6.json`／`c67-summ.txt` |
| (15) | 基线 | Orca（`ORCA_CCLOOP_BIN`＝控制器建的 ccloop `a5dc529` build，含 C1–C4；fake-codex `integration` 配置，0600，`/private/tmp/…`）：全量 vitest json **195 文件、1756/1756、RC 0**（web 先 build）。第一次跑（web 未 build、另有一席并发跑 ccloop 测试）：14 红 = 13 条 `controlMount`／`controlShutdown` 的 `panel-dist-missing`（web 未 build 的环境问题）＋ 1 条 `driverRecovery` 的「drives a retried run on … to settled」5 s 超时（负载）。ccloop 副本：63 文件、826/827，唯一红 `quiet execution proof > does not treat leader exit…`（在已知红名单内），`check-known-reds` RC 0 | 命令：`./node_modules/.bin/vitest run --reporter=json --outputFile=…`（Orca 副本 `scratchpad/planner/orca`；env 见 `scratchpad/planner/env.sh`）；日志 `scratchpad/planner/base/orca-summ2.txt`（1756/1756）、`orca-summ.txt`（第一次）、`ccloop-summ.txt`、`ccloop-known-reds.log` |

**负载型 flake（本次新观测，并入 handoff §三 的名单）**：三席并发跑测时，`tests/control/driverRecovery.test.ts` 的「drives a retried run on from where it was blocked, to settled」、`tests/control/driverLanding.test.ts` 的两条（「leaves the branch alone when it moved…」「recognises a landing it already made…」）、ccloop 的 `tests/validation/codexWatchdog.test.ts` 两条与 `tests/validation/evidence.test.ts` 四条都撞过默认超时；**单文件重跑全绿**（`scratchpad/planner/val-landing.log` 5/5；ccloop 无负载重跑 `c67-summ.txt` 未再出现）。⇒ 看到这些红，先单文件重跑。

### 会红的既有判据 —— Orca（现跑；本片授权改写，守人裁 88 (b)(c)：整条改写不许放宽、改后注释写明编码哪条人裁）

| 判据全名（文件 ＞ describe ＞ it） | 红因 | 在哪个 Task 改写 |
|---|---|---|
| `tests/control/executionDriver.test.ts` ＞ "Fix round 1 (task-4-review.md, 2026-09-25): refusals the first round left uncovered" ＞ "D21: blocks a continuation run before any provider attempt, by name" | A1 的 `continuation-unsupported` 门删了（spec §4） | T5 |
| `tests/control/stopIntent.test.ts` ＞ "one open handoff request per run and generation" ＞ "treats an active run whose only request already settled as a recovery blocker, not as permission for a second request" | `freezeRun` 不再整条拒命令，改记 run 级 blocker（§13.1 C-5）—— **复审席没列出这一条**，现跑才发现 | T3 |
| `web/tests/controlPanel.test.tsx` ＞ "ControlPanel" ＞ "shows handoff progress as pending/partial/unresolved and offers the batch continuation once requests settle" | 可续集合改看 `continuable`（§13.1 C-4），夹具的 settled run 没有该字段 | T8 |
| （typecheck，不是 vitest 判据）`tests/panel/webParity.test.ts:123` 的 `controlGroupWebToServer` 归一化 | `RunViewV1.continuable` 服务端必填、web 端可选，与 `blockedReason` 同一先例 | T8 |

**现跑确认不红**：`tests/panel/controlLifecycle.test.ts` 全部（含 `:236`，因为跳过判定排在 preserved-* 之后）、`tests/control/driverRecovery.test.ts`、`stopIntent.test.ts` 的 restartable 诸条、`resumeBundle`／`checkpointRecoverability` 的拒绝判据、`driverReconcile.test.ts:153`（零对方仍 `reconcile-other-side:0`）与 E1 的 `(reconciled with [ab])` 正则。探针：`orca-probe` 全量 195 文件 1754/1756（红的只有上表前两条）；`orca-val`（T3–T5 全部＋D-SNAP／D-VIEW）全量 198 文件 1781/1782，唯一红是 `driverRecovery` 那条负载超时（`val-summ.txt`）。

### 会红的既有判据 —— ccloop（**按 ccloop 人裁 88 由人指名**）

- **已由人指名（控制器转达，2026-09-25）并现跑确认会红**：`tests/control/handoff.test.ts` ＞ "mechanical handoff packet" ＞ "allows request:null only for natural terminal runs and retains handoff refs for every result"（C6；断言在 `:262`、`:264`；`c6.json`、`c67-summ.txt`）⇒ T1 改写。
- **已由人授权但现跑不红 ⇒ 不改**：同文件 ＞ "mechanical handoff packet" ＞ "derives blocked facts and explicit logs without an LLM call"（C7 只对非终态 run 生效，该判据的 run 是 `blocked_waiting_human`，终态）。
- **待人指名**：现跑 C5／C6／C7 之后**没有**别的 ccloop 判据红。C-3 的方案 (i) **没有**现跑（它要改 `runCodexPhase`／`codexAdapter`／`runLoop` 四处，见 T2）；T2 的第一步就是现跑并把红的判据全名交人指名 —— 读源推测的候选：`tests/runtime/codex/runCodexPhase.test.ts`（结果形状断言）、`tests/runtime/codex/adapter.test.ts`；`tests/control/handoff.test.ts` ＞ "named handoff request" ＞ "watches a latched deadline through packet, zero handoff usage, seal, and released lease" 用的是什么都不打印的 `hang` 模式，(i) 之下预期不红，(ii) 之下必红。**在人指名之前，T2 不许改任何既有判据。**

---

## §0.1 与 spec 的偏离（**控制器裁定**；标「建议」，计划正文按建议一栏写，裁定不同就改对应 Task）

| # | spec 原文／位置 | 实测事实 | 建议 |
|---|---|---|---|
| D-C3 | §13.1 C-3「本片就让 deadline 中止可续；机制由计划 Task 0 现量；候选 (i) ccloop 从被中止阶段已写出的 codex 日志取最后一次 usage 观测；(ii) 以可证明的上界结算」 | §0 (10)：(i) 在产生观测的一端可做（`runCodexPhase` 已把 stdout 落到 `events.jsonl`，只是不在中止时解析），但**真 codex 的 usage 是阶段末才有**，单 turn 被中途杀多半一行都没有 ⇒ (i) 对真 codex 实际拿不到数；fake codex 今天也拿不到（usage 最后才打印）。(ii) **不存在可证明的上界**：预算是 `soft`，ccloop 不给 codex 传任何 token 上限，活体记录里超出过 28,226 token（ccloop `docs/codex-adapter.md:78`）⇒ 只能是「按策略记账」；若按「剩余 grant」记，剩余 tokens 归零 ⇒ `registerContinuation` 因 `budget-overrun` 拒 ⇒ 续跑反而做不成 | **建议 (i)，并如实登记**：ccloop 在产生观测的一端取已写出日志里最后一条合法的 `turn.completed` usage，取不到就仍是 `null`（**不**当 0、**不**估）；fake codex 脚本加 `usageBeforeDelay:true`（先打印 usage 行再睡 `delayMs`），让 E2E 能走到「可续」。**必须同时报人**：真 codex 下 deadline 中止的 run 多半仍 `usage-unsettled` ⇒ `settled-unrecoverable`，且把组的 `usageUnknown` 置真（`budget.ts:71-74`、`webDispatch.ts:176-177`）⇒ 该组此后的领取都被挡 —— 人裁「本片就让它可续」在真 codex 下**做不到**，只在 fake codex 下成立。T2 写成门控 Task |
| D-C7′ | §13.1 C-2「进入过而文件不在的仍列 missing」＋ §12 判据增补「deadline 中止 ⇒ 可恢复 ⇒ 续跑落地」 | deadline 一定是在阶段**中途**中止（`delayMs` 大于 deadline），该阶段「进入过而文件不在」⇒ 按 C-2 原文仍列 missing ⇒ Orca 判不可续。execute 被中止时 `writeCompletedAttemptArtifacts(…, plan, null)` 不写 `execution.json`（`runLoop.ts:1421-1425`）。所以即使 D-C3 解决了 usage，这一例按 C-2 原文也做不成 | **建议**：C7 再加一条 —— 被 handoff deadline 中止的那个阶段（`events.jsonl` 里 `type:"handoff_interrupted"`、`detail` 形如 `handoff deadline interrupted <phase> in attempt <n>`，`runLoop.ts:1361`、`:1425`、`:1610`）不列 missing；工作树快照就是它留下的全部证据。这是对人裁 C-2 的**改动**，控制器裁定后须报人。放在 T2（与 D-C3 同门）。**T2 写作席在其副本 `scratchpad/planner/t12-clone`（T1＋T2(i)）里实跑证实**：execute 在 delay 中被 deadline 中止 ⇒ usage 事件 `[["work",15],["work",30],["handoff",0]]`（(i) 之后 usage 已知），但 candidate `missing` ＝ `["attempts/1/execution.json"]` ⇒ 仍不可续。两个候选：(α) 即本建议；(β) 保留 C-2 原文，把 §12 那例改成断言 `settled-unrecoverable`、删去「续跑落地」—— 两者都改人裁原文，须报人 |
| D-SNAP | §11 C2／§13.2 I-1「以 Web 感知的预留规则把剩余承诺挂为 held」；上游 Web §5.1.1 | §0 (2)：`terminaliseRun` 把 held 分配的额改成剩余；`readConfirmedTaskExecution`（`executionSnapshot.ts:268`）与读模型（`controlViews.ts:305`）都拿确认时冻结的分配**逐字段含额**比 ⇒ 任何可恢复的 handoff 之后，该组所有 run 的 A2／C／D 抛 `recovery-blocked`，面板整组拒读 `execution-snapshot-identity`（T7／T8 写作席独立撞到同一处） | **建议**：抽出 `frozenAllocationShape`，对 state ∈ {`held`,`continuing`,`terminal`} 的**任务**分配只不比 `amount`，其余字段、其余分配照比；两处共用。已在副本验证（T4 Step 6）。备选：让 `terminaliseRun` 不改额（会与 Web §5.1.1 原文和 `webContinuationAccounting` 的既有判据冲突，不建议） |
| D-VIEW | 同上 | `terminaliseRun` 把 `work.grant` 改成剩余，读模型 `run-work-identity`（`controlViews.ts:494`）要求每个 run 的 `grant` 与 `work.grant` 相等 ⇒ 前任 held 时、续跑领走后都拒读 | **建议**：只对 work 的 `currentRunId` 比；它若是 held 的前任（`settled-recoverable`），比它的 `remaining`；谱系里更早的 run 保留各自领取时的 grant、不再与 `work.grant` 比。已在副本验证（T4 Step 6、T5 第 1 条末尾的读模型断言） |
| D-LANDED | §13.2 I-3「`blockedAt ∈ {D,R,E}` ⇒ 按 C-5 收口（held、续跑重跑）」 | blocked 在 E（例如 `settle-incomplete`）或任何 `landedCommit` 非空的 run，改动**已经在 `orca/<g>` 上** ⇒ 按 C-5 挂 held 再续跑，会把同一改动再落一次，违反 §3「要么完整落地，要么完整留在检查点」 | **建议**：`landedCommit` 非空的 blocked run 不收口，请求保持开着（组停在 `handoff-pending`），由人 `recovery-retry` ⇒ E settle ⇒ C1 那一支 settle 请求。登记。T4 的 `closeBlocked` 第一行 |
| D-HASH | §13.2 I-5「contract 截到剩余 grant（取 min，contract 哈希按上游规则重算）」 | 上游规则（`executionDriver.ts:212-214`）是 A2 改写 `repoPath` 后**不重算**，envelope 的 `contractHash` 恒为冻结的 `derivedContractHash`；ccloop 只校验它的形状（`ccloop src/control/protocol.ts:147`），从不拿它比 contract | **建议**：照上游规则 —— 不重算；截后的 contract 随 envelope 一起落进规范记录（`writeCanonicalRecord`），可审计。T5 |
| D-STOPINSPECT | §3 `unknown` 行「仍 unknown ⇒ 等，计数同 B′」 | B′ 满 10 次是把 run block；stop 之下 block 没有意义（请求还得收口） | **建议**：stop 之下照 B′ 计数，满 `INSPECT_UNKNOWN_LIMIT` 把**请求**置 `outcome-unknown`（可由 `recovery-retry` 接手），run 不动；`inspect` 答 `accepted`／`stopped` 时只记 `executionId`、不重判 configHash（stop 只需执行身份）。T4 |
| D-TASKS | §13.2 I-6「只用 fake codex `.calls` 中解冲突脚本的条目数」 | `.calls` 只记阶段名（`fake-codex.mjs:24`），分不出哪个任务 | **建议**：C5 另写一份 `${marker}.tasks`（每次调用一行 `<phase> <命中的键或 ->`），`.calls` 的格式一字不改（E1 数它）；N2 的「恰好 2 次解冲突」数 `.tasks` 里 `execute reconcile-…` 的行。T1、T9 |
| D-STALE | §11 I7「尖端移动 ⇒ 清 reconcile 重落」的前提：重落时会重新 spawn 解冲突 | T6 写作席现跑（`scratchpad/planner/t6-clone`）：重落时 `beginReconcile` 复用同一个 `reconcile-<runId>` 目录，里面上一次的终态 `loop-state.json` 还在 ⇒ `stepR` 直接收集旧结果、不再 spawn（`driverLanding.ts:250-258`）⇒ 落地一棵基于**旧尖端**的树，**悄悄丢掉移动尖端的那个提交**（判据里 `person.txt` 消失），且同一次 spawn 被记账两次（`spawn-0`、`spawn-1`）。这是上游第一片的既有 bug | **建议**：`beginReconcile` 先删掉该 runs 目录（一行，可逆，T6 Step 7(d)，变异 T6-M10）。T6 已按此写；控制器若不采纳，T6 的 I7 判据要改成断言「被 block」而不是「记两次」 |
| D-SPAWNKEY | §13.2 I-6「`beginReconcile` 取已记账的 `reconcile-usage:<runId>:%` 行数为初值」 | T6 写作席读出：若某次 spawn 的进程死了、没有终态、因而从未记账，之后再被尖端移动重置，按「行数」取初值会与一个已记账的键撞上，那次 spawn 的 token 漏记 | **建议**：改取已记账键号的 **MAX**（SQL 在 T6 正文）。T6 按 spec 原文写「行数」并标注；控制器裁定 MAX 则改 T6 Step 7 那一行 |
| D-SKIP | §13.2 I-8 的 (i)「无既有 stop intent」 | T7 写作席现跑：在 preserved-* 分支之后，`intent === null` 与 `active.length === 0` 冗余，删它的变异是等价变异 | **建议**：保留（spec 点名、使该分支与位置无关），变异台账记「等价」 |
| D-RESUME-SHUTDOWN | §13.1 C-4／I-4「组 `handoff-complete` 且无可续项时显示 Resume (no continuation)」 | 面板今天对 `stopMode==="shutdown"` 的组不渲染任何续跑按钮 | **建议**：本片只对 `stopMode==="handoff"` 渲染（与人裁原文一致）；shutdown 冻结的非驱动环组的面板出口登记为已知缺口 |

**裁定（2026-09-25，控制器会话 `e5f56bfe`；全文记在 spec §13.4）**：D-C3 人裁「接受 (i)，如实登记」；D-C7′ 人裁 (α)；其余十行（D-SNAP、D-VIEW、D-LANDED、D-HASH、D-STOPINSPECT、D-TASKS、D-STALE、D-SPAWNKEY 取 **MAX**、D-SKIP、D-RESUME-SHUTDOWN）控制器按「建议」一栏采纳。⇒ **T2 的门已开**（D-C3／D-C7′ 已裁定并报人）；T2 第一步现跑出的 ccloop 红判据仍须人逐条指名。T6 Step 7 按 MAX 写。

**登记（不修，交人）**：真 codex 下 handoff 未验；真 codex 下 deadline 中止多半仍不可续（D-C3）；`continuation-input.json` 不进 ccloop 的任何 prompt（§0 (11)）；面板无「C 等 A」标记（§0 (5)）；stop 之后最多再起「stop 时 `collected` 的 run 数」次解冲突（§12(2)）；续跑会在失败 attempt 的改动上继续、越界检查把它一并算进去（§11 I6）；N 路续跑的解冲突无预留，上限不够时第 k 次被 `reconcile-budget` 阻断（§5.2 N3）；落地按组串行降低同组吞吐（N2）；人工重试可能多一次解冲突（Minor d）；宽限期 `killGraceMs + 60 s` 是控制器拍的；缩短后的 deadline 到不了 ccloop（§11 I4）；restartable 的 run 源目录 `<runsRoot>/<runId>` 留作现场（§7）；`.resume-staging-<uuid>` 崩溃残留（Minor b）。

---

## Global Constraints

- **范围只到 spec §2 的 ①–⑤**：按上下文阈值触发的 handoff、strict 组、打断解冲突 run、续跑前 rebase（方案 Y）、⑤ 预算预估链、fake claude（§12，另立一片）都不做。
- 驱动环只在 port `configured` 时存在；**没有未完 handoff 请求的 run，每一轮的行为逐字节同前**；`unconfigured` 下行为逐字节同前（关闭跳过以 `exemptDriverRuns` 为前提）。
- 常量：宽限期 `HANDOFF_EXTRA_GRACE_MS = 60_000`，装配时加上 adapter 的 `killGraceMs`；stop 之下的 inspect 计数沿用 `INSPECT_UNKNOWN_LIMIT = 10`；`handoffDeadlineAt` 缺省 `acceptedAt + 30 min`（Web §6.2，不改）。
- 一条原则（spec §3）：**一个 run 的改动，要么完整落地，要么完整留在检查点里交给续跑 —— 绝不半截落地。**
- H-settle 的检查点一律规范字节（`canonicalBytes`；§13.2 C-1），**不复用** `persistImmutableCheckpoint` 的 `JSON.stringify(c)`；**不经** `commitCandidate`（§11 C2）。
- 投递的请求体由原始 outbox 行确定性重建（§13.2 I-10）；驱动环**不调** `deliverHandoffStop`。
- 目录与 git（沿用上一片）：`runsRoot = <stateDir>.runs`、`workspacesRoot = <stateDir>.workspaces`（0700）；续跑 bundle 在 `<runsRoot>/<continuationRunId>/input/<checkpointId>`；进目标仓库的 git 命令带 `QUIET_GIT`；提交带 `ORCA_IDENTITY`；人的工作区、HEAD、index、`main` 一律不碰；`refs/heads/orca/<groupId>` 永不删。
- Rule 17：所有判据 `ORCA_CONTROL_DIR` 改道（`tests/setup/relocateUserData.ts` 已强制）；真 ccloop 的判据把 `HOME`／XDG 改道到临时目录并在每例后断言为空（照 `executionDriverE2E.test.ts`）；新建目录 0700、文件 0600；已存在的不改 mode。
- env（handoff §8.2）：`ORCA_CCLOOP_BIN` ＝ **含 C1–C7 的** ccloop `clone --local`＋`npm run build` 的 `dist/cli.js`（T9 Step 1 造）；`ORCA_CCLOOP_ADAPTER_CONFIG` ＝ `/private/tmp/…` 下 0600、`command` 指该副本 fake codex 的配置（realpath 必须等于自身）。T2 裁定并落地后，T9 的 deadline 一例改用含 T2 的 build。
- 诚实的验收表述（spec §2 末段，本计划不改）：「在 fake codex、soft 组下，对驱动环在跑的 group 发 `handoff-stop` …… N 路并行时最终内容含每一路的改动」。**真 codex 下的 handoff 不在本片验收之内**；deadline 中止的可续性在真 codex 下不成立（D-C3），不许说成「deadline 路径可续」。
- 既有判据改写：Orca 侧本片授权（spec §12），**只限 §0「会红的既有判据 —— Orca」表里那四处**；实施中另有既有判据红了 ⇒ **先停下报控制器**，不许自改。改写处上方加一行：
  `// Handoff delivery (human ruling 2026-09-25, spec §12: this slice may rewrite criteria; ruling 88 (b)(c)): <the fact it now encodes>`
- ccloop：守它自己的 `CLAUDE.md` 铁律（Rule 13 四件事、Rule 15 改既有判据须人指名到具体测试、Rule 16 只追加、Rule 17 变异只在副本、Rule 18 不替人宣布）；红线函数 `tryRecoverStaleOwnerTransferLock` 与人裁 83 删锁条件不碰；判据 `node scripts/check-known-reds.mjs <json>` RC 0。人已指名的只有 §0 那一条（C6）；其余一律「待人指名」。
- 代码、注释、commit message 英文；本计划与台账中文。
- 每笔提交 `git commit -F <file>`（不许多个 `-m`），消息结尾两行归属，**写实施席自己的模型**：
  `Co-Authored-By: <implementer's own model> <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR`（两行之间不空行）。
- **禁令（子代理同样适用）**：不许 push／amend／merge 进 main／删分支或 worktree（Tier 0；闸门会拦 Bash 里的 `git worktree remove`，连 scratchpad 里的也拦）；不许 kill 非己进程；不许调真 codex／真 claude；清单外的问题**只报不修**；验证性跑一律重定向到文件再整份读回（不许 `| tail`、`| grep`）；计数与找调用方用 python；git 用 `/usr/bin/git`；`rm`／`cp` 有 `-i` alias，用 `/bin/rm -rf`、`cat a > b`。
- 变异**只在 `git clone --local` 副本**里由单独的变异席做；每组先跑绿基线；落没落上去用 `shasum -a 256` 比；还原证明看副本 `git diff`／`git diff --cached` 字节数为 0（T10）。
- 负载：多席并发跑测会让若干真 git 判据撞 vitest 默认 5 s（§0 末段名单）；新判据文件一律给 describe 级超时；看到红先单文件重跑。

---

## File Structure

| 路径 | 动作 | 职责 | Task |
|---|---|---|---|
| ccloop `tests/fixtures/fake-codex.mjs` | 改（只加） | C5：`delayMs`、`<task>#continuation`、`${marker}.tasks`；（T2）`usageBeforeDelay` | T1、T2 |
| ccloop `src/control/handoff.ts` | 改 | C6 两处；C7 `enteredPhaseFiles`；（T2）D-C7′ | T1、T2 |
| ccloop `tests/control/handoff.test.ts` | 改写一条（人已指名） | C6 | T1 |
| ccloop `tests/runtime/codex/fakeCodexDelay.test.ts`、`tests/control/handoffEnteredPhases.test.ts` | 新 | C5、C7 判据 | T1 |
| ccloop `src/runtime/codex/runCodexPhase.ts`、`codexAdapter.ts`、`src/controller/runLoop.ts`（及判据） | 改（门控） | C-3 方案 (i) | T2 |
| `src/control/stopIntent.ts` | 改 | 导出三个；restartable 支（含续跑子支）；`freezeRun` 记 blocker；`settleCompletedRunRequestInTransaction`；`handoffRequestFromOutbox` | T3 |
| `src/control/checkpoints.ts` | 改（只加） | `persistCanonicalCheckpoint` | T3 |
| `src/control/resumeBundle.ts` | 改 | 接受 `settled-recoverable`；`readExistingResumeBundle` | T3 |
| `tests/control/stopIntent.test.ts` | 改写一条 | §13.1 C-5 | T3 |
| `tests/control/handoffStop.test.ts` | 新 | T3 判据 | T3 |
| `src/control/driverHandoff.ts` | 新 | H 步、H-settle、restartable、宽限期、blocked 分支轴 | T4 |
| `src/control/executionDriver.ts` | 改 | `CrashPoint`、deps、`collectInto`＋X1、`savedReport` 导出、遍历与分流（T4）；A1 去门、A2 续跑（T5） | T4、T5 |
| `src/control/executionSnapshot.ts`、`src/panel/controlViews.ts` | 改 | D-SNAP、D-VIEW（T4）；`continuable`（T8） | T4、T8 |
| `tests/control/fixtures/driverPort.ts` | 改（只加） | 合成 port 的 handoff 语义 | T4 |
| `tests/control/driverHandoff.test.ts` | 新 | T4 判据 | T4 |
| `src/control/startEnvelope.ts` | 改 | 第五个参数 `inputCheckpoint` | T5 |
| `tests/control/executionDriver.test.ts` | 改写 D21 | spec §4 | T5 |
| `tests/control/driverContinuation.test.ts` | 新 | T5 判据 | T5 |
| `src/scheduler/reconcile.ts` | 改（只加） | `planReconciliationOf`、`synthesizeReconcileContractOf` | T6 |
| `src/control/driveRecord.ts`、`src/control/driverLanding.ts` | 改 | `otherTaskIds`；N1、N2、单调 spawn 键、落地消息 | T6 |
| `tests/scheduler/reconcileParity.test.ts`、`tests/control/driverReconcileN.test.ts` | 新 | T6 判据 | T6 |
| `src/panel/controlLifecycle.ts`、`src/control/webProtocol.ts`、`web/src/controlTypes.ts` | 改 | 关闭跳过、`skipped-driver-owned`（T7）；`continuable`（T8） | T7、T8 |
| `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` | 文末追加 | `ERRATUM (handoff delivery, 2026-09-25)` | T7 |
| `tests/panel/shutdownDriverGroup.test.ts` | 新 | T7 判据 | T7 |
| `web/src/ControlGroupView.tsx`、`web/tests/controlPanel.test.tsx`（改写一条）、`tests/panel/webParity.test.ts`（归一化一行） | 改 | 面板可续集合、Resume (no continuation) | T8 |
| `tests/panel/runContinuable.test.ts`、`web/tests/handoffResume.test.tsx` | 新 | T8 判据 | T8 |
| `src/panel/controlAssembly.ts` | 改 | `handoffGraceMs` | T9 |
| `tests/control/handoffE2E.test.ts`（及 T9 列出的小文件） | 新 | 真 ccloop 的 H1–H7、deadline（门控）、R-H | T9 |
| `.superpowers/sdd/2026-09-25-handoff-delivery/progress.md` | 新（`git add -f` 单独） | 变异台账 | T10 |

**依赖顺序**：T1 → T3 → T4 → T5 → T6 → T7 → T8 → T9（要 T1 的 ccloop build）→ T10。T2 **只在控制器裁定 D-C3／D-C7′ 并报人之后**做，做完后 T9 的 deadline 一例才解门。T7、T8 只依赖 T3／T4 的类型，可与 T5、T6 并行写，但**同一工作树里一次只一席**（Rule 13）。

---

## Task 1：ccloop C5＋C6＋C7（仓库 `/Users/biran/code/skills/loop/ccloop`，守它自己的铁律）

> **归属**：Orca 控制器会话 `e5f56bfe` 的计划席，2026-09-25。观测锚点 ccloop `a5dc529`（主题行 `docs(handoff): roll the Orca section: real codex ran through control once; Orca's handoff slice needs C5 and C6 here`）。
> 本 Task 的全部代码已由计划席在 `scratchpad/planner/t12-clone/`（ccloop `a5dc529` 的 `git clone --local`，`node_modules` 软链）里写过、跑过、变异过；日志名见各步。**实施者在真仓库里做；变异只在 ccloop 的 `git clone --local` 副本里做（ccloop Rule 17），真仓库工作树全程零变异。**
> 守 ccloop 规则：Rule 15（既有判据只改人**指名**的那一条，整条改写、不许放宽、注释写明人裁）、Rule 16（历史／已发布文本只追加；改判据前全树扫描）、Rule 17（变异只在副本）、Rule 13（不 push、不合并、不删分支）。

**Files:**
- Modify: `tests/fixtures/fake-codex.mjs`（`:3` 之后加常量一行；`:24` 之后到 `:50` 的结尾整段替换为下文 Step 5 的代码 —— C5／I-7）
- Modify: `src/control/handoff.ts`（`retainCodexLogs` 结束的 `:241` 与 `buildHandoffPacket` 的 `:243` 之间插入 `enteredPhaseFiles`；`:261` 的 `if (runState.currentAttempt > 0) {` 块内加两处；`:288`、`:310` 各改一行 —— C7、C6）
- Modify（**人指名改写**，唯一一条）: `tests/control/handoff.test.ts` > "mechanical handoff packet" > "allows request:null only for natural terminal runs and retains handoff refs for every result"（`:245`；断言在 `:262`、`:264`）
- Create: `tests/runtime/codex/fakeCodexDelay.test.ts`（5 条）、`tests/control/handoffEnteredPhases.test.ts`（6 条）

**Interfaces:**
- Consumes: `buildHandoffPacket(envelope, request, runState, usageHighWater, result?)`（`handoff.ts:243`）、`finalizeHandoffCandidate(envelope, request, runState, {result, usageHighWater})`、`isTerminalRunStatus`（`handoff.ts:4` 已导入）、`readPrivateFile(sourceDir, path)`（`handoff.ts:6` 已导入）；runLoop 事件 `execute_started`（`runLoop.ts:1409`）、`execution_finished`（`runLoop.ts:1589`），detail 都是 `attempt <n>`，经 `appendEvent` 追加到 `<runDir>/events.jsonl`（`src/persistence/fileStore.ts:86-87`）；ccloop 续跑约束常量 `CONTINUATION_CONSTRAINT`（`src/control/materialize.ts:146`，由 `prepareContinuationContract` 追加进 `contract.context.constraints`，plan／execute prompt 以 `- <text>` 列出，verify prompt 不列 —— `src/runtime/claude/prompts.ts:22-23,39-40`）。
- Produces:
  - fake codex `script` 模式（`command = [node, fake-codex.mjs, "script", <marker>, <scriptPath>]`）：脚本条目 `{ files?: {<path>: <content>}, delayMs?: { plan?: number; execute?: number; verify?: number } }`；按本阶段 prompt 里的任务行（plan `^Plan one isolated L2 attempt for task (.+)\.$`、execute `^Execute one isolated attempt for task (.+)\.$`、verify `^Verify task (.+)\.$`）取任务 id；prompt 含续跑约束原文时先取 `<task>#continuation`，没有再取 `<task>`；`delayMs[phase]` 存在 ⇒ 该阶段在写任何东西（脚本文件、`-o` 终答、stdout 事件）**之前** sleep；`<marker>.calls` 的格式与时机一字不改（仍在 delay 之前追加 `phase\n`）；**新文件** `<marker>.tasks` 每次 script 调用追加一行 `<phase> <命中的条目键或 ->`（例 `plan a#continuation`、`execute reconcile-a-b`、`execute -`）—— 供 E2E 的 N2 计数（spec §13.2 I-6）；无条目只对 execute 报错（exit 3，同前）。
  - C6：candidate 与 packet 的 `unresolvedRequestIds` 恒为 `[]`（spec §12(1)、§13.2 I-9）；`result` 语义不变。
  - C7：`request !== null && !isTerminalRunStatus(runState.status)` 时，当前 attempt 只把**进入过**的阶段文件纳入 `retain`／`missing`：`plan.json` 恒纳入（`currentAttempt>0` 才进这段）；`execution.json` 在 `events.jsonl` 有 `{"type":"execute_started","detail":"attempt <n>"}` 之后纳入；`verify.json` 在 `{"type":"execution_finished","detail":"attempt <n>"}` 之后纳入。终态 run（含 `request:null`）逐字节同前：三份都要。

- [ ] **Step 1：开工核对**（结果写进本席交付报告）

```bash
cd /Users/biran/code/skills/loop/ccloop
S="${SCRATCH:?set SCRATCH to the session scratchpad}"
/usr/bin/git status --short > "$S/t1-start.txt" 2>&1; echo "RC=$?" >> "$S/t1-start.txt"
/usr/bin/git log --oneline -3 >> "$S/t1-start.txt" 2>&1
python3 - >> "$S/t1-start.txt" 2>&1 <<'EOF'
import re
checks = [
  ("tests/fixtures/fake-codex.mjs", r'^const mode=process\.argv\[2\], marker=process\.argv\[3\];$'),
  ("tests/fixtures/fake-codex.mjs", r'^  appendFileSync\(marker\+"\.calls",phase\+"\\n"\);$'),
  ("tests/fixtures/fake-codex.mjs", r'^  if\(mode==="script" && phase==="execute"\) \{$'),
  ("src/control/handoff.ts", r'^export async function buildHandoffPacket\($'),
  ("src/control/handoff.ts", r'unresolvedRequestIds: request === null \|\| (options\.)?result === "complete"'),
  ("src/control/materialize.ts", r'^const CONTINUATION_CONSTRAINT='),
  ("src/controller/runLoop.ts", r'"execute_started", `attempt \$\{attempt\}`'),
  ("src/controller/runLoop.ts", r'"execution_finished", `attempt \$\{attempt\}`'),
  ("tests/control/handoff.test.ts", r'it\("allows request:null only for natural terminal runs'),
  ("tests/control/handoff.test.ts", r'toEqual\(result === "complete" \? \[\] : \["request-1"\]\)'),
]
for path, pattern in checks:
    hits = [i for i, line in enumerate(open(path, encoding="utf8"), 1) if re.search(pattern, line)]
    print(path, pattern, hits)
EOF
echo "RC=$?" >> "$S/t1-start.txt"; cat "$S/t1-start.txt"
```

期望（计划席在 `a5dc529` 上现测）：工作树干净；命中行 `fake-codex.mjs` `[3]`、`[24]`、`[25]`；`handoff.ts` `[243]`、`[288, 310]`；`materialize.ts` `[146]`；`runLoop.ts` `[1409]`、`[1589]`；`handoff.test.ts` `[245]`、`[262, 264]`。**HEAD 不是 `a5dc529` 或任一行号漂移 ⇒ 以现测为准改落点；任一锚点命中数不是 1（或 2 处的那两条不是 2）⇒ 停下报告。**

- [ ] **Step 2：全树扫描（ccloop Rule 16：改判据前，扫描清单从被更正的句子机械导出）**

被更正的句子是「`result` 不是 `complete` 就把自己的请求列进 `unresolvedRequestIds`」与「非终态 handoff 的 `missing` 含当前 attempt 全部三份阶段文件」。

```bash
cd /Users/biran/code/skills/loop/ccloop
S="${SCRATCH:?}"
/usr/bin/git grep -n "unresolvedRequestIds" -- . > "$S/t1-scan.txt" 2>&1; echo "RC=$?" >> "$S/t1-scan.txt"
/usr/bin/git grep -n -e "missing" --and -e "handoff\|candidate\|packet" -- docs src/control >> "$S/t1-scan.txt" 2>&1; echo "RC=$?" >> "$S/t1-scan.txt"
cat "$S/t1-scan.txt"
```

期望（计划席现测，`scratchpad/planner/t1-scan.txt`、`t1-scan2.txt`）：`unresolvedRequestIds` 命中 `docs/handoff/handoff.md:425`（描述 C6 本身，**不改**）、`src/control/command.ts:97`（schema，不变）、`src/control/handoff.ts:46,64`（类型，不变）、`:288,:310`（本 Task 改）、`tests/control/handoff.test.ts:262,264`（本 Task 人指名改写）；`missing` 交 handoff 命中只有 `docs/ccloop-v2-review-backlog.md:62`（无关）与 `src/control/handoff.ts:292`（返回值，不变）。**多出任何一处陈述旧行为的文字 ⇒ 停下列给控制器，不自改。**

- [ ] **Step 3：写两份新判据，并按人指名改写那一条既有判据**

`tests/runtime/codex/fakeCodexDelay.test.ts`（整份新建）：

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Orca handoff delivery (2026-09-25), ccloop change C5 and spec §13.2 I-7: fake codex script entries may
// delay a named phase before it writes anything, and a `<task>#continuation` entry is chosen when the
// prompt carries ccloop's continuation constraint. Additive only (ccloop Rule 15): the existing script
// criteria in fakeCodexScript.test.ts and every other mode's criteria are untouched.
const fake = fileURLToPath(new URL("../../fixtures/fake-codex.mjs", import.meta.url));
const materializeSource = fileURLToPath(new URL("../../../src/control/materialize.ts", import.meta.url));
const CONTINUATION = "Treat continuation input fields unfinished, pendingDecisions, and awaitingHuman as required planning inputs.";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

// The fixture tells phases apart by the output schema, exactly as ccloop's phase schemas differ.
const schemas = {
  plan: { type: "object", properties: { summary: {}, primaryTargetPaths: {} } },
  execute: { anyOf: [{}] },
  verify: { type: "object", properties: { approved: {} } },
} as const;
const prompts = {
  plan: (task: string) => `Return JSON only.\nPlan one isolated L2 attempt for task ${task}.\nGoal: x\n`,
  execute: (task: string) => `Return JSON only.\nExecute one isolated attempt for task ${task}.\nGoal: x\n`,
  verify: (task: string) => `Return JSON only.\nVerify task ${task}.\nGoal: x\n`,
} as const;
type Phase = keyof typeof schemas;

interface Launched { child: ChildProcess; cwd: string; startedAt: number; done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; elapsedMs: number }> }

async function launch(phase: Phase, prompt: string, script: Record<string, unknown>): Promise<Launched> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "fake-codex-delay-")));
  roots.push(cwd);
  const scriptPath = join(cwd, "script.json"), schemaPath = join(cwd, "schema.json");
  await writeFile(scriptPath, JSON.stringify(script));
  await writeFile(schemaPath, JSON.stringify(schemas[phase]));
  const startedAt = Date.now();
  const child = spawn(process.execPath, [fake, "script", join(cwd, "marker.json"), scriptPath, "exec", "-o", join(cwd, "final.json"), "--output-schema", schemaPath], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout!.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; elapsedMs: number }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr, elapsedMs: Date.now() - startedAt }));
  });
  child.stdin!.end(prompt);
  return { child, cwd, startedAt, done };
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

describe("fake codex script delay and continuation entries (Orca handoff delivery C5, I-7)", () => {
  it("keeps its continuation marker text identical to the constraint ccloop adds to a continuation contract", async () => {
    // If ccloop's constant drifts, the #continuation lookup would silently never match again.
    expect(await readFile(materializeSource, "utf8")).toContain(`const CONTINUATION_CONSTRAINT="${CONTINUATION}";`);
  });

  it("sleeps delayMs for the named phase of every phase kind before answering, and only for that phase", { timeout: 20_000 }, async () => {
    for (const phase of ["plan", "execute", "verify"] as const) {
      const launched = await launch(phase, prompts[phase]("a"), { a: { files: { "a.txt": "A\n" }, delayMs: { [phase]: 600 } } });
      const result = await launched.done;
      expect(result.code).toBe(0);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(600);
      expect(await exists(join(launched.cwd, "final.json"))).toBe(true);
      expect(result.stdout).toContain('"turn.completed"');
    }
    // A delay named for another phase does not slow this one down.
    const other = await launch("execute", prompts.execute("a"), { a: { files: { "a.txt": "A\n" }, delayMs: { plan: 20_000, verify: 20_000 } } });
    const quick = await other.done;
    expect(quick.code).toBe(0);
    expect(quick.elapsedMs).toBeLessThan(15_000);
    expect(await readFile(join(other.cwd, "a.txt"), "utf8")).toBe("A\n");
  });

  it("writes no script file, no final answer and no events when killed during the delay", { timeout: 15_000 }, async () => {
    const launched = await launch("execute", prompts.execute("a"), { a: { files: { "a.txt": "A\n" }, delayMs: { execute: 10_000 } } });
    // The call is recorded before the delay starts: that is the moment the phase is "entered".
    await expect.poll(async () => exists(join(launched.cwd, "marker.json.calls")), { timeout: 5_000 }).toBe(true);
    launched.child.kill("SIGTERM");
    const result = await launched.done;
    expect(result.signal).toBe("SIGTERM");
    expect(result.elapsedMs).toBeLessThan(10_000);
    expect(await exists(join(launched.cwd, "a.txt"))).toBe(false);
    expect(await exists(join(launched.cwd, "final.json"))).toBe(false);
    expect(result.stdout).toBe("");
    expect(await readFile(join(launched.cwd, "marker.json.calls"), "utf8")).toBe("execute\n");
  });

  it("chooses the #continuation entry only when the prompt carries the continuation constraint", { timeout: 15_000 }, async () => {
    const script = { a: { files: { "a.txt": "first\n" } }, "a#continuation": { files: { "a.txt": "continued\n" } } };
    const continued = await launch("execute", `${prompts.execute("a")}Constraints:\n- ${CONTINUATION}\n`, script);
    expect((await continued.done).code).toBe(0);
    expect(await readFile(join(continued.cwd, "a.txt"), "utf8")).toBe("continued\n");
    const first = await launch("execute", prompts.execute("a"), script);
    expect((await first.done).code).toBe(0);
    expect(await readFile(join(first.cwd, "a.txt"), "utf8")).toBe("first\n");
    // Which entry answered is recorded per call in `<marker>.tasks`; `.calls` keeps its phase-only format.
    expect(await readFile(join(continued.cwd, "marker.json.tasks"), "utf8")).toBe("execute a#continuation\n");
    expect(await readFile(join(first.cwd, "marker.json.tasks"), "utf8")).toBe("execute a\n");
    expect(await readFile(join(continued.cwd, "marker.json.calls"), "utf8")).toBe("execute\n");
    // The continuation entry's delay applies only to the continuation call.
    const delayed = { a: { files: { "a.txt": "first\n" } }, "a#continuation": { files: { "a.txt": "continued\n" }, delayMs: { plan: 3_000 } } };
    const plain = await launch("plan", prompts.plan("a"), delayed);
    expect((await plain.done).elapsedMs).toBeLessThan(3_000);
    const resumed = await launch("plan", `${prompts.plan("a")}Constraints:\n- ${CONTINUATION}\n`, delayed);
    expect((await resumed.done).elapsedMs).toBeGreaterThanOrEqual(3_000);
  });

  it("falls back to the plain entry without a #continuation entry, and still refuses an execute with neither", async () => {
    const fallback = await launch("execute", `${prompts.execute("a")}Constraints:\n- ${CONTINUATION}\n`, { a: { files: { "a.txt": "plain\n" } } });
    expect((await fallback.done).code).toBe(0);
    expect(await readFile(join(fallback.cwd, "a.txt"), "utf8")).toBe("plain\n");
    const refused = await launch("execute", `${prompts.execute("c")}Constraints:\n- ${CONTINUATION}\n`, { a: { files: { "a.txt": "plain\n" } } });
    const result = await refused.done;
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("fake-codex script has no entry for task c");
    expect(await readFile(join(refused.cwd, "marker.json.tasks"), "utf8")).toBe("execute -\n");
    expect(await exists(join(refused.cwd, "final.json"))).toBe(false);
    // Plan and verify without an entry answer as before (only execute needs one).
    const plan = await launch("plan", prompts.plan("c"), { a: { files: { "a.txt": "plain\n" } } });
    expect((await plan.done).code).toBe(0);
    expect(await exists(join(plan.cwd, "final.json"))).toBe(true);
  });
});
```

`tests/control/handoffEnteredPhases.test.ts`（整份新建）：

```ts
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { LoopContract } from "../../src/contract/schema.js";
import { buildHandoffPacket, finalizeHandoffCandidate } from "../../src/control/handoff.js";
import { readEvidence } from "../../src/control/evidence.js";
import { canonicalHash, type HandoffRequestV1, type StartEnvelopeV1 } from "../../src/control/protocol.js";
import { writeAccepted } from "../../src/control/store.js";
import type { RunState } from "../../src/state/types.js";

// Orca handoff delivery (2026-09-25), ccloop changes C7 (spec §13.1 C-2, human ruling) and C6 (spec §12(1),
// §13.2 I-9). Additive only (ccloop Rule 15). C7: a handoff of a run that is not terminal lists as missing
// only the current attempt's phase files that the attempt ENTERED (plan once the attempt exists; execute on
// its `execute_started`; verify on its `execution_finished`); an entered phase whose file is absent is still
// missing; terminal runs require all three files exactly as before. C6: the candidate answers its request.
const execFileAsync = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(): Promise<{ runDir: string; envelope: StartEnvelopeV1; request: HandoffRequestV1 }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-handoff-entered-")));
  roots.push(root);
  const repo = join(root, "repo"), sourceDir = join(root, "source"), runDir = join(sourceDir, "run");
  await mkdir(repo);
  await mkdir(join(sourceDir, "input"), { recursive: true });
  await mkdir(runDir);
  await execFileAsync("git", ["init", "-q"], { cwd: repo });
  const contract: LoopContract = {
    objective: { taskId: "task-1", goal: "finish work", successCondition: "all checks pass", nonGoals: [] },
    context: { repoPath: repo, targetPaths: ["value.txt"], relevantDocs: [], buildTestCommands: ["npm test"], constraints: [] },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 2, perAttemptTimeoutMs: 2_000, totalRuntimeBudgetMs: 5_000, tokenBudget: 1_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 100 },
    safetyPolicy: { allowlistPaths: ["value.txt"], denylistPaths: [], maxFilesTouched: 2, humanGateConditions: [] },
    verification: { verifierType: "agent", requiredChecks: ["npm test"], rejectOn: ["failure"], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
  };
  const amount = { tokens: 10, activeMs: 20, attempts: 2, sessions: 1 };
  const config = { command: [process.execPath], model: "fixture", budgetMode: "soft", sandbox: "workspace-write", timeoutMs: 1_000, killGraceMs: 10 };
  const envelope: StartEnvelopeV1 = {
    protocol: 1,
    claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 2, graphVersion: 3, targetVersion: 4, commandId: "command-1", configHash: canonicalHash(config), grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
    contractHash: "b".repeat(64),
    inputCheckpoint: null,
    work: { contract, targetRepo: repo, base: "main", sourceDir },
  };
  await writeAccepted(sourceDir, {
    protocol: 1, envelopeHash: canonicalHash(envelope), executionId: "execution-fixture", configHash: envelope.claim.configHash,
    generation: envelope.claim.generation, acceptedAt: new Date().toISOString(), launch: "intended", worker: null,
  });
  const request: HandoffRequestV1 = { protocol: 1, requestId: "request-1", runId: "run-1", generation: 2, reason: "human", deadlineAt: new Date(Date.now() + 60_000).toISOString() };
  return { runDir, envelope, request };
}

function state(status: RunState["status"], currentAttempt = 1): RunState {
  return {
    status, currentAttempt, attemptsUsed: currentAttempt, lastTransitionAt: new Date().toISOString(),
    waitingOnHuman: status === "blocked_waiting_human", stopReason: status === "blocked_waiting_human" ? "review" : null,
    budgetSnapshot: { attemptsRemaining: 1, timeRemainingMs: 1_000, tokenBudgetRemaining: 100 }, recentFailures: [],
  };
}

/** The run directory as runLoop leaves it: events with runLoop's own types and `attempt <n>` details, plus the named phase files. */
async function runDirWith(runDir: string, events: Array<[type: string, attempt: number]>, runState: RunState, files: Record<number, string[]>): Promise<void> {
  await writeFile(join(runDir, "events.jsonl"), events.map(([type, attempt]) => `${JSON.stringify({ type, at: new Date().toISOString(), detail: `attempt ${attempt}` })}\n`).join(""));
  await writeFile(join(runDir, "loop-state.json"), JSON.stringify(runState));
  await writeFile(join(runDir, "loop-contract.json"), "{}");
  for (const [attempt, names] of Object.entries(files)) {
    await mkdir(join(runDir, "attempts", attempt), { recursive: true });
    for (const name of names) await writeFile(join(runDir, "attempts", attempt, name), "{}");
  }
}

describe("handoff packet of a run stopped between phases (ccloop C7)", () => {
  it("does not list the execute and verify files of an attempt stopped at the boundary after plan", async () => {
    const f = await fixture();
    const runState = state("planning");
    await runDirWith(f.runDir, [], runState, { 1: ["plan.json"] });
    const built = await buildHandoffPacket(f.envelope, f.request, runState, 3);
    expect(built.missing).toEqual([]);
    expect(built.artifacts.length).toBeGreaterThanOrEqual(4);
  });

  it("does not list the verify file of an attempt stopped after execute, once execute was entered and wrote its file", async () => {
    const f = await fixture();
    const runState = state("executing");
    await runDirWith(f.runDir, [["attempt_started", 1], ["execute_started", 1]], runState, { 1: ["plan.json", "execution.json"] });
    expect((await buildHandoffPacket(f.envelope, f.request, runState, 3)).missing).toEqual([]);
  });

  it("still lists an entered phase whose file is absent: execute, and verify after execution_finished", async () => {
    const f = await fixture();
    const executing = state("executing");
    await runDirWith(f.runDir, [["attempt_started", 1], ["execute_started", 1]], executing, { 1: ["plan.json"] });
    expect((await buildHandoffPacket(f.envelope, f.request, executing, 3)).missing).toEqual(["attempts/1/execution.json"]);

    const g = await fixture();
    const verifying = state("verifying");
    await runDirWith(g.runDir, [["attempt_started", 1], ["execute_started", 1], ["execution_finished", 1]], verifying, { 1: ["plan.json", "execution.json"] });
    expect((await buildHandoffPacket(g.envelope, g.request, verifying, 3)).missing).toEqual(["attempts/1/verify.json"]);
  });

  it("counts only the current attempt's events as entered", async () => {
    const f = await fixture();
    const runState = state("planning", 2);
    // Attempt 1 entered execute and verify; attempt 2 was stopped after its plan.
    await runDirWith(f.runDir, [["attempt_started", 1], ["execute_started", 1], ["execution_finished", 1]], runState, { 1: ["plan.json", "execution.json", "verify.json"], 2: ["plan.json"] });
    expect((await buildHandoffPacket(f.envelope, f.request, runState, 3)).missing).toEqual([]);
  });

  it("keeps requiring all three phase files for terminal runs, with or without a request", async () => {
    const f = await fixture();
    const blocked = state("blocked_waiting_human");
    await runDirWith(f.runDir, [], blocked, { 1: ["plan.json"] });
    expect((await buildHandoffPacket(f.envelope, f.request, blocked, 3)).missing).toEqual(["attempts/1/execution.json", "attempts/1/verify.json"]);
    const succeeded = state("succeeded");
    await runDirWith(f.runDir, [], succeeded, { 1: ["plan.json"] });
    expect((await buildHandoffPacket(f.envelope, null, succeeded, 3)).missing).toEqual(["attempts/1/execution.json", "attempts/1/verify.json"]);
  });
});

describe("handoff candidate of a deadline-interrupted run (ccloop C6 with C7)", () => {
  it("answers its request: result stays partial, no unresolved request on candidate or packet, nothing missing", async () => {
    const f = await fixture();
    const runState = state("executing");
    await runDirWith(f.runDir, [["attempt_started", 1], ["execute_started", 1]], runState, { 1: ["plan.json", "execution.json"] });
    const candidate = await finalizeHandoffCandidate(f.envelope, f.request, runState, { result: "partial", usageHighWater: 9 });
    expect(candidate.result).toBe("partial");
    expect(candidate.terminalOutcome).toBe("executing");
    expect(candidate.unresolvedRequestIds).toEqual([]);
    expect(candidate.missing).toEqual([]);
    const packet = JSON.parse((await readEvidence(f.envelope.work.sourceDir, candidate.handoff)).toString("utf8"));
    expect(packet.request).toEqual(f.request);
    expect(packet.unresolvedRequestIds).toEqual([]);
  });
});
```

`tests/control/handoff.test.ts`：**只动** "mechanical handoff packet" > "allows request:null only for natural terminal runs and retains handoff refs for every result" 这一条（ccloop 人裁 88，人 2026-09-25 经 Orca 控制器会话 `e5f56bfe` 指名，spec §13.1 末条）。整条改写后如下（`it(` 上方加一行注释；两条断言改为 `[]`；另加一条 `packet.request` 断言 —— 其余断言一字不动，**只加强不放宽**）：

```ts
  // ccloop ruling 88: rewrite authorized 2026-09-25 by the human through the Orca controller session e5f56bfe (Orca handoff delivery spec §12(1), §13.1, §13.2 I-9); whole-criterion rewrite, not weaker: a candidate answers the request it was built for, so neither the candidate nor its packet lists that request as unresolved, for every result.
  it("allows request:null only for natural terminal runs and retains handoff refs for every result", async () => {
    const f = await fixture();
    await mkdir(f.runDir, { recursive: true });
    await writeFile(join(f.runDir, "events.jsonl"), "");
    await writeFile(join(f.runDir, "loop-state.json"), JSON.stringify(state("succeeded")));
    expect((await buildHandoffPacket(f.envelope, null, state("succeeded"), 0)).packet.request).toBeNull();
    await expect(buildHandoffPacket(f.envelope, null, state("planning"), 0)).rejects.toThrow("control-handoff-request-required");

    for (const result of ["complete", "partial", "failed"] as const) {
      const candidate = await finalizeHandoffCandidate(f.envelope, f.request, state("blocked_waiting_human", "review"), {
        result,
        usageHighWater: 9,
      });
      expect(candidate.result).toBe(result);
      expect(candidate.handoff).toMatchObject({ artifactId: expect.stringMatching(/^evidence-/) });
      expect(candidate.artifacts).toContainEqual(candidate.handoff);
      expect(candidate.stopProof).toBeNull();
      expect(candidate.unresolvedRequestIds).toEqual([]);
      const packet = JSON.parse((await readEvidence(f.envelope.work.sourceDir, candidate.handoff)).toString("utf8"));
      expect(packet.unresolvedRequestIds).toEqual([]);
      // The request is answered, not dropped: the packet still names it.
      expect(packet.request).toEqual(f.request);
    }
  });
```

即相对 `a5dc529` 的 diff（逐字）：

```diff
diff --git a/tests/control/handoff.test.ts b/tests/control/handoff.test.ts
index fa04900..c137480 100644
--- a/tests/control/handoff.test.ts
+++ b/tests/control/handoff.test.ts
@@ -242,6 +242,7 @@ describe("mechanical handoff packet", () => {
     expect(built.missing).toContain("attempts/1/execution.json");
   });
 
+  // ccloop ruling 88: rewrite authorized 2026-09-25 by the human through the Orca controller session e5f56bfe (Orca handoff delivery spec §12(1), §13.1, §13.2 I-9); whole-criterion rewrite, not weaker: a candidate answers the request it was built for, so neither the candidate nor its packet lists that request as unresolved, for every result.
   it("allows request:null only for natural terminal runs and retains handoff refs for every result", async () => {
     const f = await fixture();
     await mkdir(f.runDir, { recursive: true });
@@ -259,9 +260,11 @@ describe("mechanical handoff packet", () => {
       expect(candidate.handoff).toMatchObject({ artifactId: expect.stringMatching(/^evidence-/) });
       expect(candidate.artifacts).toContainEqual(candidate.handoff);
       expect(candidate.stopProof).toBeNull();
-      expect(candidate.unresolvedRequestIds).toEqual(result === "complete" ? [] : ["request-1"]);
+      expect(candidate.unresolvedRequestIds).toEqual([]);
       const packet = JSON.parse((await readEvidence(f.envelope.work.sourceDir, candidate.handoff)).toString("utf8"));
-      expect(packet.unresolvedRequestIds).toEqual(result === "complete" ? [] : ["request-1"]);
+      expect(packet.unresolvedRequestIds).toEqual([]);
+      // The request is answered, not dropped: the packet still names it.
+      expect(packet.request).toEqual(f.request);
     }
   });
 });
```

**不改写** 同 describe 的 "derives blocked facts and explicit logs without an LLM call"：人对它的授权以「现跑确实红」为条件（spec §13.1），而它的 run 是 `blocked_waiting_human`（终态），C7 对终态逐字节同前 —— 计划席在探针副本 `ccloop-probe`（C6＋C7）的全量里测得它**绿**（`scratchpad/planner/c67.json`／`c67-kr.log`：唯一非名单红是 C6 那条），在 `t12-clone` 的全量里也绿（`t12-full.json`）。**该授权未使用，留档。**

- [ ] **Step 4：跑新判据与改写后的那一条，看见红**

```bash
cd /Users/biran/code/skills/loop/ccloop
./node_modules/.bin/vitest run tests/runtime/codex/fakeCodexDelay.test.ts tests/control/handoffEnteredPhases.test.ts tests/control/handoff.test.ts > "${SCRATCH:?}/t1-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t1-red.log"; cat "${SCRATCH:?}/t1-red.log"
```

预言（计划席在未改源码的副本上实测，`scratchpad/planner/t12-red.log`：17 条里 9 红 8 绿，RC=1）。红：`fakeCodexDelay` 的 "sleeps delayMs…"、"writes no script file…"、"chooses the #continuation entry…"；`handoffEnteredPhases` 的 "does not list the execute and verify files…"、"does not list the verify file…"、"still lists an entered phase…"、"counts only the current attempt's events…"、"answers its request…"；`handoff.test.ts` 改写的那一条。绿：`fakeCodexDelay` 的 "keeps its continuation marker text identical…"（钉常量不漂移）与 "falls back to the plain entry…"（旧行为本来如此 —— 它钉的是「退回 `<task>` 一字不改」）；`handoffEnteredPhases` 的 "keeps requiring all three phase files for terminal runs…"（同理，钉终态不变）；`handoff.test.ts` 其余 5 条。**实际与预言逐条比，不一致就停下报告。**（`.tasks` 的断言是计划席在这次红跑之后加的；按预言它落在已红的两条里，不改变红／绿划分。）

- [ ] **Step 5：实现**

`tests/fixtures/fake-codex.mjs` 改后全文（新 `:1-3` ＝原 `:1-3`；新 `:5-25` ＝原 `:4-24`；新 `:43-61` ＝原 `:31-49`，这些行字节不变。新增：`:4` 常量；`:26-40` 注释、查表与 `.tasks`（取代原 `:25-28`）；`:41` 与 `:62` 的 `respond` 包裹；`:42` 即原 `:29` 的写文件，移进 `respond`；`:63-64` 的 delay 分派）：

```js
import { appendFileSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
const mode=process.argv[2], marker=process.argv[3];
const CONTINUATION="Treat continuation input fields unfinished, pendingDecisions, and awaitingHuman as required planning inputs.";
const args=process.argv.slice(process.argv.indexOf("exec")+1);
const value=flag=>args[args.indexOf(flag)+1];
let prompt="";
process.stdin.setEncoding("utf8");
process.stdin.on("data",c=>{prompt+=c;});
process.stdin.on("end",()=>{
  writeFileSync(marker,JSON.stringify({args,cwd:process.cwd(),prompt,pid:process.pid}));
  process.stderr.write("fixture stderr 中文\n");
  if(mode==="hang" || mode==="ignore-term") {
    if(mode==="ignore-term") process.on("SIGTERM",()=>appendFileSync(marker+".term","TERM\n"));
    setInterval(()=>{},1000); return;
  }
  if(mode==="output-limit") {process.stdout.write("x".repeat(17*1024*1024)); return;}
  if(mode==="symlink") {unlinkSync(value("-o"));symlinkSync(marker,value("-o"));return;}
  const wireSchema=JSON.parse(readFileSync(value("--output-schema"),"utf8"));
  const schema=wireSchema.properties?.result??wireSchema;
  let body={summary:"fixture",primaryTargetPaths:["answer.txt"]};
  if(schema.anyOf) body={changedFiles:["answer.txt"],diffPatch:"fixture patch",commandOutputs:["changed answer"],stdoutStderrLog:"fixture execution"};
  if(schema.properties?.approved) body={approved:true,rejectCategory:"",primaryTargetPaths:["answer.txt"],failingCommand:null,safeToRetry:false,evidence:[],pauseSignals:[],stopSignals:[]};
  const phase=schema.anyOf?"execute":schema.properties?.approved?"verify":"plan";
  appendFileSync(marker+".calls",phase+"\n");
  // Orca handoff delivery (2026-09-25), C5 and I-7: a script entry is looked up for the task named in
  // this phase's prompt, `<task>#continuation` first when the prompt carries ccloop's continuation
  // constraint, and may carry `delayMs: {plan?, execute?, verify?}`: that phase then sleeps before it
  // writes anything (script files, the final answer, stdout events). Only a missing execute entry is an
  // error, as before. Each script-mode call also appends `<phase> <entry key or ->` to `<marker>.tasks`
  // (`<marker>.calls` keeps its format).
  let entry;
  if(mode==="script") {
    const task={plan:/^Plan one isolated L2 attempt for task (.+)\.$/m,execute:/^Execute one isolated attempt for task (.+)\.$/m,verify:/^Verify task (.+)\.$/m}[phase].exec(prompt)?.[1];
    const script=task===undefined?{}:JSON.parse(readFileSync(process.argv[4],"utf8"));
    const key=prompt.includes(CONTINUATION)&&script[`${task}#continuation`]!==undefined?`${task}#continuation`:script[task]!==undefined?task:undefined;
    entry=key===undefined?undefined:script[key];
    appendFileSync(marker+".tasks",`${phase} ${key??"-"}\n`);
    if(phase==="execute" && entry===undefined) {process.stderr.write(`fake-codex script has no entry for task ${task}\n`);process.exitCode=3;return;}
  }
  const respond=()=>{
  if(mode==="script" && phase==="execute") for(const [path,content] of Object.entries(entry.files)) writeFileSync(path,content);
  if(phase==="execute" && ["integration","write-hang","no-usage","false-answer","high-usage"].includes(mode)) writeFileSync("answer.txt","42\n");
  if(phase==="verify" && mode==="false-answer") writeFileSync("answer.txt","0\n");
  if(mode==="quota") {process.stdout.write(JSON.stringify({type:"turn.failed",error:{message:"quota exhausted"}})+"\n");return;}
  if(phase==="execute" && mode==="write-hang") {setInterval(()=>{},1000);return;}
  if(phase==="execute" && mode==="partial") Object.assign(body,{completionStatus:"partial",failureType:"error",failureMessage:"fixture partial"});
  if(mode!=="missing-final") writeFileSync(value("-o"),JSON.stringify(wireSchema.properties?.result?{result:body,...(mode==="envelope-extra"?{tokenUsage:0}:{})}:body));
  if(phase==="execute" && mode==="no-usage") return;
  const events=JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"中文"}})+"\n"+JSON.stringify({type:"turn.completed",usage:{input_tokens:mode==="high-usage"?39997:12,output_tokens:3}})+"\n";
  if(mode==="child-holds-pipe") {
    const child=spawn(process.execPath,["-e",'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:["ignore","inherit","inherit"]});
    writeFileSync(marker+".child",String(child.pid));
    process.stdout.write(events,()=>process.exit(0));return;
  }
  if(mode==="split-utf8") {
    const b=Buffer.from(events),i=b.indexOf(Buffer.from("中文"))+1;
    process.stdout.write(b.subarray(0,i));setTimeout(()=>process.stdout.write(b.subarray(i)),10);return;
  }
  process.stdout.write(mode==="bad-json" ? "not JSON\n" : events);
  if(mode==="nonzero") process.exitCode=7;
  };
  const delay=entry?.delayMs?.[phase];
  if(delay===undefined) respond(); else setTimeout(respond,delay);
});
```

旧模式为何行为不变：非 `script` 模式 `entry` 恒为 `undefined` ⇒ `delay` 恒为 `undefined` ⇒ `respond()` 在同一个 tick 里同步执行原 `:31-49` 的每一行，`return` 语义不变；`script` 模式无 `delayMs` 的脚本同理，且 execute 无条目时仍在写任何结果之前 exit 3（`fakeCodexScript.test.ts` 两条照绿）。

`src/control/handoff.ts`（相对 `a5dc529` 的 diff，逐字；探针 `ccloop-probe` 里跑过全量的就是这一份）：

```diff
diff --git a/src/control/handoff.ts b/src/control/handoff.ts
index ca643e3..940c599 100644
--- a/src/control/handoff.ts
+++ b/src/control/handoff.ts
@@ -240,6 +240,31 @@ async function retainCodexLogs(
   }
 }
 
+/**
+ * Orca handoff delivery spec §13.1 C-2 (human ruling 2026-09-25): a handoff candidate of a run that is
+ * not terminal lists as missing only the phase files of the current attempt that the attempt entered.
+ * Entered: plan once the attempt exists; execute on its `execute_started`; verify on its
+ * `execution_finished` (runLoop.ts emits both with detail `attempt <n>`).
+ */
+async function enteredPhaseFiles(sourceDir: string, runDir: string, attempt: number): Promise<Set<string>> {
+  const entered = new Set(["plan.json"]);
+  let text = "";
+  try {
+    text = (await readPrivateFile(sourceDir, join(runDir, "events.jsonl"))).toString("utf8");
+  } catch (error) {
+    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
+  }
+  for (const line of text.split("\n")) {
+    if (line.trim() === "") continue;
+    let event: { type?: unknown; detail?: unknown };
+    try { event = JSON.parse(line) as { type?: unknown; detail?: unknown }; } catch { continue; }
+    if (event.detail !== `attempt ${attempt}`) continue;
+    if (event.type === "execute_started") entered.add("execution.json");
+    if (event.type === "execution_finished") entered.add("verify.json");
+  }
+  return entered;
+}
+
 export async function buildHandoffPacket(
   envelope: StartEnvelopeV1,
   request: HandoffRequestV1 | null,
@@ -259,7 +284,11 @@ export async function buildHandoffPacket(
   await retainFile(envelope.work.sourceDir, join(runDir, "loop-state.json"), "loop-state.json", artifacts, missing);
   await retainFile(envelope.work.sourceDir, join(runDir, "loop-contract.json"), "loop-contract.json", artifacts, missing);
   if (runState.currentAttempt > 0) {
+    const entered = request !== null && !isTerminalRunStatus(runState.status)
+      ? await enteredPhaseFiles(envelope.work.sourceDir, runDir, runState.currentAttempt)
+      : null;
     for (const name of ["plan.json", "execution.json", "verify.json"]) {
+      if (entered !== null && !entered.has(name)) continue;
       await retainFile(
         envelope.work.sourceDir,
         join(runDir, "attempts", String(runState.currentAttempt), name),
@@ -285,7 +314,7 @@ export async function buildHandoffPacket(
     validationCommands: [...envelope.work.contract.verification.requiredChecks],
     rawLogs,
     usageHighWater,
-    unresolvedRequestIds: request === null || result === "complete" ? [] : [request.requestId],
+    unresolvedRequestIds: [],
     artifacts: [...artifacts],
   };
   const handoff = await writeEvidence(envelope.work.sourceDir, Buffer.from(canonicalJson(packet)));
@@ -307,7 +336,7 @@ export async function persistHandoffCandidate(
     artifacts: [...built.artifacts, built.handoff],
     snapshot: null,
     missing: [...built.missing],
-    unresolvedRequestIds: request === null || options.result === "complete" ? [] : [request.requestId],
+    unresolvedRequestIds: [],
     stopProof: null,
     terminalOutcome: runState.status,
     handoff: built.handoff,
```

- [ ] **Step 6：跑新判据看见绿，再跑 ccloop 全套门**

```bash
cd /Users/biran/code/skills/loop/ccloop
S="${SCRATCH:?}"
./node_modules/.bin/vitest run tests/runtime/codex/fakeCodexDelay.test.ts tests/control/handoffEnteredPhases.test.ts tests/control/handoff.test.ts tests/runtime/codex/fakeCodexScript.test.ts > "$S/t1-green.log" 2>&1; echo "RC=$?" >> "$S/t1-green.log"
npm run typecheck > "$S/t1-typecheck.log" 2>&1; echo "RC=$?" >> "$S/t1-typecheck.log"
npm run build > "$S/t1-build.log" 2>&1; echo "RC=$?" >> "$S/t1-build.log"
./node_modules/.bin/vitest run --reporter=json --outputFile="$S/t1-ccloop.json" > "$S/t1-ccloop.log" 2>&1; echo "RC=$?" >> "$S/t1-ccloop.log"
node scripts/check-known-reds.mjs "$S/t1-ccloop.json" > "$S/t1-known-reds.log" 2>&1; echo "RC=$?" >> "$S/t1-known-reds.log"
cat "$S/t1-green.log" "$S/t1-typecheck.log" "$S/t1-build.log" "$S/t1-known-reds.log"
```

Expected：定向 19/19 绿（5＋6＋6＋2）；typecheck、build RC 0；`check-known-reds.mjs` RC 0 —— **改写后的 C6 那条必须 `passed`**；名单内的已知红（`quiet execution proof > does not treat leader exit…` 等）可以红。计划席实测（`t12-full.json`／`t12-kr.log`，高负载 load≈40）：65 文件、838 条、833 过、5 败且 5 条全在名单内、0 pending，`check-known-reds` RC 0。json 顶层 `numPendingTests` 必须为 0；非 0 或出现名单外的红 ⇒ 先单文件重跑该文件（本机负载下 `runCodexPhase.test.ts` 的两条 output-limit 条目与 `tests/validation/*` 会计时红，单跑绿），单跑仍红 ⇒ 停下报告。

- [ ] **Step 7：提交（ccloop；不 push）**

```bash
cd /Users/biran/code/skills/loop/ccloop
/usr/bin/git add tests/fixtures/fake-codex.mjs src/control/handoff.ts tests/control/handoff.test.ts tests/runtime/codex/fakeCodexDelay.test.ts tests/control/handoffEnteredPhases.test.ts
/usr/bin/git diff --cached --stat > "${SCRATCH:?}/t1-cached.txt" 2>&1; cat "${SCRATCH:?}/t1-cached.txt"
/usr/bin/git commit -F "${SCRATCH:?}/t1-msg.txt"
```

`t1-msg.txt`：

```
feat(control): answer the handoff request, list only entered phases, delay fake codex

For Orca's handoff delivery. C6: a handoff candidate and its packet no longer list the
request they answer in unresolvedRequestIds; "interrupted" is carried by result:"partial".
The criterion that pinned the old behaviour is rewritten whole, as the human named it
under ruling 88 on 2026-09-25 through the Orca controller session e5f56bfe. C7: a
handoff of a non-terminal run lists as missing only the current attempt's phase files
that the attempt entered (execute on execute_started, verify on execution_finished);
terminal runs still require all three. C5: fake codex script entries may delay a phase
before it writes anything, a <task>#continuation entry answers continuation prompts, and
each script call records the entry it used in <marker>.tasks; .calls is unchanged.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异（变异席在 ccloop 的 `git clone --local` 副本里做；副本是已提交状态 —— 在 T1 提交之后克隆。每条：前后 sha256，只跑下面三份文件 `tests/runtime/codex/fakeCodexDelay.test.ts tests/control/handoffEnteredPhases.test.ts tests/control/handoff.test.ts`；还原看 `git diff`／`git diff --cached` 字节数为 0）**

计划席已在 `t12-clone` 里把下表每条跑过一遍（脚本 `scratchpad/planner/t12-mut.py`，日志 `t12-mut.log`、`t12-mut3.log`），「期望红」列就是实测红集（同时跑了 `runCodexPhase.test.ts`，它的 output-limit 两条在高负载下另有计时红，与变异无关，故变异席不跑它）。

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| T1-M1 | `tests/fixtures/fake-codex.mjs` | `if(delay===undefined) respond(); else setTimeout(respond,delay);` → `respond();` | 条目带 `delayMs` | `sleeps delayMs for the named phase…`、`writes no script file, no final answer…`、`chooses the #continuation entry…` |
| T1-M2 | 同上 | `const key=prompt.includes(CONTINUATION)&&…:undefined;` → `const key=script[task]!==undefined?task:undefined;` | 续跑 prompt ＋ `#continuation` 条目 | `chooses the #continuation entry…` |
| T1-M3 | 同上 | 删 `appendFileSync(marker+".tasks",…);` 一行 | 任一 script 调用 | `chooses the #continuation entry…`、`falls back to the plain entry…` |
| T1-M4 | `src/control/handoff.ts` | packet 处 `unresolvedRequestIds: [],` → 还原 `request === null \|\| result === "complete" ? [] : [request.requestId],` | 非 complete 的 candidate | `allows request:null only for natural terminal runs…`、`answers its request: result stays partial…` |
| T1-M5 | 同上 | candidate 处 `unresolvedRequestIds: [],` → 还原 `request === null \|\| options.result === "complete" ? [] : [request.requestId],` | 同上 | 同 T1-M4 |
| T1-M6 | 同上 | 删 `if (event.type === "execute_started") entered.add("execution.json");` | 进过 execute、`execution.json` 不在 | `still lists an entered phase whose file is absent…` |
| T1-M7 | 同上 | 删 `if (event.type === "execution_finished") entered.add("verify.json");` | 进过 verify、`verify.json` 不在 | `still lists an entered phase whose file is absent…` |
| T1-M8 | 同上 | `request !== null && !isTerminalRunStatus(runState.status)` → `request !== null`（删终态守卫） | 终态 run 带请求 | `keeps requiring all three phase files for terminal runs…`、`handoff.test.ts > derives blocked facts and explicit logs without an LLM call` |
| T1-M9 | 同上 | 删 `if (event.detail !== \`attempt ${attempt}\`) continue;` | 前一个 attempt 的事件 | `counts only the current attempt's events as entered` |
| T1-M10 | 同上 | 删 `if (entered !== null && !entered.has(name)) continue;` | 边界停 | `does not list the execute and verify files…`、`does not list the verify file…`、`still lists an entered phase…`、`counts only the current attempt's events…`、`answers its request…` |

（台账编号与计划席日志的对应：日志里的 `T1-M3`／`M4`／…／`M9`／`M10` 依次是本表的 T1-M4／M5／M6／M7／M8／M9／M10／M3 —— 日志先编了 handoff.ts 的变异；**实测红集与本表逐条一致**。）

---

## Task 2：ccloop C-3 机制（deadline 中止的阶段交出已观测的 usage）—— **闸门任务**

> ⛔ **本 Task 只在控制器对 §0.1 偏离行 D-C3 作出裁定、并已报人之后才开工。** 下文按**推荐方案 (i)**写；控制器若改选别的方案，本 Task 整体重写，不在本文上修补。
> ⛔ **另有一条计划席实测发现须同时交控制器（建议在 §0.1 新增行 D-C7′）**：见下文「实测：(i) 之后 deadline 中止的 run 仍不可续」。**它决定 §12 判据增补里「deadline 中止 ⇒ 可恢复 ⇒ 续跑落地」那例能否成立，与选 (i) 还是 (ii) 无关。**
> 归属与锚点同 Task 1；以下事实为只读调查所得，计划席在 `a5dc529` 上用 python 逐行现测复核（行号见下），并在 `t12-clone` 里把 (i) 写出、跑过、变异过。

**现量（ccloop `a5dc529`）：**

| # | 事实 | 位置 |
|---|---|---|
| F1 | deadline 到点：worker 的 `phaseAbort`（`AbortController`）被 `abort()` | `src/control/worker.ts:111`、`:121-129` |
| F2 | runLoop 把它并进阶段信号 `AbortSignal.any([abortSignal, hooks.phaseSignal])` | `src/controller/runLoop.ts:326-331` |
| F3 | `runCodexPhase` 收到 abort ⇒ 对进程组 SIGTERM，`killGraceMs` 后 SIGKILL；返回的 `PhaseOutcome` 只有 `reason/code/signal/events/final/evidenceDir`，**没有 usage** | `src/runtime/codex/runCodexPhase.ts:11-14`、`:49`、`:59-65`、`:85-86` |
| F4 | codex 的 stdout 边流边追加到 `<evidenceDir>/events.jsonl`，并累积在 `result.events` 里 | `runCodexPhase.ts:43`、`:69-73` |
| F5 | usage 只从 `turn.completed.usage` 解，且只在 `reason==="completed"` 时解 | `src/runtime/codex/protocol.ts:41-73`（`decodeCodexResult`）、`codexAdapter.ts:15-19` |
| F6 | plan／verify 被中止 ⇒ `CodexAdapter.phase` 抛 `codex-aborted` ⇒ `PhaseExecutionError` ⇒ `runLoop.ts:1830` `settlePhase(activePhase, attempt, error.elapsedMs)`，无 result ⇒ `tokenUsage: null`（`runLoop.ts:1228`） | `codexAdapter.ts:15-16`、`runLoop.ts:102-110`、`:486-488`、`:1828-1838` |
| F7 | execute 被中止 ⇒ `CodexAdapter.execute` 返回 `null` ⇒ `runLoop.ts:1421-1423` `settlePhase("execute", …, null)` | `codexAdapter.ts:31`、`runLoop.ts:1421-1425` |
| F8 | worker `onPhaseSettled` 在 `tokenUsage===null` 时写 `threadTotalTokens:null` ⇒ usage 事件 `cumulative:null` | `worker.ts:165-181`、`src/control/usage.ts:167`、`:178` |
| F9 | 能力声明：`usageObservation:"phase-end"`、`budgetEnforcement:"soft"`（无可证明的上限） | `src/control/command.ts:146-147`、`docs/control-protocol-v1.md:3,34` |
| F10 | fake codex 唯一的 usage 行最后打印，在写文件与终答之后 | `tests/fixtures/fake-codex.mjs:38`、`:48` |

**推荐方案 (i)（修在产生观测的一端，spec §13.1 C-3 的优先候选）**：`runCodexPhase` 在 `reason!=="completed"` 时从它已持有的 stdout 里取**最后一条合规的** `turn.completed` usage，作为 `PhaseOutcome.observedTokens: number | null` 交出；`CodexAdapter` 对 `reason==="aborted"` 抛带 `observedTokens` 的 `CodexPhaseAborted`（消息仍是 `codex-aborted: <dir>`）；execute 被中止时**只有**观测到 usage 才抛（让 runLoop 结算它），没观测到仍返回 `null`（旧行为）；`PhaseExecutionError` 带 `tokenUsage: number | null`（结构读取 `observedTokens`）；runLoop 的 `PhaseExecutionError` 收口把它交给 `settlePhase`。**没观测到 ⇒ 仍是 `null`，不是 0，不猜。** fake codex 脚本条目加 `usageBeforeDelay: true`：在 sleep `delayMs` **之前**先打印本次调用的 `turn.completed` usage 行（12＋3＝15），让 deadline 场景有观测可报。

**诚实声明（登记，不修）**：真 codex 的 usage 是**阶段末**才出的（F9 `phase-end`）；deadline 在一个 turn 中途杀掉进程时，stdout 里多半**没有** `turn.completed` ⇒ `observedTokens:null` ⇒ 该阶段 usage 仍未知 ⇒ Orca 侧这类 run 仍按 usage-unknown 收口为 `settled-unrecoverable`。(i) 让「观测到了就不丢」成立，**不**让真 codex 的 deadline 中止变得可续；E2E 的 deadline 例靠 fake codex 的 `usageBeforeDelay` 才有观测。

**实测：(i) 之后 deadline 中止的 run 仍不可续（D-C7′，交控制器）**。计划席在 `t12-clone`（T1＋T2(i)）里用 worker 级判据实跑：execute 在 delay 中被 deadline 中止 ⇒ usage 事件 `[["work",15],["work",30],["handoff",0]]`（usage 已知 ✔），但 candidate 的 `missing` ＝ `["attempts/1/execution.json"]`。原因：execute 被中止时 `CodexAdapter.execute` 无结果（`null` 或 `CodexPhaseAborted`），runLoop 调 `writeCompletedAttemptArtifacts(runDir, attempt, plan, null)`（`runLoop.ts:1424`／`:1833`），`writeAttemptArtifacts` 在 `execution===undefined` 时不写 `execution.json`（`src/persistence/fileStore.ts:1995-1997`）；而 C7 按 §13.1 C-2 人裁「进入过而文件不在的仍列」把它列进 `missing`；Orca `checkpoints.ts:85` `continuable = settled && missing.length===0 && !!snapshot` ⇒ **不可续**。同理 plan／verify 被 deadline 中止也各缺一份。⇒ 在现行人裁下，**没有任何 deadline 中止能产出 `missing` 为空的 candidate**，§12「deadline 中止 ⇒ 可恢复 ⇒ 续跑落地」那例不可达。候选（计划席不选，交控制器按 Rule 1／Rule 7 定，涉及改 §13.1 C-2 人裁原文的须报人）：(α) C7 另加一条：当前 attempt 有 `handoff_interrupted` 事件（`runLoop.ts:1233`，detail 形如 `handoff deadline interrupted <phase> in attempt <n>`）时，**被它点名的那个阶段**的文件不列 `missing`（该阶段按设计就不会有结果，「被打断」已由 `result:"partial"` 表达）—— 与 C-2「进入过而不在的仍列」字面冲突，需人改裁；(β) 保留 C-2，E2E 的 deadline 例改为断言 `settled-unrecoverable`、删掉「续跑落地」—— 同样改 §12 判据增补，需人裁。

**Files（按推荐方案 (i)）:**
- Modify: `src/runtime/codex/protocol.ts`（`:40` `PhaseResults` 类型之后、`:41` `decodeCodexResult` 之前加 `observedTurnUsage`）
- Modify: `src/runtime/codex/runCodexPhase.ts`（`:8` import；`:11-14` `PhaseOutcome` 加字段；`:22` 初值；`:116` `return persist();` 之前一行）
- Modify: `src/runtime/codex/codexAdapter.ts`（`:9` 之前加 `CodexPhaseAborted`；`:15` 之前一行；`:31` execute 的 catch）
- Modify: `src/runtime/types.ts`（`:129-131` `isPartialExecutionResult` 之后加 `observedTokensOf`）
- Modify: `src/controller/runLoop.ts`（`:45` import；`:102-110` `PhaseExecutionError`；`:1830` 一行）
- Modify: `tests/fixtures/fake-codex.mjs`（T1 之后的 `:64` delay 分派那一行）
- Create: `tests/runtime/codex/abortedUsage.test.ts`（3 条）、`tests/control/handoffDeadlineUsage.test.ts`（1 条）—— **这两个文件名不在 brief 的固定清单里**（T2 是闸门任务，清单只列了 T1 的两份）；收尾计数器需要把它们加进去，或由控制器改名。

**Interfaces（(i)）:**
- Produces: `observedTurnUsage(events: string): number | null`（`protocol.ts`）；`PhaseOutcome.observedTokens: number | null`；`class CodexPhaseAborted extends Error { evidenceDir: string; observedTokens: number | null }`（`codexAdapter.ts`，`message === "codex-aborted: <evidenceDir>"`）；`observedTokensOf(error: unknown): number | null`（`runtime/types.ts`）；`PhaseExecutionError.tokenUsage: number | null`；fake codex 脚本条目 `usageBeforeDelay?: true`（只在该阶段有 `delayMs` 时生效）。
- 不变：`capabilities` 的 `usageObservation:"phase-end"`／`budgetEnforcement:"soft"`；`docs/control-protocol-v1.md:46`「Missing token usage is represented by `cumulative:null`, never synthetic zero」—— (i) 与之一致，文档不改。

- [ ] **Step 1：闸门核对** —— 确认控制器对 D-C3（与 D-C7′）的裁定已落在 §0.1、已报人，且裁定是 (i)；否则停下，本 Task 不开工。然后同 Task 1 Step 1 的方式现测 F1–F10 的行号（python 逐行，输出重定向到 `"${SCRATCH:?}/t2-start.txt"` 再 `cat`），与上表不符 ⇒ 以现测为准改落点。

- [ ] **Step 2：写两份新判据**

`tests/runtime/codex/abortedUsage.test.ts`：

```ts
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAdapter, CodexPhaseAborted } from "../../../src/runtime/codex/codexAdapter.js";
import { observedTurnUsage, parseCodexConfig, type CodexPhase } from "../../../src/runtime/codex/protocol.js";
import { runCodexPhase } from "../../../src/runtime/codex/runCodexPhase.js";
import { codexFixture } from "./fixture.js";

// Orca handoff delivery (2026-09-25), spec §13.1 C-3 option (i), controller ruling on plan row D-C3: a phase
// stopped by a handoff deadline reports the usage its codex stdout showed before the kill, and null — not 0,
// not a guess — when it showed none. Additive only (ccloop Rule 15).
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

/** Fake codex in script mode for the fixture's task `codex-test`, sleeping 10 s in `phase`. */
async function delayed(phase: CodexPhase, usageBeforeDelay: boolean) {
  const f = await codexFixture("script");
  dirs.push(f.dir);
  const scriptPath = join(f.dir, "script.json");
  await writeFile(scriptPath, JSON.stringify({ "codex-test": { files: { "answer.txt": "42\n" }, delayMs: { [phase]: 10_000 }, usageBeforeDelay } }));
  f.config.command.push(scriptPath);
  return { ...f, config: parseCodexConfig(f.config) };
}

const prompts = {
  plan: "Plan one isolated L2 attempt for task codex-test.\n",
  execute: "Execute one isolated attempt for task codex-test.\n",
  verify: "Verify task codex-test.\n",
} as const;

/** Resolves once the running call's own evidence stdout shows a usage line. */
async function usageSeen(runDir: string, phase: CodexPhase): Promise<void> {
  const root = join(runDir, "codex", "1", phase);
  await expect.poll(async () => {
    try {
      const [call] = await readdir(root);
      return call === undefined ? "" : await readFile(join(root, call, "events.jsonl"), "utf8");
    } catch { return ""; }
  }, { timeout: 5_000 }).toContain('"turn.completed"');
}

describe("usage observed before a codex phase was aborted (Orca handoff delivery C-3)", () => {
  it("reads the last well-formed turn.completed usage, skipping torn and malformed rows", () => {
    const usage = (input: number, output: number) => JSON.stringify({ type: "turn.completed", usage: { input_tokens: input, output_tokens: output } });
    expect(observedTurnUsage(`${usage(5, 1)}\n${usage(12, 3)}\n{"type":"turn.comp`)).toBe(15);
    expect(observedTurnUsage(`${usage(12, 3)}\n${usage(0, 0)}\n${JSON.stringify({ type: "turn.completed", usage: { input_tokens: -1, output_tokens: 3 } })}\n`)).toBe(15);
    expect(observedTurnUsage(`${JSON.stringify({ type: "item.completed" })}\nnot json\n`)).toBeNull();
    expect(observedTurnUsage("")).toBeNull();
  });

  it("returns the observed tokens on an aborted outcome after a usage line, and null before any", async () => {
    const seen = await delayed("execute", true);
    const abort = new AbortController();
    const pending = runCodexPhase(seen.config, { phase: "execute", prompt: prompts.execute, context: { ...seen.context, abortSignal: abort.signal } });
    await usageSeen(seen.runDir, "execute");
    abort.abort();
    const outcome = await pending;
    expect(outcome.reason).toBe("aborted");
    expect(outcome.final).toBeNull();
    expect(outcome.observedTokens).toBe(15);
    // Killed during the delay: the script's files were never written.
    await expect(readFile(join(seen.repo, "answer.txt"), "utf8")).resolves.toBe("0\n");

    const unseen = await delayed("execute", false);
    const abortEarly = new AbortController();
    const early = runCodexPhase(unseen.config, { phase: "execute", prompt: prompts.execute, context: { ...unseen.context, abortSignal: abortEarly.signal } });
    await expect.poll(async () => readFile(`${unseen.marker}.calls`, "utf8").catch(() => ""), { timeout: 5_000 }).toContain("execute");
    abortEarly.abort();
    const none = await early;
    expect(none.reason).toBe("aborted");
    expect(none.observedTokens).toBeNull();
  });

  it("carries the observation on CodexPhaseAborted for plan and verify, and for execute only when one exists", async () => {
    for (const phase of ["plan", "verify"] as const) {
      const f = await delayed(phase, true);
      const abort = new AbortController();
      const pending = new CodexAdapter(f.config)[phase]({ ...f.context, abortSignal: abort.signal, plan: { summary: "p", primaryTargetPaths: ["answer.txt"] } }).catch((error: unknown) => error);
      await usageSeen(f.runDir, phase);
      abort.abort();
      const error = await pending;
      expect(error).toBeInstanceOf(CodexPhaseAborted);
      expect((error as CodexPhaseAborted).message).toMatch(/^codex-aborted: /);
      expect((error as CodexPhaseAborted).observedTokens).toBe(15);
    }
    const seen = await delayed("execute", true);
    const abort = new AbortController();
    const pending = new CodexAdapter(seen.config).execute({ ...seen.context, abortSignal: abort.signal, plan: { summary: "p", primaryTargetPaths: ["answer.txt"] } }).catch((error: unknown) => error);
    await usageSeen(seen.runDir, "execute");
    abort.abort();
    const thrown = await pending;
    expect(thrown).toBeInstanceOf(CodexPhaseAborted);
    expect((thrown as CodexPhaseAborted).observedTokens).toBe(15);

    // Nothing observed: execute keeps answering null (the pre-existing adapter criterion pins the pre-aborted case).
    const unseen = await delayed("execute", false);
    const abortEarly = new AbortController();
    const early = new CodexAdapter(unseen.config).execute({ ...unseen.context, abortSignal: abortEarly.signal, plan: { summary: "p", primaryTargetPaths: ["answer.txt"] } });
    await expect.poll(async () => readFile(`${unseen.marker}.calls`, "utf8").catch(() => ""), { timeout: 5_000 }).toContain("execute");
    abortEarly.abort();
    expect(await early).toBeNull();
  }, 20_000);
});
```

`tests/control/handoffDeadlineUsage.test.ts`：

```ts
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestHandoff } from "../../src/control/handoff.js";
import { collectExecution } from "../../src/control/collect.js";
import { readEvidence } from "../../src/control/evidence.js";
import { atomicReplacePrivateFile, ensurePrivateDirectory } from "../../src/control/paths.js";
import { canonicalHash, canonicalJson, type HandoffRequestV1, type StartEnvelopeV1 } from "../../src/control/protocol.js";
import { writeAccepted } from "../../src/control/store.js";
import { runControlWorker } from "../../src/control/worker.js";
import { codexFixture } from "../runtime/codex/fixture.js";

// Orca handoff delivery (2026-09-25), spec §13.1 C-3 option (i), controller ruling on plan row D-C3: a control
// run whose execute phase a handoff deadline aborts after codex reported usage books that usage as a known
// cumulative (not null), so Orca does not have to treat the run's usage as unknown. Additive only (ccloop
// Rule 15): the existing "watches a latched deadline …" criterion (hang mode, nothing reported) keeps
// expecting a null work event.
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("deadline-aborted execute with observed usage (Orca handoff delivery C-3)", () => {
  it("books the observed tokens as a known cumulative and still hands off a partial candidate that answers its request", async () => {
    const runtime = await codexFixture("script");
    dirs.push(runtime.dir);
    const scriptPath = join(runtime.dir, "script.json");
    await writeFile(scriptPath, JSON.stringify({ "codex-test": { files: { "answer.txt": "42\n" }, delayMs: { execute: 30_000 }, usageBeforeDelay: true } }));
    runtime.config.command.push(scriptPath);
    await mkdir(join(runtime.dir, "input"));
    const amount = { tokens: 100, activeMs: 60_000, attempts: 1, sessions: 1 };
    const envelope: StartEnvelopeV1 = {
      protocol: 1,
      claim: { groupId: "group-1", workItemId: "work-1", taskId: "task-1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "command-1", configHash: canonicalHash(runtime.config), grant: { work: amount, handoff: amount }, ownerToken: "owner-1" },
      contractHash: "c".repeat(64),
      inputCheckpoint: null,
      work: { contract: runtime.contract, targetRepo: runtime.repo, base: "main", sourceDir: runtime.dir },
    };
    const controlDir = join(runtime.dir, "control");
    await ensurePrivateDirectory(runtime.dir, controlDir);
    await atomicReplacePrivateFile(runtime.dir, join(controlDir, "config.json"), Buffer.from(canonicalJson(runtime.config)));
    await atomicReplacePrivateFile(runtime.dir, join(controlDir, "envelope.json"), Buffer.from(canonicalJson(envelope)));
    await writeAccepted(runtime.dir, {
      protocol: 1, envelopeHash: canonicalHash(envelope), executionId: "execution-1", configHash: envelope.claim.configHash,
      generation: 1, acceptedAt: new Date().toISOString(), launch: "intended", worker: null,
    });

    const worker = runControlWorker(["--source-dir", runtime.dir, "--execution-id", "execution-1", "--nonce", "nonce-1"]);
    // Wait until execute is running and its stdout already shows usage, then latch a request whose deadline
    // falls inside the 30 s delay.
    const executeRoot = join(runtime.runDir, "codex", "1", "execute");
    await expect.poll(async () => {
      try {
        const [call] = await readdir(executeRoot);
        return call === undefined ? "" : await readFile(join(executeRoot, call, "events.jsonl"), "utf8");
      } catch { return ""; }
    }, { timeout: 10_000 }).toContain('"turn.completed"');
    const request: HandoffRequestV1 = { protocol: 1, requestId: "request-1", runId: "run-1", generation: 1, reason: "human", deadlineAt: new Date(Date.now() + 150).toISOString() };
    expect(await requestHandoff(envelope, request)).toEqual({ kind: "latched", requestId: "request-1" });
    await worker;

    expect(await readFile(`${runtime.marker}.calls`, "utf8")).toBe("plan\nexecute\n");
    // Killed during the delay: the script's file was never written into the attempt worktree's repository.
    expect(await readFile(join(runtime.repo, "answer.txt"), "utf8")).toBe("0\n");
    const collected = await collectExecution(envelope, 0);
    expect(collected.candidate).toMatchObject({ result: "partial", unresolvedRequestIds: [] });
    // Plan completed with 15; execute was aborted after reporting 15 more.
    expect(collected.events.map((event) => [event.bucket, event.cumulative?.tokens ?? null])).toEqual([
      ["work", 15],
      ["work", 30],
      ["handoff", 0],
    ]);
    const packet = JSON.parse((await readEvidence(runtime.dir, collected.candidate!.handoff)).toString("utf8"));
    expect(packet.request).toEqual(request);
    expect(await readFile(join(runtime.runDir, "events.jsonl"), "utf8")).toContain("handoff deadline interrupted execute in attempt 1");
  }, 30_000);
});
```

- [ ] **Step 3：跑新判据看见红**

```bash
cd /Users/biran/code/skills/loop/ccloop
./node_modules/.bin/vitest run tests/runtime/codex/abortedUsage.test.ts tests/control/handoffDeadlineUsage.test.ts > "${SCRATCH:?}/t2-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t2-red.log"; cat "${SCRATCH:?}/t2-red.log"
```

预言：`abortedUsage` 整文件红在 import（`CodexPhaseAborted`／`observedTurnUsage` 不存在 ⇒ **不是判据红证**，只证明文件接上了）；`handoffDeadlineUsage` 红在 `expect.poll(…).toContain('"turn.completed"')` 超时（fake codex 还不认 `usageBeforeDelay`，delay 中 stdout 为空）。判据红证由 Step 6 的变异表给出。

- [ ] **Step 4：实现 (i)**（相对 T1 提交的 diff，逐字；计划席 `t12-clone` 的 `a5c9a09` 就是这一份）

```diff
diff --git a/src/controller/runLoop.ts b/src/controller/runLoop.ts
index 88fc0c5..9e099cd 100644
--- a/src/controller/runLoop.ts
+++ b/src/controller/runLoop.ts
@@ -42,7 +42,7 @@ import type {
   UsageEvidence,
   VerificationResult,
 } from "../runtime/types.js";
-import { isPartialExecutionResult } from "../runtime/types.js";
+import { isPartialExecutionResult, observedTokensOf } from "../runtime/types.js";
 import { buildProcessInstanceId } from "../runtime/processIdentity.js";
 import type { FailureFingerprint, LastTrustedBoundary, RunState, StopDecision } from "../state/types.js";
 import { cleanupAttemptWorkspace, createAttemptWorkspace, publishAttemptCommit } from "../workspace/worktreeManager.js";
@@ -101,11 +101,14 @@ export const OWNER_TRANSFER_LOCK_RETRY_DELAY_MS = 50;
 
 class PhaseExecutionError extends Error {
   readonly elapsedMs: number;
+  // Orca handoff delivery C-3: tokens the failed phase was observed spending, or null (never 0).
+  readonly tokenUsage: number | null;
 
   constructor(elapsedMs: number, error: unknown) {
     super(String(error));
     this.name = "PhaseExecutionError";
     this.elapsedMs = elapsedMs;
+    this.tokenUsage = observedTokensOf(error);
   }
 }
 
@@ -1827,7 +1830,9 @@ export async function runLoopFromState(
 
       if (error instanceof PhaseExecutionError) {
         const failedPhase = activePhase;
-        if (activePhase !== null) await settlePhase(activePhase, attempt, error.elapsedMs);
+        if (activePhase !== null) {
+          await settlePhase(activePhase, attempt, error.elapsedMs, error.tokenUsage === null ? undefined : { tokenUsage: error.tokenUsage });
+        }
 
         if (handoffAborted() || handoffRequested()) {
           await guardedWriteArtifacts(() => writeCompletedAttemptArtifacts(runDir, attempt, plan, execution));
diff --git a/src/runtime/codex/codexAdapter.ts b/src/runtime/codex/codexAdapter.ts
index 8f8ffa9..5340d78 100644
--- a/src/runtime/codex/codexAdapter.ts
+++ b/src/runtime/codex/codexAdapter.ts
@@ -6,12 +6,21 @@ import type { AttemptContext, RuntimeAdapter } from "../types.js";
 import { decodeCodexResult, parseCodexConfig, type CodexConfig, type CodexPhase, type PhaseResults } from "./protocol.js";
 import { runCodexPhase } from "./runCodexPhase.js";
 
+/** Orca handoff delivery C-3: an aborted phase, carrying the usage its stdout showed before the kill (or null). */
+export class CodexPhaseAborted extends Error {
+  constructor(readonly evidenceDir: string, readonly observedTokens: number | null) {
+    super(`codex-aborted: ${evidenceDir}`);
+    this.name = "CodexPhaseAborted";
+  }
+}
+
 export class CodexAdapter implements RuntimeAdapter {
   private readonly config: CodexConfig;
   constructor(rawConfig: unknown) { this.config = parseCodexConfig(rawConfig); }
 
   private async phase<P extends CodexPhase>(phase: P, prompt: string, context: AttemptContext): Promise<PhaseResults[P]> {
     const outcome = await runCodexPhase(this.config, { phase, prompt, context });
+    if (outcome.reason === "aborted") throw new CodexPhaseAborted(outcome.evidenceDir, outcome.observedTokens);
     if (outcome.reason !== "completed" || outcome.final === null) {
       throw new Error(`codex-${outcome.reason}: ${outcome.evidenceDir}`);
     }
@@ -28,7 +37,12 @@ export class CodexAdapter implements RuntimeAdapter {
   plan(context: AttemptContext) { return this.phase("plan", buildPlannerPrompt(context.contract), context); }
   async execute(context: AttemptContext) {
     try { return await this.phase("execute", buildExecutorPrompt(context) + "\nWrap the complete or partial result in a single object with the sole key result, as required by the output schema.", context); }
-    catch (error) { if (context.abortSignal?.aborted) return null; throw error; }
+    catch (error) {
+      // An aborted execute that was observed spending tokens throws, so runLoop can settle that usage;
+      // one that was not keeps answering null exactly as before.
+      if (context.abortSignal?.aborted && !(error instanceof CodexPhaseAborted && error.observedTokens !== null)) return null;
+      throw error;
+    }
   }
   verify(context: AttemptContext) { return this.phase("verify", buildVerifierPrompt(context), context); }
 }
diff --git a/src/runtime/codex/protocol.ts b/src/runtime/codex/protocol.ts
index 704023a..ed04645 100644
--- a/src/runtime/codex/protocol.ts
+++ b/src/runtime/codex/protocol.ts
@@ -38,6 +38,25 @@ export function phaseJsonSchema(phase: CodexPhase): Record<string, unknown> {
 const record = (x: unknown): x is Record<string,unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
 const integer = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
 export type PhaseResults = {plan:AttemptPlan; execute:ExecutionResult; verify:VerificationResult};
+/**
+ * Orca handoff delivery (2026-09-25), spec §13.1 C-3: the total of the last well-formed
+ * `turn.completed` usage in the stdout a phase wrote before it stopped, or null when there is none.
+ * Unlike decodeCodexResult this tolerates a torn last line and other rows: a stopped phase's stdout
+ * ends wherever the kill landed.
+ */
+export function observedTurnUsage(events: string): number | null {
+  let observed: number | null = null;
+  for (const line of events.split("\n")) {
+    let row: unknown;
+    try { row = JSON.parse(line); } catch { continue; }
+    if (!record(row) || row.type !== "turn.completed" || !record(row.usage)) continue;
+    const input = row.usage.input_tokens, output = row.usage.output_tokens;
+    if (!integer(input) || !integer(output) || !Number.isSafeInteger(input + output) || input + output === 0) continue;
+    observed = input + output;
+  }
+  return observed;
+}
+
 export function decodeCodexResult<P extends CodexPhase>(phase:P, events:string, final:string): PhaseResults[P] {
   let completed: Record<string, unknown> | undefined;
   for (const line of events.split("\n")) {
diff --git a/src/runtime/codex/runCodexPhase.ts b/src/runtime/codex/runCodexPhase.ts
index d49a232..9b254ac 100644
--- a/src/runtime/codex/runCodexPhase.ts
+++ b/src/runtime/codex/runCodexPhase.ts
@@ -5,12 +5,14 @@ import { join } from "node:path";
 import { StringDecoder } from "node:string_decoder";
 import { promisify } from "node:util";
 import type { AttemptContext } from "../types.js";
-import { phaseJsonSchema, type CodexConfig, type CodexPhase } from "./protocol.js";
+import { observedTurnUsage, phaseJsonSchema, type CodexConfig, type CodexPhase } from "./protocol.js";
 
 export type PhaseRequest = {phase:CodexPhase;prompt:string;context:AttemptContext};
 export type PhaseOutcome = {
   reason:"completed"|"aborted"|"timeout"|"spawn-error"|"exit-error"|"output-limit"|"io-error";
   code:number|null;signal:NodeJS.Signals|null;events:string;final:string|null;evidenceDir:string;
+  // Orca handoff delivery C-3: usage observed in the stdout of a phase that did not complete; null otherwise.
+  observedTokens:number|null;
 };
 const LIMIT=16*1024*1024;
 const execFileAsync=promisify(execFile);
@@ -19,7 +21,7 @@ export async function runCodexPhase(config:CodexConfig, request:PhaseRequest):Pr
   const root=join(context.runDir,"codex",String(context.attempt),phase);
   await mkdir(root,{recursive:true,mode:0o700});
   const evidenceDir=await mkdtemp(join(root,"call-"));
-  const result:PhaseOutcome={reason:"completed",code:null,signal:null,events:"",final:null,evidenceDir};
+  const result:PhaseOutcome={reason:"completed",code:null,signal:null,events:"",final:null,evidenceDir,observedTokens:null};
   const save=async(name:string,data:string)=>writeFile(join(evidenceDir,name),data,{mode:0o600});
   const schemaPath=join(evidenceDir,"schema.json"),finalPath=join(evidenceDir,"final.json");
   const args=[...config.command.slice(1),"exec","--json","--ephemeral","--color","never","--model",config.model,
@@ -113,5 +115,6 @@ export async function runCodexPhase(config:CodexConfig, request:PhaseRequest):Pr
       }finally{await file.close();}
     }catch{result.reason="io-error";}
   }
+  if(result.reason!=="completed")result.observedTokens=observedTurnUsage(result.events);
   return persist();
 }
diff --git a/src/runtime/types.ts b/src/runtime/types.ts
index 243cd0f..42f7633 100644
--- a/src/runtime/types.ts
+++ b/src/runtime/types.ts
@@ -130,6 +130,17 @@ export function isPartialExecutionResult(result: ExecutionResult): result is Par
   return "completionStatus" in result && result.completionStatus === "partial";
 }
 
+/**
+ * Orca handoff delivery (2026-09-25), spec §13.1 C-3: a phase that ended without a result (a handoff
+ * deadline aborted it) may still have been OBSERVED spending tokens before it was stopped. A runtime
+ * adapter reports that observation as `observedTokens` on the error it throws; anything else is "not
+ * observed" (null) — never 0, never an estimate.
+ */
+export function observedTokensOf(error: unknown): number | null {
+  const value = error !== null && typeof error === "object" ? (error as { observedTokens?: unknown }).observedTokens : undefined;
+  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
+}
+
 export type VerificationResult = {
   approved: boolean;
   rejectCategory: string;
diff --git a/tests/fixtures/fake-codex.mjs b/tests/fixtures/fake-codex.mjs
index 3243666..cb14a59 100644
--- a/tests/fixtures/fake-codex.mjs
+++ b/tests/fixtures/fake-codex.mjs
@@ -61,5 +61,10 @@ process.stdin.on("end",()=>{
   if(mode==="nonzero") process.exitCode=7;
   };
   const delay=entry?.delayMs?.[phase];
-  if(delay===undefined) respond(); else setTimeout(respond,delay);
+  if(delay===undefined) respond(); else {
+    // Orca handoff delivery C-3: `usageBeforeDelay: true` reports this call's usage before sleeping, so a
+    // phase stopped during the delay has an observation to report.
+    if(entry.usageBeforeDelay===true) process.stdout.write(JSON.stringify({type:"turn.completed",usage:{input_tokens:12,output_tokens:3}})+"\n");
+    setTimeout(respond,delay);
+  }
 });
```

- [ ] **Step 5：⛔ 既有判据闸门（ccloop Rule 15）—— 先跑全量，任何名单外的红都停下交人**

```bash
cd /Users/biran/code/skills/loop/ccloop
S="${SCRATCH:?}"
npm run typecheck > "$S/t2-typecheck.log" 2>&1; echo "RC=$?" >> "$S/t2-typecheck.log"
npm run build > "$S/t2-build.log" 2>&1; echo "RC=$?" >> "$S/t2-build.log"
./node_modules/.bin/vitest run --reporter=json --outputFile="$S/t2-ccloop.json" > "$S/t2-ccloop.log" 2>&1; echo "RC=$?" >> "$S/t2-ccloop.log"
node scripts/check-known-reds.mjs "$S/t2-ccloop.json" > "$S/t2-known-reds.log" 2>&1; echo "RC=$?" >> "$S/t2-known-reds.log"
cat "$S/t2-typecheck.log" "$S/t2-build.log" "$S/t2-known-reds.log"
```

- 名单外的红，先单文件重跑（`./node_modules/.bin/vitest run <file> > "$S/t2-rerun-<name>.log" 2>&1; echo "RC=$?" >> …; cat …`）排除负载计时红；**单跑仍红的每一条既有判据 ⇒ 停下，按「文件 > describe > it ＋ 红在哪条断言 ＋ 原因」逐条列给控制器，由人按 ccloop 人裁 88 指名后才许改写**（本 Task 没有任何既有判据的改写授权）。
- 读出来的风险点（调查席静态阅读，计划席已实测）：`tests/runtime/codex/runCodexPhase.test.ts`（`PhaseOutcome` 多一个字段；它不对整个 outcome 做 `toEqual`，16/16 绿）、`tests/runtime/codex/adapter.test.ts`（"returns null only for aborted execution…" 是预先 abort、无观测 ⇒ 仍 `null`，消息仍含 `codex-aborted`；4/4 绿）、`tests/control/handoff.test.ts` > "named handoff request" > "watches a latched deadline through packet, zero handoff usage, seal, and released lease"（`hang` 模式什么都不打印 ⇒ 仍 `[["work",null],["handoff",0]]`；6/6 绿）。
- 计划席实测（`t12-clone`，高负载 load≈35–45）：全量第一次（`t2-gate.json`，未加新判据）10 败，其中 5 条不在名单：`parseArgs > returns 0 for the scripted example run`、`isolated Codex acceptance harness > outer watchdog kills…`、`run-scenario CLI > works when invoked outside the repo root`、`run-scenario CLI > records claudeChildExited…`、`Codex phase process > refuses output-limit output` —— 全是超时／计时类，**逐个单文件重跑全绿**（`t2-rerun.log`、`t2-one.log`、`t2-rcp.log`；同一 `runCodexPhase.test.ts` 在未改的 `a5dc529` 副本上同时刻也 16/16 绿）。加新判据后的全量（`t2-full.json`）：67 文件、842 条、834 过、1 败（名单内）、**7 skipped**（`tests/validation/codexAdapter.test.ts` 整个 describe 在负载下被跳过；单跑 7/7 绿）。⇒ 本机结论：(i) 没有让任何既有判据红；**但这是在负载下测的，实施者必须在自己的时刻重测，不许抄本段。** `numPendingTests` 非 0 同样按「单跑」处理，单跑仍 skipped ⇒ 停下报告。

- [ ] **Step 6：新判据看见绿**

```bash
cd /Users/biran/code/skills/loop/ccloop
./node_modules/.bin/vitest run tests/runtime/codex/abortedUsage.test.ts tests/control/handoffDeadlineUsage.test.ts tests/runtime/codex/fakeCodexDelay.test.ts tests/runtime/codex/adapter.test.ts tests/runtime/codex/runCodexPhase.test.ts tests/control/handoff.test.ts > "${SCRATCH:?}/t2-green.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t2-green.log"; cat "${SCRATCH:?}/t2-green.log"
```

Expected：RC 0；`abortedUsage` 3/3、`handoffDeadlineUsage` 1/1、`fakeCodexDelay` 5/5、`adapter` 4/4、`runCodexPhase` 16/16、`handoff` 6/6。

- [ ] **Step 7：提交（ccloop；不 push）**

```bash
cd /Users/biran/code/skills/loop/ccloop
/usr/bin/git add src/runtime/codex/protocol.ts src/runtime/codex/runCodexPhase.ts src/runtime/codex/codexAdapter.ts src/runtime/types.ts src/controller/runLoop.ts tests/fixtures/fake-codex.mjs tests/runtime/codex/abortedUsage.test.ts tests/control/handoffDeadlineUsage.test.ts
/usr/bin/git diff --cached --stat > "${SCRATCH:?}/t2-cached.txt" 2>&1; cat "${SCRATCH:?}/t2-cached.txt"
/usr/bin/git commit -F "${SCRATCH:?}/t2-msg.txt"
```

`t2-msg.txt`：

```
feat(codex): report usage observed before a phase was aborted

For Orca's handoff delivery (spec 13.1 C-3, option (i) as the Orca controller ruled on
plan row D-C3). When a handoff deadline aborts a codex phase, runCodexPhase now returns
the last well-formed turn.completed usage its stdout already showed (observedTokens), the
adapter carries it on CodexPhaseAborted, and runLoop settles that phase with it, so the
work usage event has a known cumulative instead of null. Nothing observed stays null:
never zero, never a guess. Real codex reports usage at phase end, so a mid-turn kill
will usually still be unknown; fake codex gains usageBeforeDelay to exercise the path.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异（在 ccloop 的 `git clone --local` 副本里，T2 提交之后克隆；只跑 `tests/runtime/codex/abortedUsage.test.ts tests/control/handoffDeadlineUsage.test.ts tests/runtime/codex/adapter.test.ts tests/control/handoff.test.ts`）** —— 计划席已在 `t12-clone` 全部实跑（`t2-mut.py`／`t2-mut.log`），期望红即实测红集：

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| T2-M1 | `src/runtime/codex/runCodexPhase.ts` | 删 `if(result.reason!=="completed")result.observedTokens=observedTurnUsage(result.events);` | 中止前已打印 usage | `returns the observed tokens on an aborted outcome…`、`carries the observation on CodexPhaseAborted…`、`books the observed tokens as a known cumulative…` |
| T2-M2 | `src/runtime/codex/protocol.ts` | 删 `\|\| input + output === 0`（零 usage 不再跳过） | 末条 usage 为 0 | `reads the last well-formed turn.completed usage…` |
| T2-M3 | `src/runtime/codex/codexAdapter.ts` | 删 `if (outcome.reason === "aborted") throw new CodexPhaseAborted(…);` | plan／verify／execute 被中止 | `carries the observation on CodexPhaseAborted…`、`books the observed tokens…` |
| T2-M4 | 同上 | execute 的 catch 条件 → 还原 `if (context.abortSignal?.aborted) return null;` | execute 中止且有观测 | `carries the observation on CodexPhaseAborted…`、`books the observed tokens…` |
| T2-M5 | `src/controller/runLoop.ts` | `settlePhase(activePhase, attempt, error.elapsedMs, error.tokenUsage === null ? undefined : { tokenUsage: error.tokenUsage })` → `settlePhase(activePhase, attempt, error.elapsedMs)` | worker 级 deadline | `books the observed tokens…` |
| T2-M6 | `src/runtime/types.ts` | `observedTokensOf` 的 `return typeof value === …;` → `return null;` | 同上 | `books the observed tokens…` |
| T2-M7 | `tests/fixtures/fake-codex.mjs` | `if(entry.usageBeforeDelay===true) process.stdout.write(…)` → `if(false) process.stdout.write(…)` | `usageBeforeDelay:true` | `returns the observed tokens…`、`carries the observation…`、`books the observed tokens…` |

**若控制器改选 (ii)**（取不到观测时由某一端「结算一个上界」）：ccloop 的 codex 预算是 `soft`（F9；`src/cli.ts:324`、`docs/codex-adapter.md:27-28,78`），**没有任何可证明的 per-phase 上界** —— codex 一个 turn 能花多少 token 不受 ccloop 约束；所以 (ii) 只能是一条**策略性记账**（「按某个数记，并登记可能高估／低估」），不是 spec §13.1 C-3 字面要求的「可证明的上界」。最自然的策略是「把该 run 剩余的整份 grant 记成已花」—— 它是**自我挫败**的：记完剩余 token 为 0，而续跑注册按 spec §13.2 I-5 把 contract 截到剩余 grant、「某一维剩余为 0 ⇒ 该续跑在注册时被拒」（`budget-overrun` 一类的拒绝），于是正是这个想让它「可续」的 run 续不了。记小于剩余的任意数又没有依据（既非观测、也非上界）。⇒ 选 (ii) 须人另裁记账数的来源，并同样面对上文 D-C7′。

---

---

## Task 3：stop 侧的零件 —— restartable 新支、C1 那一支、请求体重建、`freezeRun` 记 blocker、规范字节检查点、bundle 接受 `settled-recoverable` 与复用

**Files:**
- Modify: `src/control/stopIntent.ts`（`:54` 导出 `ADOPTABLE_STATES`；`:192` 导出 `latestRequestForRun`；`:288-290` `freezeRun`；`:622` 导出 `settleHandoffRequestInTransaction`；`:650-674` `terminaliseRun` 加 restartable 支；文末加 `settleCompletedRunRequestInTransaction`、`handoffRequestFromOutbox`）
- Modify: `src/control/checkpoints.ts`（import 区；文末加 `persistCanonicalCheckpoint`）
- Modify: `src/control/resumeBundle.ts`（`:78` 前任状态；文末加 `readExistingResumeBundle`）
- Modify（**既有判据整条改写**，人裁见 spec §12）: `tests/control/stopIntent.test.ts:332-340`
- Create: `tests/control/handoffStop.test.ts`

**Interfaces:**
- Consumes: 既有 `readHandoffRequest`、`saveHandoffRequest`、`readStopIntent`、`rewriteStopIntentState`、`deriveStopState`、`setAllocationStates`、`readWork`／`saveWork`；`canonicalBytes`／`sha256Canonical`；`candidateSchema`。
- Produces（T4、T5、T9 用）：
  - `export const ADOPTABLE_STATES: string[]`（值不变：`request-pending`／`latched`／`collecting`／`outcome-unknown`）
  - `export function latestRequestForRun(store: ControlStore, groupId: string, runId: string): HandoffRequestBody | null`
  - `export type HandoffRequestBody`（今天是文件内 `type`，改 `export type`）
  - `export function settleHandoffRequestInTransaction(deps: StopDeps, groupId: string, requestId: string, outcome: HandoffDisposition, reasonCode: string | null): { state: string; groupStopState: GroupStopState }`（体不变，只导出）
  - `export function settleCompletedRunRequestInTransaction(store: ControlStore, groupId: string, requestId: string): void`
  - `export function handoffRequestFromOutbox(store: ControlStore, requestId: string): HandoffRequest`
  - `export async function persistCanonicalCheckpoint(store: ControlStore, candidate: Candidate): Promise<{ checkpointId: string; hash: string; body: string }>`
  - `export async function readExistingResumeBundle(store: ControlStore, input: { predecessorRunId: string; newSourceDir: string }): Promise<InputCheckpointV1>`

**为什么这些零件单独成一个 Task**：它们都是事务内／幂等的小函数，互不依赖驱动环；T4（H 步）与 T5（续跑）只是把它们串起来。先把它们各自钉住，T4／T5 的判据红了就能分清是零件错还是编排错。

- [ ] **Step 1：写失败的判据 `tests/control/handoffStop.test.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { persistCanonicalCheckpoint } from "../../src/control/checkpoints.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import {
  freezeRun, handoffRequestFromOutbox, readHandoffRequest, readStopIntent, saveHandoffRequest, settleCompletedRunRequestInTransaction,
  settleHandoffRequest, writeHandoffRequest,
} from "../../src/control/stopIntent.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { Candidate } from "../../src/control/types.js";
import { driverHarness } from "./fixtures/driverHarness.js";

// Handoff delivery spec §11 I9, §11 C1, §13.1 C-5, §13.2 C-1, C-6, I-10, Minor a: the stop-side parts the
// driver's H step (Task 4) and the continuation's A2 (Task 5) are assembled from.

const row = (t: Awaited<ReturnType<typeof driverHarness>>, table: "runs" | "work_items", id: string): string =>
  String(t.h.store.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id)!.body);

async function stopped(tasks = [{ taskId: "a" }]) {
  const t = await driverHarness(tasks);
  const runIds: string[] = [];
  for (let i = 0; i < tasks.length; i += 1) runIds.push(await t.claim());
  return { t, runIds };
}

async function handoffStop(t: Awaited<ReturnType<typeof driverHarness>>): Promise<string[]> {
  const result = await t.service.handoffStop(t.h.command("handoff-stop", {}));
  if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(result)}`);
  return result.result.requestIds;
}

describe("a restartable run gives its task back (spec §11 I9, Minor a)", () => {
  it("puts a plain run's task back to ready, keeps the allocation confirmed and gives nothing back to the group", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      const [requestId] = await handoffStop(t);
      const reservedBefore = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved;
      const allocationsBefore = readBudgetProposal(t.h.store, "g").allocations.filter((a) => a.ownerId === "a").map((a) => ({ state: a.state, amount: a.amount }));
      settleHandoffRequest({ store: t.h.store, profileRouter: t.h.deps.profileRouter }, { requestId: requestId!, outcome: "settled-restartable" });
      expect(t.body(runId!)).toMatchObject({ state: "settled-restartable" });
      expect(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId!)!.active).toBe(0);
      // Before this slice the task was parked `held` with no way out (stopIntent.ts terminaliseRun, review I9).
      expect(JSON.parse(row(t, "work_items", "a")).status).toBe("ready");
      expect(readBudgetProposal(t.h.store, "g").allocations.filter((a) => a.ownerId === "a").map((a) => ({ state: a.state, amount: a.amount }))).toEqual(allocationsBefore);
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).reserved).toEqual(reservedBefore);
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.map((run) => run.state)).toEqual(["settled-restartable"]);
    } finally { await t.h.dispose(); }
  });
});

describe("a run that finished settles its request on its own (spec §11 C1)", () => {
  it("marks only the request settled-recoverable: the run, its work item and the allocations are not touched", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      const [requestId] = await handoffStop(t);
      const before = { run: row(t, "runs", runId!), work: row(t, "work_items", "a"), proposal: JSON.stringify(readBudgetProposal(t.h.store, "g")) };
      t.h.store.transaction(() => settleCompletedRunRequestInTransaction(t.h.store, "g", requestId!));
      expect(readHandoffRequest(t.h.store, "g", requestId!).request.state).toBe("settled-recoverable");
      expect({ run: row(t, "runs", runId!), work: row(t, "work_items", "a"), proposal: JSON.stringify(readBudgetProposal(t.h.store, "g")) }).toEqual(before);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
      // A second call is the same settlement, not a second one.
      t.h.store.transaction(() => settleCompletedRunRequestInTransaction(t.h.store, "g", requestId!));
      expect(readHandoffRequest(t.h.store, "g", requestId!).request.state).toBe("settled-recoverable");
    } finally { await t.h.dispose(); }
  });
});

describe("the delivered request is rebuilt from its original outbox row (spec §13.2 I-10)", () => {
  it("maps a human stop to reason human and keeps the outbox deadline even after the request row's deadline is shortened", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      const [requestId] = await handoffStop(t);
      const intent = readStopIntent(t.h.store, "g")!;
      const built = handoffRequestFromOutbox(t.h.store, requestId!);
      expect(built).toEqual({ protocol: 1, requestId, runId, generation: 1, reason: "human", deadlineAt: intent.deadlineAt });
      // adoptRequest/deliverHandoffStop shorten the row, never the outbox: ccloop judges a replay by the whole
      // request's canonical hash (ccloop handoff.ts), so a replay must carry the bytes first sent.
      const { request } = readHandoffRequest(t.h.store, "g", requestId!);
      t.h.store.transaction(() => saveHandoffRequest(t.h.store, "g", { ...request, deadlineAt: "2026-01-01T00:00:00.000Z" }));
      expect(handoffRequestFromOutbox(t.h.store, requestId!)).toEqual(built);
    } finally { await t.h.dispose(); }
  });

  it("maps a shutdown freeze to reason shutdown", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      const requestId = t.h.store.transaction(() => freezeRun(t.h.store, "g", runId!, "shutdown", 99, "2026-09-25T00:00:00.000Z", "2026-09-25T00:02:00.000Z"));
      expect(handoffRequestFromOutbox(t.h.store, requestId)).toMatchObject({ reason: "shutdown", deadlineAt: "2026-09-25T00:02:00.000Z", runId });
    } finally { await t.h.dispose(); }
  });
});

describe("a stop never loses its brake over one contradictory run (spec §13.1 C-5)", () => {
  it("records the run whose request already settled as a recovery blocker and still freezes the group's other run", async () => {
    const { t, runIds } = await stopped([{ taskId: "a" }, { taskId: "b" }]); try {
      const [settledRun, liveRun] = runIds;
      t.h.store.transaction(() => writeHandoffRequest(t.h.store, { requestId: "handoff-old", runId: settledRun!, state: "settled-recoverable", deadlineAt: "2026-09-25T00:30:00.000Z", phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [] }, "g"));
      const requestIds = await handoffStop(t);
      expect(requestIds).toHaveLength(2);
      expect(requestIds).toContain("handoff-old");
      const fresh = requestIds.find((id) => id !== "handoff-old")!;
      expect(readHandoffRequest(t.h.store, "g", fresh).request).toMatchObject({ runId: liveRun, state: "request-pending" });
      expect(t.h.store.db.prepare("SELECT run_id,scope,code FROM recovery_blockers WHERE group_id='g'").all().map((r) => ({ ...r })))
        .toEqual([{ run_id: settledRun, scope: "run", code: "handoff-request-already-settled" }]);
    } finally { await t.h.dispose(); }
  });
});

describe("a handoff checkpoint is stored as canonical bytes (spec §13.2 C-1)", () => {
  const candidate = (runId: string, checkpointId = `settle-${runId}-0123456789abcdef`): Candidate => ({
    groupId: "g", workItemId: "a", taskId: "a", runId, generation: 1, graphVersion: 1, targetVersion: 1, checkpointId, usageHighWater: 2,
    result: "partial", artifacts: [{ artifactId: "x", hash: "a".repeat(64) }], snapshot: { artifactId: "s", hash: "b".repeat(64) }, missing: [],
    unresolvedRequestIds: [], stopProof: { executionId: "e", generation: 1, isolated: true, source: { artifactId: "p", hash: "c".repeat(64) } },
    terminalOutcome: "executing", handoff: { artifactId: "h", hash: "d".repeat(64) },
  });

  it("writes the file as canonicalBytes and answers sha256Canonical, the identity all three readers accept, and a replay is a no-op", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      const c = candidate(runId!);
      const first = await persistCanonicalCheckpoint(t.h.store, c);
      const path = join(t.h.store.stateDir, "checkpoints", runId!, `${c.checkpointId}.json`);
      expect(readFileSync(path).equals(canonicalBytes(c))).toBe(true);
      expect(first).toEqual({ checkpointId: c.checkpointId, hash: sha256Canonical(c), body: canonicalBytes(c).toString("utf8") });
      // exportResumeBundle hashes JSON.stringify(JSON.parse(file)); on canonical bytes that is the same hash.
      expect(Buffer.from(JSON.stringify(JSON.parse(readFileSync(path, "utf8")))).equals(canonicalBytes(c))).toBe(true);
      expect(await persistCanonicalCheckpoint(t.h.store, c)).toEqual(first);
    } finally { await t.h.dispose(); }
  });

  it("refuses different bytes under an id already written", async () => {
    const { t, runIds: [runId] } = await stopped(); try {
      await persistCanonicalCheckpoint(t.h.store, candidate(runId!));
      await expect(persistCanonicalCheckpoint(t.h.store, { ...candidate(runId!), usageHighWater: 3 })).rejects.toThrow("checkpoint-id-conflict");
      expect(existsSync(join(t.h.store.stateDir, "checkpoints", runId!))).toBe(true);
    } finally { await t.h.dispose(); }
  });
});
```

条数：7。

- [ ] **Step 2：跑，看见红**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/handoffStop.test.ts > "${SCRATCH:?}/t3-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t3-red.log"; cat "${SCRATCH:?}/t3-red.log"
```

预言：import 失败（`settleCompletedRunRequestInTransaction`／`handoffRequestFromOutbox`／`persistCanonicalCheckpoint` 未导出）⇒ 整个文件红，RC 1。补上导出之前先确认日志里是这个原因，不是别的。

- [ ] **Step 3：`src/control/stopIntent.ts`**

(a) `:54` 与 `:79`、`:192` 三处只加 `export`：

```ts
export const ADOPTABLE_STATES = [...OPEN_STATES, "outcome-unknown"];
```
```ts
export type HandoffRequestBody = z.infer<typeof handoffRequestBodySchema>;
```
```ts
export function latestRequestForRun(store: ControlStore, groupId: string, runId: string): HandoffRequestBody | null {
```

(b) `:622` 同样只加 `export`（函数体一字不改）：

```ts
export function settleHandoffRequestInTransaction(
```

(c) `freezeRun`（`:288-290`）把 `if (!ADOPTABLE_STATES.includes(existing.state)) return blocked("handoff-request-already-settled");` 换成：

```ts
    if (!ADOPTABLE_STATES.includes(existing.state)) {
      // Handoff delivery spec §13.1 C-5 (human ruling 2026-09-25) with Web spec §6.2: an active run whose request
      // already settled is a contradiction to record, not a reason to refuse the whole stop -- the group's other
      // runs still have to stop. It never opens a second request for the run.
      store.db.prepare("INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES (?,?,?,'run','handoff-request-already-settled',?) ON CONFLICT(id) DO NOTHING")
        .run(`handoff-settled-active:${runId}:${existing.requestId}`, groupId, runId, canonicalBytes({ evidenceIds: [] }).toString("utf8"));
      recordProjectionChange(store, [groupId]);
      return existing.requestId;
    }
```

(d) `terminaliseRun`：在 `if (outcome === "settled-unrecoverable") {`（`:660`）**之前**插入：

```ts
  if (outcome === "settled-restartable") {
    // Handoff delivery spec §11 I9, §13.2 C-6, Minor a (controller decisions, 2026-09-25): a run proved never to
    // have started keeps the task's commitment -- nothing is released. A plain run's task is claimable again and
    // its allocation stays `confirmed`; a continuation gives the task back to the predecessor it continued, so
    // that predecessor's checkpoint can be chosen again (otherwise its half-done work is silently dropped).
    const record = work as unknown as { status: string; currentRunId: string | null; pendingRunId: string | null; continuation?: { continuationIntentId: string; predecessorRunId: string } | null };
    const continuationIntentId = typeof run.continuationIntentId === "string" ? run.continuationIntentId : null;
    if (continuationIntentId !== null) {
      const registered = record.continuation ?? null;
      if (registered === null || registered.continuationIntentId !== continuationIntentId) return blocked(`restartable-continuation:${run.runId}`);
      Object.assign(record, { status: "held", currentRunId: registered.predecessorRunId, pendingRunId: null, continuation: null });
      saveWork(store, groupId, record as never);
      setAllocationStates(store, groupId, run.workItemId, "held");
      return;
    }
    record.status = "ready";
    saveWork(store, groupId, record as never);
    return;
  }
```

(e) 文末追加（import 区加 `import type { HandoffRequest } from "./types.js";`）：

```ts
/**
 * Handoff delivery spec §11 C1 (with §13.2 I-1): a frozen run the driver settled through its own E step already
 * has its final run, work and allocation state; its request then settles recoverably on its own. Never
 * `terminaliseRun`, which would park a finished task as `held`. Idempotent: a closed request is left alone.
 */
export function settleCompletedRunRequestInTransaction(store: ControlStore, groupId: string, requestId: string): void {
  const request = readHandoffRequest(store, groupId, requestId).request;
  if (!ADOPTABLE_STATES.includes(request.state)) return;
  saveHandoffRequest(store, groupId, { ...request, state: "settled-recoverable", failureCode: null });
  const intent = readStopIntent(store, groupId);
  if (intent && intent.mode !== "pause") rewriteStopIntentState(store, groupId, intent, deriveStopState(store, groupId, intent.frozenRunIds));
}

const handoffOutboxSchema = z.object({
  desiredRequestId: z.string().min(1), requestId: idSchema, groupId: idSchema, runId: idSchema, generation: safeInteger.positive(),
  origin: z.enum(["handoff", "shutdown"]), acceptedAt: canonicalTimestampSchema, deadlineAt: canonicalTimestampSchema,
}).strict();

/**
 * Handoff delivery spec §13.2 I-10 (controller decision): the request the driver sends ccloop is rebuilt from the
 * request's original outbox row, never from the request row -- `adoptRequest` and `deliverHandoffStop` shorten
 * the row's deadline, and ccloop judges a replay by the whole request's canonical hash, so only the first bytes
 * replay safely. A shortened deadline therefore never reaches ccloop (registered, spec §11 I4).
 */
export function handoffRequestFromOutbox(store: ControlStore, requestId: string): HandoffRequest {
  const row = store.db.prepare("SELECT body FROM outbox WHERE kind='handoff-request' AND json_extract(body,'$.requestId')=? ORDER BY rowid LIMIT 1").get(requestId);
  if (!row) return blocked(`handoff-outbox-missing:${requestId}`);
  const body = parseStored(handoffOutboxSchema, String(row.body), "handoff-outbox-invalid");
  return { protocol: 1, requestId: body.requestId, runId: body.runId, generation: body.generation, reason: body.origin === "shutdown" ? "shutdown" : "human", deadlineAt: body.deadlineAt };
}
```

（`z`、`idSchema`、`safeInteger`、`canonicalTimestampSchema`、`parseStored`、`blocked`、`recordProjectionChange` 都已在本文件 import／定义；legacy `service.ts` 的 `handoff-request` outbox 行形状是 `{workItemId,request}`，`$.requestId` 为 NULL，不会被本查询选中。）

- [ ] **Step 4：`src/control/checkpoints.ts`**（本文件是紧凑风格，照它写）

import 区：`:1` 不动；`:3` 改为 `import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";`；加一行 `import { canonicalBytes } from "./canonicalJson.js";`。文末追加：

```ts
/**
 * Handoff delivery spec §13.2 C-1 (controller decision): a handoff checkpoint's file and its row body are one and
 * the same canonical bytes, and its hash is sha256Canonical(candidate) -- the only identity that
 * readCommittedCheckpoint (file == body), exportResumeBundle (JSON.stringify(JSON.parse(file))) and
 * assertPredecessor (sha256Canonical) all accept. persistImmutableCheckpoint's JSON.stringify(c) keeps the
 * schema's key order and fails assertPredecessor by construction. Idempotent on equal bytes.
 */
export async function persistCanonicalCheckpoint(store:ControlStore,candidate:Candidate):Promise<{checkpointId:string;hash:string;body:string}> {
 const c=candidateSchema.parse(candidate),bytes=canonicalBytes(c),hash=createHash("sha256").update(bytes).digest("hex");
 const dir=privateDirectory(join(store.stateDir,"checkpoints",c.runId)),path=join(dir,c.checkpointId+".json");
 const same=():boolean=>{assertRegular(path);if(!readFileSync(path).equals(bytes))throw new ControlError("checkpoint-id-conflict");return true;};
 if(existsSync(path)&&same())return {checkpointId:c.checkpointId,hash,body:bytes.toString("utf8")};
 const temp=join(dir,".staging-"+randomUUID());
 const file=await open(temp,"wx",0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 store.assertOwner();
 if(existsSync(path)){unlinkSync(temp);same();}else{renameSync(temp,path);syncDirectory(dir);}
 return {checkpointId:c.checkpointId,hash,body:bytes.toString("utf8")};
}
```

- [ ] **Step 5：`src/control/resumeBundle.ts`**

`:78` 改为（`readRun` 的类型只列 legacy 状态，Web 的 `settled-recoverable` 要断言成 `string` 比）：

```ts
  // Handoff delivery spec §11 C2: a Web predecessor settled by the driver's H-settle is `settled-recoverable`.
  if ((run.state !== "settled" && (run.state as string) !== "settled-recoverable") || !run.recoverable || !run.checkpointId) throw new ControlError("resume-predecessor-unrecoverable");
```

文末追加：

```ts
/**
 * Handoff delivery spec §11 I5: exportResumeBundle is not idempotent (a second export is `resume-bundle-exists`),
 * so a continuation whose A2 died after exporting reuses the published bundle -- re-verified against the
 * predecessor's committed checkpoint before its identity is handed to ccloop again.
 */
export async function readExistingResumeBundle(store: ControlStore, input: { predecessorRunId: string; newSourceDir: string }): Promise<InputCheckpointV1> {
  const checkpoint = await readCommittedCheckpoint(store, input.predecessorRunId);
  const checkpointHash = sha256(Buffer.from(JSON.stringify(checkpoint)));
  const row = store.db.prepare("SELECT hash FROM checkpoints WHERE id=? AND run_id=?").get(checkpoint.checkpointId, checkpoint.runId);
  if (!row || String(row.hash) !== checkpointHash) throw new ControlError("checkpoint-hash-mismatch");
  const bundlePath = join(input.newSourceDir, "input", checkpoint.checkpointId);
  const manifest = JSON.parse((await rereadRegular(join(bundlePath, "resume-bundle.json"))).toString()) as ResumeBundleV1;
  if (manifest.protocol !== 1 || manifest.predecessorRunId !== input.predecessorRunId || manifest.checkpointId !== checkpoint.checkpointId
    || manifest.checkpointHash !== checkpointHash) throw new ControlError("resume-bundle-hash-mismatch");
  await rereadRegular(join(bundlePath, "checkpoint.json"), checkpointHash);
  return { predecessorRunId: input.predecessorRunId, checkpointId: checkpoint.checkpointId, checkpointHash, bundlePath };
}
```

（`readExistingResumeBundle` 的判据在 T5：A2 在 bundle 之后崩溃 ⇒ 重启复用。`exportResumeBundle` 接受 `settled-recoverable` 的判据在 T4：H-settle 之后直接导出。）

- [ ] **Step 6：改写既有判据 `tests/control/stopIntent.test.ts:332-340`**（人裁 spec §12，守 88 (b)(c)；整条替换为）：

```ts
  // Handoff delivery (human ruling 2026-09-25, spec §12: this slice may rewrite criteria; ruling 88 (b)(c)): spec §13.1 C-5 --
  // an active run whose only request already settled is recorded as a run-scope recovery blocker (Web spec §6.2) and the
  // stop is not refused as a whole; the run still never gets a second request.
  it("treats an active run whose only request already settled as a recovery blocker, not as permission for a second request", async () => {
    const { h, service } = await startedFixture(); try {
      const runId = workRuns(h.store).find((run) => run.phase === "work")!.runId;
      const existing = seedRequest(h.store, "g", runId, "settled-recoverable", "2026-09-20T11:00:00.000Z");
      const result = await service.handoffStop(h.command("handoff-stop", {}));
      if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(result)}`);
      expect(result.result.requestIds).toEqual([existing]);
      expect(requests(h.store).map((request) => request.requestId)).toEqual([existing]);
      expect(h.store.db.prepare("SELECT run_id,scope,code FROM recovery_blockers WHERE group_id='g'").all().map((row) => ({ ...row })))
        .toEqual([{ run_id: runId, scope: "run", code: "handoff-request-already-settled" }]);
      expect(readStopIntent(h.store, "g")).toMatchObject({ mode: "handoff", frozenRunIds: [runId] });
    } finally { await h.dispose(); }
  });
```

旧三条断言的去向：「不开第二个请求」保留（两行）；「当 recovery blocker」由「命令整体失败」改为「有一行 run 级 blocker」（这是人裁 C-5 的内容）；「无 stop intent」反转为「stop intent 存在」（刹车不失效）。**不放宽**。

- [ ] **Step 7：跑，看见绿**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/handoffStop.test.ts tests/control/stopIntent.test.ts tests/control/resumeBundle.test.ts tests/control/checkpointRecoverability.test.ts tests/control/checkpoints.test.ts tests/control/webContinuation.test.ts tests/control/webContinuationAccounting.test.ts > "${SCRATCH:?}/t3-green.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t3-green.log"; cat "${SCRATCH:?}/t3-green.log"
npm run typecheck > "${SCRATCH:?}/t3-typecheck.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t3-typecheck.log"; cat "${SCRATCH:?}/t3-typecheck.log"
```

Expected：`handoffStop` 7/7；`stopIntent.test.ts` 全绿（含改写的那条；计划席的探针里，把 C-5 与 restartable 两处改动同时打上后，本文件只有被改写的那一条红，restartable 的几条估算器判据照绿 —— `scratchpad/planner/probe-summ.txt`）；其余文件全绿；typecheck RC 0。

- [ ] **Step 8：变异表**（T10 的变异席在副本里跑）

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| T3-M1 | `stopIntent.ts` | 删掉 restartable 支整段（回到 held） | restartable | `handoffStop` 第 1 条（work 仍 `held`） |
| T3-M2 | 同上 | restartable 支里改成 `setAllocationStates(..., "held")`（非续跑也改分配） | 同上 | `handoffStop` 第 1 条（allocation 不等） |
| T3-M3 | 同上 | 删续跑子支（续跑也回 `ready`） | T5 的 C-6 判据 | `driverContinuation` 的「续跑在 A1 被 stop」那条 |
| T3-M4 | 同上 | `settleCompletedRunRequestInTransaction` 改调 `terminaliseRun` | C1 | `handoffStop` 第 2 条（run／work 字节变了） |
| T3-M5 | 同上 | `handoffRequestFromOutbox` 的 `deadlineAt` 改取请求行 | 缩短 deadline | `handoffStop` 第 3 条 |
| T3-M6 | 同上 | `reason` 映射恒 `"human"` | shutdown 冻结 | `handoffStop` 第 4 条 |
| T3-M7 | 同上 | `freezeRun` 恢复 `return blocked(...)` | 已 settle 的 active run | `handoffStop` 第 5 条 **与** 改写后的 `stopIntent` 那条 |
| T3-M8 | `checkpoints.ts` | `bytes=canonicalBytes(c)` 换回 `Buffer.from(JSON.stringify(c))` | 规范字节 | `handoffStop` 第 6 条 **与** T4 的 C-1 判据（H-settle 后导出＋注册） |
| T3-M9 | 同上 | 删 `same()` 里的字节比较 | 同 id 不同字节 | `handoffStop` 第 7 条 |
| T3-M10 | `resumeBundle.ts` | `:78` 删掉 `settled-recoverable` 分支 | H-settle 后导出 | T4 的 C-1 判据、T5 全部续跑判据 |
| T3-M11 | 同上 | `readExistingResumeBundle` 删 manifest 核验 | T5 的 A2-after-bundle | 预言不红（复用路径只在崩溃后走，manifest 正确时核验恒过）⇒ 登记「该核验无独占判据」，除非 T5 另有一条篡改 manifest 的判据 —— T5 有（见 T5 Step 1 第 5 条） |

- [ ] **Step 9：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/stopIntent.ts src/control/checkpoints.ts src/control/resumeBundle.ts tests/control/stopIntent.test.ts tests/control/handoffStop.test.ts
/usr/bin/git diff --cached --stat > "${SCRATCH:?}/t3-cached.txt"; cat "${SCRATCH:?}/t3-cached.txt"
/usr/bin/git commit -F "${SCRATCH:?}/t3-msg.txt"
```

`t3-msg.txt`：

```
feat(control): stop-side parts for handoff delivery

A restartable run gives its task back (a continuation gives it back to its
predecessor) instead of parking it held; a run that finished on its own settles
its request without terminaliseRun; the delivered request is rebuilt from its
original outbox row; a stop records an active run with a settled request as a
run blocker instead of refusing the whole stop (human ruling, spec 13.1 C-5);
handoff checkpoints are canonical bytes; a resume bundle accepts a
settled-recoverable predecessor and can be reused after a crash. One existing
criterion rewritten under the human ruling of spec 12.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

---

## Task 4：驱动环的 H 步 —— 投递、收集、H-settle、restartable、blocked 分支轴、宽限期、X1；以及让读模型读得出 held 的前任（D-SNAP、D-VIEW）

**Files:**
- Create: `src/control/driverHandoff.ts`（H 步全部）
- Modify: `src/control/executionDriver.ts`（`:36` `CrashPoint`；`:59` 之后 deps 两个字段；`:312-335` 把 stepC 的收集半段抽成 `collectInto`，并加 X1；`:364` 导出 `savedReport`；`:544` 一轮的遍历与分流；import 区一行）
- Modify: `src/control/executionSnapshot.ts`（`:259` 之前加 `frozenAllocationShape`；`:268` 比对）—— **偏离 D-SNAP，待控制器裁定**
- Modify: `src/panel/controlViews.ts`（import；`:297`、`:305` 同一比对；`:494` run 与 work 的 grant 比对）—— **偏离 D-SNAP、D-VIEW，待控制器裁定**
- Modify（夹具，只加）: `tests/control/fixtures/driverPort.ts`（三个新行为、`calls.handoff`、`requestHandoff` 的 ccloop 语义）
- Create: `tests/control/driverHandoff.test.ts`

**Interfaces:**
- Consumes（T3）：`ADOPTABLE_STATES`、`latestRequestForRun`、`settleHandoffRequestInTransaction`、`settleCompletedRunRequestInTransaction`、`handoffRequestFromOutbox`、`readHandoffRequest`／`saveHandoffRequest`、`persistCanonicalCheckpoint`；既有 `archiveRun`、`verifyCandidateArtifacts`、`hasObservedUsage`、`cleanupRunWorkspace`、`isWebWorkRun`。
- Produces：
  - `src/control/driverHandoff.ts`：`HANDOFF_EXTRA_GRACE_MS = 60_000`；`openRequestOf(store, run): HandoffRequestBody | null`；`handoffRunIds(store): string[]`；`visitOrder(store): string[]`；`stepH(deps, runId, context): Promise<boolean>`；`restartRun(deps, runId, requestId): Promise<boolean>`；`settleHandoffCheckpoint(deps, runId, requestId, report): Promise<boolean>`
  - `src/control/executionDriver.ts`：`CrashPoint` 加 `"H-after-deliver" | "H-after-candidate" | "H-between-commit-and-settle" | "A2-after-bundle"`（最后一个由 T5 用）；`ExecutionDriverDeps.now?: () => Date`、`ExecutionDriverDeps.handoffGraceMs?: number`（T9 的装配传 `killGraceMs + HANDOFF_EXTRA_GRACE_MS`）；`export async function collectInto(deps, run): Promise<ExecutionReport>`；`export async function savedReport(store, runId)`
  - `src/control/executionSnapshot.ts`：`export function frozenAllocationShape(allocations)`
  - 夹具 `FakeBehaviour` 加 `"stoppable" | "stoppable-silent" | "orphan-candidate"`；`FakeCcloop.calls.handoff: HandoffRequest[]`

**这一步的形状**（spec §3 表 ＋ §11 C1–C4、I1–I5、I9 ＋ §13.1 C-5 ＋ §13.2 C-1、I-1、I-2、I-3、I-10）：

| run 所处（有未完请求时） | H 做什么 | 请求的结局 |
|---|---|---|
| `starting`；`start-pending` 且 `prepared:false` | 删 A2 可能建的工作区 → restartable 支（T3） | `settled-restartable` |
| `start-pending` 且 `prepared:true`；`unknown` | `inspect`：`absent` ⇒ 同上；`accepted`／`stopped` ⇒ 记 `executionId`、转 `accepted`，下一轮投递；`unknown` ⇒ 计数，满 `INSPECT_UNKNOWN_LIMIT` ⇒ | `outcome-unknown` |
| `accepted` | `request-pending` ⇒ 用 outbox 原字节投递（`latched`／`complete` 即落 `collecting`）；之后每轮 `collectInto`：有终态 ⇒ 交回 `stepC`（跑完了，照常 C→D→E）；有 stopProof 无终态 ⇒ H-settle；宽限期过了仍什么都没有 ⇒ | `settled-recoverable`／`settled-unrecoverable`／`outcome-unknown`（后者继续收集，不杀 ccloop） |
| `collected`／`landed`／`reconciling` | 不打断，照常 `advance` | run settle 后走下一行 |
| `settled` | C1 那一支（第二个事务） | `settled-recoverable` |
| `blocked` | 按「ccloop 可能还在跑吗」分（§13.2 I-3）：有 outcome 或 blockedAt∈{D,R,E} ⇒ 用 C 存下的报告 H-settle（§13.1 C-5）；blockedAt∈{A1,A2} 或 B 的 `accept-refused` ⇒ restartable；其余 ⇒ 无 `executionId` 先 inspect、有则投递＋收集。**已落地（`landedCommit` 非空）的不收口**，等人 `recovery-retry` ⇒ E ⇒ C1（偏离 D-LANDED） | 同上 |

H-settle ＝ 外部段（`archiveRun`、`persistCanonicalCheckpoint`，都幂等）＋ **一个**事务（插检查点行、置 `checkpointId`／`recoverable`、`settleHandoffRequestInTransaction` 的 recoverable／unrecoverable 记账、重算 stop 状态）。**不经 `commitCandidate`**（它的 `releaseRunReserve` 会把挂起的承诺放掉）。可续与否按 Web §6.2 的硬条件逐条判，不满足的写进 `failureCode`（`unresolved-requests`／`usage-unsettled`／`missing:<…>`／`snapshot-missing`），面板看得见为什么。

**计划席实测（为什么要 D-SNAP、D-VIEW）**：只做 H-settle 时，同组此后任何 run 的 A2 都抛 `recovery-blocked`（`readConfirmedTaskExecution` 的分配比对，`executionSnapshot.ts:268`），面板读模型整组报 `execution-snapshot-identity`（`controlViews.ts:305`）与 `run-work-identity`（`:494`）。原因是 Web §5.1.1（`terminaliseRun`，`stopIntent.ts:670-672`）把 held 的分配额与 `work.grant` 改成剩余额，而这三处比对都假定它们在确认后永不变。探针日志：`scratchpad/planner/val-t5.log` 之前的那一版（A2 `recovery-blocked`，栈顶 `executionSnapshot.ts:268`）、`val-view.log` 之前的 `run-work-identity`。两处放宽的范围都只到「被 §5.1.1 结算过的那部分」，见 §0.1 D-SNAP、D-VIEW。

- [ ] **Step 1：夹具 `tests/control/fixtures/driverPort.ts`**（只加：三个新行为、`calls.handoff`；`requestHandoff` 按 ccloop `handoff.ts:137-160` 的语义答 —— 未 accept 拒、同一请求重放答同值（有 candidate 答 `complete`）、不同请求 `control-handoff-conflict`；既有行为的报告一字不变）

```diff
diff --git a/tests/control/fixtures/driverPort.ts b/tests/control/fixtures/driverPort.ts
index 40712af..c4ec4bb 100644
--- a/tests/control/fixtures/driverPort.ts
+++ b/tests/control/fixtures/driverPort.ts
@@ -5,5 +5,5 @@ import { dirname, join } from "node:path";
 import { ControlError } from "../../../src/control/errors.js";
 import type { ExecutionPort, ExecutionReport, StartEnvelope } from "../../../src/control/executionPort.js";
-import type { ArtifactRef, Candidate, UsageEvent } from "../../../src/control/types.js";
+import type { ArtifactRef, Candidate, HandoffRequest, UsageEvent } from "../../../src/control/types.js";
 import type { CapabilityViewV1 } from "../../../src/control/webProtocol.js";
 
@@ -15,9 +15,13 @@ import type { CapabilityViewV1 } from "../../../src/control/webProtocol.js";
  * terminal. Evidence bytes are served back by reference.
  */
-export type FakeBehaviour = "succeed" | "unknown" | "forget-first-accept" | "lost-accept" | "refuse" | "wrong-config" | "exhausted";
+export type FakeBehaviour = "succeed" | "unknown" | "forget-first-accept" | "lost-accept" | "refuse" | "wrong-config" | "exhausted"
+  // Handoff delivery (Task 4): runs until a handoff request arrives, then stops at a boundary with a candidate and
+  // no terminal; `-silent` latches the request but never produces anything; `orphan-candidate` reports a proved
+  // stop with no terminal and no request at all (criterion X1).
+  | "stoppable" | "stoppable-silent" | "orphan-candidate";
 
 export interface FakeCcloop {
   port: ExecutionPort;
-  calls: { accept: StartEnvelope[]; inspect: number; collect: number };
+  calls: { accept: StartEnvelope[]; inspect: number; collect: number; handoff: HandoffRequest[] };
 }
 
@@ -32,5 +36,6 @@ export function fakeCcloopPort(input: {
   workTokens?: (workItemId: string) => number;
 }): FakeCcloop {
-  const calls = { accept: [] as StartEnvelope[], inspect: 0, collect: 0 };
+  const calls = { accept: [] as StartEnvelope[], inspect: 0, collect: 0, handoff: [] as HandoffRequest[] };
+  const handoffs = new Map<string, HandoffRequest>();
   const executions = new Map<string, string>();
   const forgotten = new Set<string>();
@@ -45,5 +50,5 @@ export function fakeCcloopPort(input: {
     put(`stop-${runId}`, Buffer.from(JSON.stringify({ isolated: true, executionId, generation })));
 
-  const execute = (envelope: StartEnvelope, executionId: string): ExecutionReport => {
+  const execute = (envelope: StartEnvelope, executionId: string, stop: { request: HandoffRequest | null; terminal: boolean } = { request: null, terminal: true }): ExecutionReport => {
     const { claim, work } = envelope;
     const workspace = (work.contract as { context: { repoPath: string } }).context.repoPath;
@@ -71,5 +76,5 @@ export function fakeCcloopPort(input: {
         generation: claim.generation, graphVersion: claim.graphVersion, targetVersion: claim.targetVersion,
       },
-      request: null, runState: { status: outcome },
+      request: stop.request, runState: { status: stop.terminal ? outcome : "executing" },
       completed: [] as string[], unfinished: [] as string[], pendingDecisions: [] as string[],
       awaitingHuman: [] as string[], validationCommands: [] as string[], rawLogs: [] as unknown[],
@@ -81,7 +86,7 @@ export function fakeCcloopPort(input: {
       result: outcome === "succeeded" ? "complete" : "partial", artifacts: [], snapshot: null, missing: [], unresolvedRequestIds: [],
       stopProof: { executionId, generation: claim.generation, isolated: true, source: stopSource(claim.runId, executionId, claim.generation) },
-      terminalOutcome: outcome, handoff: put(`handoff-${claim.runId}`, Buffer.from(JSON.stringify(handoffPacket))),
+      terminalOutcome: stop.terminal ? outcome : "executing", handoff: put(`handoff-${claim.runId}`, Buffer.from(JSON.stringify(handoffPacket))),
     };
-    return { events, candidate, terminal: { outcome, attemptSha: null, sourceDir: work.sourceDir, repoDir: repo } };
+    return { events, candidate, terminal: stop.terminal ? { outcome, attemptSha: null, sourceDir: work.sourceDir, repoDir: repo } : null };
   };
 
@@ -117,4 +122,12 @@ export function fakeCcloopPort(input: {
       if (executionId === undefined) return { events: [], candidate: null, terminal: null };
       let report = reports.get(envelope.claim.runId);
+      const behaviour = input.behaviour(envelope.claim.workItemId);
+      if (report === undefined && (behaviour === "stoppable" || behaviour === "stoppable-silent")) {
+        const request = handoffs.get(envelope.claim.runId);
+        if (request === undefined || behaviour === "stoppable-silent") return { events: [], candidate: null, terminal: null };
+        report = execute(envelope, executionId, { request, terminal: false });
+        reports.set(envelope.claim.runId, report);
+      }
+      if (report === undefined && behaviour === "orphan-candidate") { report = execute(envelope, executionId, { request: null, terminal: false }); reports.set(envelope.claim.runId, report); }
       if (report === undefined) { report = execute(envelope, executionId); reports.set(envelope.claim.runId, report); }
       return { ...report, events: report.events.filter((event) => event.eventSeq > afterSeq) };
@@ -125,5 +138,15 @@ export function fakeCcloopPort(input: {
       return bytes;
     },
-    requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }),
+    // ccloop's control handoff (ccloop src/control/handoff.ts): an accepted execution latches the request, a replay
+    // of the same request is answered again (`complete` once a candidate exists), a different one is a conflict.
+    async requestHandoff(envelope, request) {
+      calls.handoff.push(structuredClone(request));
+      const runId = envelope.claim.runId;
+      if (!executions.has(runId)) throw new ControlError("control-peer-exit", "2:control-handoff-not-accepted");
+      const existing = handoffs.get(runId);
+      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(request)) throw new ControlError("control-peer-exit", "2:control-handoff-conflict");
+      handoffs.set(runId, request);
+      return reports.has(runId) ? { kind: "complete", requestId: request.requestId, checkpointId: `candidate-${runId}` } : { kind: "latched", requestId: request.requestId };
+    },
   };
   return { port, calls };
```

（原 `requestHandoff` 恒答 `unknown`，`:127`；它在 `src/` 里没有驱动环调用方，既有判据无一依赖这个答复 —— 计划席全套跑过，见 Step 7。）

- [ ] **Step 2：写失败的判据 `tests/control/driverHandoff.test.ts`**

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { DriverCrash, createExecutionDriver, stepA1, stepA2, type CrashPoint } from "../../src/control/executionDriver.js";
import { HANDOFF_EXTRA_GRACE_MS } from "../../src/control/driverHandoff.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { exportResumeBundle } from "../../src/control/resumeBundle.js";
import { handoffRequestFromOutbox, readHandoffRequest, readStopIntent } from "../../src/control/stopIntent.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Handoff delivery spec §3 (with §11 C1-C4, I1-I5, I9; §12(2); §13.1 C-5; §13.2 C-1, I-1..I-3, I-10): the
// driver's step H against the synthetic ccloop. A stop always ends in a settled request (or outcome-unknown),
// a run's change is either landed whole or parked whole in a checkpoint, and nothing is landed half-way.

// Every scenario drives real git through many rounds; under a loaded machine the vitest default of 5 s is not a
// bound on correctness (the execution driver round saw the same, tests/control/driverSettle.test.ts).
type Harness = Awaited<ReturnType<typeof driverHarness>>;

async function stop(t: Harness): Promise<string[]> {
  const result = await t.service.handoffStop(t.h.command("handoff-stop", {}));
  if ("error" in result || result.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(result)}`);
  return result.result.requestIds;
}
const requestState = (t: Harness, requestId: string): string => readHandoffRequest(t.h.store, "g", requestId).request.state;
const requestOf = (t: Harness, runId: string): string =>
  String(t.h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=? ORDER BY rowid DESC LIMIT 1").get(runId)!.id);
const work = (t: Harness, taskId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const allocation = (t: Harness, taskId: string) => readBudgetProposal(t.h.store, "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work")!;
/** The group's reserved plus used, per dimension: booking usage moves an amount from one to the other, releasing a commitment lowers it. */
const committedAndUsed = (t: Harness): number[] => {
  const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  return (["tokens", "activeMs", "attempts", "sessions"] as const).map((d) => group.reserved[d] + group.used[d]);
};
const active = (t: Harness, runId: string): number => Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active);
const crashingAt = (t: Harness, point: CrashPoint) =>
  createExecutionDriver({ ...t.deps, crash: (at) => { if (at === point) throw new DriverCrash(at); } });

describe("a running run under handoff-stop (spec §3 accepted row, §11 C2/C3, §13.2 C-1, I-1, I-10)", { timeout: 60_000 }, () => {
  it("delivers one request rebuilt from the outbox, H-settles a partial checkpoint, parks the task held and lands nothing", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const ledgerBefore = committedAndUsed(t);
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
      expect(t.fake.calls.handoff).toEqual([handoffRequestFromOutbox(t.h.store, requestId!)]);
      expect(t.fake.calls.handoff[0]).toMatchObject({ reason: "human", deadlineAt: readStopIntent(t.h.store, "g")!.deadlineAt });
      const run = t.body(runId);
      expect(run).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(active(t, runId)).toBe(0);
      // spec §11 C2: the commitment is parked, not released -- reserved + used is what it was before the stop.
      expect(work(t, "a")).toMatchObject({ status: "held", currentRunId: runId });
      expect(allocation(t, "a")).toMatchObject({ state: "held", amount: run.remaining.work });
      expect(committedAndUsed(t)).toEqual(ledgerBefore);
      const row = t.h.store.db.prepare("SELECT hash,body FROM checkpoints WHERE id=?").get(run.checkpointId)!;
      const checkpoint = JSON.parse(String(row.body));
      expect(String(row.hash)).toBe(sha256Canonical(checkpoint));
      expect(checkpoint).toMatchObject({ result: "partial", missing: [], unresolvedRequestIds: [], terminalOutcome: "executing" });
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(tip);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
      // The re-amounted held allocation is the ledger's own settlement: the panel's read model still reads the group
      // (plan deviation D-SNAP; without it the whole group is refused as execution-snapshot-identity).
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.map((view) => view.state)).toEqual(["settled-recoverable"]);
    } finally { await t.h.dispose(); }
  });

  it("leaves a checkpoint both continuation readers accept: exportResumeBundle and resume-from-handoff (spec §13.2 C-1)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
      const checkpointId = t.body(runId).checkpointId as string;
      const exported = await exportResumeBundle(t.h.store, { predecessorRunId: runId, newSourceDir: join(t.h.root, "bundle-probe") });
      expect(exported.checkpointHash).toBe(String(t.h.store.db.prepare("SELECT hash FROM checkpoints WHERE id=?").get(checkpointId)!.hash));
      const resumed = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: runId, checkpointId }] }));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
    } finally { await t.h.dispose(); }
  });
});

describe("a proved stop with no terminal and no request (spec §3, X1)", { timeout: 60_000 }, () => {
  it("is blocked by name at C instead of being waited on forever", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "orphan-candidate" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "candidate-without-terminal", outcome: null });
    } finally { await t.h.dispose(); }
  });
});

describe("a run that provably never started (spec §11 C4, I9; §13.2 I-3; H4)", { timeout: 60_000 }, () => {
  it("restarts a starting run: no provider call, the task is ready, and an empty resume claims it afresh", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      const [requestId] = await stop(t);
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-restartable");
      expect(t.fake.calls.accept).toHaveLength(0);
      expect(t.body(runId).state).toBe("settled-restartable");
      expect(work(t, "a").status).toBe("ready");
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
      const resumed = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
      const claimed = await deliverScheduledStart(t.dispatch, "g");
      expect(claimed).toMatchObject({ kind: "claimed" });
      expect((claimed as { runId: string }).runId).not.toBe(runId);
      expect(t.body((claimed as { runId: string }).runId).state).toBe("starting");
    } finally { await t.h.dispose(); }
  });

  it("restarts a prepared run ccloop never saw (inspect absent) and removes the workspace A2 made", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      expect(stepA1(t.deps, runId)).toBe(true);
      expect(await stepA2(t.deps, runId)).toBe(true);
      const workspace = t.body(runId).drive.workspacePath as string;
      expect(existsSync(workspace)).toBe(true);
      const [requestId] = await stop(t);
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-restartable");
      expect(t.fake.calls.accept).toHaveLength(0);
      expect(t.fake.calls.inspect).toBeGreaterThan(0);
      expect(existsSync(workspace)).toBe(false);
      expect(work(t, "a").status).toBe("ready");
    } finally { await t.h.dispose(); }
  });

  it("restarts a run ccloop refused before writing anything (B accept-refused, Minor h)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "refuse" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const [requestId] = await stop(t);
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-restartable");
      expect(work(t, "a").status).toBe("ready");
    } finally { await t.h.dispose(); }
  });

  it("does not restart a prepared run whose accept reached ccloop before a death (B-after-accept under stop): it is stopped and parked", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      const crashing = crashingAt(t, "B-after-accept");
      await t.until(crashing, () => crashing.crashed !== null);
      expect(t.body(runId)).toMatchObject({ state: "start-pending", executionId: null });
      const [requestId] = await stop(t);
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-recoverable");
      expect(t.fake.calls.accept).toHaveLength(1);
      expect(work(t, "a").status).toBe("held");
    } finally { await t.h.dispose(); }
  });
});

describe("a run already landing is not interrupted (spec §3, §11 C1; H5)", { timeout: 60_000 }, () => {
  it("lands and settles as usual, then its request settles on its own; the task is done, not held", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "collected");
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable" && t.body(runId).drive.cleanedUp === true);
      expect(t.fake.calls.handoff).toHaveLength(0);
      expect(t.body(runId).state).toBe("settled");
      expect(work(t, "a").status).toBe("done");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).not.toBe(tip);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
    } finally { await t.h.dispose(); }
  });

  it("settles the request after a death between the run's settle and the request's (R-H H-between-commit-and-settle)", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "collected");
      const [requestId] = await stop(t);
      const crashing = crashingAt(t, "H-between-commit-and-settle");
      await t.until(crashing, () => crashing.crashed !== null);
      expect(t.body(runId).state).toBe("settled");
      expect(requestState(t, requestId!)).toBe("request-pending");
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-recoverable");
      expect(work(t, "a").status).toBe("done");
    } finally { await t.h.dispose(); }
  });
});

describe("nothing arrives (spec §3 grace, §11 I3)", { timeout: 60_000 }, () => {
  it("turns the request outcome-unknown past deadline + grace, keeps collecting without killing, and H-settles a late candidate", async () => {
    let behaviour: FakeBehaviour = "stoppable-silent";
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => behaviour }); try {
      const runId = await t.claim();
      let now = Date.now();
      const driver = createExecutionDriver({ ...t.deps, now: () => new Date(now) });
      await t.until(driver, () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "collecting");
      await driver.round();
      expect(requestState(t, requestId!)).toBe("collecting");
      now = Date.parse(readHandoffRequest(t.h.store, "g", requestId!).request.deadlineAt) + HANDOFF_EXTRA_GRACE_MS + 1;
      await t.until(driver, () => requestState(t, requestId!) === "outcome-unknown");
      expect(t.body(runId).state).toBe("accepted");
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-unresolved");
      behaviour = "stoppable";
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
    } finally { await t.h.dispose(); }
  });
});

describe("blocked runs under a stop (spec §11 I1, §13.1 C-5, §13.2 I-3; H8)", { timeout: 60_000 }, () => {
  it("closes a run blocked after its execution ended from its collected result, beside a running run", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { behaviour: (id) => id === "a" ? "exhausted" : "stoppable" }); try {
      const [a, b] = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await t.until(driver, () => t.body(a!).state === "blocked" && t.body(b!).state === "accepted");
      expect(t.body(a!).drive).toMatchObject({ blockedAt: "C", outcome: "exhausted" });
      await stop(t);
      await t.until(driver, () => [a!, b!].every((runId) => requestState(t, requestOf(t, runId)) === "settled-recoverable"));
      expect([t.body(a!).state, t.body(b!).state]).toEqual(["settled-recoverable", "settled-recoverable"]);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
    } finally { await t.h.dispose(); }
  });

  it("parks a run whose conflict the group cannot afford as held with a partial checkpoint (human ruling §13.1 C-5)", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }],
      { files: (id) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" }) }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await t.until(driver, () => ids.some((id) => t.body(id).drive?.blockedReason === "reconcile-budget"), 120);
      const parked = ids.find((id) => t.body(id).drive?.blockedReason === "reconcile-budget")!;
      await stop(t);
      await t.until(driver, () => requestState(t, requestOf(t, parked)) === "settled-recoverable", 120);
      expect(t.body(parked)).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(active(t, parked)).toBe(0);
      expect(work(t, t.body(parked).taskId).status).toBe("held");
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM checkpoints WHERE id=?").get(t.body(parked).checkpointId)!.body)).result).toBe("partial");
    } finally { await t.h.dispose(); }
  });
});

describe("deaths inside H (spec §9.2 R-H)", { timeout: 60_000 }, () => {
  it("re-delivers the identical request after a death between delivery and its record (H-after-deliver); ccloop runs it once", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      const crashing = crashingAt(t, "H-after-deliver");
      await t.until(crashing, () => crashing.crashed !== null);
      expect(requestState(t, requestId!)).toBe("request-pending");
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-recoverable");
      expect(t.fake.calls.handoff).toHaveLength(2);
      expect(t.fake.calls.handoff[1]).toEqual(t.fake.calls.handoff[0]);
      expect(t.fake.calls.accept).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("settles once after a death between reading the candidate and settling (H-after-candidate)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      const crashing = crashingAt(t, "H-after-candidate");
      await t.until(crashing, () => crashing.crashed !== null);
      expect(requestState(t, requestId!)).toBe("collecting");
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-recoverable");
      expect(Number(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(runId)!.n)).toBe(1);
    } finally { await t.h.dispose(); }
  });
});
```

条数：14。

- [ ] **Step 3：跑，看见红**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/driverHandoff.test.ts > "${SCRATCH:?}/t4-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t4-red.log"; cat "${SCRATCH:?}/t4-red.log"
```

预言：`../../src/control/driverHandoff.js` 不存在 ⇒ 整个文件在收集阶段红，RC 1。

- [ ] **Step 4：`src/control/executionDriver.ts`**

(a) import 区，`import { stepD, stepR } from "./driverLanding.js";` 之后加一行（与 `driverLanding` 同样的循环 import：只在调用时取值，ESM 下安全）：

```ts
import { openRequestOf, stepH, visitOrder } from "./driverHandoff.js";
```

(b) `:36` 的 `CrashPoint` 整条换成：

```ts
export type CrashPoint = "A2-after-workspace" | "B-after-accept" | "C-after-terminal" | "D-after-cas" | "E-after-acceptance"
  // Handoff delivery spec §9.2 R-H, §11 I5, §13.2 I-1.
  | "H-after-deliver" | "H-after-candidate" | "H-between-commit-and-settle" | "A2-after-bundle";
```

(c) `ExecutionDriverDeps` 里 `beforeCas?: () => Promise<void>;`（`:59`）之后加：

```ts
  /** Handoff delivery spec §3: the clock a request's grace is judged by (tests move it). */
  now?: () => Date;
  /** Handoff delivery spec §3 (controller decision): adapter killGraceMs + 60 s; HANDOFF_EXTRA_GRACE_MS when absent. */
  handoffGraceMs?: number;
```

(d) `stepC`（`:312` 起到 `:335` 那行 `if (!report.terminal || !candidate?.stopProof) return report.events.length > 0;` 为止）整段换成下面这段；`:336` 起（`if (report.terminal.sourceDir !== drive.sourceDir)` 以下）一字不改：

```ts
/**
 * C's collection half (spec §2.2), shared with the handoff step H (handoff delivery spec §3): collect, check
 * every piece of evidence against its hash and archive it, book usage, and check the report is this run's.
 */
export async function collectInto(deps: ExecutionDriverDeps, run: DriverRun): Promise<ExecutionReport> {
  const { store } = deps;
  const runId = run.runId;
  const port = portFor(deps, run);
  const report = await port.collect(readStartEnvelope(store, run), run.highWater);
  const refs = [...report.events.map((event) => event.source), ...(report.candidate?.artifacts ?? [])];
  if (report.candidate) refs.push(report.candidate.handoff);
  if (report.candidate?.stopProof) refs.push(report.candidate.stopProof.source);
  for (const ref of refs) {
    const bytes = await port.readEvidence(ref);
    if (createHash("sha256").update(bytes).digest("hex") !== ref.hash) throw new ControlError("artifact-hash-mismatch");
    await writeArtifact(store, ref.artifactId, bytes, archiveAdmission(deps));
  }
  for (const event of report.events) {
    if (event.runId !== runId || event.generation !== run.generation) throw new ControlError("report-identity-conflict");
    admitted(deps, () => recordUsage(store, event));
  }
  const candidate = report.candidate;
  if (candidate && (candidate.runId !== runId || candidate.generation !== run.generation || candidate.workItemId !== run.workItemId)) {
    throw new ControlError("report-identity-conflict");
  }
  return report;
}

export async function stepC(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "accepted" || run.drive === undefined || run.taskId === null) return false;
  const drive = run.drive;
  const report = await collectInto(deps, run);
  const candidate = report.candidate;
  // Handoff delivery spec §3 (X1): a proved stop with no terminal and no request of this run's is not
  // something to wait for forever; it is blocked by name. With a request, step H owns the run.
  if (!report.terminal && candidate?.stopProof && openRequestOf(store, run) === null) {
    blockRun(deps, runId, "C", "candidate-without-terminal");
    return true;
  }
  if (!report.terminal || !candidate?.stopProof) return report.events.length > 0;
```

(e) `:364` `async function savedReport(` 前加 `export `（H 的 blocked 支要读 C 存下的报告）。

(f) 一轮的遍历（`:544-547`）换成：

```ts
    for (const runId of visitOrder(deps.store)) {
      if (context.stopped) break;
      try {
        // Handoff delivery spec §3: a run with an open request goes to H; every other run is advanced as before.
        const moved = openRequestOf(deps.store, readDriverRun(deps.store, runId)) !== null ? await stepH(deps, runId, context) : await advance(deps, runId, context);
        if (moved) progressed = true;
```

（`catch` 分支以下一字不改：H 里抛错的 run 同样按 `stepOf` 被 block；它若仍有未完请求，下一轮由 H 的 blocked 支接手。）

- [ ] **Step 5：新文件 `src/control/driverHandoff.ts`**

```ts
import { join } from "node:path";
import { archiveRun } from "./archive.js";
import { hasObservedUsage, readRun, saveRun } from "./budget.js";
import { persistCanonicalCheckpoint, verifyCandidateArtifacts } from "./checkpoints.js";
import { hashPayload } from "./commands.js";
import { ControlError } from "./errors.js";
import {
  ADOPTABLE_STATES, handoffRequestFromOutbox, latestRequestForRun, readHandoffRequest, saveHandoffRequest,
  settleCompletedRunRequestInTransaction, settleHandoffRequestInTransaction, type HandoffRequestBody,
} from "./stopIntent.js";
import { isWebWorkRun } from "./webDispatch.js";
import { cleanupRunWorkspace } from "./workspace.js";
import {
  INSPECT_UNKNOWN_LIMIT, advance, archiveAdmission, collectInto, describeError, driverRunIds, groupRepoId, portFor, readDriverRun,
  readStartEnvelope, saveDriverRun, savedReport, stepC, write, type DriverContext, type DriverRun, type ExecutionDriverDeps,
} from "./executionDriver.js";
import type { ExecutionReport, ExecutionStatus } from "./executionPort.js";
import type { ControlStore } from "./store.js";
import type { Candidate } from "./types.js";

/**
 * Handoff delivery spec §3 (with §11, §12, §13): the driver's step H. A run with an open handoff request is
 * closed by the step it is at -- restarted if it provably never started, collected into a checkpoint if it
 * was running, left to finish if it was already landing -- and its request always reaches a settled state or
 * `outcome-unknown`. A run without an open request never comes here: its rounds are byte-for-byte as before.
 */

/** spec §3 (controller decision): how long past a request's deadline nothing at all may arrive before outcome-unknown. */
export const HANDOFF_EXTRA_GRACE_MS = 60_000;

const stopDeps = (deps: ExecutionDriverDeps) => ({ store: deps.store, profileRouter: deps.router });
const nowMs = (deps: ExecutionDriverDeps): number => (deps.now ?? (() => new Date()))().getTime();

/** spec §11 I3: the run's newest request, when it is still open -- `outcome-unknown` included. */
export function openRequestOf(store: ControlStore, run: Pick<DriverRun, "groupId" | "runId">): HandoffRequestBody | null {
  const request = latestRequestForRun(store, run.groupId, run.runId);
  return request !== null && ADOPTABLE_STATES.includes(request.state) ? request : null;
}

/** spec §13.2 I-2: every Web work run with an open request, whatever its state (blocked and settled included). */
export function handoffRunIds(store: ControlStore): string[] {
  const ids: string[] = [];
  for (const row of store.db.prepare("SELECT DISTINCT run_id FROM handoff_requests ORDER BY run_id").all()) {
    const runId = String(row.run_id);
    const body = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
    if (!body) continue;
    const run = JSON.parse(String(body.body)) as DriverRun;
    if (run.phase === "work" && isWebWorkRun(store, runId) && openRequestOf(store, run) !== null) ids.push(runId);
  }
  return ids;
}

/** One round's runs: the driver's own (spec §2.1 of the execution driver) and every run a stop still owns. */
export function visitOrder(store: ControlStore): string[] {
  return [...new Set([...driverRunIds(store), ...handoffRunIds(store)])].sort();
}

/** spec §3 table: the one entry point for a run with an open request. */
export async function stepH(deps: ExecutionDriverDeps, runId: string, context: DriverContext): Promise<boolean> {
  const run = readDriverRun(deps.store, runId);
  const request = openRequestOf(deps.store, run);
  if (request === null) return advance(deps, runId, context);
  switch (run.state) {
    case "settled": return settleCompletedRun(deps, run, request);
    case "starting": return restartRun(deps, runId, request.requestId);
    // spec §11 C4: no executionId is not "never accepted"; a prepared envelope may have reached ccloop.
    case "start-pending": return run.drive?.prepared ? inspectUnderStop(deps, run, request) : restartRun(deps, runId, request.requestId);
    case "unknown": return inspectUnderStop(deps, run, request);
    case "accepted": return deliverAndCollect(deps, run, request);
    // spec §3: a landing is a short local operation and a reconciliation run cannot be reached by the control
    // protocol, so neither is interrupted; the request settles once the run does (spec §11 C1).
    case "collected": case "landed": case "reconciling": return advance(deps, runId, context);
    case "blocked": return closeBlocked(deps, run, request);
    default: return false;
  }
}

/** spec §11 C1, §13.2 I-1: the run settled through E; its request settles on its own, in a second transaction. */
function settleCompletedRun(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): boolean {
  deps.crash?.("H-between-commit-and-settle");
  write(deps, () => settleCompletedRunRequestInTransaction(deps.store, run.groupId, request.requestId));
  return true;
}

/**
 * spec §11 I9, §13.2 C-6: a run proved never to have started. Its workspace (if A2 made one) is removed first --
 * after the settle the run leaves the driver's scope and nothing would come back for it; a failed removal is
 * recorded on the run, never a reason to keep the task stuck.
 */
export async function restartRun(deps: ExecutionDriverDeps, runId: string, requestId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  let cleanupError: string | null = null;
  if (run.drive !== undefined) {
    try { await cleanupRunWorkspace(deps.resolveRepository(groupRepoId(store, run.groupId)), deps.roots, runId, run.drive.workspacePath); }
    catch (error) { cleanupError = describeError(error); }
  }
  return write(deps, () => {
    const request = readHandoffRequest(store, run.groupId, requestId).request;
    if (!ADOPTABLE_STATES.includes(request.state)) return false;
    const current = readDriverRun(store, runId);
    if (current.drive !== undefined) {
      current.drive = { ...current.drive, cleanedUp: cleanupError === null, cleanupError };
      saveDriverRun(store, current);
    }
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, requestId, "settled-restartable", null);
    return true;
  });
}

/** spec §3 `unknown` row and §11 C4: ask ccloop whether the execution exists before deciding anything. */
async function inspectUnderStop(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): Promise<boolean> {
  let status: ExecutionStatus;
  try { status = await portFor(deps, run).inspect(readStartEnvelope(deps.store, run)); }
  catch { status = { kind: "unknown" }; }
  if (status.kind === "absent") return restartRun(deps, run.runId, request.requestId);
  if (status.kind === "unknown") return countUnknownUnderStop(deps, run, request);
  const executionId = status.kind === "accepted" ? status.executionId : status.proof.executionId;
  // The execution exists: record it and deliver the stop next round, as for any accepted run. A stop only
  // needs the execution's identity, so a config mismatch here is not re-judged (it was B's question).
  return write(deps, () => {
    const current = readDriverRun(deps.store, run.runId);
    current.executionId = executionId;
    current.state = "accepted";
    current.drive = { ...current.drive!, inspectUnknown: 0, blockedAt: null, blockedReason: null };
    saveDriverRun(deps.store, current);
    return true;
  });
}

/** spec §3: unknown answers are counted as B' counts them; at the limit the request is outcome-unknown, the run left alone. */
function countUnknownUnderStop(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): boolean {
  return write(deps, () => {
    const current = readDriverRun(deps.store, run.runId);
    const inspectUnknown = (current.drive?.inspectUnknown ?? 0) + 1;
    current.drive = { ...current.drive!, inspectUnknown };
    saveDriverRun(deps.store, current);
    if (inspectUnknown < INSPECT_UNKNOWN_LIMIT || request.state === "outcome-unknown") return false;
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, request.requestId, "outcome-unknown", "inspect-unknown");
    return true;
  });
}

/**
 * spec §3 "accepted, no terminal" row: deliver once (request-pending), then collect every round. A terminal
 * means the run finished before the stop took effect and goes on through C; a candidate with a stop proof
 * and no terminal is H-settled; nothing at all past the grace is outcome-unknown -- which keeps collecting
 * and never kills ccloop (spec §11 I3).
 */
async function deliverAndCollect(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): Promise<boolean> {
  const { store } = deps;
  if (request.state === "request-pending") {
    if (deps.admissionGate?.draining) return false;
    let delivered = false;
    try {
      const ack = await portFor(deps, run).requestHandoff(readStartEnvelope(store, run), handoffRequestFromOutbox(store, request.requestId));
      // spec Minor f: a replayed request is answered `complete` once the candidate exists; both mean ccloop holds it.
      delivered = ack.requestId === request.requestId && (ack.kind === "latched" || ack.kind === "complete");
    } catch { delivered = false; }
    deps.crash?.("H-after-deliver");
    if (!delivered) return settleIfPastGrace(deps, run, request);
    return write(deps, () => {
      const current = readHandoffRequest(store, run.groupId, request.requestId).request;
      if (current.state !== "request-pending") return false;
      saveHandoffRequest(store, run.groupId, { ...current, state: "collecting" });
      return true;
    });
  }
  const report = await collectInto(deps, run);
  if (report.terminal !== null && report.candidate?.stopProof && run.state === "accepted") return stepC(deps, run.runId);
  if (report.candidate?.stopProof) {
    deps.crash?.("H-after-candidate");
    return settleHandoffCheckpoint(deps, run.runId, request.requestId, report);
  }
  return settleIfPastGrace(deps, run, request) || report.events.length > 0;
}

/** spec §3 grace (controller decision): past deadline + killGraceMs + 60 s with nothing collected. */
function settleIfPastGrace(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): boolean {
  if (request.state === "outcome-unknown") return false;
  if (nowMs(deps) <= Date.parse(request.deadlineAt) + (deps.handoffGraceMs ?? HANDOFF_EXTRA_GRACE_MS)) return false;
  return write(deps, () => {
    const current = readHandoffRequest(deps.store, run.groupId, request.requestId).request;
    if (current.state === "outcome-unknown" || !ADOPTABLE_STATES.includes(current.state)) return false;
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, request.requestId, "outcome-unknown", "handoff-grace-elapsed");
    return true;
  });
}

/**
 * spec §13.2 I-3: a blocked run is split by whether ccloop may still be running. Done executing (an outcome, or
 * blocked at D/R/E) ⇒ closed from the result it already collected (§13.1 C-5); provably never started ⇒
 * restartable; otherwise delivered to or inspected like a live run. A run that already landed is not a
 * checkpoint to continue -- its request waits for a person's recovery-retry to settle it through E and C1.
 */
async function closeBlocked(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): Promise<boolean> {
  const drive = run.drive!;
  const at = drive.blockedAt;
  if (drive.landedCommit !== null) return false;
  if (drive.outcome !== null || at === "D" || at === "R" || at === "E") {
    return settleHandoffCheckpoint(deps, run.runId, request.requestId, await savedReport(deps.store, run.runId));
  }
  if (at === "A1" || at === "A2" || (at === "B" && (drive.blockedReason ?? "").startsWith("accept-refused"))) return restartRun(deps, run.runId, request.requestId);
  if (run.executionId === null) return inspectUnderStop(deps, run, request);
  return deliverAndCollect(deps, run, request);
}

/**
 * H-settle (spec §11 C2 as corrected by §13.2 C-1, I-1): an external segment -- the snapshot archive and the
 * canonical checkpoint file, both idempotent -- then ONE transaction: the checkpoint row, `checkpointId` and
 * `recoverable`, the recoverable (or unrecoverable) accounting of `terminaliseRun`, the request's settlement
 * and the group's stop state. Never `commitCandidate`, whose `releaseRunReserve` would give the held
 * commitment back.
 */
export async function settleHandoffCheckpoint(deps: ExecutionDriverDeps, runId: string, requestId: string, report: ExecutionReport): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  const raw = report.candidate;
  if (run.drive === undefined || raw === null || raw.stopProof === null) throw new ControlError("recovery-blocked", `handoff-candidate-missing:${runId}`);
  const archive = await archiveRun(store, { runId, sourceDir: run.drive.sourceDir, repoDir: join(run.drive.sourceDir, "repo"), stopProof: raw.stopProof }, archiveAdmission(deps));
  const record = readRun(store, runId);
  const candidate: Candidate = {
    groupId: record.groupId, workItemId: record.workItemId, taskId: record.taskId, runId, generation: record.generation,
    graphVersion: record.graphVersion, targetVersion: record.targetVersion, checkpointId: `settle-${runId}`, usageHighWater: raw.usageHighWater,
    // spec §11 C3: a request and no landing is an Orca `partial` checkpoint whatever ccloop's own `result` says;
    // ccloop's word on how clean the handoff was stays in the handoff packet it points at.
    result: "partial",
    artifacts: [...archive.artifacts, ...raw.artifacts, raw.handoff], snapshot: archive.snapshot, missing: [...archive.missing, ...raw.missing],
    // spec Minor e: there is no terminal at this instant; ccloop's own (non-terminal) status is what is recorded.
    unresolvedRequestIds: raw.unresolvedRequestIds, stopProof: raw.stopProof, terminalOutcome: raw.terminalOutcome, handoff: raw.handoff,
  };
  candidate.checkpointId = `settle-${runId}-${hashPayload(candidate).slice(0, 16)}`;
  await verifyCandidateArtifacts(store, candidate);
  const persisted = await persistCanonicalCheckpoint(store, candidate);
  return write(deps, () => {
    const request = readHandoffRequest(store, run.groupId, requestId).request;
    if (!ADOPTABLE_STATES.includes(request.state)) return false;
    const previous = store.db.prepare("SELECT hash FROM checkpoints WHERE id=?").get(persisted.checkpointId);
    if (previous !== undefined && String(previous.hash) !== persisted.hash) throw new ControlError("checkpoint-id-conflict");
    if (previous === undefined) store.db.prepare("INSERT INTO checkpoints VALUES (?,?,?,?)").run(persisted.checkpointId, runId, persisted.hash, persisted.body);
    const current = readRun(store, runId);
    if (candidate.usageHighWater !== current.highWater) throw new ControlError("checkpoint-usage-high-water");
    const pending = store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(runId, current.highWater);
    // Web spec §6.2's hard conditions, each named when it fails so the panel shows why.
    const reasons = [
      ...(candidate.unresolvedRequestIds.length > 0 ? ["unresolved-requests"] : []),
      ...(pending !== undefined || current.unknown.work || current.unknown.handoff || !hasObservedUsage(store, current) ? ["usage-unsettled"] : []),
      ...(candidate.missing.length > 0 ? [`missing:${candidate.missing.join(",")}`] : []),
      ...(candidate.snapshot === null ? ["snapshot-missing"] : []),
    ];
    current.checkpointId = persisted.checkpointId;
    current.recoverable = reasons.length === 0;
    saveRun(store, current);
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, requestId,
      reasons.length === 0 ? "settled-recoverable" : "settled-unrecoverable", reasons.length === 0 ? null : reasons.join(";"));
    return true;
  });
}
```

- [ ] **Step 6：D-SNAP 与 D-VIEW**（**先看 §0.1 的裁定**；若控制器改选别的修法，本步按裁定重写，Step 2 第 1 条的最后一个断言与 T5 第 1 条的读模型断言是它们的红证）

`src/control/executionSnapshot.ts`：

```diff
diff --git a/src/control/executionSnapshot.ts b/src/control/executionSnapshot.ts
index 324c591..bf2e4fb 100644
--- a/src/control/executionSnapshot.ts
+++ b/src/control/executionSnapshot.ts
@@ -256,8 +256,25 @@ export function buildExecutionSnapshot(input: ConfirmedProposal): ExecutionSnaps
 }
 
+/**
+ * Handoff delivery plan deviation D-SNAP (2026-09-25): the shape a live allocation is compared to its frozen
+ * counterpart in. Web spec §5.1.1 re-amounts a parked task allocation (held, then continuing) to its remaining
+ * grant, and it keeps that amount once terminal; those amounts are the ledger's settlement, not a drift from the
+ * confirmation, so only their `amount` is left out. Every other field of theirs, and every field of every other
+ * allocation, is still compared. Shared by the driver's contract read and the panel's read model.
+ */
+export function frozenAllocationShape(allocations: ReadonlyArray<{ ownerKind: string; ownerId: string; bucket: string; state: string }>) {
+  const settled = new Set(allocations.filter(a => a.ownerKind === "task" && ["held", "continuing", "terminal"].includes(a.state)).map(a => `${a.ownerId}\0${a.bucket}`));
+  return <A extends { ownerKind: string; ownerId: string; bucket: string }>(allocation: A): A | Omit<A, "amount"> => {
+    if (allocation.ownerKind !== "task" || !settled.has(`${allocation.ownerId}\0${allocation.bucket}`)) return allocation;
+    const { amount: _amount, ...rest } = allocation as A & { amount: unknown };
+    return rest;
+  };
+}
+
 /** Scheduler consumption verifies the archived wrapper, then returns its exact contract bytes. */
 export function readConfirmedTaskExecution(store: ControlStore, groupId: string, taskId: string) {
   const proposal = readBudgetProposal(store, groupId), plan = readArchivedPlan(store, groupId);
   if (proposal.state !== "confirmed" || !proposal.executionSnapshotHash) throw new ControlError("group-state-invalid");
+  const settledShape = frozenAllocationShape(proposal.allocations);
   try {
     const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(store, proposal.executionSnapshotHash)));
@@ -266,5 +283,5 @@ export function readConfirmedTaskExecution(store: ControlStore, groupId: string,
       || sha256Canonical(snapshot.profiles) !== sha256Canonical(proposal.profiles)
       || sha256Canonical(snapshot.contextPolicy) !== sha256Canonical(proposal.contextPolicy)
-      || sha256Canonical(snapshot.allocations.filter(a => a.ownerKind !== "reserve")) !== sha256Canonical(proposal.allocations.filter(a => a.ownerKind !== "reserve").map(({ state: _state, ...a }) => a))) throw new ControlError("recovery-blocked");
+      || sha256Canonical(snapshot.allocations.filter(a => a.ownerKind !== "reserve").map(settledShape)) !== sha256Canonical(proposal.allocations.filter(a => a.ownerKind !== "reserve").map(({ state: _state, ...a }) => settledShape(a)))) throw new ControlError("recovery-blocked");
     const task = plan.plan.tasks.find(t => t.taskId === taskId), ref = snapshot.derivedContracts.find(t => t.taskId === taskId);
     const work = snapshot.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work");
```

`src/panel/controlViews.ts`（import 从 `../control/executionSnapshot.js` 取 `frozenAllocationShape`；本文件若已有该模块的 import 就并进去）：

```diff
diff --git a/src/panel/controlViews.ts b/src/panel/controlViews.ts
index 15faa09..5fe449a 100644
--- a/src/panel/controlViews.ts
+++ b/src/panel/controlViews.ts
@@ -1,2 +1,3 @@
+import { frozenAllocationShape } from "../control/executionSnapshot.js";
 import { z } from "zod";
 import { readArtifact } from "../control/archive.js";
@@ -295,5 +296,7 @@ function validateExecutionSnapshot(
   const canonicalJson = readGroupOwnedCanonicalRecord(store, groupId, proposal.executionSnapshotHash);
   const parsed = executionSnapshotSchema.safeParse(parseJson(canonicalJson, "execution-snapshot-invalid"));
-  const proposalAllocations = proposal.allocations.map(({ state: _state, ...allocation }) => allocation);
+  // Handoff delivery plan deviation D-SNAP: a settled task allocation's amount is the ledger's, not a drift.
+  const settledShape = frozenAllocationShape(proposal.allocations);
+  const proposalAllocations = proposal.allocations.map(({ state: _state, ...allocation }) => settledShape(allocation));
   if (!parsed.success || canonicalBytes(parsed.data).toString("utf8") !== canonicalJson
     || sha256Canonical(parsed.data) !== proposal.executionSnapshotHash
@@ -303,5 +306,5 @@ function validateExecutionSnapshot(
     || canonicalBytes(parsed.data.contextPolicy).compare(canonicalBytes(proposal.contextPolicy)) !== 0
     || canonicalBytes(parsed.data.profiles).compare(canonicalBytes(proposal.profiles)) !== 0
-    || canonicalBytes(parsed.data.allocations.filter(a => a.ownerKind !== "reserve")).compare(canonicalBytes(proposalAllocations.filter(a => a.ownerKind !== "reserve"))) !== 0) {
+    || canonicalBytes(parsed.data.allocations.filter(a => a.ownerKind !== "reserve").map(settledShape)).compare(canonicalBytes(proposalAllocations.filter(a => a.ownerKind !== "reserve"))) !== 0) {
     return blocked("execution-snapshot-identity");
   }
@@ -490,7 +493,13 @@ function runViews(store: ControlStore, groupId: string, graphVersion: number, pr
       if (!workRow) return blocked(`run-work-missing:${runId}`);
       const work = parseStored(workBodySchema, workRow.body, `run-work-invalid:${runId}`);
+      // Handoff delivery plan deviation D-VIEW (2026-09-25): Web spec §5.1.1 parks a recoverable predecessor's
+      // remainder as the task's grant, the grant its continuation is claimed with. So the task's grant is its
+      // current run's claim grant -- or, while that run is the parked predecessor, its remaining -- and an older
+      // run of the task's lineage keeps the grant it was claimed with.
+      const current = work.currentRunId === runId;
+      const claimed = current && run.state === "settled-recoverable" ? run.remaining : run.grant;
       if (work.workItemId !== run.workItemId || work.taskId !== run.taskId || work.configHash !== run.configHash
         || work.targetVersion !== run.targetVersion
-        || canonicalBytes(work.grant).compare(canonicalBytes(run.grant)) !== 0
+        || (current && canonicalBytes(work.grant).compare(canonicalBytes(claimed)) !== 0)
         || !sameBinding(run.executionProfile, proposal.profiles.worker, "task")
         || !sameBinding(run.handoffProfile, proposal.profiles.handoff, "handoff")) return blocked(`run-work-identity:${runId}`);
```

- [ ] **Step 7：跑，看见绿；邻居不红**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/driverHandoff.test.ts tests/control/handoffStop.test.ts tests/control/executionDriver.test.ts tests/control/driverLanding.test.ts tests/control/driverReconcile.test.ts tests/control/driverSettle.test.ts tests/control/driverRecovery.test.ts tests/control/executionSnapshot.test.ts tests/panel/controlReadApi.test.ts > "${SCRATCH:?}/t4-green.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t4-green.log"; cat "${SCRATCH:?}/t4-green.log"
npm run typecheck > "${SCRATCH:?}/t4-typecheck.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t4-typecheck.log"; cat "${SCRATCH:?}/t4-typecheck.log"
```

Expected：`driverHandoff` 14/14；其余全绿（`executionDriver.test.ts` 的 D21 那条在 T5 才改写 —— **本 Task 不碰 A1 的门**，它照绿）；typecheck RC 0。计划席在副本里实测 14/14（`scratchpad/planner/val-t4b.log`，单文件 26 s）；并发负载下（三席同时跑测）曾有 5 条撞 vitest 默认 5 s 超时，故每个 describe 给了 60 s（与 `driverSettle` 的先例同理）。`driverRecovery` 的「drives a retried run on … to settled」在负载下的基线里也撞过 5 s（`scratchpad/planner/base/orca-summ.txt` 第一版），**先单文件重跑**。

- [ ] **Step 8：变异表**

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| T4-M1 | `executionDriver.ts` | pass 里删掉分流（一律 `advance`），遍历仍用 `visitOrder` | 所有 H 场景 | `driverHandoff` 除 X1 外全部 |
| T4-M2 | 同上 | `visitOrder` 换回 `driverRunIds`（§13.2 I-2 的遍历范围） | blocked、settled 的 run | `driverHandoff` 的 H8 两条、`accept-refused` 那条、`H-between-commit-and-settle` 那条 |
| T4-M3 | 同上 | 删 X1 那段 | 孤儿 candidate | `driverHandoff` X1 |
| T4-M4 | 同上 | X1 条件去掉 `openRequestOf(...) === null` | 有请求的 H 场景 | 预言：不红（有请求的 run 在 pass 里根本不进 `stepC`；只有 `deliverAndCollect` 在有终态时调 `stepC`，那时 X1 条件因有终态为假）⇒ 登记「该条件无独占判据，是防御」|
| T4-M5 | `driverHandoff.ts` | `stepH` 的 `settled` 支改 `return false` | C1 | H5 两条 |
| T4-M6 | 同上 | `start-pending` 支不看 `prepared`，一律 `restartRun` | B-after-accept 之下的 stop | 「does not restart a prepared run whose accept reached ccloop…」 |
| T4-M7 | 同上 | `inspectUnderStop` 把 `absent` 当 `unknown` | prepared、ccloop 没见过 | 「restarts a prepared run ccloop never saw…」 |
| T4-M8 | 同上 | `restartRun` 删工作区清理 | 同上 | 同上（`existsSync(workspace)` 仍真） |
| T4-M9 | 同上 | 投递的请求体改用 `readHandoffRequest` 行重建（不读 outbox） | 第 1 条 | `driverHandoff` 第 1 条（`calls.handoff` 与 outbox 重建不等 —— 行里没有 `reason`／`generation`，编译都过不了；改成 `{...request, protocol:1, reason:"human", generation:1}` 这种能编译的写法再测） |
| T4-M10 | 同上 | `delivered` 后不落 `collecting` | H-after-deliver | 「re-delivers the identical request…」（第二次投递不发生，`calls.handoff` 长度 1）|
| T4-M11 | 同上 | `deliverAndCollect` 删「有终态交回 stepC」 | 自然跑完的 run 被 stop | 预言：H5 不红（那条 stop 在 `collected` 才发）；**无独占判据** ⇒ 由 T9 的 E2E（stop 落在执行刚结束时）补；登记 |
| T4-M12 | 同上 | `settleIfPastGrace` 恒 `false` | 宽限期 | 「turns the request outcome-unknown…」 |
| T4-M13 | 同上 | `settleIfPastGrace` 不加 grace（只比 deadline） | 同上 | 预言不红（判据把时钟直接推过 deadline+grace）⇒ 登记「grace 数值无独占判据」；T9 的装配判据钉 `handoffGraceMs` 的来源 |
| T4-M14 | 同上 | `closeBlocked` 的 C-5 支改 `restartRun` | C 上 exhausted、D 上 reconcile-budget | H8 两条 |
| T4-M15 | 同上 | `closeBlocked` 删 `accept-refused` 判断（落到 inspect） | B 拒绝 | 「restarts a run ccloop refused…」（inspect 答 `absent` 也会 restart ⇒ **预言不红**；登记为「该判断与 inspect 同果，只省一次 inspect」）|
| T4-M16 | 同上 | H-settle 的 `result` 取 ccloop 的 `raw.result` | 边界停（ccloop 答 `complete`） | 第 1 条（`result:"partial"`）与第 2 条（`assertPredecessor` 要 `partial`）|
| T4-M17 | 同上 | H-settle 改用 `commitCandidate` | 第 1 条 | 第 1 条（承诺被放掉：`committedAndUsed` 变小；run 转 `settled` 而非 `settled-recoverable`）|
| T4-M18 | 同上 | `reasons` 删 `usage-unsettled` 那项 | — | 预言不红（夹具总有 usage）⇒ 由 T2／T9 的 deadline 场景钉；登记 |
| T4-M19 | `executionSnapshot.ts` | `frozenAllocationShape` 恒返回原分配 | T5 第 1 条 | T5 第 1 条（A2 `recovery-blocked`）|
| T4-M20 | `controlViews.ts` | 读模型那处不用 `settledShape` | 第 1 条末尾的读模型断言 | `driverHandoff` 第 1 条 |
| T4-M21 | 同上 | D-VIEW 的 `claimed` 恒取 `run.grant` | 同上 | `driverHandoff` 第 1 条（`run-work-identity`）|
| T4-M22 | 同上 | D-VIEW 去掉 `current &&`（历史 run 也比） | T5 第 1 条末尾 | T5 第 1 条（前任在续跑领走后不再是 current）|

- [ ] **Step 9：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/driverHandoff.ts src/control/executionDriver.ts src/control/executionSnapshot.ts src/panel/controlViews.ts tests/control/fixtures/driverPort.ts tests/control/driverHandoff.test.ts
/usr/bin/git diff --cached --stat > "${SCRATCH:?}/t4-cached.txt"; cat "${SCRATCH:?}/t4-cached.txt"
/usr/bin/git commit -F "${SCRATCH:?}/t4-msg.txt"
```

`t4-msg.txt`：

```
feat(control): deliver handoff-stop from the execution driver

Step H: a run with an open handoff request is closed by the step it is at.
Never started (starting, unprepared, inspect absent, refused at accept):
restartable. Running: the request is sent once, byte for byte from its outbox
row, then collected every round; a stop proof without a terminal is H-settled
(archive and canonical checkpoint outside, one transaction inside, the
commitment parked held, never released); nothing past the grace is
outcome-unknown and keeps collecting. Landing: not interrupted; the request
settles after the run does. Blocked: split by whether ccloop may still run.
A proved stop with no terminal and no request is blocked by name (X1).
The execution snapshot and read-model comparisons leave out the amounts Web
spec 5.1.1 re-books for a parked task (plan deviations D-SNAP, D-VIEW).

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

---

## Task 5：续跑 —— A1 去门、A2 继承前任 base（方案 X）、生成／复用 resume bundle、contract 截到剩余 grant、envelope 带 `inputCheckpoint`、清前任工作区

**Files:**
- Modify: `src/control/startEnvelope.ts`（import；`toStartEnvelope` 加第五个参数；`:91`）
- Modify: `src/control/executionDriver.ts`（import 两处；`:164-168` A1 的注释；`:183` 删门；`:199-225` `stepA2` 整个换掉并在其后加四个函数）
- Modify（**既有判据整条改写**，人裁 spec §12）: `tests/control/executionDriver.test.ts`（import 加 `stepA2`；`:259-268` D21 那条）
- Create: `tests/control/driverContinuation.test.ts`

**Interfaces:**
- Consumes：T3 的 `exportResumeBundle`（接受 `settled-recoverable`）、`readExistingResumeBundle`、restartable 的续跑子支；T4 的 H 步（造出 held 的前任）、`CrashPoint` 的 `"A2-after-bundle"`、D-SNAP／D-VIEW（没有它们续跑的 A2 抛 `recovery-blocked`）。
- Produces：
  - `toStartEnvelope(envelope, run, work, contract, inputCheckpoint: InputCheckpointV1 | null = null): StartEnvelope`
  - `export function withinGrant<P extends { maxAttempts: number; tokenBudget: number; totalRuntimeBudgetMs: number }>(policy: P, grant: { tokens: number; activeMs: number; attempts: number }): P`
  - 续跑 run 的 `drive.base` ＝ 前任的 `drive.base`（续跑链上恒为最初那个 run 的 base）；阻断原因 `continuation-registration`（登记与 run 对不上）

**要点**（spec §4、§11 I5、I6、M4、§13.2 I-5）：
- base 取前任的 `drive.base`，**不**解析 `orca/<g>` 尖端（人裁方案 X）。ccloop 在快照 HEAD 上重建前任的树，快照 HEAD 是这个 base 的后代（§11 I6：可能是失败 attempt 的提交），所以 C 的越界检查、D 的 `findLanding`、冲突对方的「base 之后落地的」都从这个 base 算。
- bundle：`exportResumeBundle` 不幂等（第二次 `resume-bundle-exists`），A2 死在导出之后再来 ⇒ `readExistingResumeBundle` 复用并重新核验（T3）。核验不过 ⇒ 抛 ⇒ 被 block 在 A2（原因就是错误码）。
- contract：`maxAttempts`／`tokenBudget`／`totalRuntimeBudgetMs` 各取 min(contract, 剩余 grant)。**contract 哈希不重算**：envelope 的 `contractHash` 一直是冻结的 `derivedContractHash`，与 A2 改写 `repoPath` 同一条上游规则（`executionDriver.ts:212-214` 注释；ccloop 只按 schema 校验 `contractHash` 的形状，`ccloop src/control/protocol.ts:147`，不拿它比 contract）⇒ 见 §0.1 D-HASH。
- 前任工作区在 bundle 生成并核验之后清（spec §4）；前任的源目录与归档快照保留。

- [ ] **Step 1：写失败的判据 `tests/control/driverContinuation.test.ts`**

```ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DriverCrash, createExecutionDriver, withinGrant, type CrashPoint } from "../../src/control/executionDriver.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { readHandoffRequest } from "../../src/control/stopIntent.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Handoff delivery spec §4 (human ruling plan X), §11 I5, I6, M4, §13.2 C-6, I-5: the driver runs the continuation
// `resume-from-handoff` registered. It starts from its predecessor's base (never the current tip), carries the
// predecessor's checkpoint to ccloop, spends at most the task's remaining grant, and a continuation stopped before
// it started hands the task back to that predecessor.

type Harness = Awaited<ReturnType<typeof driverHarness>>;

async function command(t: Harness, verb: "handoff-stop" | "resume-from-handoff", payload: unknown) {
  const result = verb === "handoff-stop" ? await t.service.handoffStop(t.h.command(verb, payload as never)) : await t.service.resumeFromHandoff(t.h.command(verb, payload as never));
  if ("error" in result) throw new Error(`${verb} refused: ${JSON.stringify(result.error)}`);
  return result.result as { requestIds?: string[] };
}
const requestState = (t: Harness, requestId: string): string => readHandoffRequest(t.h.store, "g", requestId).request.state;
const work = (t: Harness, taskId: string) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const allocation = (t: Harness, taskId: string) => readBudgetProposal(t.h.store, "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work")!;
const crashingAt = (t: Harness, point: CrashPoint) =>
  createExecutionDriver({ ...t.deps, crash: (at) => { if (at === point) throw new DriverCrash(at); } });

/** A task stopped mid-run and parked held: its run is the predecessor to continue. */
async function parked(behaviour: { value: FakeBehaviour }) {
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => behaviour.value });
  const predecessor = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(predecessor).state === "accepted");
  const { requestIds } = await command(t, "handoff-stop", {});
  await t.until(driver, () => requestState(t, requestIds![0]!) === "settled-recoverable");
  return { t, predecessor, driver, checkpointId: t.body(predecessor).checkpointId as string };
}

/** resume-from-handoff choosing the predecessor, and the pump's delivery of the resume wake: the continuation run. */
async function resume(t: Harness, predecessor: string, checkpointId: string): Promise<string> {
  await command(t, "resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: predecessor, checkpointId }] });
  const claimed = await deliverScheduledStart(t.dispatch, "g");
  if (claimed.kind !== "claimed") throw new Error(`resume claim refused: ${JSON.stringify(claimed)}`);
  return claimed.runId;
}

describe("a continuation run (spec §4)", { timeout: 60_000 }, () => {
  it("keeps its predecessor's base though the tip moved, carries the checkpoint, is cut to the remaining grant, and lands", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, driver, checkpointId } = await parked(behaviour); try {
      const base = t.body(predecessor).drive.base as string;
      const predecessorWorkspace = t.body(predecessor).drive.workspacePath as string;
      // Someone else moves orca/g meanwhile: plan X must not follow it.
      git(t.repo, "checkout", "-q", "orca/g");
      writeFileSync(join(t.repo, "other.txt"), "other\n");
      git(t.repo, "add", "other.txt");
      git(t.repo, "commit", "-qm", "moved tip");
      git(t.repo, "checkout", "-q", "main");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).not.toBe(base);
      behaviour.value = "succeed";
      const continuation = await resume(t, predecessor, checkpointId);
      await t.until(driver, () => t.body(continuation).state === "settled" && t.body(continuation).drive.cleanedUp === true);
      const run = t.body(continuation);
      expect(run.drive.base).toBe(base);
      const envelope = t.fake.calls.accept.find((sent) => sent.claim.runId === continuation)!;
      expect(envelope.inputCheckpoint).toMatchObject({ predecessorRunId: predecessor, checkpointId });
      expect(envelope.inputCheckpoint!.bundlePath).toBe(join(run.drive.sourceDir, "input", checkpointId));
      expect(envelope.inputCheckpoint!.checkpointHash).toBe(String(t.h.store.db.prepare("SELECT hash FROM checkpoints WHERE id=?").get(checkpointId)!.hash));
      const policy = (envelope.work.contract as { executionPolicy: { maxAttempts: number; tokenBudget: number; totalRuntimeBudgetMs: number } }).executionPolicy;
      const confirmed = readConfirmedTaskExecution(t.h.store, "g", "a").contract.executionPolicy;
      expect(policy).toEqual(withinGrant(confirmed, run.grant.work));
      // Not vacuous: the predecessor spent part of the task's grant, so the cut is visible.
      expect(policy.tokenBudget).toBeLessThan(confirmed.tokenBudget);
      expect(work(t, "a").status).toBe("done");
      expect(git(t.repo, "rev-parse", `${run.drive.landedCommit}^1`)).not.toBe(base);
      // spec §4: the predecessor's workspace goes once the bundle exists; its checkpoint stays.
      expect(existsSync(predecessorWorkspace)).toBe(false);
      expect(t.body(predecessor).drive.cleanedUp).toBe(true);
      // The task's lineage reads back whole: the parked predecessor, then its continuation (deviations D-SNAP, D-VIEW).
      const views = readControlGroup(t.h.store, "epoch-test", "g").runs;
      expect(Object.fromEntries(views.map((view) => [view.runId, view.state]))).toEqual({ [predecessor]: "settled-recoverable", [continuation]: "settled-recoverable" });
    } finally { await t.h.dispose(); }
  });

  it("keeps the first base down a chain: a continuation stopped again is continued from the same base", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, driver, checkpointId } = await parked(behaviour); try {
      const base = t.body(predecessor).drive.base as string;
      const second = await resume(t, predecessor, checkpointId);
      await t.until(driver, () => t.body(second).state === "accepted");
      const { requestIds } = await command(t, "handoff-stop", {});
      await t.until(driver, () => requestState(t, requestIds![0]!) === "settled-recoverable");
      behaviour.value = "succeed";
      const third = await resume(t, second, t.body(second).checkpointId as string);
      await t.until(driver, () => t.body(third).state === "settled");
      expect([t.body(second).drive.base, t.body(third).drive.base]).toEqual([base, base]);
    } finally { await t.h.dispose(); }
  });
});

describe("a continuation stopped before it started (spec §13.2 C-6)", { timeout: 60_000 }, () => {
  it("hands the task back to its predecessor, which can be chosen again and continued with its checkpoint", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, driver, checkpointId } = await parked(behaviour); try {
      const amountBefore = allocation(t, "a").amount;
      const continuation = await resume(t, predecessor, checkpointId);
      const { requestIds } = await command(t, "handoff-stop", {});
      await t.until(driver, () => requestState(t, requestIds![0]!) === "settled-restartable");
      expect(t.fake.calls.accept.filter((sent) => sent.claim.runId === continuation)).toHaveLength(0);
      expect(work(t, "a")).toMatchObject({ status: "held", currentRunId: predecessor, pendingRunId: null, continuation: null });
      expect(allocation(t, "a")).toMatchObject({ state: "held", amount: amountBefore });
      behaviour.value = "succeed";
      const again = await resume(t, predecessor, checkpointId);
      await t.until(driver, () => t.body(again).state === "settled");
      expect(t.fake.calls.accept.find((sent) => sent.claim.runId === again)!.inputCheckpoint).toMatchObject({ predecessorRunId: predecessor, checkpointId });
    } finally { await t.h.dispose(); }
  });
});

describe("A2 of a continuation after a death (spec §11 I5; R-H A2-after-bundle)", { timeout: 60_000 }, () => {
  it("reuses the bundle it already published instead of failing on resume-bundle-exists", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, checkpointId } = await parked(behaviour); try {
      behaviour.value = "succeed";
      const continuation = await resume(t, predecessor, checkpointId);
      const crashing = crashingAt(t, "A2-after-bundle");
      await t.until(crashing, () => crashing.crashed !== null);
      const sourceDir = t.body(continuation).drive.sourceDir as string;
      expect(readdirSync(join(sourceDir, "input"))).toEqual([checkpointId]);
      await t.until(t.driver(), () => t.body(continuation).state === "settled");
      expect(t.fake.calls.accept.find((sent) => sent.claim.runId === continuation)!.inputCheckpoint!.bundlePath).toBe(join(sourceDir, "input", checkpointId));
      expect(readdirSync(join(sourceDir, "input"))).toEqual([checkpointId]);
    } finally { await t.h.dispose(); }
  });

  it("refuses a published bundle whose manifest no longer names the committed checkpoint", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, predecessor, checkpointId } = await parked(behaviour); try {
      behaviour.value = "succeed";
      const continuation = await resume(t, predecessor, checkpointId);
      const crashing = crashingAt(t, "A2-after-bundle");
      await t.until(crashing, () => crashing.crashed !== null);
      const manifestPath = join(t.body(continuation).drive.sourceDir, "input", checkpointId, "resume-bundle.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, checkpointHash: "0".repeat(64) }));
      await t.until(t.driver(), () => t.body(continuation).state === "blocked");
      expect(t.body(continuation).drive).toMatchObject({ blockedAt: "A2", blockedReason: "resume-bundle-hash-mismatch" });
      expect(t.fake.calls.accept.filter((sent) => sent.claim.runId === continuation)).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });
});
```

条数：5。第 5 条（篡改 manifest）是 T3-M11 的红证。

- [ ] **Step 2：改写既有判据 D21**（`tests/control/executionDriver.test.ts`；人裁 spec §12，守 88 (b)(c)）

```diff
diff --git a/tests/control/executionDriver.test.ts b/tests/control/executionDriver.test.ts
index 36c2924..5017fc8 100644
--- a/tests/control/executionDriver.test.ts
+++ b/tests/control/executionDriver.test.ts
@@ -4,5 +4,5 @@ import { join } from "node:path";
 import { describe, expect, it } from "vitest";
 import { readCanonicalRecord } from "../../src/control/snapshot.js";
-import { stepA1, type CrashPoint, DriverCrash, createExecutionDriver } from "../../src/control/executionDriver.js";
+import { stepA1, stepA2, type CrashPoint, DriverCrash, createExecutionDriver } from "../../src/control/executionDriver.js";
 import { applySetWorkspaceMode } from "../../src/control/workspaceSettings.js";
 import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
@@ -257,5 +257,8 @@ describe("Fix round 1 (task-4-review.md, 2026-09-25): refusals the first round l
   });
 
-  it("D21: blocks a continuation run before any provider attempt, by name", async () => {
+  // Handoff delivery (human ruling 2026-09-25, spec §12: this slice may rewrite criteria; ruling 88 (b)(c)): spec §4 removes
+  // deviation D21 -- a continuation passes A1; one whose registration does not match its work item is blocked by name at
+  // A2, still before any provider attempt.
+  it("D21 (superseded by handoff delivery §4): blocks a continuation run without its registration before any provider attempt, by name", async () => {
     const t = await driverHarness([{ taskId: "a" }]); try {
       const runId = await t.claim();
@@ -264,5 +267,8 @@ describe("Fix round 1 (task-4-review.md, 2026-09-25): refusals the first round l
       t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
       expect(stepA1(t.deps, runId)).toBe(true);
-      expect(t.body(runId)).toMatchObject({ state: "blocked", providerAttemptOrdinal: 0, drive: { blockedAt: "A1", blockedReason: "continuation-unsupported" } });
+      expect(t.body(runId)).toMatchObject({ state: "start-pending", providerAttemptOrdinal: 1 });
+      expect(await stepA2(t.deps, runId)).toBe(true);
+      expect(t.body(runId)).toMatchObject({ state: "blocked", drive: { blockedAt: "A2", blockedReason: "continuation-registration" } });
+      expect(t.fake.calls.accept).toHaveLength(0);
     } finally { await t.h.dispose(); }
   });
```

旧判据钉的是「续跑 run 在任何 provider 调用之前被点名 block」。改写后仍钉「点名 block、provider 调用 0」，只是对象换成「登记对不上的续跑」、位置从 A1 移到 A2；合法的续跑不再被拦（人裁范围②）。**不放宽**。

- [ ] **Step 3：跑，看见红**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/driverContinuation.test.ts tests/control/executionDriver.test.ts > "${SCRATCH:?}/t5-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t5-red.log"; cat "${SCRATCH:?}/t5-red.log"
```

预言：`withinGrant` 未导出 ⇒ `driverContinuation` 整个文件红；D21 改写后那条红（A1 仍 block 为 `continuation-unsupported`，`state` 不是 `start-pending`）。

- [ ] **Step 4：`src/control/startEnvelope.ts`**

```diff
diff --git a/src/control/startEnvelope.ts b/src/control/startEnvelope.ts
index c8dde19..b4f08ac 100644
--- a/src/control/startEnvelope.ts
+++ b/src/control/startEnvelope.ts
@@ -4,4 +4,5 @@ import type { StartEnvelope } from "./executionPort.js";
 import { dispatchEnvelopeSchema, type DispatchEnvelopeV1 } from "./webProtocol.js";
 import { grantSchema, idSchema, safeInteger, startEnvelopeSchema } from "./schema.js";
+import type { InputCheckpointV1 } from "./resumeBundle.js";
 
 /**
@@ -56,4 +57,6 @@ export function toStartEnvelope(
   work: StartEnvelopeWork,
   contract: unknown,
+  // Handoff delivery spec §4, §11 M4: a continuation carries the checkpoint ccloop rebuilds its first workspace from.
+  inputCheckpoint: InputCheckpointV1 | null = null,
 ): StartEnvelope {
   const parsedEnvelope = dispatchEnvelopeSchema.safeParse(envelope);
@@ -89,5 +92,5 @@ export function toStartEnvelope(
     // drifted after the freeze pass as the one the claim was made against.
     contractHash: frozen.derivedContractHash,
-    inputCheckpoint: null,
+    inputCheckpoint,
     work: { contract, targetRepo: work.targetRepo, base: work.base, sourceDir: work.sourceDir },
   };
```

- [ ] **Step 5：`src/control/executionDriver.ts`**

(a) import 区：`import { toStartEnvelope } from "./startEnvelope.js";` 之后加

```ts
import { exportResumeBundle, readExistingResumeBundle, type InputCheckpointV1 } from "./resumeBundle.js";
```

并把 `import { readBudgetProposal, readGroup } from "./queries.js";` 改成 `import { readBudgetProposal, readGroup, readWork } from "./queries.js";`。

(b) A1 的文档注释（`:164-168`）整段换成下面这段，并删掉 `:183` 那一行 `if (run.continuationIntentId) return refuse("continuation-unsupported");`：

```ts
/**
 * A1 (spec §2.2): one transaction reserves the provider attempt and records where the run will live.
 * Only a `starting` run enters, so a restart that finds `start-pending` never reserves a second one.
 * A strict group is refused before any attempt (spec §1, §8). A continuation is no longer refused here
 * (handoff delivery spec §4 removes deviation D21); its budget is the task's remaining grant (A2, §13.2 I-5).
 */
```

(c) `stepA2`（`:199` 到 `:225` 的结束花括号）整个换成下面这段（新 `stepA2` 与其后四个函数）：

```ts
export async function stepA2(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.state !== "start-pending" || run.drive === undefined || run.drive.prepared || run.taskId === null) return false;
  const drive = run.drive;
  let targetRepo: string;
  try { targetRepo = deps.resolveRepository(groupRepoId(store, run.groupId)); }
  catch { blockRun(deps, runId, "A2", "repository-path"); return true; }
  const continued = run.continuationIntentId ? continuationOf(store, run) : null;
  if (run.continuationIntentId && continued === null) { blockRun(deps, runId, "A2", "continuation-registration"); return true; }
  // Handoff delivery spec §4 (human ruling, plan X): a continuation keeps its predecessor's base and never reads
  // the current tip -- ccloop rebuilds the predecessor's tree on the snapshot HEAD, a descendant of that base
  // (spec §11 I6), so C's bounds check, D's findLanding and the other side of a conflict all count from it.
  const base = continued !== null ? continued.base : await ensureWorkBranch(targetRepo, run.groupId);
  privateDirectory(drive.sourceDir);
  await ensureWorkspace(targetRepo, drive.workspaceMode, drive.workspacePath, base, deps.roots);
  deps.crash?.("A2-after-workspace");
  let inputCheckpoint: InputCheckpointV1 | null = null;
  if (continued !== null) {
    inputCheckpoint = await continuationBundle(deps, continued.predecessorRunId, drive.sourceDir);
    deps.crash?.("A2-after-bundle");
    // spec §4: the predecessor's workspace goes only once the bundle exists and has verified itself.
    await cleanupPredecessor(deps, targetRepo, continued.predecessorRunId);
  }
  const confirmed = readConfirmedTaskExecution(store, run.groupId, run.taskId);
  // ccloop opens its attempt worktrees from repoPath's HEAD, not from `base` (spec §3.2), so the
  // contract points at this run's own workspace. The frozen derivedContractHash is unchanged.
  const contract = {
    ...confirmed.contract, context: { ...confirmed.contract.context, repoPath: drive.workspacePath },
    ...(continued !== null ? { executionPolicy: withinGrant(confirmed.contract.executionPolicy, (run.grant as { work: { tokens: number; activeMs: number; attempts: number } }).work) } : {}),
  };
  const envelope = toStartEnvelope(readWorkClaimEnvelope(store, run.groupId, runId), run, { sourceDir: drive.sourceDir, targetRepo, base }, contract, inputCheckpoint);
  const envelopeHash = sha256Canonical(envelope);
  return write(deps, () => {
    writeCanonicalRecord(store, run.groupId, envelopeHash, canonicalBytes(envelope).toString("utf8"));
    const current = readDriverRun(store, runId);
    if (current.state !== "start-pending" || current.drive === undefined || current.drive.prepared) return false;
    current.drive = { ...current.drive, targetRepo, base, envelopeHash, prepared: true };
    saveDriverRun(store, current);
    return true;
  });
}

/** The registration this continuation run was claimed from, and its predecessor's base (spec §4). */
function continuationOf(store: ControlStore, run: DriverRun): { predecessorRunId: string; base: string } | null {
  const work = readWork(store, run.groupId, run.workItemId) as unknown as { continuation?: { continuationIntentId: string; predecessorRunId: string } | null };
  const registered = work.continuation ?? null;
  if (registered === null || registered.continuationIntentId !== run.continuationIntentId) return null;
  const base = readDriverRun(store, registered.predecessorRunId).drive?.base ?? null;
  return base === null ? null : { predecessorRunId: registered.predecessorRunId, base };
}

/** spec §11 I5: exportResumeBundle refuses a second export, so a restarted A2 reuses (and re-verifies) the first. */
async function continuationBundle(deps: ExecutionDriverDeps, predecessorRunId: string, sourceDir: string): Promise<InputCheckpointV1> {
  try { return await exportResumeBundle(deps.store, { predecessorRunId, newSourceDir: sourceDir }, archiveAdmission(deps)); }
  catch (error) {
    if (!(error instanceof ControlError && error.code === "resume-bundle-exists")) throw error;
    return readExistingResumeBundle(deps.store, { predecessorRunId, newSourceDir: sourceDir });
  }
}

/** spec §4, §7: the predecessor's own workspace; its source directory and archived snapshot stay. */
async function cleanupPredecessor(deps: ExecutionDriverDeps, targetRepo: string, predecessorRunId: string): Promise<void> {
  const predecessor = readDriverRun(deps.store, predecessorRunId);
  if (predecessor.drive === undefined || predecessor.drive.cleanedUp) return;
  await cleanupRunWorkspace(targetRepo, deps.roots, predecessorRunId, predecessor.drive.workspacePath);
  write(deps, () => {
    const current = readDriverRun(deps.store, predecessorRunId);
    current.drive = { ...current.drive!, cleanedUp: true, cleanupError: null };
    saveDriverRun(deps.store, current);
  });
}

/**
 * spec §13.2 I-5 (controller decision): ccloop spends by the contract, not by the grant, so a continuation's
 * contract is cut to what its task has left. The contract hash stays the frozen derivedContractHash, the same
 * rule as the repoPath rewrite above.
 */
export function withinGrant<P extends { maxAttempts: number; tokenBudget: number; totalRuntimeBudgetMs: number }>(policy: P, grant: { tokens: number; activeMs: number; attempts: number }): P {
  return {
    ...policy, maxAttempts: Math.min(policy.maxAttempts, grant.attempts), tokenBudget: Math.min(policy.tokenBudget, grant.tokens),
    totalRuntimeBudgetMs: Math.min(policy.totalRuntimeBudgetMs, grant.activeMs),
  };
}
```

- [ ] **Step 6：跑，看见绿；邻居不红**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/driverContinuation.test.ts tests/control/executionDriver.test.ts tests/control/driverHandoff.test.ts tests/control/startEnvelope.test.ts tests/control/webCcloopSmoke.test.ts tests/control/resumeBundle.test.ts > "${SCRATCH:?}/t5-green.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t5-green.log"; cat "${SCRATCH:?}/t5-green.log"
npm run typecheck > "${SCRATCH:?}/t5-typecheck.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t5-typecheck.log"; cat "${SCRATCH:?}/t5-typecheck.log"
```

Expected：`driverContinuation` 5/5（计划席副本实测，`scratchpad/planner/val-t5c.log`，19 s）；`executionDriver.test.ts` 全绿（含改写的 D21）；其余全绿；typecheck RC 0。`webCcloopSmoke`（`verify:web-control:consumer`）必须照绿：`toStartEnvelope` 的第五个参数缺省为 `null`，既有调用方逐字节不变。

- [ ] **Step 7：变异表**

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| T5-M1 | `executionDriver.ts` | A2 的 `base` 恒取 `ensureWorkBranch`（方案 Y） | 尖端被人移动之后续跑 | `driverContinuation` 第 1、2 条 |
| T5-M2 | 同上 | 不传 `inputCheckpoint`（第五个参数给 `null`） | 续跑 | 第 1、3 条 |
| T5-M3 | 同上 | 删 `withinGrant` 的应用（contract 不截） | 续跑 | 第 1 条（`policy` 与截后值不等；`tokenBudget` 不小于原值） |
| T5-M4 | 同上 | `withinGrant` 里 `tokenBudget` 不取 min | 同上 | 第 1 条 |
| T5-M5 | 同上 | `continuationBundle` 不接 `resume-bundle-exists`（直接抛） | A2-after-bundle | 第 4 条（run 被 block 在 A2） |
| T5-M6 | 同上 | 删 `cleanupPredecessor` 调用 | 续跑 | 第 1 条（前任工作区仍在、`cleanedUp` 为假） |
| T5-M7 | 同上 | `continuationOf` 不核 `continuationIntentId` | 改写后的 D21 | `executionDriver.test.ts` 的 D21（改写版）|
| T5-M8 | 同上 | 恢复 A1 的 `continuation-unsupported` 门 | 续跑 | 第 1–5 条全部、D21（改写版）|
| T5-M9 | `startEnvelope.ts` | 第五个参数被忽略（仍写 `inputCheckpoint: null`） | 续跑 | 第 1、3 条 |

- [ ] **Step 8：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/startEnvelope.ts src/control/executionDriver.ts tests/control/executionDriver.test.ts tests/control/driverContinuation.test.ts
/usr/bin/git diff --cached --stat > "${SCRATCH:?}/t5-cached.txt"; cat "${SCRATCH:?}/t5-cached.txt"
/usr/bin/git commit -F "${SCRATCH:?}/t5-msg.txt"
```

`t5-msg.txt`：

```
feat(control): run continuations from the execution driver

A continuation passes A1 (deviation D21 of the first slice is removed) and in
A2 keeps its predecessor's base instead of reading the tip (human ruling,
plan X), exports the predecessor's resume bundle into its own source
directory (reusing and re-verifying it after a crash), carries it as the
start envelope's inputCheckpoint, cuts the contract to the task's remaining
grant, and only then removes the predecessor's workspace. The D21 criterion
is rewritten under the human ruling of spec 12.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

---

## Task 6：N 路并行落地 —— 对方是集合（N1）、每组至多一个在解冲突（N2）、单调 spawn 键（§11 I7／§13.2 I-6）

> **归属**：计划席（T6 分节），控制器会话 `e5f56bfe`。本节全部行号、红绿、变异结果现测于 Orca `264f967` 之上**单独叠 T6** 的 `git clone --local` 副本（`scratchpad/planner/t6-clone`、变异在 `t6-mut`），测量命令见各步。T1–T5 先落地后，`driverLanding.ts`／`reconcile.ts`／`driveRecord.ts` 若被前序 Task 动过，行号会漂 —— 下面每一处改动都用**整段文本锚点 + 断言命中 == 1**，不靠行号。

**依据**：spec §5.1–§5.2（N1、N2）、§9.2 N1u／N-parity、§11 I7、§11 M5、§13.2 I-6、§13.2 Minor c（id 超 200 字符用哈希后缀）、Minor d（N2 的「人工重试可能多一次解冲突」登记）。

**本席新现量（控制器须知，Rule 7／Rule 12）**：§11 I7 的前提「尖端移动 ⇒ 清 reconcile 重落 ⇒ 再冲突 ⇒ **再 spawn** 一次解冲突」**现测不成立**。今天第二次 `beginReconcile` 用的是**同一个** `runsDir/reconcile-<runId>` 工作目录，上一次 spawn 的终态 `loop-state.json` 还在；`stepR` 读到终态、`outcome===null` ⇒ `reconcileNextAction` 判 `collect`（`driverLanding.ts:250-255`，删目录只发生在 spawn 分支 `:258`）⇒ **不 spawn，直接收旧结果**：旧树是在**旧尖端**上解的冲突，`rebuildMergeCommit` 把它挂到新尖端上落地 ⇒ **人移动尖端时提交的改动被静默抹掉**；同时这份旧结果以 `spawn-0` 再记一次账（同一次 spawn 记两次）。
测量：本节 I7 判据在 `264f967` 的 `src` 上跑（`t6-mut` 里 `git checkout HEAD~1 -- src`），落地后 `git ls-tree --name-only refs/heads/orca/g` ＝ `base.txt shared.txt`（`person.txt` 没了），`reconcile-usage` 行 ＝ `spawn-0`、`spawn-1`，`.runs` 只有 1 行。
⇒ 本 Task 在 `beginReconcile` 里**先删掉本 run 的旧解冲突工作目录**（Step 7(d)），这是让 §11 I7「重复解冲突的 token 全部记到 group 上」有意义的前提；它是可逆的一行、证据分得出胜负（Rule 1 第 2 档／Rule 7），本席自定并在此登记，**请控制器复核**。

**Files:**
- Modify: `src/scheduler/reconcile.ts`（`:1` 之前加一行 import；文件末尾追加两个导出函数与一个常量 —— **只加不改**，既有两元函数与 `orca run` 调度器路径逐字节不动）
- Modify: `src/control/driveRecord.ts`（`reconcileRecordSchema` 的 `otherTaskId: idSchema,` 之后加一个可选字段，`:25`）
- Modify: `src/control/driverLanding.ts`（`:13` import；`stepD` `:82` 之后 N2 守卫；`otherSideOfWeb` `:110-133` 返回集合；`beginReconcile` `:154-170`；`finishReconcile` `:310` 落地消息）
- Create: `tests/scheduler/reconcileParity.test.ts`、`tests/control/driverReconcileN.test.ts`

行号现测命令（Orca `264f967`，输出 `scratchpad/planner/t6-lines.log`）：`python3` 逐行找锚点文本打印 `file:[line]`；关键几处：`driverLanding.ts` `otherSideOfWeb` `:114`、`return touched.size === 1` `:132`、`beginReconcile` `:146`、`spawnSeq: 0,` `:169`、`recordReconcileUsage(…spawn-…)` `:300`、`(reconciled with` `:310`、尖端移动重置 `current.state = "collected";` `:324`／`reconcile: null` `:325`；`reconcile.ts` `planReconciliation(` `:215`、`synthesizeReconcileContract(` `:318`、`taskId: \`reconcile-${slug(a.taskId)}-${slug(b.taskId)}\`` `:361`；`driveRecord.ts` `otherTaskId: idSchema` `:25`；`schema.ts` `idSchema`（`max(200)`）`:3`。

**Interfaces:**
- Consumes：`planReconciliation(a, b)`、`synthesizeReconcileContract(a, b, contracts, runsDir, conflict)`（`reconcile.ts:215,:318`，不改）；`requiredChecksUnion(a, b)`（`writeSet.ts:94`）；`recordReconcileUsage(deps, groupId, runId, spawnKey, tokens)`（`driverLanding.ts:223`，键 `reconcile-usage:<runId>:<spawnKey>`，不改）；测试夹具 `driverHarness`（`tests/control/fixtures/driverHarness.ts`）＋ `fake-ccloop-run.mjs`（每次 spawn 往 `<adapterConfigPath>.runs` 追加一行 —— spawn 数的唯一可信计数，§13.2 I-6）。
- Produces（与 brief 的跨计划接口逐字一致）：
  - `reconcile.ts`：`export function planReconciliationOf(sides: readonly unknown[]): ReconciliationPlan`；`export async function synthesizeReconcileContractOf(self: PlanTask, others: readonly PlanTask[], contracts: Map<string, unknown>, runsDir: string, conflict: MaterialisedConflict): Promise<{ path: string } | { escalate: string }>`（`others` 由调用方按 task id 排序）。
  - `driveRecord.ts`：`reconcileRecordSchema` 加 `otherTaskIds: z.array(idSchema).min(1).optional()`；读方一律 `record.otherTaskIds ?? [record.otherTaskId]`；`otherTaskId` 保留，＝ `otherTaskIds[0]`。
  - `driverLanding.ts`：`otherSideOfWeb(...)` ⇒ `{ taskIds: string[] } | { escalate: string }`（≥1 个、按 task id 排序；零个 ⇒ `{ escalate: "0" }`）；`stepD` 在同组另有 `active=1` 的 run 处于 `reconciling` 时返回 `false`（N2）；`beginReconcile` 的 `spawnSeq` 初值 ＝ outbox 里已记账键 `reconcile-usage:<runId>:spawn-<n>` 的最大 `n`（无则 0；控制器裁定 D-SPAWNKEY，2026-09-25）；落地消息 `orca: land <runId> (reconciled with <ids 以 ", " 连接>)`（N＝1 时字面不变：`driverReconcile.test.ts:60` 的全等与 `executionDriverE2E.test.ts:223` 的正则 `\(reconciled with [ab]\)$` 照过）。

**为什么 `spawnSeq` 取「已记账行数」是单调的**（§11 I7、§13.2 I-6）：
1. 一次 spawn 的序号在 spawn **之前**就落盘：`stepR` 的 `setRecord({ spawning: true, …, spawnSeq: (record.spawnSeq ?? 0) + 1 })`（`driverLanding.ts:264`）。
2. 该 spawn 被收集时，`finishReconcile` **先记账**（`recordReconcileUsage(…, \`spawn-${record.spawnSeq ?? 0}\`, spent)`，`:300`），**之后**才去落地；只有落地发现尖端已动，才在同一个函数末尾的写里清掉 record（`current.state = "collected"; … reconcile: null`，`:324-325`）。所以清零发生时，被清掉的这次 spawn 的键**已经**是 outbox 里的一行。
3. 于是下一次 `beginReconcile` 数到的行数 ＝ 此前被收集过的 spawn 数 k，新 record 从 `spawnSeq = k` 起，`stepR` 把它推到 k+1 再 spawn —— 键 `spawn-(k+1)` 与已有的 `spawn-1..spawn-k` 都不撞；`recordReconcileUsage` 按键去重（`:226`）从此只挡「同一次 spawn 重试收集」，不再吞掉新的一次。
4. `recovery-retry` 从 R 回来时保留 `spawnSeq`（`driveRecord.ts:94` 只清 `spawning/pid/attemptSha`），不经过 `beginReconcile`，不受影响；blocked 在 D 的重试会重进 `beginReconcile`，此时没有新 spawn，行数照旧成立。
- **已裁定改 MAX（控制器，2026-09-25，D-SPAWNKEY）；Step 7(e) 的代码已按 MAX 写，上面「行数」的论证对 MAX 同样成立（MAX ≥ 行数）。原登记如下**：若某次 spawn 的进程死了且没留下终态（`stepR` 判 `spawn` 再起一次，`:250-264`），那次 spawn **从未记账**（执行驱动既有缺口，D18），行数会比已用过的最大序号小 1；此后若再遇尖端移动重置，新序号可能撞上一个已记账的键 ⇒ 少记一次。行数方案按 §13.2 I-6 的字面实现；等价且无此边界的写法是取已记账键的最大序号：`SELECT MAX(CAST(substr(id, length(?) + 1) AS INTEGER)) AS n FROM outbox WHERE id LIKE ?`，参数 `reconcile-usage:${runId}:spawn-` 与其 `%` 形式，`null` 当 0。本席未改，因为 brief 的接口写死了行数；需要改时只动 Step 7(e) 那一行，判据不变（本节判据不覆盖「死进程 ＋ 尖端移动」这一组合）。
- **Minor d 登记**：N2 只挡「同组另一个 run 正在 `reconciling`」。人对一个 blocked 在 R 的 run 做 `recovery-retry` 时，它回到 `reconciling` 之前，兄弟 run 可能已经落地、推走尖端 ⇒ 该解冲突落地时尖端已动 ⇒ 重置、再解一次（多花一次钱）。本片不防，照 spec §13.2 Minor d 登记。
- **Minor c**：合成 id `reconcile-<self>-<others…>` 长于 200（`idSchema` 的上限）时改用 `reconcile-<slug(self) 前 100 字符>-<sha256(others 以 \0 连接) 前 16 位十六进制>`，恒 ≤ 127 字符。N-parity 只在 id ≤ 200 时成立（两元函数对超长 id 不截断）—— 这是有意的分岔，判据点名。

- [ ] **Step 1：开工核对**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?set SCRATCH to the session scratchpad}"
/usr/bin/git status --short > "$S/t6-start.txt" 2>&1; /usr/bin/git log --oneline -3 >> "$S/t6-start.txt" 2>&1
python3 - >> "$S/t6-start.txt" 2>&1 <<'EOF'
anchors = {
  "src/control/driverLanding.ts": [
    'import { markersRemaining, materialiseConflict, pinConflictCommit, rebuildMergeCommit, synthesizeReconcileContract } from "../scheduler/reconcile.js";',
    'return touched.size === 1 ? { taskId: [...touched][0]! } : { escalate: String(touched.size) };',
    '    spawnSeq: 0,',
    '(reconciled with ${record.otherTaskId})',
    'recordReconcileUsage(deps, run.groupId, runId, `spawn-${record.spawnSeq ?? 0}`, spent);',
    '      current.drive = { ...current.drive!, reconcile: null };',
  ],
  "src/control/driveRecord.ts": ['  otherTaskId: idSchema,'],
  "src/scheduler/reconcile.ts": ['import { writeFile } from "node:fs/promises";', 'export function planReconciliationOf', 'export async function synthesizeReconcileContractOf'],
}
for path, pats in anchors.items():
    lines = open(path).read().split("\n")
    for pat in pats:
        print(path, [i + 1 for i, l in enumerate(lines) if pat in l], repr(pat[:70]))
EOF
cat "$S/t6-start.txt"
```

期望：工作树干净，HEAD 是 T5 的提交；前 7 个锚点各命中**恰好 1 行**，`planReconciliationOf`／`synthesizeReconcileContractOf` 命中 `[]`（尚不存在）。在 `264f967` 上现测的行号：`driverLanding.ts` `[13] [132] [169] [310] [300] [325]`，`driveRecord.ts` `[25]`，`reconcile.ts` `[1] [] []`。任何一个锚点不是 1 次命中 ⇒ 停下报告。

- [ ] **Step 2：写 N-parity 判据 `tests/scheduler/reconcileParity.test.ts`**

```ts
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  planReconciliation, planReconciliationOf, synthesizeReconcileContract, synthesizeReconcileContractOf,
  type MaterialisedConflict,
} from "../../src/scheduler/reconcile.js";
import type { PlanTask } from "../../src/scheduler/planFile.js";

// Handoff delivery spec §5.2 N1 and §11 M5 (controller decision; human ruling "parallel is not only two"):
// the N-ary reconciler is added beside the two-sided one, which `orca run` keeps using unchanged. With one
// other side it must write the very same bytes under the very same name, or the driver's two-way landing
// (every existing reconciliation criterion) would silently change what it hands the reconciler.
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const runsDir = async (): Promise<string> => { const dir = await mkdtemp(join(tmpdir(), "orca-reconcile-parity-")); dirs.push(dir); return dir; };

const side = (taskId: string): PlanTask => ({ taskId, contract: "", dependsOn: [] });
const contract = (taskId: string, checks: string[] | undefined, tokenBudget: number) => ({
  objective: { taskId, goal: `do ${taskId}`, successCondition: `${taskId} passes` },
  executionPolicy: { perAttemptTimeoutMs: 1_000 * tokenBudget, totalRuntimeBudgetMs: 2_000 * tokenBudget, tokenBudget },
  ...(checks === undefined ? {} : { verification: { requiredChecks: checks } }),
});
// Only the fields the synthesizer reads; the conflict itself is never touched here.
const conflict: MaterialisedConflict = {
  copyPath: "/copy", wTip: "1".repeat(40), incomingRef: "refs/orca/incoming/run", conflictedPaths: ["shared.txt"],
  conflictCommit: "2".repeat(40), blocks: [],
};

describe("the N-ary reconciler (handoff delivery spec §5.2 N1, §11 M5)", () => {
  it("N-parity: with one other side it writes byte-for-byte what the two-sided synthesizer writes, under the same file name", async () => {
    const contracts = new Map<string, unknown>([["a", contract("a", ["x", "y"], 5)], ["b", contract("b", ["y", "z"], 3)]]);
    const [two, many] = [await runsDir(), await runsDir()];
    const byTwo = await synthesizeReconcileContract(side("a"), side("b"), contracts, two, conflict);
    const byMany = await synthesizeReconcileContractOf(side("a"), [side("b")], contracts, many, conflict);
    if (!("path" in byTwo) || !("path" in byMany)) throw new Error(`escalated: ${JSON.stringify([byTwo, byMany])}`);
    expect(basename(byMany.path)).toBe(basename(byTwo.path));
    expect((await readFile(byMany.path)).equals(await readFile(byTwo.path))).toBe(true);
    expect(await readdir(many)).toEqual([basename(byTwo.path)]);
    expect(planReconciliationOf([contracts.get("a"), contracts.get("b")])).toEqual(planReconciliation(contracts.get("a"), contracts.get("b")));
  });

  it("three sides: every side's checks in first-seen order, the largest budget, and a task id naming all three", async () => {
    const contracts = new Map<string, unknown>([
      ["a", contract("a", ["x", "y"], 5)], ["b", contract("b", ["y", "z"], 3)], ["d", contract("d", ["w", "x"], 7)],
    ]);
    const made = await synthesizeReconcileContractOf(side("a"), [side("b"), side("d")], contracts, await runsDir(), conflict);
    if (!("path" in made)) throw new Error(`escalated: ${made.escalate}`);
    const written = JSON.parse(await readFile(made.path, "utf8"));
    expect(basename(made.path)).toBe("contract-reconcile-a-b-d.json");
    expect(written.objective.taskId).toBe("reconcile-a-b-d");
    expect(written.verification.requiredChecks).toEqual(["x", "y", "z", "w"]);
    expect(written.context.buildTestCommands).toEqual(["x", "y", "z", "w"]);
    expect(written.executionPolicy).toMatchObject({ tokenBudget: 7, perAttemptTimeoutMs: 7_000, totalRuntimeBudgetMs: 14_000, maxAttempts: 1 });
    // Every side's intent is carried: the reconciler is none of the parties (spec §5.2).
    for (const id of ["a", "b", "d"]) expect(written.objective.goal).toContain(`${id} was trying to: do ${id}`);
    expect(written.objective.goal).toContain("between task a and tasks b, d.");
    expect(written.objective.goal).toContain("Every intent must survive.");
  });

  it("escalates an empty union of checks over three sides with the two-sided function's own words", async () => {
    const contracts = new Map<string, unknown>([["a", contract("a", undefined, 5)], ["b", contract("b", [], 3)], ["d", contract("d", undefined, 7)]]);
    const expected = planReconciliation(undefined, undefined);
    expect(expected.escalate).toBe(true);
    expect(planReconciliationOf([contracts.get("a"), contracts.get("b"), contracts.get("d")])).toEqual(expected);
    const dir = await runsDir();
    const made = await synthesizeReconcileContractOf(side("a"), [side("b"), side("d")], contracts, dir, conflict);
    expect(made).toEqual({ escalate: (expected as { why: string }).why });
    expect(await readdir(dir)).toEqual([]);
  });

  it("escalates a three-sided reconciliation one side of which contributed no intent, naming every side", async () => {
    const contracts = new Map<string, unknown>([["a", contract("a", ["x"], 5)], ["b", { verification: { requiredChecks: ["y"] } }], ["d", contract("d", ["z"], 7)]]);
    const dir = await runsDir();
    const made = await synthesizeReconcileContractOf(side("a"), [side("b"), side("d")], contracts, dir, conflict);
    expect(made).toEqual({
      escalate: "cannot synthesize a reconciliation contract for a x b x d: b contributed no goal, successCondition or " +
        "execution budget, so the contract would carry only the other side's intent and the reconciler would be the " +
        "conflicting party (spec §5.2)",
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it("names a reconciliation whose ids would pass the 200-character id ceiling by a hash stem, at most 200 characters (spec §13.2 Minor c)", async () => {
    const [long1, long2] = ["p".repeat(120), "q".repeat(120)];
    const contracts = new Map<string, unknown>([["a", contract("a", ["x"], 5)], [long1, contract(long1, ["y"], 3)], [long2, contract(long2, ["z"], 7)]]);
    const made = await synthesizeReconcileContractOf(side("a"), [side(long1), side(long2)], contracts, await runsDir(), conflict);
    if (!("path" in made)) throw new Error(`escalated: ${made.escalate}`);
    const taskId: string = JSON.parse(await readFile(made.path, "utf8")).objective.taskId;
    expect(taskId).toMatch(/^reconcile-a-[0-9a-f]{16}$/);
    expect(taskId.length).toBeLessThanOrEqual(200);
    expect(basename(made.path)).toBe(`contract-${taskId}.json`);
    // A different set of other sides gets a different name: the hash is over the other sides' ids.
    const other = await synthesizeReconcileContractOf(side("a"), [side(long2), side(long1)], contracts, await runsDir(), conflict);
    if (!("path" in other)) throw new Error(`escalated: ${other.escalate}`);
    expect(JSON.parse(await readFile(other.path, "utf8")).objective.taskId).not.toBe(taskId);
  });
});
```

- [ ] **Step 3：写驱动环判据 `tests/control/driverReconcileN.test.ts`**

要点（夹具怎么用，读 `tests/control/driverReconcile.test.ts:22-44` 与 `fixtures/driverHarness.ts`）：
- 解冲突由 `fake-ccloop-run.mjs` 扮演，它的行为来自 `t.deps.adapterConfigPath` 这份 JSON（`files`／`status`／`spent`／`holdMs`），每次 spawn 往 `<adapterConfigPath>.runs` 追加一行 ⇒ `spawns()` 是**不会被重置**的 spawn 计数（§13.2 I-6；不用 `spawnSeq`，也不用 runs 目录数 —— 每次 spawn 前同一目录被删，恒为 1）。
- D12：默认组预留小于一个任务的 `tokenBudget`，解冲突会被 `reconcile-budget` 拦下 ⇒ 用 `set-limit` 把上限抬高 1000 万 token（同 `driverReconcile.test.ts:34-40`）。
- 解冲突是后台进程，进度按墙钟 ⇒ `untilDeadline`（50 ms 一轮、最多 20 s，同 `driverReconcile.test.ts:22-29`）。
- 驱动环每轮 `replenishStartWakes` 会自己布一个 start wake（`executionDriver.ts:457-481`），此后再发 `start` 命令会被 `group-state-invalid` 拒 ⇒ 驱动环跑过之后要再领一个 run，**直接投递已布好的 wake**：`deliverScheduledStart(t.dispatch, "g")`（现测：用 `t.claim()` 得 `start refused: {"code":"group-state-invalid",…}`）。
- run id 是随机 UUID，`otherSideOfWeb` 按 run id 遍历；N1u 要证明「按 task id 排序」，就得在 b 的 run id 排在 a 之前的那种顺序里量 ⇒ 夹具最多重建 16 次直到出现这种顺序（每次 ½，全部落空的概率 2⁻¹⁶），否则无序的实现也能碰巧绿。

```ts
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readDriverRun, type ExecutionDriver } from "../../src/control/executionDriver.js";
import { otherSideOfWeb, stepD } from "../../src/control/driverLanding.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import type { WebFixtureTask } from "./fixtures/web.js";

// Handoff delivery spec §5.2 (human ruling "parallel is not only two"; controller decisions N1, N2) and
// §11 I7 / §13.2 I-6: a landing that conflicts with several landed tasks is reconciled against all of them
// at once, a group has at most one landing reconciling at a time, and every reconciliation spawn is booked
// on the group, a second spawn after a moved tip included.
const LANDED = ["landed", "settled"];
// The reconciliation is a background process: its progress is wall-clock time, not rounds (execution
// driver deviation, Task 6 fix round 1, m3). Rounds 50 ms apart for at most 20 s.
async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await driver.round();
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

async function harness(tasks: readonly WebFixtureTask[], files: (id: string) => Record<string, string>, reconcile: { files: Record<string, string>; holdMs?: number }) {
  const t = await driverHarness(tasks, { files });
  await writeFile(t.deps.adapterConfigPath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
  // Deviation D12: by default the group's reserve (20% of base) is smaller than one task's token budget,
  // so a reconciliation is refused until another run settles. Raise the ceiling explicitly.
  const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens + 10_000_000 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const spawns = () => existsSync(`${t.deps.adapterConfigPath}.runs`) ? readFileSync(`${t.deps.adapterConfigPath}.runs`, "utf8").trim().split("\n") : [];
  const bookings = () => (t.h.store.db.prepare("SELECT id FROM outbox WHERE kind='reconcile-usage' ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
  const taskOf = (runId: string): string => t.body(runId).taskId;
  return { ...t, spawns, bookings, taskOf };
}

const shared = (id: string) => ({ "shared.txt": `${id}\n` });
const threeShared = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }, { taskId: "d", targetPaths: ["shared.txt"] }];

describe("N1u: the other side of a conflict is every landed task it touches (spec §5.2 N1)", { timeout: 60_000 }, () => {
  it("answers both landed tasks, sorted by task id, where the two-sided rule escalated \"2\"; none still escalates \"0\"", async () => {
    // Runs are visited by run id (a random UUID). The answer must be sorted by task id, so the fixture is
    // retried until b's run id sorts before a's -- the one order in which an unsorted answer shows.
    for (let tries = 0; ; tries += 1) {
      const t = await harness([{ taskId: "a" }, { taskId: "b" }, { taskId: "d" }], (id) => ({ [id]: `${id}\n` }), { files: {} });
      try {
        const ids = [await t.claim(), await t.claim(), await t.claim()];
        const byTask = new Map(ids.map((id) => [t.taskOf(id), id]));
        if (!(byTask.get("b")! < byTask.get("a")!)) { if (tries < 15) continue; throw new Error("run ids never sorted b before a"); }
        await t.until(t.driver(), () => ids.every((id) => ["collected", ...LANDED].includes(t.body(id).state)));
        for (const id of [byTask.get("a")!, byTask.get("b")!]) if (t.body(id).state === "collected") await stepD(t.deps, id);
        expect([t.body(byTask.get("a")!).state, t.body(byTask.get("b")!).state].every((state) => LANDED.includes(state))).toBe(true);
        const d = readDriverRun(t.h.store, byTask.get("d")!);
        expect(await otherSideOfWeb(t.h.store, t.repo, d, ["a", "b"])).toEqual({ taskIds: ["a", "b"] });
        expect(await otherSideOfWeb(t.h.store, t.repo, d, ["b"])).toEqual({ taskIds: ["b"] });
        expect(await otherSideOfWeb(t.h.store, t.repo, d, ["base.txt"])).toEqual({ escalate: "0" });
        return;
      } finally { await t.h.dispose(); }
    }
  });
});

describe("three runs conflicting on one file (spec §5.2 N1, N2)", { timeout: 60_000 }, () => {
  it("lands all three with exactly two reconciliations, the second against both landed tasks", async () => {
    const t = await harness(threeShared, shared, { files: { "shared.txt": "a\nb\nd\n" } }); try {
      const ids = [await t.claim(), await t.claim(), await t.claim()];
      await untilDeadline(t.driver(), () => ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(ids.map((id) => t.body(id).state).every((state) => LANDED.includes(state))).toBe(true);
      expect(t.spawns()).toHaveLength(2);
      const reconciled = ids.filter((id) => t.body(id).drive.reconcile !== null)
        .sort((x, y) => t.body(x).drive.reconcile.otherTaskIds.length - t.body(y).drive.reconcile.otherTaskIds.length);
      expect(reconciled).toHaveLength(2);
      const [once, twice] = reconciled.map((id) => ({ id, record: t.body(id).drive.reconcile, landed: t.body(id).drive.landedCommit }));
      const first = ids.find((id) => t.body(id).drive.reconcile === null)!;
      expect(once!.record).toMatchObject({ otherTaskIds: [t.taskOf(first)], otherTaskId: t.taskOf(first), spawnSeq: 1, outcome: "succeeded" });
      const both = [t.taskOf(first), t.taskOf(once!.id)].sort();
      expect(twice!.record).toMatchObject({ otherTaskIds: both, otherTaskId: both[0], spawnSeq: 1, outcome: "succeeded" });
      expect(git(t.repo, "log", "-1", "--format=%s", once!.landed)).toBe(`orca: land ${once!.id} (reconciled with ${t.taskOf(first)})`);
      expect(git(t.repo, "log", "-1", "--format=%s", twice!.landed)).toBe(`orca: land ${twice!.id} (reconciled with ${both.join(", ")})`);
      // Each task landed exactly once: no moved-tip reset re-landed anything (N2).
      expect(git(t.repo, "rev-list", "--first-parent", "--count", "main..refs/heads/orca/g")).toBe("3");
      expect(git(t.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("a\nb\nd");
      // 10 tokens of work per task, 7 per reconciliation.
      expect(t.bookings()).toHaveLength(2);
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(44);
    } finally { await t.h.dispose(); }
  });

  it("N2: while one run of the group is reconciling, a sibling collected run does not land until the reconciliation has", async () => {
    const t = await harness([...threeShared.slice(0, 2), { taskId: "d" }], (id) => id === "d" ? { d: "d\n" } : shared(id), { files: { "shared.txt": "a\nb\n" }, holdMs: 5_000 }); try {
      const pair = [await t.claim(), await t.claim()];
      expect(pair.map(t.taskOf).sort()).toEqual(["a", "b"]);
      const driver = t.driver();
      await untilDeadline(driver, () => pair.some((id) => t.body(id).drive?.reconcile?.pid != null));
      const reconciling = pair.find((id) => t.body(id).state === "reconciling")!;
      // The driver armed the next start wake itself (replenishStartWakes); delivering it claims d.
      const delivered = await deliverScheduledStart(t.dispatch, "g");
      if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
      const sibling = delivered.runId;
      expect(t.taskOf(sibling)).toBe("d");
      await t.until(driver, () => t.body(sibling).state === "collected");
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      for (let i = 0; i < 3; i += 1) await driver.round();
      expect(t.body(reconciling).state).toBe("reconciling");
      expect(t.body(sibling).state).toBe("collected");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(tip);
      await untilDeadline(driver, () => [...pair, sibling].every((id) => LANDED.includes(t.body(id).state)));
      expect(t.spawns()).toHaveLength(1);
      expect(t.body(reconciling).drive.reconcile.spawnSeq).toBe(1);
      expect(git(t.repo, "rev-parse", `${t.body(sibling).drive.landedCommit}^1`)).toBe(t.body(reconciling).drive.landedCommit);
    } finally { await t.h.dispose(); }
  });
});

describe("a reconciliation reset by a moved tip and spawned again (spec §11 I7, §13.2 I-6)", { timeout: 60_000 }, () => {
  it("books both spawns on the group under two distinct keys", async () => {
    const t = await harness(threeShared.slice(0, 2), shared, { files: { "shared.txt": "a\nb\n" }, holdMs: 1_500 }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await untilDeadline(driver, () => ids.some((id) => t.body(id).drive?.reconcile?.pid != null));
      const runId = ids.find((id) => t.body(id).state === "reconciling")!;
      // A person moves orca/g while the reconciliation runs: its merge now has a stale first parent.
      git(t.repo, "checkout", "-q", "orca/g");
      await writeFile(`${t.repo}/person.txt`, "a person's own\n");
      git(t.repo, "add", "person.txt");
      git(t.repo, "commit", "-qm", "by hand");
      const moved = git(t.repo, "rev-parse", "HEAD");
      await untilDeadline(driver, () => ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      expect(ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
      expect(t.spawns()).toHaveLength(2);
      expect(t.body(runId).drive.reconcile).toMatchObject({ spawnSeq: 2, outcome: "succeeded" });
      expect(git(t.repo, "rev-parse", `${t.body(runId).drive.landedCommit}^1`)).toBe(moved);
      // The second reconciliation ran on the moved tip: the person's commit survives the landing.
      expect(git(t.repo, "show", "refs/heads/orca/g:person.txt")).toBe("a person's own");
      await driver.round(); await driver.round();
      expect(t.bookings()).toEqual([`reconcile-usage:${runId}:spawn-1`, `reconcile-usage:${runId}:spawn-2`]);
      // 10 + 10 for the two tasks, 7 for each of the two reconciliation spawns.
      expect(readWebGroup(t.h.store, "g").used.tokens).toBe(34);
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 4：跑新判据，看见预言的红**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
./node_modules/.bin/vitest run tests/scheduler/reconcileParity.test.ts tests/control/driverReconcileN.test.ts > "$S/t6-red.log" 2>&1; echo "RC=$?" >> "$S/t6-red.log"
cat "$S/t6-red.log"
```

Expected（现测，Orca `264f967` 的 `src` ＋ 本节两份判据，`t6-mut` 里 `git checkout HEAD~1 -- src` 后跑，日志 `scratchpad/planner/t6-red2.log`）：RC 1，**9 条全红，各红在预言处**：
- `reconcileParity` 5 条：`synthesizeReconcileContractOf is not a function`（4 条）、`planReconciliationOf is not a function`（空并集那条）。
- N1u：`expected { escalate: '2' } to deeply equal { taskIds: [ 'a', 'b' ] }` —— 正是 spec §9.2 N1u 说的「今天 `escalate:"2"`」。
- 三路：`expected false to be true`（`driverReconcileN.test.ts:73`「全部落地」：第三个 run 被 `reconcile-other-side:2` 挡住）。
- N2：`expected 'settled' to be 'collected'`（兄弟 run 在解冲突期间已经落地并 settle）。
- I7：`expected [ Array(1) ] to have a length of 2 but got 1`（`.runs` 只有 1 行：第二次根本没 spawn，见本节开头的新现量）。

红的位置不对（例如 N2 那条红在 `deliverScheduledStart`、I7 红在 `bookings`）⇒ 停下，先弄清楚。

- [ ] **Step 5：`src/scheduler/reconcile.ts` —— 只加不改**

第 1 行 `import { writeFile } from "node:fs/promises";` **之前**插入一行：

```ts
import { createHash } from "node:crypto";
```

文件末尾（最后一行 `}` 之后，空一行）追加：

```ts
/**
 * Orca handoff delivery spec §5.2 N1 (controller decision; human ruling "parallel is not only two"):
 * the N-ary reconciliation plan. Added beside the two-sided function, which `orca run` keeps using
 * unchanged; with two sides it answers exactly what `planReconciliation(a, b)` answers.
 */
export function planReconciliationOf(sides: readonly unknown[]): ReconciliationPlan {
  if (sides.length < 2) throw new Error(`orca: a reconciliation needs at least two sides, got ${sides.length}`);
  let union = requiredChecksUnion(sides[0], sides[1]);
  for (const side of sides.slice(2)) union = requiredChecksUnion({ verification: { requiredChecks: union } }, side);
  // An empty union escalates with the two-sided function's own words: two sides contributing nothing.
  return union.length === 0 ? planReconciliation(undefined, undefined) : { escalate: false, requiredChecks: union };
}

/** idSchema's ceiling (src/control/schema.ts): a longer synthesized task id is shortened by a hash. */
const RECONCILE_ID_LIMIT = 200;

/**
 * Handoff delivery spec §5.2 N1 and §11 M5: one landing run reconciled against every landed task its
 * conflict touches. `others` is sorted by task id by the caller. With one other side the contract and
 * its file are byte-for-byte what `synthesizeReconcileContract(self, other, ...)` writes (criterion
 * N-parity); every rule of the two-sided function holds for N sides: all sides contribute intent and
 * budget or the round escalates, the checks are the union of every side's, the budget is the max.
 */
export async function synthesizeReconcileContractOf(
  self: PlanTask,
  others: readonly PlanTask[],
  contracts: Map<string, unknown>,
  runsDir: string,
  conflict: MaterialisedConflict,
): Promise<{ path: string } | { escalate: string }> {
  if (others.length === 0) return { escalate: "a reconciliation needs at least one other side" };
  const all = [self, ...others];
  const intents = all.map((task) => ({ task, intent: intentOf(contracts.get(task.taskId)) }));
  const oneSided = intents.filter((s) => s.intent === null).map((s) => s.task.taskId);
  if (oneSided.length > 0) {
    return {
      escalate:
        `cannot synthesize a reconciliation contract for ${all.map((task) => task.taskId).join(" x ")}: ` +
        `${oneSided.join(", ")} contributed no goal, successCondition or execution budget, so the contract ` +
        `would carry only the other side's intent and the reconciler would be the conflicting party ` +
        `(spec §5.2)`,
    };
  }
  const sides = intents.map((s) => s.intent!);
  const plan = planReconciliationOf(all.map((task) => contracts.get(task.taskId)));
  if (plan.escalate) return { escalate: plan.why };

  const two = others.length === 1;
  const partners = two ? `task ${others[0]!.taskId}` : `tasks ${others.map((task) => task.taskId).join(", ")}`;
  const goal =
    `Reconcile the merge conflict between task ${self.taskId} and ${partners}. ` +
    `HEAD is a commit that records the conflict itself, so the conflict markers are ordinary text in ` +
    `the working tree. Remove every conflict marker in: ${conflict.conflictedPaths.join(", ")}.\n\n` +
    all.map((task, index) =>
      `${task.taskId} was trying to: ${sides[index]!.goal}\n` +
      `${task.taskId} counts as done when: ${sides[index]!.successCondition}\n\n`).join("") +
    (two
      ? `Both intents must survive. Where a block cannot satisfy both, it is a semantic conflict and belongs ` +
        `to a human: leave that block alone and stop, rather than choosing one side.`
      : `Every intent must survive. Where a block cannot satisfy all of them, it is a semantic conflict and belongs ` +
        `to a human: leave that block alone and stop, rather than choosing a side.`);

  const joined = `${slug(self.taskId)}-${others.map((task) => slug(task.taskId)).join("-")}`;
  const stem = `reconcile-${joined}`.length <= RECONCILE_ID_LIMIT
    ? joined
    : `${slug(self.taskId).slice(0, 100)}-${createHash("sha256").update(others.map((task) => task.taskId).join("\0")).digest("hex").slice(0, 16)}`;
  const max = (pick: (side: SideIntent) => number): number => Math.max(...sides.map(pick));
  const contract = {
    objective: {
      taskId: `reconcile-${stem}`,
      goal,
      successCondition:
        `No file in ${conflict.conflictedPaths.join(", ")} contains a conflict marker, and ${two ? "both tasks'" : "every task's"} ` +
        `required checks pass.`,
      nonGoals: [
        "changing anything outside the conflicting blocks",
        two ? "deciding a block that cannot satisfy both intents at once" : "deciding a block that cannot satisfy every intent at once",
      ],
    },
    context: {
      repoPath: conflict.copyPath,
      targetPaths: conflict.conflictedPaths,
      relevantDocs: [],
      buildTestCommands: plan.requiredChecks,
      constraints: [
        `The conflict is recorded in commit ${conflict.conflictCommit}, whose parents are ${conflict.wTip} ` +
          `(the work branch) and ${conflict.incomingRef} (the incoming task).`,
      ],
    },
    executionPolicy: {
      autonomyLevel: "L2",
      maxAttempts: 1,
      perAttemptTimeoutMs: max((side) => side.perAttemptTimeoutMs),
      totalRuntimeBudgetMs: max((side) => side.totalRuntimeBudgetMs),
      tokenBudget: max((side) => side.tokenBudget),
      worktreeRequired: true,
      partialOutcomeRecoveryWindowMs: 0,
    },
    safetyPolicy: {
      allowlistPaths: [],
      denylistPaths: [],
      maxFilesTouched: conflict.conflictedPaths.length,
      humanGateConditions: [],
    },
    verification: {
      verifierType: "command",
      requiredChecks: plan.requiredChecks,
      rejectOn: ["nonzero exit"],
      evidenceRequired: [],
    },
    escalationAndExit: {
      escalationTargets: [],
      pauseOn: [],
      stopOn: [],
      terminalStates: [...TERMINAL_OUTCOMES],
    },
  };

  const path = join(runsDir, `contract-reconcile-${stem}.json`);
  await writeFile(path, JSON.stringify(contract, null, 2));
  return { path };
}
```

只加不改的证明（必须 `APPEND_ONLY True`）：

```bash
cd /Users/biran/code/skills/loop/Orca
python3 - > "${SCRATCH:?}/t6-append-only.log" 2>&1 <<'EOF'
import subprocess
p = "src/scheduler/reconcile.ts"
old = subprocess.run(["/usr/bin/git", "show", "HEAD:" + p], capture_output=True, check=True).stdout
new = open(p, "rb").read()
head = b'import { createHash } from "node:crypto";\n'
print("APPEND_ONLY", new.startswith(head) and new[len(head):].startswith(old), "ADDED_BYTES", len(new) - len(old))
EOF
cat "${SCRATCH:?}/t6-append-only.log"
```

现测：`APPEND_ONLY True ADDED_BYTES 6081`（在 `264f967` 上；前序 Task 不动 `reconcile.ts`，字节数应相同）。

说明：`planReconciliationOf` 把 `requiredChecksUnion` 依次折叠过每一方（保持首见顺序），并集为空时**直接返回 `planReconciliation(undefined, undefined)`** —— 升级文案与两元函数逐字相同（spec §5.2「上游 §5.3(3) 同一规则的 N 元推广」）。`synthesizeReconcileContractOf` 的每条规则与两元函数相同：任何一方缺意图或预算 ⇒ 点名全部缺的一方升级；checks 取并集；三个预算取 max；`maxAttempts` 钉 1。N＝1 时 `two === true`，所有文案、字段顺序、文件名都走两元函数的原文 ⇒ N-parity 逐字节。

- [ ] **Step 6：`src/control/driveRecord.ts`**

`  otherTaskId: idSchema,`（`:25`，命中 1）之后插入：

```ts
  // Handoff delivery spec §5.2 N1 (controller decision, 2026-09-25): every landed task the conflict touches,
  // sorted by task id; `otherTaskId` is its first. Optional so a record from before this field still parses;
  // readers use `otherTaskIds ?? [otherTaskId]`.
  otherTaskIds: z.array(idSchema).min(1).optional(),
```

- [ ] **Step 7：`src/control/driverLanding.ts`**（每一处整段替换，断言命中 == 1）

(a) `:13` import：`synthesizeReconcileContract }` → `synthesizeReconcileContractOf }`（两元函数在本文件不再被用；`orca run` 的 `src/scheduler/run.ts:38,:434` 照旧用它）：

```ts
import { markersRemaining, materialiseConflict, pinConflictCommit, rebuildMergeCommit, synthesizeReconcileContractOf } from "../scheduler/reconcile.js";
```

(b) N2：`stepD` 里 `  if (run.state !== "collected" || run.drive?.attemptSha == null || run.drive.base === null) return false;`（`:82`）之后、`  const drive = run.drive;` 之前插入：

```ts
  // Handoff delivery spec §5.2 N2 (controller decision): at most one landing of a group is reconciling. A
  // sibling landing now would move the tip under it and make it land, and maybe pay, again.
  for (const row of store.db.prepare("SELECT body FROM runs WHERE group_id=? AND active=1").all(run.groupId)) {
    if ((JSON.parse(String(row.body)) as DriverRun).state === "reconciling") return false;
  }
```

说明：返回 `false`（本轮无进展），不 block、不写任何东西；按 run id 序排队是 `driverRunIds` 本来的遍历次序（`executionDriver.ts:490-500`）。自己这个 run 不会是 `reconciling`（第一行已要求 `collected`），所以不必排除自己。一轮之内的干净落地仍串行照旧（上游 §5.4）：守卫只看 `reconciling`，不看 `collected`／`landed`。

(c) N1：`otherSideOfWeb` 的文档注释末行 ` * path. Exactly one, or the reconciliation would carry a side this driver picked.` 之后、` */` 之前追加一段，签名改返回类型，末行改返回集合：

```ts
 * path. Exactly one, or the reconciliation would carry a side this driver picked.
 *
 * Handoff delivery spec §5.2 N1 (controller decision, 2026-09-25): every such task, sorted by task id, so
 * the reconciliation carries all of them and none is picked. None is still an escalation: the conflict
 * then comes from a commit no run of this group landed.
 */
export async function otherSideOfWeb(store: ControlStore, targetRepo: string, run: DriverRun, conflictedPaths: readonly string[]): Promise<{ taskIds: string[] } | { escalate: string }> {
```

```ts
  return touched.size === 0 ? { escalate: "0" } : { taskIds: [...touched].sort() };
```

（替换 `:132` 的 `  return touched.size === 1 ? { taskId: [...touched][0]! } : { escalate: String(touched.size) };`；`blocked`＝`reconcile-other-side:0` 的既有判据 `driverReconcile.test.ts` "blocks a conflict that no landed run of the group explains" 照绿。）

(d)＋(e) `beginReconcile`：从 `  const contracts = new Map<string, unknown>([` 到 `  const synthesized = await synthesizeReconcileContract(side(run.taskId!), side(other.taskId), contracts, runsDir, conflict);` 这一整段（`:156-162`）替换为：

```ts
  const others = other.taskIds;
  const contracts = new Map<string, unknown>(
    [run.taskId!, ...others].map((taskId) => [taskId, readConfirmedTaskExecution(store, run.groupId, taskId).contract]),
  );
  const runsDir = privateDirectory(reconcileRunsDirOf(roots, runId));
  // A reconciliation reset by a moved tip left its terminal loop state here; a new one must not collect
  // it. Measured (handoff delivery Task 6): it did, and landed a tree built on the old tip.
  await rm(join(runsDir, `reconcile-${runId}`), { recursive: true, force: true });
  const side = (taskId: string): PlanTask => ({ taskId, contract: "", dependsOn: [] });
  const synthesized = await synthesizeReconcileContractOf(side(run.taskId!), others.map(side), contracts, runsDir, conflict);
```

record 字面量的首行与 `spawnSeq` 行（`:167`、`:169`）替换为：

```ts
    copyPath: copy, old, conflictCommit: conflict.conflictCommit, conflictedPaths: conflict.conflictedPaths, otherTaskId: others[0]!, otherTaskIds: others,
```

```ts
    // Handoff delivery spec §11 I7, §13.2 I-6: the spawn key is monotonic per run. A moved-tip reset clears
    // this record, so it resumes from the spawns already booked instead of from 0 (a booked key collides).
    // Controller ruling D-SPAWNKEY (2026-09-25): MAX of the booked spawn numbers, not a row count -- a spawn
    // whose process died unbooked would make a count collide with a booked key.
    spawnSeq: Number(store.db.prepare("SELECT COALESCE(MAX(CAST(substr(id, ?) AS INTEGER)), 0) AS n FROM outbox WHERE id LIKE ?")
      .get(`reconcile-usage:${runId}:spawn-`.length + 1, `reconcile-usage:${runId}:spawn-%`)!.n),
```

说明：(d) 删的是 `join(record.runsDir, record.reconcileRunId)`，与 `stepR` spawn 前删的是同一个目录（`:248`、`:258`；`reconcileRunId` ＝ `reconcile-${runId}`，`:168`）；它在驱动环自己的根下（`reconcileRunsDirOf`），不在人的检出里。`beginReconcile` 只从 `collected` 进来，此时该 run 没有活着的解冲突进程（上一次已被收集为终态）。合约文件同目录、同名，`writeFile` 覆盖，不受影响。

(f) `finishReconcile` 落地消息（`:310`）：`\`orca: land ${runId} (reconciled with ${record.otherTaskId})\`` → 

```ts
`orca: land ${runId} (reconciled with ${(record.otherTaskIds ?? [record.otherTaskId]).join(", ")})`
```

- [ ] **Step 8：看见绿；typecheck；既有判据与全套回归**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
: "${ORCA_CCLOOP_BIN:?E2E criteria must not be skipped: point ORCA_CCLOOP_BIN at a built ccloop dist/cli.js}"
./node_modules/.bin/vitest run tests/scheduler/reconcileParity.test.ts tests/control/driverReconcileN.test.ts > "$S/t6-green.log" 2>&1; echo "RC=$?" >> "$S/t6-green.log"
npm run typecheck > "$S/t6-tsc.log" 2>&1; echo "RC=$?" >> "$S/t6-tsc.log"
./node_modules/.bin/vitest run tests/control/driverReconcile.test.ts tests/control/driverLanding.test.ts tests/control/executionDriver.test.ts tests/control/executionDriverE2E.test.ts tests/scheduler > "$S/t6-regress.log" 2>&1; echo "RC=$?" >> "$S/t6-regress.log"
./node_modules/.bin/vitest run --reporter=json --outputFile="$S/t6-full.json" > "$S/t6-full.log" 2>&1; echo "RC=$?" >> "$S/t6-full.log"
S="$S" python3 - > "$S/t6-full-summary.log" 2>&1 <<'EOF'
import json, os
d = json.load(open(os.path.join(os.environ["S"], "t6-full.json")))
print("files", len(d["testResults"]), "passed", d["numPassedTests"], "failed", d["numFailedTests"], "skipped", d["numPendingTests"] + d.get("numTodoTests", 0), "total", d["numTotalTests"])
for f in d["testResults"]:
    for a in f["assertionResults"]:
        if a["status"] != "passed": print(a["status"], f["name"], a["fullName"])
EOF
cat "$S/t6-green.log" "$S/t6-tsc.log" "$S/t6-regress.log" "$S/t6-full.log" "$S/t6-full-summary.log"
```

（全套需要 `web/dist`：没有就先 `npm run build --workspace web`，否则 `tests/panel/controlMount.test.ts` 12 条与 `controlShutdown.test.ts` 的 SIGTERM 那条以 `panel-dist-missing` 红 —— 本席现测过这 13 条红的原因就是它，补上 `web/dist` 后 19/19 绿，与 T6 无关。）

Expected（现测，`t6-clone`，Orca `264f967` ＋ T6）：
- `t6-green.log`：2 个文件 9/9 绿，RC 0（`driverReconcileN` 约 30 s：N1u ≈3 s、三路 ≈7 s、N2 ≈10 s、I7 ≈9 s）。同一对文件与 `driverReconcile.test.ts` 连跑 3 遍：28/28、28/28、28/28。
- `t6-tsc.log`：RC 0。
- `t6-regress.log`：RC 0；既有 `driverReconcile.test.ts` **一条不改、全绿**（含 RC1 的 `otherTaskId` 与落地消息全等、"blocks a conflict that no landed run of the group explains" 的 `reconcile-other-side:0`、I4 的两条 spawn／记账计数）；`executionDriverE2E.test.ts:223` 的 `\(reconciled with [ab]\)$` 正则照过；`tests/scheduler/**`（含 `S4`、`S20`、`reconcile.test.ts` 对两元函数的全部判据）照绿。未设 `ORCA_CCLOOP_BIN` 时现测为 55 文件绿 ＋ 1 文件跳过（9 条，E2E）—— **不许**，门要求 0 跳过。
- `t6-full-summary.log`：`failed 0`、`skipped 0`。本席在 `264f967`＋T6 上现测：197 个文件、1765/1765（基线 195／1756 ＋ 本节 2 文件 9 条）；叠在 T1–T5 之后，数 ＝ T5 结束时的数 ＋ 2 文件 ＋ 9 条。

- [ ] **Step 9：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/scheduler/reconcile.ts src/control/driveRecord.ts src/control/driverLanding.ts tests/scheduler/reconcileParity.test.ts tests/control/driverReconcileN.test.ts
/usr/bin/git diff --cached --stat > "${SCRATCH:?}/t6-cached.txt"; cat "${SCRATCH:?}/t6-cached.txt"
/usr/bin/git commit -F "${SCRATCH:?}/t6-msg.txt"
```

期望 `--stat`：5 个文件；现测 `--numstat`：`reconcile.ts 124/0`、`driverLanding.ts 25/11`、`driveRecord.ts 4/0`、`driverReconcileN.test.ts 146/0`、`reconcileParity.test.ts 99/0`。

`t6-msg.txt`：

```
feat(control): land N-way conflicts against every landed side, one reconciliation per group

Handoff delivery spec §5.2 N1/N2, §11 I7, §13.2 I-6. A landing that conflicts
with several landed tasks is reconciled against all of them: otherSideOfWeb
answers the sorted set (none still blocks), and a new append-only N-ary
reconciler builds the contract from every side (checks union, max budget; with
one other side it writes the two-sided synthesizer's bytes). A group has at most
one landing reconciling, so a sibling never moves the tip under it. The
reconciliation spawn key resumes from the spawns already booked, so a moved-tip
reset no longer books a second spawn under a used key, and a new reconciliation
first discards the previous one's terminal loop state, which it used to collect
and land on the moved tip, dropping the commit that moved it.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异（变异席在 `git clone --local` 副本里做；每条：前后 sha256、跑三份文件 `tests/scheduler/reconcileParity.test.ts tests/control/driverReconcileN.test.ts tests/control/driverReconcile.test.ts`，共 33 条）**

现测：本席在 `t6-mut`（`t6-clone` 的 `clone --local`）逐条做过，脚本 `scratchpad/planner/t6-mutate.py`，日志 `t6-mut.log`／`t6-mut2.log`；T6-M1..M12 **全部**前后 sha256 相同、红在下表所列且仅所列；收尾 `git diff` 与 `git diff --cached` 字节数 `0 0`。

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| T6-M1 | `src/scheduler/reconcile.ts` | 删 N 元折叠那一行 `for (const side of sides.slice(2)) union = …` | 三方 checks | `three sides: every side's checks in first-seen order…`（缺 `"w"`） |
| T6-M2 | 同上 | `return union.length === 0 ? planReconciliation(undefined, undefined) : {…}` → 只留 `{ escalate: false, requiredChecks: union }` | 三方并集为空 | `escalates an empty union of checks over three sides…` |
| T6-M3 | 同上 | `const two = others.length === 1;` → `const two = true;`（删掉 >1 方的措辞分支） | 三方 | `three sides: …`（goal 里没有 `tasks b, d`／`Every intent must survive.`） |
| T6-M4 | 同上 | `` const stem = `reconcile-${joined}`.length <= RECONCILE_ID_LIMIT `` → `const stem = true`（删哈希兜底） | 两个 120 字符的对方 | `names a reconciliation whose ids would pass the 200-character id ceiling…` |
| T6-M5 | `src/control/driverLanding.ts` | `otherSideOfWeb` 末行换回 `touched.size === 1 ? { taskIds: [...touched] } : { escalate: String(touched.size) }`（删集合） | 两个已落地相交 | N1u **与** 三路 `lands all three with exactly two reconciliations…` |
| T6-M6 | 同上 | 删 `.sort()` | b 的 run id 排在 a 前（N1u 夹具保证） | N1u（确定红）；三路那条随 run id 序约一半概率同红（本席那一遍红了） |
| T6-M7 | 同上 | 删零个分支：`return { taskIds: [...touched].sort() };` | 冲突来自人手提交 | N1u（`escalate:"0"`）**与**既有 `driverReconcile.test.ts` > `blocks a conflict that no landed run of the group explains`（原因变成 `reconcile-contract:…`） |
| T6-M8 | 同上 | N2 守卫的 `return false;` → `continue;`（删守卫本身） | 解冲突期间兄弟 run 已 `collected` | `N2: while one run of the group is reconciling…` **与** 三路那条（第三个 run 抢先解冲突，尖端移动后重来：spawn 3 次） |
| T6-M9 | 同上 | `spawnSeq: Number(…COUNT(*)…)` → `spawnSeq: 0,` | 尖端移动重置后再 spawn | `books both spawns on the group under two distinct keys`（第二次记账撞键 `spawn-1`，被去重吞掉） |
| T6-M10 | 同上 | 删 `await rm(join(runsDir, \`reconcile-${runId}\`), …)` | 尖端移动重置 | `books both spawns…`（`.runs` 只 1 行：旧终态被直接收集；`person.txt` 丢失） |
| T6-M11 | 同上 | record 里删 `otherTaskIds: others` | 三路 | 三路那条（`otherTaskIds` 缺失；落地消息退回单个 id） |
| T6-M12 | 同上 | 落地消息换回 `${record.otherTaskId}` | 三路 | 三路那条（第二次落地消息只列一个 id） |

说明：`driveRecord.ts` 的可选字段记为 T6-M13「删 `otherTaskIds: z.array(idSchema).min(1).optional(),`」，期望红是 **typecheck**（不是 vitest）：现测 `npm run typecheck` RC 2，`driverLanding.ts` 两处 `TS2561`／`TS2551`（record 字面量与落地消息各一），日志 `scratchpad/planner/t6-mut-M13.log`。


---

---

## Task 7：优雅关闭不再冻住驱动环的 group ＋ Web spec ERRATUM（spec §6、§12(3)、§13.2 I-8；终审 m5）

**Files:**
- Modify: `src/panel/controlLifecycle.ts`（`:52` `Disposition`；`recordInconsistency`（`:115-119`）之后加 `driverOwnedGroup`；`shutdownGroup` 里 `preserved-pause` 分支（`:138-140`）之后、`const stopRevision`（`:141`）之前加跳过分支）
- Modify: `src/control/webProtocol.ts`（shutdown 条目的 `disposition` 枚举，`"blocked-inconsistent",` 在 `:1122`）
- Modify: `web/src/controlTypes.ts`（`:246` `CommandSuccessV1` 的 shutdown 条目）
- Modify: `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`（**只在文末追加**，原文一字不动，Rule 13）
- Create: `tests/panel/shutdownDriverGroup.test.ts`

（行号：Orca `264f967`，python 逐行现测。）

**Interfaces:**
- Consumes: `shutdownGroup(store, groupId, window, shutdownId, exemptDriverRuns = false)`（`controlLifecycle.ts:126`）；`applyPanelShutdown(deps)`（`:156`）；`frozenRunIds`、`readStopIntent`（`stopIntent.ts`）；`commandSuccessSchema`（`webProtocol.ts:1137`）；`lookupCommandResult`（`commandLedger.ts`）；`WebControlService.claimEstimate`（`webService.ts:260`）。
- Produces:
  - `Disposition` 加值 `"skipped-driver-owned"`（服务端 zod 枚举与 web 类型同步 —— 人已同意的线上契约变更，§12(3)）。
  - `driverOwnedGroup(store, groupId): boolean`（模块私有）＝ group body 有 `planHash` **且** `SELECT 1 FROM scheduler_wakes WHERE group_id=? AND kind='start'` 有行（不看 `delivered`）。「驱动环存在」由调用方的 `exemptDriverRuns` 表达（组装层只在驱动环存在时传 `true`，既有）。
  - 跳过条件：`exemptDriverRuns && intent === null && active.length === 0 && driverOwnedGroup(store, groupId)`，**放在既有 `blocked-inconsistent`／`preserved-*` 三个分支之后**（§13.2 I-8）。条目 `{ disposition: "skipped-driver-owned", changed: false, commandRevision/projectionSeq 取现值, frozenRunIds: [], requestIds: [], blockerCode: null }`；不写 stop intent、不置 `stopped`、不升 revision、不记 projection。

**两条现测到的结构事实（写进计划，免得执行席把它们当成漏洞去「修」）：**
1. `active` 已经滤掉了驱动环的 Web work run（`controlLifecycle.ts:128`，执行驱动 spec §4 的既有豁免）⇒ `active.length === 0` 恰好就是「组内没有非驱动环的活动 run」（H7）。
2. 在「既有分支之后」这个位置上，`intent === null` 是**冗余**的：能走到这里的非空 intent 只剩 `pause` 且 `active.length > 0`，已被 `active.length === 0` 排除。保留它是因为 §13.2 I-8 把「无既有 stop intent」写成定义的一部分，并让跳过分支**不依赖**它在函数里的位置。变异表如实登记两条等价变异（T7-M2、T7-M7a），以及能杀死「挪位置＋删 `intent === null`」组合的判据（T7-M7b）。

- [ ] **Step 1：开工核对**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?set SCRATCH to the session scratchpad}"
/usr/bin/git status --short > "$S/t7-start.txt" 2>&1; /usr/bin/git log --oneline -3 >> "$S/t7-start.txt" 2>&1
python3 - >> "$S/t7-start.txt" 2>&1 <<'EOF'
for f, p in [("src/panel/controlLifecycle.ts", 'type Disposition = "created"'), ("src/panel/controlLifecycle.ts", 'disposition: "preserved-pause"'),
             ("src/control/webProtocol.ts", '"blocked-inconsistent",'), ("web/src/controlTypes.ts", 'kind: "shutdown"; groups'),
             ("docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md", "resume-from-handoff` followed by"),
             ("docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md", "is now satisfiable by production code")]:
    print(f, [i + 1 for i, l in enumerate(open(f).read().splitlines()) if p in l], p)
EOF
cat "$S/t7-start.txt"
```

期望：每个锚点**恰好命中 1 行**（`264f967` 上分别是 `:52`、`:139`、`:1122`、`:246`、web spec `:1282`、`:1583`）。行号若因前面的 Task 移动，**以现测为准**改下面的落点与 ERRATUM 里引用的行号；命中数不是 1 ⇒ 停下报告。

- [ ] **Step 2：写新判据 `tests/panel/shutdownDriverGroup.test.ts`（8 条）**

```ts
import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { frozenRunIds, readStopIntent } from "../../src/control/stopIntent.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { commandSuccessSchema } from "../../src/control/webProtocol.js";
import { applyPanelShutdown, freezeShutdownWindow, shutdownCommandId, shutdownGroup } from "../../src/panel/controlLifecycle.js";
import { webFixture } from "../control/fixtures/web.js";
import type { ControlStore } from "../../src/control/store.js";

// Handoff delivery spec §6, §12(3) (human: "空闲的也跳过") and §13.2 I-8 (m5). A group the execution
// driver owns -- a Web plan group (planHash) that has been started (a start wake exists) while a driver
// exists -- gets no shutdown stop intent and is not stopped, so after a restart the driver keeps
// dispatching with no human command. Every other group is frozen exactly as Web spec §6.4 says.

const ACCEPTED_AT = "2026-09-25T10:00:00.000Z";
const EPOCH = "epoch-shutdown-driver";
const window = freezeShutdownWindow({ now: () => new Date(ACCEPTED_AT), shutdownGraceMs: 120_000 });

type Fixture = Awaited<ReturnType<typeof webFixture>>;
const revisionOf = (store: ControlStore): number => Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
const projectionOf = (store: ControlStore): number => Number(store.db.prepare("SELECT projection_seq FROM groups WHERE id='g'").get()!.projection_seq);
const stopped = (store: ControlStore): boolean => (JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { stopped: boolean }).stopped;
const count = (store: ControlStore, sql: string): number => Number(store.db.prepare(sql).get()!.n);

/** A confirmed group `g`; `start` arms the start wake, `claim` delivers it into one `starting` Web work run. */
async function group(options: { start: boolean; claim: boolean }): Promise<{ h: Fixture; service: WebControlService; runId: string | null }> {
  const h = await webFixture();
  const service = new WebControlService(h.deps);
  const confirmed = service.confirm(h.command("confirm", h.confirmPayload()));
  if ("error" in confirmed) throw new Error(JSON.stringify(confirmed));
  let runId: string | null = null;
  if (options.start) {
    const started = await service.start(h.command("start", {}));
    if ("error" in started) throw new Error(JSON.stringify(started));
  }
  if (options.claim) {
    const claim = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
    if (claim.kind !== "claimed") throw new Error(JSON.stringify(claim));
    runId = claim.runId;
  }
  return { h, service, runId };
}

describe("graceful shutdown and driver-owned groups (handoff delivery m5)", () => {
  it("skips a started group whose only active run is the driver's Web work run: no stop intent, not stopped, no request", async () => {
    const { h, runId } = await group({ start: true, claim: true }); try {
      expect(frozenRunIds(h.store, "g")).toEqual([runId]);
      const before = { revision: revisionOf(h.store), projection: projectionOf(h.store) };
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toEqual({ groupId: "g", disposition: "skipped-driver-owned", changed: false, commandRevision: before.revision,
        projectionSeq: before.projection, frozenRunIds: [], requestIds: [], blockerCode: null });
      expect(readStopIntent(h.store, "g")).toBeNull();
      expect(count(h.store, "SELECT COUNT(*) AS n FROM stop_intents")).toBe(0);
      expect(stopped(h.store)).toBe(false);
      expect(count(h.store, "SELECT COUNT(*) AS n FROM handoff_requests")).toBe(0);
      expect(count(h.store, "SELECT COUNT(*) AS n FROM outbox WHERE kind='handoff-request'")).toBe(0);
      expect(revisionOf(h.store)).toBe(before.revision);
    } finally { await h.dispose(); }
  });

  it("skips a started driver-owned group that is idle, with no active run at all", async () => {
    const { h } = await group({ start: true, claim: false }); try {
      expect(frozenRunIds(h.store, "g")).toEqual([]);
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "skipped-driver-owned", changed: false, frozenRunIds: [], requestIds: [] });
      expect(readStopIntent(h.store, "g")).toBeNull();
      expect(stopped(h.store)).toBe(false);
    } finally { await h.dispose(); }
  });

  it("freezes a started group exactly as before when no driver exists, idle or running", async () => {
    const running = await group({ start: true, claim: true }); try {
      const { h, runId } = running;
      const before = revisionOf(h.store);
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), false);
      expect(entry).toMatchObject({ disposition: "created", changed: true, commandRevision: before + 1, frozenRunIds: [runId] });
      expect(entry.requestIds).toHaveLength(1);
      expect(readStopIntent(h.store, "g")).toMatchObject({ mode: "shutdown", frozenRunIds: [runId], acceptedAt: ACCEPTED_AT });
      expect(stopped(h.store)).toBe(true);
      expect(count(h.store, "SELECT COUNT(*) AS n FROM handoff_requests")).toBe(1);
    } finally { await running.h.dispose(); }
    // Idle is the case where only the driver switch tells the two apart: no run is left to exempt.
    const idle = await group({ start: true, claim: false }); try {
      const entry = shutdownGroup(idle.h.store, "g", window, shutdownCommandId(EPOCH), false);
      expect(entry).toMatchObject({ disposition: "created", changed: true, frozenRunIds: [] });
      expect(readStopIntent(idle.h.store, "g")).toMatchObject({ mode: "shutdown", state: "handoff-complete" });
      expect(stopped(idle.h.store)).toBe(true);
    } finally { await idle.h.dispose(); }
  });

  it("freezes a group that was never started even when a driver exists: it is not the driver's yet", async () => {
    const { h } = await group({ start: false, claim: false }); try {
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "created", changed: true, frozenRunIds: [] });
      expect(readStopIntent(h.store, "g")).toMatchObject({ mode: "shutdown", state: "handoff-complete" });
      expect(stopped(h.store)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("freezes a started group whose body carries no planHash: the planHash is part of the definition", async () => {
    const { h } = await group({ start: true, claim: false }); try {
      const row = h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
      const { planHash: _dropped, ...rest } = JSON.parse(String(row.body)) as Record<string, unknown>;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(rest));
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "created", changed: true });
      expect(stopped(h.store)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("preserves an existing pause on an idle driver-owned group: the skip never pre-empts an earlier intent", async () => {
    const { h, service } = await group({ start: true, claim: false }); try {
      const paused = await service.pauseDispatch(h.command("pause-dispatch", {}));
      if ("error" in paused) throw new Error(JSON.stringify(paused));
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      expect(entry).toMatchObject({ disposition: "preserved-pause", changed: false, frozenRunIds: [] });
      expect(readStopIntent(h.store, "g")!.mode).toBe("pause");
      expect(stopped(h.store)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("H7: freezes a driver-owned group as before while a non-driver run (an estimate) is active in it", async () => {
    const { h, service, runId } = await group({ start: true, claim: true }); try {
      const estimate = await service.claimEstimate("g", h.estimateId);
      const estimateRunId = String((estimate as { runId: string }).runId);
      expect(frozenRunIds(h.store, "g")).toEqual([runId, estimateRunId].sort());
      const entry = shutdownGroup(h.store, "g", window, shutdownCommandId(EPOCH), true);
      // The driver's own run stays exempt (execution driver spec §4); only the estimate is frozen.
      expect(entry).toMatchObject({ disposition: "created", changed: true, frozenRunIds: [estimateRunId] });
      expect(entry.requestIds).toHaveLength(1);
      expect(readStopIntent(h.store, "g")).toMatchObject({ mode: "shutdown", frozenRunIds: [estimateRunId] });
      expect(stopped(h.store)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("commits the new disposition under the global command and replays it through the ledger schema", async () => {
    const { h } = await group({ start: true, claim: true }); try {
      const result = await applyPanelShutdown({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate,
        epoch: EPOCH, now: () => new Date(ACCEPTED_AT), shutdownGraceMs: 120_000, exemptDriverRuns: true });
      expect(commandSuccessSchema.safeParse(result).success).toBe(true);
      expect(result.result).toMatchObject({ kind: "shutdown", groups: [{ groupId: "g", disposition: "skipped-driver-owned", changed: false }] });
      const replay = lookupCommandResult(h.store, "@global", shutdownCommandId(EPOCH))!;
      expect(replay.body).toEqual(result);
      expect(stopped(h.store)).toBe(false);
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 3：跑新判据，看见红**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/panel/shutdownDriverGroup.test.ts > "${SCRATCH:?}/t7-red.log" 2>&1; echo "RC=$?" >> "${SCRATCH:?}/t7-red.log"; cat "${SCRATCH:?}/t7-red.log"
```

Expected（控制器席在 `clone --local` 副本上实测，`264f967`＋本判据、未改 `src/`）：RC=1，**恰好 3 条红**，且只有这 3 条：
`skips a started group whose only active run is the driver's Web work run…`（`disposition: "created"`、`changed: true`、`commandRevision` 3→4）、`skips a started driver-owned group that is idle…`（`created`）、`commits the new disposition under the global command…`（`created`）。其余 5 条今天就绿 —— 它们钉的正是「不该被跳过的组照旧冻结」。实际与此逐条比，不一致就停下报告。

- [ ] **Step 4：实现**

`src/panel/controlLifecycle.ts` `:52` 整行换为：

```ts
type Disposition = "created" | "strengthened-pause" | "preserved-pause" | "preserved-handoff" | "preserved-shutdown" | "blocked-inconsistent" | "skipped-driver-owned";
```

在 `recordInconsistency` 函数（`:115-119`）之后、`shutdownGroup` 的文档注释之前插入：

```ts
/**
 * Handoff delivery spec §12(3): a group the execution driver owns is a Web plan group (it has a
 * `planHash`) that a person has started at least once (a `start` wake exists, delivered or not).
 * Whether a driver exists at all is the caller's `exemptDriverRuns`.
 */
function driverOwnedGroup(store: ControlStore, groupId: string): boolean {
  const group = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as { planHash?: string };
  return group.planHash !== undefined
    && store.db.prepare("SELECT 1 FROM scheduler_wakes WHERE group_id=? AND kind='start'").get(groupId) !== undefined;
}
```

`shutdownGroup` 里 `preserved-pause` 分支（`if (intent?.mode === "pause" && active.length === 0) { … }`，`:138-140`）的闭合 `}` 之后、`const stopRevision = revisionOf(store, groupId) + 1;` 之前插入：

```ts
  // Handoff delivery spec §12(3) and §13.2 I-8 (m5): a driver-owned group keeps dispatching across a
  // restart, so it gets no stop intent and is not stopped -- but only when no earlier intent exists
  // (the branches above answer those first) and every active run is one the driver collects.
  if (exemptDriverRuns && intent === null && active.length === 0 && driverOwnedGroup(store, groupId)) {
    return { groupId, disposition: "skipped-driver-owned", changed: false, ...versions(store, groupId), frozenRunIds: [], requestIds: [], blockerCode: null };
  }
```

`src/control/webProtocol.ts`：shutdown 条目的 `disposition: z.enum([...])` 里，`"blocked-inconsistent",`（`:1122`）之后加一行：

```ts
              "skipped-driver-owned",
```

`web/src/controlTypes.ts` `:246`：把 `"preserved-shutdown" | "blocked-inconsistent"; changed: boolean;` 改为

```ts
"preserved-shutdown" | "blocked-inconsistent" | "skipped-driver-owned"; changed: boolean;
```

（该行其余字面一字不动；python 断言命中 == 1 再替换。）

- [ ] **Step 5：追加 Web spec 的 ERRATUM（Rule 13：原文逐字保留，只在文末追加）**

先确认文末现状（最后一节应是 `## ERRATUM (execution driver, 2026-09-25)`，文件以换行结尾），再把下面的文本**原样**追加到 `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` 末尾（首行是空行）。文中的行号 `1274`、`1282`、`1582-1583` 是 Step 1 现测值；Step 1 若测得不同，**只改这几个数字**。

```markdown
## ERRATUM (handoff delivery, 2026-09-25)

Appended 2026-09-25 by the implementer of Task 7 of the handoff delivery plan, under controller session `e5f56bfe`
(Claude Opus 5.5), in the commit whose subject is `feat(panel): skip graceful shutdown for driver-owned groups`. The statements below are superseded by
`docs/superpowers/specs/2026-09-25-handoff-delivery-design.md` (§6, §11 C2, §12(3), §13.2 C-1, I-1 and I-8). The original text above is kept verbatim.

1. **§6.4 no longer freezes a driver-owned group.** A group is driver-owned when its body carries a `planHash`, a `start`
   scheduler wake exists for it (delivered or not), and the panel runs with an execution driver (`exemptDriverRuns`).
   For such a group, and only when it has **no existing stop intent** and **no active run other than the driver's own Web
   work runs**, shutdown writes no stop intent, does not set `stopped`, freezes no run, and lists the group with the new
   disposition `skipped-driver-owned` (`changed: false`). Step 3 (line 1274, "for every group with active runs—including a
   paused group—persists or strengthens its stop intent … for a dispatch-enabled group with no active run, persists a
   shutdown stop intent") therefore does not apply to it, and neither does the sentence at line 1282: "A ready group with
   no active run receives a shutdown intent with an empty frozen set, reaches `handoff-complete`, and after restart uses an
   empty `resume-from-handoff` followed by an explicit `start`." After a restart the driver collects the runs it left in
   ccloop and arms the next start wake with no human command. Every other group — never started, no `planHash`, no driver,
   an existing pause/handoff/shutdown intent, or any active non-driver run such as a budget estimate — is handled exactly
   as §6.4 says. Implemented in `src/panel/controlLifecycle.ts` (`driverOwnedGroup` and the branch after the preserved
   dispositions); pinned by `tests/panel/shutdownDriverGroup.test.ts`.
2. **§11.1 "the chain `commitCandidate → settleHandoffRequest → assertPredecessor` is now satisfiable by production code"
   (lines 1582-1583) no longer holds** after the execution driver's deviation D2 (`releaseRunReserve` got a Web branch that
   releases the run's commitment when a candidate is committed): committing first and settling the request second either
   double-counts or breaks `assertPredecessor`. A Web run stopped by a handoff is closed by one step, H-settle: archive the
   snapshot and write the checkpoint file as canonical bytes (`canonicalBytes(candidate)`, row hash
   `sha256Canonical(candidate)`), then one transaction inserts the checkpoint row with `result: "partial"`, sets
   `checkpointId`/`recoverable`, parks the remaining commitment as `held`, settles the request `settled-recoverable`, and
   leaves the run `settled-recoverable` with its work `held`. `commitCandidate` is not on that path.
```

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"; F=docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md
/usr/bin/git diff --numstat -- "$F" > "$S/t7-erratum.txt" 2>&1
/usr/bin/git diff -- "$F" | python3 -c "import sys; d=sys.stdin.read().splitlines(); print('removed lines:', sum(1 for l in d if l.startswith('-') and not l.startswith('---')))" >> "$S/t7-erratum.txt" 2>&1
cat "$S/t7-erratum.txt"
```

期望：`numstat` 为 `28	0	…`（只加不删；28 行是控制器席副本上的实测值），`removed lines: 0`。

- [ ] **Step 6：绿，再跑相邻判据与全部门**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
./node_modules/.bin/vitest run tests/panel/shutdownDriverGroup.test.ts tests/panel/controlLifecycle.test.ts tests/control/driverRecovery.test.ts > "$S/t7-green.log" 2>&1; echo "RC=$?" >> "$S/t7-green.log"
npm run typecheck > "$S/t7-typecheck.log" 2>&1; echo "RC=$?" >> "$S/t7-typecheck.log"
npm run --ws check > "$S/t7-ws.log" 2>&1; echo "RC=$?" >> "$S/t7-ws.log"
npm run verify:web-control > "$S/t7-web-control.log" 2>&1; echo "RC=$?" >> "$S/t7-web-control.log"
cat "$S/t7-green.log" "$S/t7-typecheck.log" "$S/t7-ws.log" "$S/t7-web-control.log"
```

Expected（控制器席实测）：三个文件 29/29 绿（8＋13＋8），RC=0 —— `controlLifecycle.test.ts` 的 13 条（含 `:236` 那条）与 `driverRecovery.test.ts` 的 8 条**一条不改、照绿**（后者 "freezes no driver-owned run…" 那条的组现在走跳过分支，它断言的 `frozenRunIds: []` 与零请求照样成立）；typecheck、`--ws check`、`verify:web-control` RC 0。

- [ ] **Step 7：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/panel/controlLifecycle.ts src/control/webProtocol.ts web/src/controlTypes.ts tests/panel/shutdownDriverGroup.test.ts docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md
/usr/bin/git diff --cached --stat > "${SCRATCH:?}/t7-cached.txt"; cat "${SCRATCH:?}/t7-cached.txt"
/usr/bin/git commit -F "${SCRATCH:?}/t7-msg.txt"
```

`t7-msg.txt`：

```
feat(panel): skip graceful shutdown for driver-owned groups

Handoff delivery spec §6, §12(3) and §13.2 I-8 (review m5). A Web plan group that
has been started, on a panel with an execution driver, now gets no shutdown stop
intent and is not stopped, idle or not, so after a restart the driver keeps
dispatching with no human command. The skip is taken only after the existing
blocked-inconsistent and preserved-* dispositions, only with no earlier stop intent,
and only when no non-driver run (a budget estimate) is active in the group; every
other group is frozen exactly as Web spec §6.4 says. The shutdown entry gains the
disposition skipped-driver-owned on the server schema and the Web type (an online
contract change the human approved). The Web control spec gets an appended ERRATUM
for §6.4 and for §11.1's commitCandidate chain; its original text is untouched.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异（变异席在 `git clone --local` 副本里做；每条前后 `git diff`／`git diff --cached` 字节数相同；跑 `shutdownDriverGroup`＋`controlLifecycle`＋`driverRecovery` 三个文件共 29 条）**

控制器席已在副本上逐条实测（`t78-clone`，`264f967`＋本 Task），「期望红」列即实测结果：

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| T7-M1 | `src/panel/controlLifecycle.ts` | 跳过条件删 `exemptDriverRuns && ` | 无驱动环、已 start、空闲 | `freezes a started group exactly as before when no driver exists, idle or running` |
| T7-M2 | 同上 | 删 `intent === null && ` | — | **等价变异，实测 0 红**（见上「结构事实 2」）；登记，不算判据缺口 |
| T7-M3 | 同上 | 删 `active.length === 0 && ` | 组内有在飞 estimate run | `H7: freezes a driver-owned group as before while a non-driver run (an estimate) is active in it` |
| T7-M4 | 同上 | 删 `&& driverOwnedGroup(store, groupId)` | 未 start／无 planHash | `freezes a group that was never started…` 与 `freezes a started group whose body carries no planHash…` |
| T7-M5 | 同上 `driverOwnedGroup` | `group.planHash !== undefined` → `group !== undefined` | 无 planHash 的已 start 组 | `freezes a started group whose body carries no planHash…` |
| T7-M6 | 同上 | 删 `&& store.db.prepare("SELECT 1 FROM scheduler_wakes …").get(groupId) !== undefined` | 从未 start 的组 | `freezes a group that was never started even when a driver exists…` |
| T7-M7a | 同上 | 整个跳过块挪到 `blocked-inconsistent` 分支**之前**（条件不动） | — | **等价变异，实测 0 红**：条件里的 `intent === null` 让它与位置无关 |
| T7-M7b | 同上 | 挪到 `blocked-inconsistent` 之前**且**删 `intent === null` | 已有 pause／已有 shutdown intent 的空闲驱动环组 | `preserves an existing pause on an idle driver-owned group…` 与 `tests/panel/controlLifecycle.test.ts > shutdown exemption and a persisted frozen set … > does not flag shutdown-frozen-set-inconsistent …`（`:236`；第二次 shutdown 被跳过而非 `preserved-shutdown`） |
| T7-M8 | `src/control/webProtocol.ts` | 删枚举值 `"skipped-driver-owned",` | 全局 shutdown 命令落账 | `commits the new disposition under the global command and replays it through the ledger schema` 与 `tests/control/driverRecovery.test.ts > … > freezes no driver-owned run and writes no handoff request for it when the driver exists`（成功体过不了 `commandSuccessSchema`） |

---

## Task 8：`RunViewV1.continuable` ＋ 面板只续可续的、无可续时给「Resume (no continuation)」（spec §13.1 C-4 ＋ I-4；线上契约变更，人已同意）

**Files:**
- Modify: `src/control/webProtocol.ts`（`runViewSchema`，`:839`；`blockedReason: nonemptyString.nullable(),` 在 `:867`）
- Modify: `src/panel/controlViews.ts`（`runViews`（`:458`）之前加 `continuableRun`；返回对象里 `blockedReason` 一行（`:513`）之后加字段）
- Modify: `web/src/controlTypes.ts`（`RunViewV1`，`blockedReason?` 在 `:99`）
- Modify: `web/src/ControlGroupView.tsx`（`continuableRuns`，`:19-26`；「Continue …」块之后、`{view.recoveryBlockers.length > 0 && (`（`:190`）之前加按钮）
- Modify（既有判据，整条改写，人裁 §12）：`web/tests/controlPanel.test.tsx`（`:101` 那条）；`tests/panel/webParity.test.ts`（`:122-124` 规范化器，typecheck 层）
- Create: `tests/panel/runContinuable.test.ts`、`web/tests/handoffResume.test.tsx`

（行号：Orca `264f967`，python 逐行现测；T7 不碰这些落点。）

**Interfaces:**
- Consumes: `persistedRunSchema`（`controlViews.ts:105`，含 `state`、`checkpointId: idSchema.nullable()`（`:127`））、`parseJson`（`:148`）；`checkpoints(id,run_id,hash,body)` 表；`readControlGroup(store, epoch, groupId)`（`controlViews.ts:542`）；`settleHandoffRequest`（`stopIntent.ts`）；`writeArtifact`（`archive.ts:103`）；`driverHarness`（`tests/control/fixtures/driverHarness.ts`）；`applyResumeFromHandoff`（`continuation.ts:202`，`selections` 允许空数组，`webProtocol.ts:563` 无 `.min(1)`）。
- Produces:
  - 服务端 `runViewSchema` 加 `continuable: z.boolean()`（必填）；web `RunViewV1` 加 `continuable?: boolean`（可选，同 `blockedReason` 的先例：既有字面 fixture 不必改）。
  - `continuableRun(store, run)`（模块私有）＝ 持久 `run.state === "settled-recoverable"` **且** 该 run 的 `checkpointId` 在 `checkpoints` 表里有行、行 body 的 `result === "partial"`。**看持久 state，不看显示 state**：`displayRunState` 把持久 `settled`＋`recoverable` 也显示成 `settled-recoverable`（`controlViews.ts:452`）。
  - `continuableRuns(view)` 改看 `run.continuable === true`。
  - 面板在 `stopMode === "handoff" && stopState === "handoff-complete" && continuable.length === 0` 时显示按钮 `Resume (no continuation)`，发 `{ verb: "resume-from-handoff", groupId, expectedRevision, payload: { selections: [] } }`。

**会红的既有判据（brief 实测）与处置：**
- web `web/tests/controlPanel.test.tsx` > "ControlPanel" > "shows handoff progress as pending/partial/unresolved and offers the batch continuation once requests settle" —— 它的 settled run 没有 `continuable` ⇒ 改后不再显示 "Continue selected tasks"。**整条改写、不放宽**：settled run 带 `continuable: true`、检查点 `partial`，断言 `Continue selected tasks (1)` 与 `Continue task a`；同一条里加「正常完成的 run（`continuable: false`、检查点 `complete`、work `completed`）照样显示 `settled-recoverable`，但**不**给任何 Continue 按钮」。
- typecheck：`tests/panel/webParity.test.ts` 的 `controlGroupWebToServer` 必须补 `continuable: run.continuable ?? false`（web 侧可选、服务端必填）。

- [ ] **Step 1：开工核对**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
/usr/bin/git status --short > "$S/t8-start.txt" 2>&1; /usr/bin/git log --oneline -3 >> "$S/t8-start.txt" 2>&1
python3 - >> "$S/t8-start.txt" 2>&1 <<'EOF'
for f, p in [("src/control/webProtocol.ts", "blockedReason: nonemptyString.nullable(),"), ("src/panel/controlViews.ts", "function runViews("),
             ("src/panel/controlViews.ts", "blockedReason: run.drive?.blockedReason ?? null,"), ("web/src/controlTypes.ts", "blockedReason?: string | null;"),
             ("web/src/ControlGroupView.tsx", 'run.state !== "settled-recoverable"'), ("web/src/ControlGroupView.tsx", "{view.recoveryBlockers.length > 0 && ("),
             ("tests/panel/webParity.test.ts", "blockedReason: run.blockedReason ?? null"), ("web/tests/controlPanel.test.tsx", "offers the batch continuation once requests settle")]:
    print(f, [i + 1 for i, l in enumerate(open(f).read().splitlines()) if p in l], p)
EOF
cat "$S/t8-start.txt"
```

期望：每个锚点恰好命中 1 行（`264f967` 上依次 `:867`、`:458`、`:513`、`:99`、`:22`、`:190`、`:123`、`:101`）。不是 1 ⇒ 停下报告。

- [ ] **Step 2：写两份新判据**

`tests/panel/runContinuable.test.ts`（4 条；检查点行按 H-settle 的规范字节写 —— `canonicalBytes` 存 body、`sha256Canonical` 存 hash，spec §13.2 C-1；handoff 包过真归档器，因为读模型会重哈希检查点的 `handoff` 引用）：

```ts
import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { settleHandoffRequest } from "../../src/control/stopIntent.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { writeArtifact } from "../../src/control/archive.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";
import { webFixture } from "../control/fixtures/web.js";
import type { ControlStore } from "../../src/control/store.js";

// Handoff delivery spec §13.1 C-4 (human ruling 2026-09-25, an online contract change): `RunViewV1.continuable`
// is true only for a run a handoff stopped -- persisted `settled-recoverable` holding a checkpoint whose
// result is `partial`. A run the driver settled normally also DISPLAYS `settled-recoverable` (persisted
// `settled` + `recoverable`), and before this field the panel offered it for continuation.

const EPOCH = "epoch-continuable";
const persisted = (store: ControlStore, runId: string) => JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)) as Record<string, unknown>;
const viewOf = (store: ControlStore, runId: string) => readControlGroup(store, EPOCH, "g").runs.find((entry) => entry.runId === runId)!;

/** A confirmed group with one Web work run, handoff-stopped and settled through the adapter-facing API, holding a checkpoint. */
async function handedOff(result: "partial" | "complete", outcome: "settled-recoverable" | "settled-unrecoverable" = "settled-recoverable") {
  const h = await webFixture();
  const deps = { ...h.deps, now: () => new Date("2026-09-25T10:00:00.000Z") };
  const service = new WebControlService(deps);
  service.confirm(h.command("confirm", h.confirmPayload()));
  await service.start(h.command("start", {}));
  const claim = await deliverScheduledStart(deps, "g");
  if (claim.kind !== "claimed") throw new Error(JSON.stringify(claim));
  const runId = claim.runId;
  const stopped = await service.handoffStop(h.command("handoff-stop", {}));
  if ("error" in stopped) throw new Error(JSON.stringify(stopped));
  const requestId = String(h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=?").get(runId)!.id);
  settleHandoffRequest(deps, { requestId, outcome });
  const run = persisted(h.store, runId);
  const checkpointId = `cp-${runId}`;
  // The read model re-hashes every checkpoint's handoff reference, so the packet goes through the real archiver.
  const handoff = await writeArtifact(h.store, `handoff-${runId}`, canonicalBytes({ schema: "orca-handoff-packet-v1", runId, result }));
  // Canonical bytes and hash, as H-settle writes them (spec §13.2 C-1).
  const candidate = {
    schema: "orca-checkpoint-candidate-v1", checkpointId, groupId: "g", workItemId: run.workItemId, taskId: run.taskId, runId,
    generation: run.generation, graphVersion: run.graphVersion, targetVersion: run.targetVersion, usageHighWater: run.highWater,
    result, artifacts: [], snapshot: null, handoff, missing: [], unresolvedRequestIds: [], stopProof: null, terminalOutcome: "cancelled",
  };
  h.store.db.prepare("INSERT INTO checkpoints(id,run_id,hash,body) VALUES (?,?,?,?)").run(checkpointId, runId, sha256Canonical(candidate), canonicalBytes(candidate).toString("utf8"));
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, checkpointId, recoverable: outcome === "settled-recoverable" }), runId);
  return { h, runId };
}

describe("RunViewV1.continuable (handoff delivery C-4)", () => {
  it("is false for a run the driver settled normally, although it displays settled-recoverable", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const run = persisted(t.h.store, runId);
      expect(run).toMatchObject({ state: "settled", recoverable: true });
      const checkpoint = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM checkpoints WHERE id=?").get(String(run.checkpointId))!.body)) as { result: string };
      expect(checkpoint.result).toBe("complete");
      expect(viewOf(t.h.store, runId)).toMatchObject({ state: "settled-recoverable", continuable: false });
    } finally { await t.h.dispose(); }
  }, 30000);

  it("is true for a run a handoff settled recoverably with a partial checkpoint", async () => {
    const { h, runId } = await handedOff("partial"); try {
      expect(persisted(h.store, runId)).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(viewOf(h.store, runId)).toMatchObject({ state: "settled-recoverable", continuable: true });
    } finally { await h.dispose(); }
  });

  it("is false for a handoff-settled run whose checkpoint says the task completed", async () => {
    const { h, runId } = await handedOff("complete"); try {
      expect(persisted(h.store, runId)).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(viewOf(h.store, runId)).toMatchObject({ state: "settled-recoverable", continuable: false });
    } finally { await h.dispose(); }
  });

  it("is false for a handoff-settled run that is not recoverable, although its checkpoint is partial", async () => {
    const { h, runId } = await handedOff("partial", "settled-unrecoverable"); try {
      expect(persisted(h.store, runId)).toMatchObject({ state: "settled-unrecoverable", recoverable: false, checkpointId: `cp-${runId}` });
      expect(viewOf(h.store, runId)).toMatchObject({ state: "settled-unrecoverable", continuable: false });
    } finally { await h.dispose(); }
  });
});
```

注：`handedOff` 故意**不记 usage**。记了 usage 之后 `settleHandoffRequest` 把剩余承诺挂 `held` 会改分配数额，读模型的 `execution-snapshot-identity` 校验（`controlViews.ts` `validateExecutionSnapshot`）会整组拒读 —— 控制器席实测过这一红；那是旧 settle 路径的既有行为，不是本 Task 的对象（H-settle 的记账归 T3／T4 的判据）。

`web/tests/handoffResume.test.tsx`（3 条；按 `web/tests/driverRetry.test.tsx` 的方式用 `vi.fn()` 截 `onCommand`）：

```tsx
// @vitest-environment jsdom
/**
 * Handoff delivery spec §13.1 C-4 and I-4 (human ruling 2026-09-25, an online contract change): the panel
 * offers continuation only for runs the server marks `continuable` -- a normally completed task also
 * displays `settled-recoverable` and must not be continued -- and a handoff-complete group with nothing to
 * continue gets a resume with no selections, its only way back to dispatch.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { Amount, CheckpointViewV1, ControlConfigV1, GroupViewV1, RunViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-25T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "settled-recoverable", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], ...over,
});
const checkpoint = (runId: string, taskId: string, state: CheckpointViewV1["state"]): CheckpointViewV1 =>
  ({ checkpointId: `cp-${taskId}`, taskId, runId, state, snapshotHash: "9".repeat(64), evidenceIds: [] });
const view = (stopState: "handoff-pending" | "handoff-partial" | "handoff-complete", runs: RunViewV1[], checkpoints: CheckpointViewV1[]): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: "handoff", stopState, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(20), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_980), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [], estimates: [], runs, checkpoints, handoffRequests: [],
  stop: { mode: "handoff", state: stopState, frozenRunIds: runs.map((entry) => entry.runId), acceptedAt: "2026-09-25T00:00:00.000Z", deadlineAt: "2026-09-25T00:30:00.000Z" },
  recoveryBlockers: [], recentCommandIds: [],
});
// One task finished normally before the stop reached it; the other was handed off with a partial checkpoint.
const completed = run({ runId: "run-a", taskId: "a", continuable: false });
const handedOff = run({ runId: "run-b", taskId: "b", continuable: true });

afterEach(cleanup);

describe("continuing after a handoff-stop (handoff delivery C-4, I-4)", () => {
  it("offers only the handed-off task, and the batch command carries only its selection", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view("handoff-complete", [completed, handedOff], [checkpoint("run-a", "a", "complete"), checkpoint("run-b", "b", "partial")])}
      config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("button", { name: "Continue task a" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue task b" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume (no continuation)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue selected tasks (1)" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6,
      payload: { selections: [{ taskId: "b", predecessorRunId: "run-b", checkpointId: "cp-b" }] } });
  });

  it("offers a resume with no selections when the handoff completed and nothing is continuable", () => {
    const onCommand = vi.fn();
    render(<ControlGroupView view={view("handoff-complete", [completed, run({ runId: "run-c", taskId: "c", state: "settled-restartable" })], [checkpoint("run-a", "a", "complete")])}
      config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume (no continuation)" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6, payload: { selections: [] } });
  });

  it("offers no resume at all while the handoff has not completed", () => {
    for (const stopState of ["handoff-pending", "handoff-partial"] as const) {
      render(<ControlGroupView view={view(stopState, [completed], [checkpoint("run-a", "a", "complete")])}
        config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Resume (no continuation)" })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
      cleanup();
    }
  });
});
```

- [ ] **Step 3：改写既有 web 判据（整条改写，不放宽）**

`web/tests/controlPanel.test.tsx`：在 `it("shows handoff progress as pending/partial/unresolved and offers the batch continuation once requests settle", () => {`（`:101`）的**上一行**插入注释：

```tsx
  // Handoff delivery (human ruling 2026-09-25, spec §12: this slice may rewrite criteria; ruling 88 (b)(c)): the batch continuation is offered only for a run the server marks continuable (a handoff left a partial checkpoint), never for a normally completed run that also displays settled-recoverable.
```

把该条末尾从 `checkpoints: [{ checkpointId: "cp-1", …` 到 `expect(settledHtml).toContain("settled-recoverable");` 再到 `});` 的这段（`:116-121`）：

```tsx
      checkpoints: [{ checkpointId: "cp-1", taskId: "a", runId: "run-a", state: "complete", snapshotHash: "9".repeat(64), evidenceIds: ["ev-1"] }],
      runs: [{ ...view.runs[0], state: "settled-recoverable" }], handoffRequests: [], recoveryBlockers: [] });
    const settledHtml = renderToStaticMarkup(<ControlPanel {...panelProps({ groups: { g: settled }, summary: { ...summary, groups: [settled.summary] } })} />);
    expect(settledHtml).toContain("Continue selected tasks");
    expect(settledHtml).toContain("settled-recoverable");
  });
```

整段替换为：

```tsx
      checkpoints: [{ checkpointId: "cp-1", taskId: "a", runId: "run-a", state: "partial", snapshotHash: "9".repeat(64), evidenceIds: ["ev-1"] }],
      runs: [{ ...view.runs[0], state: "settled-recoverable", continuable: true }], handoffRequests: [], recoveryBlockers: [] });
    const settledHtml = renderToStaticMarkup(<ControlPanel {...panelProps({ groups: { g: settled }, summary: { ...summary, groups: [settled.summary] } })} />);
    expect(settledHtml).toContain("Continue selected tasks (1)");
    expect(settledHtml).toContain("Continue task a");
    expect(settledHtml).toContain("settled-recoverable");
    // The same settled run finished normally: it still displays settled-recoverable, but it is not continuable.
    const completed = groupView({ ...settled, workItems: [{ ...view.workItems[0], status: "completed", currentRunId: "run-a" }],
      checkpoints: [{ ...settled.checkpoints[0], state: "complete" }], runs: [{ ...settled.runs[0], continuable: false }] });
    const completedHtml = renderToStaticMarkup(<ControlPanel {...panelProps({ groups: { g: completed }, summary: { ...summary, groups: [completed.summary] } })} />);
    expect(completedHtml).toContain("settled-recoverable");
    expect(completedHtml).not.toContain("Continue selected tasks");
    expect(completedHtml).not.toContain("Continue task a");
  });
```

（改写前后对照：旧条断言「显示 Continue selected tasks」—— 新条仍断言，且更严：带计数 `(1)`、带单任务按钮；新增的一半断言正常完成的 run 不被提供续跑。前半段 handoff-unresolved 的断言一字不动。work 状态用 `"completed"`：web 的 `WorkItemViewV1.status` 没有 `"done"`，写 `"done"` 过不了 `web` 的 tsc —— 控制器席实测过。）

`tests/panel/webParity.test.ts`：`controlGroupWebToServer`（`:122-124`）整段：

```ts
function controlGroupWebToServer(x: WebGroupViewV1): ServerGroupViewV1 {
  return { ...x, runs: x.runs.map((run) => ({ ...run, blockedReason: run.blockedReason ?? null })) };
}
```

替换为：

```ts
// Handoff delivery (human ruling 2026-09-25, spec §12: this slice may rewrite criteria; ruling 88 (b)(c)): `continuable` is
// optional on the Web side for the same reason as `blockedReason`, and an absent flag reads as "not continuable".
function controlGroupWebToServer(x: WebGroupViewV1): ServerGroupViewV1 {
  return { ...x, runs: x.runs.map((run) => ({ ...run, blockedReason: run.blockedReason ?? null, continuable: run.continuable ?? false })) };
}
```

- [ ] **Step 4：跑新判据与改写的判据，看见红**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
./node_modules/.bin/vitest run tests/panel/runContinuable.test.ts > "$S/t8-red-root.log" 2>&1; echo "RC=$?" >> "$S/t8-red-root.log"
(cd web && ../node_modules/.bin/vitest run tests/handoffResume.test.tsx tests/controlPanel.test.tsx > "$S/t8-red-web.log" 2>&1; echo "RC=$?" >> "$S/t8-red-web.log")
cat "$S/t8-red-root.log" "$S/t8-red-web.log"
```

（web 工作区没有自己的 `node_modules/.bin/vitest`，用根的那个 —— 控制器席实测，直接调 `./node_modules/.bin/vitest` 得 RC 127。）

Expected（控制器席实测，未改 `src/`、`web/src/`）：
- root：RC=1，**4 条全红**，信息都是 `expected { …(14) } to match object { state: …, continuable: … }`（视图里还没有 `continuable` 字段）—— 这是字段不存在的红，Step 5 之后每条各由 T8-M1／M2 证明它钉的是自己那一支。
- web：RC=1，恰好 3 条红：`controlPanel.test.tsx > … offers the batch continuation once requests settle`（`expected … not to contain 'Continue selected tasks'` —— 旧谓词按显示态把正常完成的 run 选进续跑，C-4 的原样）、`handoffResume.test.tsx > offers only the handed-off task…`、`… offers a resume with no selections…`；`offers no resume at all while the handoff has not completed` 今天就绿（它钉的是 Step 5 新按钮的 stopState 条件，由 T8-M6 证明不空）。

- [ ] **Step 5：实现**

`src/control/webProtocol.ts`：`runViewSchema` 里 `blockedReason: nonemptyString.nullable(),`（`:867`）之后加一行：

```ts
    continuable: z.boolean(),
```

`src/panel/controlViews.ts`：`function runViews(`（`:458`）之前插入：

```ts
/**
 * Handoff delivery spec §13.1 C-4: a run the person may continue from is one a handoff stopped --
 * persisted `settled-recoverable` with a committed checkpoint whose result is `partial`. A run the
 * driver settled normally (persisted `settled`, recoverable, checkpoint `complete`) displays as
 * `settled-recoverable` too, but its task is done and must never be offered for continuation.
 */
function continuableRun(store: ControlStore, run: z.infer<typeof persistedRunSchema>): boolean {
  if (run.state !== "settled-recoverable") return false;
  const row = store.db.prepare("SELECT body FROM checkpoints WHERE id=? AND run_id=?").get(run.checkpointId, run.runId);
  return row !== undefined && (parseJson(row.body, `checkpoint-invalid:${run.checkpointId}`) as { result?: unknown }).result === "partial";
}
```

（`checkpointId` 为 `null` 时 `id=NULL` 在 SQLite 里不匹配任何行 ⇒ `row === undefined` ⇒ false；不另加 `=== null` 守卫 —— 控制器席实测过加上它是一条等价变异，Rule 2 去掉。）

同文件 `runViews` 返回对象里，`blockedReason: run.drive?.blockedReason ?? null,`（`:513`）之后加一行：

```ts
      continuable: continuableRun(store, run),
```

`web/src/controlTypes.ts`：`RunViewV1` 里 `blockedReason?: string | null;`（`:99`）之后加一行：

```ts
  continuable?: boolean;
```

`web/src/ControlGroupView.tsx`：`continuableRuns` 的注释与首个判断（`:19-22`）：

```tsx
/** A held run the person may continue: settled with a checkpoint to continue from. */
export function continuableRuns(view: GroupViewV1): Array<{ run: RunViewV1; checkpointId: string }> {
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.state !== "settled-recoverable") return [];
```

替换为：

```tsx
/**
 * A held run the person may continue: the server marks it `continuable` (handoff delivery spec §13.1 C-4),
 * because a normally completed run also displays as `settled-recoverable` and must never be continued.
 */
export function continuableRuns(view: GroupViewV1): Array<{ run: RunViewV1; checkpointId: string }> {
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.continuable !== true) return [];
```

同文件，`Continue …` 块的闭合（`          ))}` / `        </>` / `      )}`）之后、`{view.recoveryBlockers.length > 0 && (`（`:190`）之前插入：

```tsx
      {/* Handoff delivery spec §13.1 I-4: when every frozen run finished or restarted, nothing is continuable,
          and the group's only way out of handoff-complete is a resume with no selections. */}
      {handoffActive && view.summary.stopState === "handoff-complete" && continuable.length === 0 && (
        <button
          type="button"
          onClick={() => onCommand({ verb: "resume-from-handoff", groupId, expectedRevision: revision, payload: { selections: [] } })}
        >
          Resume (no continuation)
        </button>
      )}
```

- [ ] **Step 6：绿，再跑全部门**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"
./node_modules/.bin/vitest run tests/panel/runContinuable.test.ts tests/panel/webParity.test.ts tests/panel/shutdownDriverGroup.test.ts tests/panel/controlLifecycle.test.ts > "$S/t8-green.log" 2>&1; echo "RC=$?" >> "$S/t8-green.log"
npm run typecheck > "$S/t8-typecheck.log" 2>&1; echo "RC=$?" >> "$S/t8-typecheck.log"
npm run --ws check > "$S/t8-ws.log" 2>&1; echo "RC=$?" >> "$S/t8-ws.log"
npm run build --workspace web > "$S/t8-webbuild.log" 2>&1; echo "RC=$?" >> "$S/t8-webbuild.log"
npm run verify:web-control > "$S/t8-web-control.log" 2>&1; echo "RC=$?" >> "$S/t8-web-control.log"
npm run verify:panel > "$S/t8-panel.log" 2>&1; echo "RC=$?" >> "$S/t8-panel.log"
./node_modules/.bin/vitest run --reporter=json --outputFile="$S/t8-full.json" > "$S/t8-full.log" 2>&1; echo "RC=$?" >> "$S/t8-full.log"
cat "$S/t8-green.log" "$S/t8-typecheck.log" "$S/t8-ws.log" "$S/t8-webbuild.log" "$S/t8-web-control.log" "$S/t8-panel.log" "$S/t8-full.log"
```

Expected（控制器席在副本上实测，T7＋T8 叠加、`ORCA_CCLOOP_BIN` **未设**）：
- 四文件 28/28 绿（4＋3＋8＋13）；typecheck RC 0；`--ws check` RC 0，web **17 文件 78 条**全绿（含 `handoffResume` 3、`controlPanel` 13）；web build RC 0。
- 根全量 vitest：**197 文件、1768 条：1753 passed、0 failed、15 skipped**，RC 0。15 个 skipped 全是要真 ccloop 的 E2E（`ccloopProtocol.integration` 3、`executionDriverE2E` 9、`webCcloopSmoke` 3），因为副本上没设 `ORCA_CCLOOP_BIN`。执行席**必须**设 `ORCA_CCLOOP_BIN`（brief：门要求 0 skipped），期望 **1768/1768 passed**（基线 1756 ＋ T7 的 8 ＋ T8 的 4；若 T1–T6 已先落地，按它们各自新增的条数累加）。
- `verify:web-control`、`verify:panel` 控制器席未跑，执行席跑、RC 必须为 0。

- [ ] **Step 7：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/webProtocol.ts src/panel/controlViews.ts web/src/controlTypes.ts web/src/ControlGroupView.tsx tests/panel/webParity.test.ts web/tests/controlPanel.test.tsx tests/panel/runContinuable.test.ts web/tests/handoffResume.test.tsx
/usr/bin/git diff --cached --stat > "${SCRATCH:?}/t8-cached.txt"; cat "${SCRATCH:?}/t8-cached.txt"
/usr/bin/git commit -F "${SCRATCH:?}/t8-msg.txt"
```

`t8-msg.txt`：

```
feat(panel): mark continuable runs and offer a resume with no continuation

Handoff delivery spec §13.1 C-4 and I-4, an online contract change the human
approved. RunViewV1 gains a read-only `continuable`: true only for a run persisted
settled-recoverable whose committed checkpoint has result "partial", i.e. a run a
handoff stopped. A run the driver settled normally also displays
settled-recoverable, and the panel used to offer it for continuation; the panel now
selects on `continuable` instead. A handoff-complete group with nothing to continue
gets "Resume (no continuation)", a resume-from-handoff with no selections, its only
way back to dispatch. The web control-panel criterion for the batch continuation is
rewritten whole under the human's ruling (never weaker: it now also asserts that a
completed run is not offered), and the parity normalizer defaults the optional web
field like blockedReason.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

**变异（`git clone --local` 副本；前后 `git diff` 字节数相同；root 变异跑 `runContinuable`＋`webParity`（7 条），web 变异在 `web/` 下用 `../node_modules/.bin/vitest` 跑 `handoffResume`＋`controlPanel`（16 条））**

控制器席已逐条实测，「期望红」列即实测结果：

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| T8-M1 | `src/panel/controlViews.ts` | `return row !== undefined && (…).result === "partial";` → `return row !== undefined;` | handoff settle、检查点 `complete` | `runContinuable.test.ts > … is false for a handoff-settled run whose checkpoint says the task completed` |
| T8-M2 | 同上 | 删 `if (run.state !== "settled-recoverable") return false;` 这一行 | 持久 `settled-unrecoverable`、检查点 `partial` | `… is false for a handoff-settled run that is not recoverable, although its checkpoint is partial` |
| T8-M4 | `web/src/ControlGroupView.tsx` | `run.continuable !== true` → 旧的 `run.state !== "settled-recoverable"` | 正常完成与被 handoff 的 run 并存 | `controlPanel.test.tsx > … offers the batch continuation once requests settle`、`handoffResume.test.tsx > offers only the handed-off task…`、`… offers a resume with no selections…` |
| T8-M5 | 同上 | Resume 按钮条件删 `continuable.length === 0 && ` | 有可续项的 handoff-complete 组 | `handoffResume.test.tsx > offers only the handed-off task, and the batch command carries only its selection` |
| T8-M6 | 同上 | Resume 按钮条件删 `view.summary.stopState === "handoff-complete" && ` | `handoff-pending`／`handoff-partial` 的组 | `handoffResume.test.tsx > offers no resume at all while the handoff has not completed` |

**登记（不在本 Task 修）：**
- Resume 按钮条件里的 `handoffActive`（`stopMode === "handoff"`）**没有独立判据**：删掉它只会让 `stopMode === "shutdown"` 且 `handoff-complete` 的组也出现该按钮，而本 Task 的判据里没有 shutdown 模式的组。这是既有的空白 —— Web spec §6.4 让非驱动环组在关闭重启后「发空的 `resume-from-handoff` 再 `start`」，`applyResumeFromHandoff`（`continuation.ts:202`）也接受 shutdown 模式，但面板今天对 shutdown 模式**什么按钮都不给**（`handoffActive` 只认 `"handoff"`，`ControlGroupView.tsx:41`）。brief 固定接口为 `stopMode==="handoff"`，本 Task 照办；是否把 shutdown 模式也纳入，报控制器裁。
- `runContinuable.test.ts` 的 handoff 路径用今天的 `settleHandoffRequest`（与 `webContinuationAccounting.test.ts:77` 同法）。T3 改 `terminaliseRun` 的 restartable 支不影响这里用到的 `settled-recoverable`／`settled-unrecoverable` 两支；若 T3 另改了这两支，本文件须随 T3 重跑。

---

## Task 9：装配（`handoffGraceMs`）＋ 真 ccloop 的 handoff E2E（H1–H3、H5、H6、G、deadline）＋ R-H 崩溃电池

**Files:**
- Modify: `src/panel/controlAssembly.ts`（`:10` 之后加一行 import；`:108`（`ControlAssemblyInput` 的 `}`）与 `:110`（`choosePort` 的文档注释 `/**`）之间加导出函数 `handoffGraceMsOf`；`:240` `kickPump: …, crash: input.driverCrash,` 之后加一行 `handoffGraceMs`）
- Create: `tests/panel/assemblyHandoffGrace.test.ts`（不需要真 ccloop）
- Create: `tests/control/handoffE2E.test.ts`（`describe.skipIf(!ORCA_CCLOOP_BIN)`；门里一律带 env 跑，**0 skipped 才算过** —— T10 的判定器查）
- **不改** `tests/panel/controlAssemblyDriver.test.ts`、`tests/control/executionDriverE2E.test.ts`（既有判据，本 Task 不碰）

**Interfaces:**
- Consumes: T3–T8 全部（`openRequestOf`／`stepH`／`HANDOFF_EXTRA_GRACE_MS`／`DriverCrash` 的四个新崩溃点／续跑 A2／N1、N2、I7／`skipped-driver-owned`／`RunViewV1.continuable`）；ccloop T1（C5 `delayMs`、`<task>#continuation`、`<marker>.tasks`；C6；C7）；ccloop T2（C-3，只 deadline 那一条要）。
- Produces（`src/panel/controlAssembly.ts`）：`export function handoffGraceMsOf(adapterConfigPath: string): number` ＝ adapter config 的 `killGraceMs`（非负安全整数，否则按 0）＋ `HANDOFF_EXTRA_GRACE_MS`；装配时读一次，传给 `createExecutionDriver({ …, handoffGraceMs })`。

**本 Task 的判据各自防的是什么空绿**（spec §9.2、§12 判据增补、§13.1 C-2／C-4、§13.2 I-6）：

| 场景 | 承重断言 | 为什么不会空绿 |
|---|---|---|
| H1 | `orca/g` 上 `a1.txt`＝前任写的、`a2.txt`＝续跑写的；续跑 `drive.base`＝前任的；`merge-base --is-ancestor <前任 base> <snapshot.head>`；续跑第一个 attempt 工作区 HEAD ＝ `snapshot.head`；envelope 带 `inputCheckpoint`；`checkpoint.missing` 空、`recoverable`；resume 前后台账守恒；`.calls`／`.tasks` 逐条相等 | 两半分属两个脚本键，任何一半丢了内容就不对；`.tasks` 钉住「续跑的 plan／execute 是 `a#continuation` 答的」—— C5 的选择键或 ccloop 的续跑约束任一坏掉都红 |
| H2 | 三路都续跑后 `shared.txt`＝`A\nB\nD`；`execute reconcile-*` 恰 2 行（数 `.tasks`，**不**数 `spawnSeq`、**不**数 runs 目录 —— §13.2 I-6）；两次解冲突的对方集合大小为 `[1,2]`；`main..orca/g` first-parent ＝ 3；`reconcile-usage:%` outbox 行 ＝ 2 | 没有 N2 时第三路与第二路的解冲突并发、尖端被推走 ⇒ 多一次解冲突或多一次落地；没有 N1 时第三路 `escalate` ⇒ `blocked` |
| H3 | c 的 run 行只在 a 为 `done` 之后出现（**每一次轮询**都查）；`merge-base --is-ancestor <a 续跑 landedCommit> <c.base>` | 在 resume 之后的整段续跑期间逐轮断言，不只是「stop 时 group 被停住所以没领」那一刻（那一刻恒真） |
| H5 | 用执行驱动 R1 的 `D-after-cas` 把 a 卡在 `collected`（尖端已被 CAS 推走）时发 stop；重启后 a `settled`／`done`／`cleanedUp`，请求 `settled-recoverable`；读模型 a `continuable:false`、b `true`；**一次** resume（选择按面板规则由 `continuable` 构造）续上 b 并领走依赖 a 的 c | 「已在落地」一行的时间窗在真 ccloop 下只有毫秒级，不靠崩溃点卡住就是在赌时序 |
| H6 | 优雅关闭后账本里的 shutdown 条目 `disposition:"skipped-driver-owned"`、无 stop intent 行、`stopped=false`；重启后无人操作 a、b 都 `settled` | b 依赖 a，重启前 a 还在 execute 里 —— 只有驱动环自己接着走完 a 才会有 b |
| G（宽限） | 杀掉 ccloop worker（再无 candidate 可来）后，请求变 `outcome-unknown` 的时刻 ≥ `deadline + killGraceMs(5 s) + 60 s`，且 < 再加 30 s | 装配不传 `handoffGraceMs` 时驱动环用 `HANDOFF_EXTRA_GRACE_MS` 单独一项，早约 5 s —— **已在副本里实测见红**（下表 T9-M1） |
| deadline（**闸门**） | `usageBeforeDelay` ＋ 远超 deadline 的 execute `delayMs` ⇒ ccloop 在 deadline 中止阶段 ⇒ 用量事件 `cumulative` 非 null（C-3）、`unresolvedRequestIds` 空（C6）、`missing` 空（D-C7′）⇒ `settled-recoverable` ⇒ 续跑落地 | 规划席实测：**只红在 `missing:["attempts/1/execution.json"]`** —— 正是 D-C7′ 要裁的那一点（见下「需要控制器裁定」） |
| R-H ×5 | `H-after-deliver`／`H-after-candidate`／`A2-after-bundle`／stop 之下的 `B-after-accept`：死一次、重启后与 H1 同终态，`.calls`、`.tasks` 与 H1 **逐条相等**（比「不多于」更严），`<stateDir>.runs` 下恰 2 个源目录；`H-between-commit-and-settle`：两次崩溃（`D-after-cas`、再 `H-between…`）后 run `settled`、请求经 C1 settle、`.calls`＝`[plan, execute]`、源目录 1 个，且无可续项时空 selections 的 resume（面板的「Resume (no continuation)」）把组放开 | 每个崩溃点都先断言 `driver.crashed === point` 真的发生过，再比终态 |

**H7 不在本文件**：它要组内有一个在飞的非驱动环 run（estimate），而本世界的 estimator 是 `blocked-capability`（执行驱动偏差 D1），造不出来。H7 由 T7 的单元判据覆盖：`tests/panel/shutdownDriverGroup.test.ts` > "H7: freezes a driver-owned group as before while a non-driver run (an estimate) is active in it"。本 Task 不重复。

**§11 I6 的「stop 落在一次失败 attempt 之后」一例：登记为缺口，不写判据，不发明夹具功能。** 现量（ccloop `a5dc529`）：fake codex 脚本模式的 verify 恒答 `approved:true`（`tests/fixtures/fake-codex.mjs:22`）；command 验证器的 required check 失败恒为 `safeToRetry:false`（`src/controller/runLoop.ts:197`／`:200`），`evaluateStopDecision` 于是直接判 `failed`（`src/stop/stopController.ts:85`），根本没有第二个 attempt 可以被 stop。要表达它，fake codex 需要「按 attempt 给 verify 答案」的新脚本字段（ccloop 夹具的新功能，需 ccloop 侧另开一笔）。**报控制器**：是否立项；不立则 §11 I6 这半句只由 T5 的单元判据（合成 port）承重。

**续跑第一个 attempt 工作区 HEAD 怎么读（spec §11 I6）**：那个工作区在 ccloop 跑完后已被删，不能直接 `rev-parse`。读法是续跑 run 的 `drive.attemptSha` 的第一个父提交：ccloop `publishAttemptCommit`（`src/workspace/worktreeManager.ts:97`，`:100` 先取 `HEAD` 作 base 再 `commit`）就在 attempt 工作区的 HEAD 上提交；`materializeFirstWorkspace` 在 `snapshot.head` 上建这个工作区（`src/control/materialize.ts:141`）并在 `verifyMaterialized`（`:128`）里核验 HEAD；Orca 的 `commitAttempt` 在 ccloop 结果仓干净时不再加提交，所以 `attemptSha^1 === snapshot.head`。`snapshot.head` 本身取自检查点 `snapshot` 所指的归档件（`readArtifact` → JSON 的 `head`）。规划席实测此等式成立。

**规划席的验证（Rule 12：跑了什么、没跑什么）**：在 `…/scratchpad/planner/t9-clone`（Orca `264f967` ＋ orca-val 的 T3–T5 参考实现（含 D-SNAP、D-VIEW）＋ t6-clone 的 T6 草稿 ＋ t78-clone 的 T7、T8 草稿 ＋ 本 Task 代码）与 `…/scratchpad/planner/t9-ccloop`（`git clone --local` 自 t12-clone，HEAD `a5c9a09`＝T1 草稿 `b8845c1` ＋ T2 草稿；`npm run build` RC 0）里：`typecheck` RC 0；`assemblyHandoffGrace` 1/1 绿；`handoffE2E` **11 passed、1 failed**（失败的只有 deadline，红点如上表），全文件 352 s；T9-M1 实测见红（G 红在 `expected 1790320011250 to be greater than or equal to 1790320016152`，差 4.9 s），还原后 `shasum -a 256` 与备份相同。**未跑**：`verify:control` 全量、其余变异（下表标「预言」的）。

- [ ] **Step 1：造含 T1（与 T2，若控制器已裁 D-C3）的 ccloop build，写 env（新目录，不许在旧副本里 pull —— handoff §8.2）**

T1、T2 的提交取自 ccloop 主仓 `/Users/biran/code/skills/loop/ccloop` 的 `main`（T1、T2 的实施席在那里提交；本 Task 开工前核对它们在 `main` 上）。按内容核对，不按提交号：

```bash
S="${SCRATCH:?}"
DEST="$S/ccloop-handoff-$(date +%Y%m%d%H%M%S)"
/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop "$DEST" > "$S/t9-ccloop-clone.log" 2>&1; echo "RC=$?" >> "$S/t9-ccloop-clone.log"
ln -s /Users/biran/code/skills/loop/ccloop/node_modules "$DEST/node_modules"
( cd "$DEST" && npm run build ) > "$S/t9-ccloop-build.log" 2>&1; echo "RC=$?" >> "$S/t9-ccloop-build.log"
/usr/bin/git -C "$DEST" log --oneline -3 > "$S/t9-ccloop-head.txt"
python3 - "$DEST" >> "$S/t9-ccloop-head.txt" <<'EOF'
import sys
d = sys.argv[1]
fake = open(f"{d}/tests/fixtures/fake-codex.mjs").read()
handoff = open(f"{d}/src/control/handoff.ts").read()
print("C5_DELAY", "delayMs" in fake)
print("C5_CONTINUATION_KEY", "#continuation" in fake)
print("C5_TASKS_LOG", 'marker+".tasks"' in fake)
print("C6", handoff.count("unresolvedRequestIds: [],") == 2)
print("C7", "enteredPhaseFiles" in handoff)
print("T2_USAGE_BEFORE_DELAY", "usageBeforeDelay" in fake)
EOF
cat "$S/t9-ccloop-clone.log" "$S/t9-ccloop-build.log" "$S/t9-ccloop-head.txt"
```

Expected：两个 RC 0；`C5_DELAY True`、`C5_CONTINUATION_KEY True`、`C5_TASKS_LOG True`、`C6 True`、`C7 True`。`T2_USAGE_BEFORE_DELAY` 为 `False` 时 deadline 一条按下文闸门处理（不跑、不算红）。任何一个 C5–C7 为 `False` ⇒ **停下报控制器**，不许继续。

再写 env 与一份 0600 的 adapter config（给 `verify:control` 里既有判据用的 `integration` 配置；**新判据自己造自己的 config**）。handoff §8.2：路径全部用 realpath 过的形式，写完断言 `realpath(x) == x`：

```bash
# Same shell as the block above: S and DEST are still set.
python3 - "$S" "$DEST" > "$S/t9-env.log" 2>&1 <<'EOF'
import json, os, sys
s, dest = sys.argv[1], os.path.realpath(sys.argv[2])
node = os.path.realpath(os.popen("command -v node").read().strip())
config = os.path.realpath(s) + "/t9-adapter-config.json"
marker = os.path.realpath(s) + "/t9-fake-codex-marker.json"
fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.write(fd, json.dumps({"command": [node, f"{dest}/tests/fixtures/fake-codex.mjs", "integration", marker], "model": "fixture-model",
  "budgetMode": "soft", "sandbox": "workspace-write", "timeoutMs": 120000, "killGraceMs": 5000}, indent=2).encode()); os.close(fd)
binary = f"{dest}/dist/cli.js"
for p in (binary, config, f"{dest}/tests/fixtures/fake-codex.mjs"):
    assert os.path.realpath(p) == p, p
print("mode", oct(os.stat(config).st_mode & 0o777))
open(f"{s}/t9-env.sh", "w").write(f"export ORCA_CCLOOP_BIN={binary}\nexport ORCA_CCLOOP_ADAPTER_CONFIG={config}\n")
print(open(f"{s}/t9-env.sh").read())
EOF
echo "RC=$?" >> "$S/t9-env.log"; cat "$S/t9-env.log"
```

Expected：`mode 0o600`；两行 export；RC 0。（`O_EXCL`：同名文件已存在就失败 —— 不覆盖旧的，换一个 `$S` 下的新名字重来。）

- [ ] **Step 2：判据 `tests/panel/assemblyHandoffGrace.test.ts`（不需要真 ccloop）**

```ts
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HANDOFF_EXTRA_GRACE_MS } from "../../src/control/driverHandoff.js";
import { handoffGraceMsOf } from "../../src/panel/controlAssembly.js";

// Handoff delivery spec §3 (controller decision) and §10: a delivered request that yields nothing turns
// outcome-unknown only past deadline + the adapter's killGraceMs + 60 s. ccloop itself waits killGraceMs
// before it kills a phase, so a grace shorter than that would call a stop "unknown" while ccloop is still
// legitimately finishing it. The wiring into the running driver is measured by handoffE2E.test.ts (G).
const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function config(text: string | null): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-assembly-grace-")));
  roots.push(root);
  const path = join(root, "adapter.json");
  if (text !== null) await writeFile(path, text, { mode: 0o600 });
  return path;
}

describe("the handoff grace the assembly hands the driver (spec §3)", () => {
  it("is the adapter's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable", async () => {
    expect(HANDOFF_EXTRA_GRACE_MS).toBe(60_000);
    expect(handoffGraceMsOf(await config(JSON.stringify({ command: ["codex"], killGraceMs: 5_000 })))).toBe(65_000);
    expect(handoffGraceMsOf(await config(JSON.stringify({ killGraceMs: 0 })))).toBe(60_000);
    // Never shorter than the fixed part, whatever the file says or fails to say.
    for (const text of [JSON.stringify({}), JSON.stringify({ killGraceMs: -1 }), JSON.stringify({ killGraceMs: 1.5 }),
      JSON.stringify({ killGraceMs: "5000" }), "null", "not json", null]) {
      expect(handoffGraceMsOf(await config(text))).toBe(60_000);
    }
  });
});
```

- [ ] **Step 3：判据 `tests/control/handoffE2E.test.ts`（真 ccloop；本 Step 不含 deadline 一条 —— 它在 Step 3b，受闸门）**

形状照 `tests/control/executionDriverE2E.test.ts`（`world()`／`boot`／`die`／`startGroup`／`until`／HOME 改道），**复制所需，不从那个测试文件 import**。每条场景的 `.calls` 预言都从阶段推出：一个被 stop 在 execute 之后的前任 ＝ `plan, execute`；一个完整 attempt ＝ `plan, execute, verify`，但 command 验证器与合成的解冲突 contract 的 verify 不调 provider（执行驱动 E1 的注释）；续跑的 verify prompt 不带续跑约束文本，所以 `.tasks` 里它是 `verify a` 而不是 `verify a#continuation`（ccloop C5 的选键规则）。超时：单条 ≤ 420 s（`describe` 级），各 `until` 按场景给（H2 360 s 最长；G 180 s，其承重等待本身约 67 s）。

```ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readArtifact } from "../../src/control/archive.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { DriverCrash, readDriverRun, readStartEnvelope, type CrashPoint } from "../../src/control/executionDriver.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { readHandoffRequest, readStopIntent } from "../../src/control/stopIntent.js";
import { assembleControlRuntime, type ControlRuntime } from "../../src/panel/controlAssembly.js";
import { shutdownCommandId } from "../../src/panel/controlLifecycle.js";
import { controlRepoKey, resolveControlOptions } from "../../src/panel/controlOptions.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { profileSnapshot } from "./fixtures/web.js";

/**
 * Handoff delivery spec §9.2 (H1-H3, H5, H6, R-H), §12 (the deadline case), §13.1 C-2/C-4 and §13.2 I-6 against
 * the real ccloop build (ORCA_CCLOOP_BIN, which must contain ccloop C1-C7: the scripted fake codex with
 * per-phase `delayMs`, the `<task>#continuation` key and the `<marker>.tasks` log; C6; C7). Everything is
 * relocated under a temporary root. The honest claim (spec §2): with fake codex and a soft group, a human
 * handoff-stop of a group the driver is running closes every frozen run by the step it is at, and a
 * resume-from-handoff continues each selected task from its checkpoint onto orca/<group>, N-way included.
 * Real codex under a handoff is not claimed here.
 */
const realBinary = process.env.ORCA_CCLOOP_BIN;
const roots: string[] = [];
// Retried for the same reason as executionDriverE2E.test.ts: a failed scenario may leave a background
// reconciliation `ccloop run` (or an orphaned fake codex) still writing under the root for a moment.
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

const g = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
const isAncestor = (cwd: string, ancestor: string, descendant: string): boolean => {
  try { g(cwd, "merge-base", "--is-ancestor", ancestor, descendant); return true; } catch { return false; }
};

/** ccloop's canonicalHash (ccloop src/control/protocol.ts): keys sorted by localeCompare, JSON, sha256. */
function ccloopHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === "object"
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonical(nested)]))
      : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** What the shipped ccloop answers; a null window blocks the estimate (execution driver deviation D1). */
const CCLOOP_CAPABILITIES = {
  usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable",
  handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
} as const;

interface Task { taskId: string; dependsOn?: string[]; targetPaths: string[]; verifierType?: "agent" | "command" }
/** One fake codex script entry (ccloop C5): the files execute writes, and how long each phase sleeps first. */
interface Entry { files: Record<string, string>; delayMs?: { plan?: number; execute?: number; verify?: number }; usageBeforeDelay?: boolean }

/** A killGraceMs the grace scenario (G) can tell apart from HANDOFF_EXTRA_GRACE_MS alone. */
const KILL_GRACE_MS = 5_000;

async function world(tasks: Task[], script: Record<string, Entry>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-handoff-e2e-")));
  roots.push(root);
  const repo = join(root, "target");
  await mkdir(repo);
  g(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "shared.txt"), "base\n");
  g(repo, "add", "shared.txt");
  g(repo, "commit", "-qm", "base");
  const marker = join(root, "codex-marker.json");
  const scriptPath = join(root, "codex-script.json");
  await writeFile(scriptPath, JSON.stringify(script));
  const fakeCodex = resolve(dirname(realBinary!), "..", "tests", "fixtures", "fake-codex.mjs");
  const adapter = { command: [process.execPath, fakeCodex, "script", marker, scriptPath], model: "fixture-model", budgetMode: "soft", sandbox: "workspace-write", timeoutMs: 120_000, killGraceMs: KILL_GRACE_MS };
  const adapterPath = join(root, "adapter.json");
  await writeFile(adapterPath, JSON.stringify(adapter), { mode: 0o600 });
  const contracts = join(root, "contracts");
  await mkdir(contracts);
  const planTasks = [];
  for (const task of tasks) {
    const contract = {
      objective: { taskId: task.taskId, goal: `write ${task.targetPaths.join(", ")}`, successCondition: "the files hold the scripted text", nonGoals: [] },
      context: { repoPath: repo, targetPaths: task.targetPaths, relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 120_000, totalRuntimeBudgetMs: 240_000, tokenBudget: 100_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 1_000 },
      safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: 2, humanGateConditions: [] },
      verification: { verifierType: task.verifierType ?? "agent", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
    };
    const path = join(contracts, `${task.taskId}.json`);
    await writeFile(path, canonicalBytes(contract));
    planTasks.push({ taskId: task.taskId, contract: path, dependsOn: task.dependsOn ?? [], targetVersion: 1, configHash: ccloopHash(adapter) });
  }
  const planPath = join(repo, "plan.json");
  await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin: realBinary, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["the files hold the scripted text"], tasks: planTasks }));
  const snapshot = profileSnapshot();
  snapshot.profile.capabilities = { ...CCLOOP_CAPABILITIES };
  const profilePath = join(root, "profile.json");
  await writeFile(profilePath, JSON.stringify(snapshot));
  const repoId = controlRepoKey("e2e");
  const repos = [{ projectKey: "e2e", path: repo }];
  const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CCLOOP_BIN: realBinary!, ORCA_CCLOOP_ADAPTER_CONFIG: adapterPath };
  const { rejection, ...control } = resolveControlOptions(["--plan", `plan=${repoId}=${planPath}`, "--profile", profilePath, "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "50"], env, repos);
  if (rejection !== null) throw new Error(rejection);
  let epoch = 0;
  const live = new Set<ControlRuntime>();
  const boot = async (driverCrash?: (point: CrashPoint) => void): Promise<ControlRuntime> => {
    const runtime = await assembleControlRuntime({ control, repos, epoch: `epoch-handoff-e2e-${++epoch}`, env, driverCrash });
    if (runtime === null) throw new Error("the control plane did not assemble");
    live.add(runtime);
    await runtime.recover();
    return runtime;
  };
  /** A process death: no shutdown, just the store let go. */
  const die = (runtime: ControlRuntime): void => { live.delete(runtime); runtime.close(); };
  const teardown = async (): Promise<void> => {
    for (const runtime of live) {
      live.delete(runtime);
      try { await runtime.shutdown(); } finally { runtime.close(); }
    }
  };
  const lines = (path: string): string[] => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n") : [];
  /** One line per provider call, the phase only (fake codex's own log, unchanged by C5). */
  const calls = (): string[] => lines(`${marker}.calls`);
  /** One `<phase> <script key>` line per provider call (ccloop C5): which entry answered it. */
  const scripted = (): string[] => lines(`${marker}.tasks`);
  const show = (path: string): string => g(repo, "show", `refs/heads/orca/g:${path}`);
  const tip = (): string => g(repo, "rev-parse", "refs/heads/orca/g");
  /** Commits orca/g gained over main along its first parent: one per landing. */
  const landings = (): number => Number(g(repo, "rev-list", "--first-parent", "--count", "main..refs/heads/orca/g"));
  return { root, repo, repoId, boot, die, teardown, calls, scripted, show, tip, landings };
}

const raw = (runtime: ControlRuntime, commandId: string, verb: string, payload: unknown, target: unknown = { kind: "group", groupId: "g" }) => ({
  schema: "orca-raw-command-v1", commandId, actorId: "human", verb, target, payload,
  expectedRevision: verb === "import-plan" ? 0 : Number(runtime.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
}) as never;

/** Import, confirm soft, optionally widen the token ceiling, start -- through the assembled service. */
async function startGroup(runtime: ControlRuntime, repoId: string, raiseTokens = 0): Promise<void> {
  const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId, planId: "plan" }));
  expect(imported).toMatchObject({ result: { kind: "imported", estimateState: "blocked-capability" } });
  const hash = runtime.router.list()[0]!.profileHash;
  const confirmed = runtime.service.confirm(raw(runtime, "confirm", "confirm", {
    planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: null },
  }));
  expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
  if (raiseTokens > 0) {
    const limit = readControlGroup(runtime.store, runtime.epoch, "g").ledger.groupLimit;
    const raised = runtime.service.setLimit(raw(runtime, "raise", "set-limit", { limit: { ...limit, tokens: limit.tokens + raiseTokens } }));
    expect("error" in raised ? raised.error : "raised").toBe("raised");
  }
  const started = await runtime.service.start(raw(runtime, "start", "start", {}));
  expect("error" in started ? started.error : "started").toBe("started");
}

let commandSeq = 0;
/** The person's handoff-stop; answers the request ids it created, one per frozen run. */
async function handoffStop(runtime: ControlRuntime, payload: { handoffDeadlineAt?: string } = {}): Promise<string[]> {
  const stopped = await runtime.service.handoffStop(raw(runtime, `stop-${++commandSeq}`, "handoff-stop", payload));
  if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(stopped)}`);
  return stopped.result.requestIds;
}

/**
 * The panel's rule (web/src/ControlGroupView.tsx `continuableRuns`, handoff delivery spec §13.1 C-4), applied
 * to the server's read model: a run the server marks continuable, with its non-unknown checkpoint.
 */
function panelSelections(runtime: ControlRuntime): Array<{ taskId: string; predecessorRunId: string; checkpointId: string }> {
  const view = readControlGroup(runtime.store, runtime.epoch, "g");
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.continuable !== true) return [];
    const checkpoint = view.checkpoints.find((candidate) => candidate.runId === run.runId && candidate.state !== "unknown");
    return checkpoint ? [{ taskId: run.taskId, predecessorRunId: run.runId, checkpointId: checkpoint.checkpointId }] : [];
  });
}

/** One resume-from-handoff command carrying exactly the panel's selections. */
async function resumeAsThePanelWould(runtime: ControlRuntime): Promise<Array<{ taskId: string; predecessorRunId: string; checkpointId: string }>> {
  const selections = panelSelections(runtime);
  const resumed = await runtime.service.resumeFromHandoff(raw(runtime, `resume-${++commandSeq}`, "resume-from-handoff", { selections }));
  expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
  return selections;
}

interface RunRow { runId: string; task: string; body: Record<string, any> }
const workRuns = (runtime: ControlRuntime): RunRow[] => runtime.store.db.prepare("SELECT id,work_item_id,body FROM runs WHERE group_id='g' ORDER BY id").all()
  .map((row) => ({ runId: String(row.id), task: String(row.work_item_id), body: JSON.parse(String(row.body)) }))
  .filter((row) => row.body.phase === "work");
const runsOf = (runtime: ControlRuntime, taskId: string): RunRow[] => workRuns(runtime).filter((run) => run.task === taskId);
const work = (runtime: ControlRuntime, taskId: string) =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const requestState = (runtime: ControlRuntime, requestId: string): string => readHandoffRequest(runtime.store, "g", requestId).request.state;
const active = (runtime: ControlRuntime, runId: string): number => Number(runtime.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active);
const stopped = (runtime: ControlRuntime): boolean => JSON.parse(String(runtime.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).stopped;
/** The group's reserved plus used, per dimension: booking usage moves an amount between them, releasing a commitment lowers it. */
const committedAndUsed = (runtime: ControlRuntime): number[] => {
  const group = JSON.parse(String(runtime.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  return (["tokens", "activeMs", "attempts", "sessions"] as const).map((d) => group.reserved[d] + group.used[d]);
};
const allocation = (runtime: ControlRuntime, taskId: string) =>
  readBudgetProposal(runtime.store, "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work")!;
const checkpointOf = (runtime: ControlRuntime, checkpointId: string) =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM checkpoints WHERE id=?").get(checkpointId)!.body));
/** The snapshot a checkpoint points at (an archived artifact, src/control/snapshot.ts): its `head` is ccloop's result HEAD. */
const snapshotHead = async (runtime: ControlRuntime, checkpoint: { snapshot: { artifactId: string; hash: string } }): Promise<string> =>
  (JSON.parse((await readArtifact(runtime.store, checkpoint.snapshot)).toString("utf8")) as { head: string }).head;
/** ccloop source directories the driver created: one per run it prepared (reconciliation runs live elsewhere). */
const sourceDirs = (runtime: ControlRuntime): string[] => readdirSync(`${runtime.store.stateDir}.runs`).sort();

async function until(predicate: () => boolean, ms: number, what: string, poll = 100): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
}

/** A run that stopped moving on its own is a failure to report by its reason, not a timeout to wait out. */
function noBlocked(runtime: ControlRuntime): void {
  const blocked = workRuns(runtime).filter((run) => run.body.state === "blocked");
  if (blocked.length > 0) throw new Error(`blocked: ${blocked.map((run) => `${run.task}=${run.body.drive?.blockedReason}`).join(", ")}`);
}

/** Every file and directory under `dir`, relative, sorted. */
function tree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();
}

/**
 * The one-task script H1 and every R-H point share. The predecessor writes the first half while its execute
 * phase sleeps long enough for the stop to arrive in the middle of it; the continuation (ccloop C5's
 * `#continuation` key, chosen by the continuation constraint in its plan and execute prompts) writes the
 * second half. Its verify prompt carries no constraint, so that call is answered by `a` -- which has no
 * verify delay.
 */
const HALVES: Record<string, Entry> = {
  a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 6_000 } },
  "a#continuation": { files: { "a2.txt": "A2\n" } },
};
const HALVES_TASKS: Task[] = [{ taskId: "a", targetPaths: ["a1.txt", "a2.txt"] }];
/**
 * Stopped at the boundary after execute (ccloop stops at every phase boundary, spec §11 M1): plan and
 * execute. The continuation runs a whole attempt with the agent verifier: plan, execute, verify.
 */
const HALVES_CALLS = ["plan", "execute", "plan", "execute", "verify"];
const HALVES_SCRIPTED = ["plan a", "execute a", "plan a#continuation", "execute a#continuation", "verify a"];

/** Waits until the predecessor of `taskId` is in its execute phase (its execute call is logged before it sleeps). */
async function inExecute(w: Awaited<ReturnType<typeof world>>, runtime: ControlRuntime, taskIds: string[]): Promise<void> {
  await until(() => { noBlocked(runtime); return taskIds.every((id) => w.scripted().includes(`execute ${id}`)); }, 120_000, `${taskIds.join(",")} to enter execute`, 20);
}

/** Test-only fault injection (execution driver spec §7.2 R1): the driver dies at `point`, as a process death would. */
const crashAt = (point: CrashPoint) => (at: CrashPoint): void => { if (at === point) throw new DriverCrash(at); };

describe.skipIf(!realBinary)("handoff delivery against real ccloop (spec §9.2)", { timeout: 420_000 }, () => {
  // Rule 17: every ccloop child inherits this worker's environment, so HOME and the XDG roots are moved to an
  // empty temporary directory for the whole file, and each scenario must leave it empty.
  const saved: Record<string, string | undefined> = {};
  const HOME_KEYS = ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const;
  let fakeHome = "";
  beforeAll(async () => {
    fakeHome = await realpath(await mkdtemp(join(tmpdir(), "orca-handoff-e2e-home-")));
    roots.push(fakeHome);
    for (const key of HOME_KEYS) saved[key] = process.env[key];
    process.env.HOME = fakeHome;
    for (const key of HOME_KEYS.slice(1)) process.env[key] = join(fakeHome, key.toLowerCase());
  });
  afterAll(() => { for (const key of HOME_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  afterEach(() => { expect(tree(fakeHome)).toEqual([]); });

  it("H1: a run stopped mid-execute parks its half in a checkpoint, and its continuation lands the whole task on the predecessor's base", async () => {
    const w = await world(HALVES_TASKS, HALVES);
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [predecessor] = runsOf(runtime, "a");
      expect(predecessor!.body.state).toBe("accepted");
      const tipBefore = w.tip();
      const ledgerBefore = committedAndUsed(runtime);
      const [requestId] = await handoffStop(runtime);
      await until(() => { noBlocked(runtime); return requestState(runtime, requestId!) === "settled-recoverable"; }, 120_000, "the request to settle recoverable");
      // spec §3 accepted row, §11 C2: the run is parked whole -- held, inactive, nothing landed.
      const parked = readDriverRun(runtime.store, predecessor!.runId) as unknown as Record<string, any>;
      expect(parked).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(active(runtime, predecessor!.runId)).toBe(0);
      expect(work(runtime, "a")).toMatchObject({ status: "held", currentRunId: predecessor!.runId });
      expect(w.tip()).toBe(tipBefore);
      expect(readStopIntent(runtime.store, "g")!.state).toBe("handoff-complete");
      // spec §13.1 C-2 (ccloop C7) and §11 C3/C6: nothing the run never entered is missing, its own request is
      // answered, and a request with no landing is an Orca `partial` checkpoint.
      const checkpoint = checkpointOf(runtime, parked.checkpointId);
      expect(checkpoint).toMatchObject({ result: "partial", missing: [], unresolvedRequestIds: [] });
      // spec §11 C2 ledger conservation: the commitment is parked, not released.
      expect(committedAndUsed(runtime)).toEqual(ledgerBefore);
      expect(allocation(runtime, "a")).toMatchObject({ state: "held", amount: parked.remaining.work });
      // spec §13.1 C-4: the read model offers exactly this run, and the panel's selection resumes it.
      const selections = await resumeAsThePanelWould(runtime);
      expect(selections).toEqual([{ taskId: "a", predecessorRunId: predecessor!.runId, checkpointId: parked.checkpointId }]);
      // Registering the continuation moves the parked commitment to it, amount unchanged; nothing is released.
      expect(committedAndUsed(runtime)).toEqual(ledgerBefore);
      expect(allocation(runtime, "a")).toMatchObject({ state: "continuing", amount: parked.remaining.work });
      await until(() => { noBlocked(runtime); return work(runtime, "a").status === "done" && runsOf(runtime, "a").every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "the continuation to land and settle");
      const continuation = runsOf(runtime, "a").find((run) => run.runId !== predecessor!.runId)!;
      // The whole task: the predecessor's half from its checkpoint plus the continuation's part, landed once.
      expect(w.show("a1.txt")).toBe("A1");
      expect(w.show("a2.txt")).toBe("A2");
      expect(w.landings()).toBe(1);
      // spec §4 plan X and §11 I6: the continuation keeps the predecessor's base, and that base is an ancestor of
      // the snapshot HEAD ccloop rebuilt the first attempt on.
      expect(continuation.body.drive.base).toBe(predecessor!.body.drive.base);
      const head = await snapshotHead(runtime, checkpoint);
      expect(isAncestor(w.repo, predecessor!.body.drive.base, head)).toBe(true);
      // The first attempt's workspace HEAD, read as the parent of the attempt commit ccloop published from it
      // (ccloop publishAttemptCommit commits on the attempt worktree's HEAD; materializeFirstWorkspace created
      // that worktree at snapshot.head and verified it).
      expect(g(w.repo, "rev-parse", `${continuation.body.drive.attemptSha}^1`)).toBe(head);
      const envelope = readStartEnvelope(runtime.store, continuation.body as never) as unknown as { inputCheckpoint: Record<string, string> | null };
      expect(envelope.inputCheckpoint).toMatchObject({ predecessorRunId: predecessor!.runId, checkpointId: parked.checkpointId,
        checkpointHash: String(runtime.store.db.prepare("SELECT hash FROM checkpoints WHERE id=?").get(parked.checkpointId)!.hash) });
      expect(envelope.inputCheckpoint!.bundlePath.startsWith(join(continuation.body.drive.sourceDir, "input"))).toBe(true);
      expect(w.calls()).toEqual(HALVES_CALLS);
      expect(w.scripted()).toEqual(HALVES_SCRIPTED);
      expect(sourceDirs(runtime)).toEqual([predecessor!.runId, continuation.runId].sort());
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("H3: a dependent is not claimed while its dependency is parked or continuing, and then starts on top of the whole landing", async () => {
    const w = await world([...HALVES_TASKS, { taskId: "c", dependsOn: ["a"], targetPaths: ["c.txt"], verifierType: "command" }], {
      ...HALVES, c: { files: { "c.txt": "C\n" } },
    });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [requestId] = await handoffStop(runtime);
      await until(() => requestState(runtime, requestId!) === "settled-recoverable", 120_000, "the request to settle recoverable");
      expect(work(runtime, "a").status).toBe("held");
      expect(runsOf(runtime, "c")).toEqual([]);
      await resumeAsThePanelWould(runtime);
      // spec §4.1: `held`, then continuing, is not `done` -- every poll until c appears proves a is done by then.
      await until(() => {
        noBlocked(runtime);
        if (runsOf(runtime, "c").length > 0 && work(runtime, "a").status !== "done") throw new Error(`c was claimed while a is ${work(runtime, "a").status}`);
        return work(runtime, "c").status === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true);
      }, 300_000, "the continuation and then c to settle", 20);
      const continuation = runsOf(runtime, "a").find((run) => run.body.continuationIntentId)!;
      const [c] = runsOf(runtime, "c");
      // The base c started from holds a's whole landing, not a half of it.
      expect(isAncestor(w.repo, continuation.body.drive.landedCommit, c!.body.drive.base)).toBe(true);
      expect([w.show("a1.txt"), w.show("a2.txt"), w.show("c.txt")]).toEqual(["A1", "A2", "C"]);
      // c's command verifier calls no provider (executionDriverE2E.test.ts E1).
      expect(w.calls()).toEqual([...HALVES_CALLS, "plan", "execute"]);
      expect(w.scripted()).toEqual([...HALVES_SCRIPTED, "plan c", "execute c"]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("H2: three parallel runs stopped mid-execute all continue; the landings are serial and reconcile exactly twice, the second against both", async () => {
    const own = (id: string): Entry => ({ files: { "shared.txt": `${id.toUpperCase()}\n`, [`${id}.txt`]: `${id.toUpperCase()}\n` }, delayMs: { execute: 8_000 } });
    const script: Record<string, Entry> = {
      a: own("a"), b: own("b"), d: own("d"),
      "a#continuation": { files: { "a.txt": "A2\n" } }, "b#continuation": { files: { "b.txt": "B2\n" } }, "d#continuation": { files: { "d.txt": "D2\n" } },
    };
    // Which task lands first is the driver's runId order, so every name the synthesized contracts can carry is
    // scripted (spec §11 M5): `reconcile-<self>-<others sorted, joined by ->`, each writing the union in task order.
    for (const [self, other] of [["a", "b"], ["b", "a"], ["a", "d"], ["d", "a"], ["b", "d"], ["d", "b"]] as const) {
      script[`reconcile-${self}-${other}`] = { files: { "shared.txt": [self, other].sort().map((id) => `${id.toUpperCase()}\n`).join("") } };
    }
    for (const [self, x, y] of [["a", "b", "d"], ["b", "a", "d"], ["d", "a", "b"]] as const) script[`reconcile-${self}-${x}-${y}`] = { files: { "shared.txt": "A\nB\nD\n" } };
    const w = await world(["a", "b", "d"].map((id) => ({ taskId: id, targetPaths: ["shared.txt", `${id}.txt`] })), script);
    const runtime = await w.boot(); try {
      // Execution driver deviation D12: the default reserve cannot afford a reconciliation until another run settles.
      await startGroup(runtime, w.repoId, 10_000_000);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a", "b", "d"]);
      const requestIds = await handoffStop(runtime);
      expect(requestIds).toHaveLength(3);
      await until(() => requestIds.every((id) => requestState(runtime, id) === "settled-recoverable"), 120_000, "three requests to settle recoverable");
      expect(w.landings()).toBe(0);
      const selections = await resumeAsThePanelWould(runtime);
      expect(selections.map((selection) => selection.taskId)).toEqual(["a", "b", "d"]);
      await until(() => { noBlocked(runtime); return ["a", "b", "d"].every((id) => work(runtime, id).status === "done") && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 360_000, "three continuations to land");
      expect(w.show("shared.txt")).toBe("A\nB\nD");
      expect([w.show("a.txt"), w.show("b.txt"), w.show("d.txt")]).toEqual(["A2", "B2", "D2"]);
      // spec §9.2 H2 (N2): one landing per task along orca/g's first parent -- no "tip moved, land again".
      expect(w.landings()).toBe(3);
      // spec §13.2 I-6: reconciliations counted from fake codex's own log, never from spawnSeq or a runs directory.
      expect(w.scripted().filter((line) => line.startsWith("execute reconcile-"))).toHaveLength(2);
      // spec §5.2 N1: the second reconciliation's other side is both earlier landings.
      const reconciled = workRuns(runtime).filter((run) => run.body.drive.reconcile !== null);
      expect(reconciled.map((run) => (run.body.drive.reconcile.otherTaskIds ?? [run.body.drive.reconcile.otherTaskId]).length).sort()).toEqual([1, 2]);
      // spec §11 I7: every reconciliation's spend is booked on the group, under its own key.
      expect(Number(runtime.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE id LIKE 'reconcile-usage:%'").get()!.n)).toBe(2);
      // Three stopped predecessors (plan, execute), three continuations (plan, execute, verify), two
      // reconciliations (plan, execute; their synthesized command verifier calls no provider): 6 + 9 + 4 = 19.
      expect(["plan", "execute", "verify"].map((phase) => w.calls().filter((call) => call === phase).length)).toEqual([8, 8, 3]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("H5: a run already landing when the stop arrives lands, its request settles beside it, the panel offers only the stopped one, and one resume continues it and claims the dependent", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["a.txt"], verifierType: "command" },
      { taskId: "b", targetPaths: ["b1.txt", "b2.txt"] },
      { taskId: "c", dependsOn: ["a"], targetPaths: ["c.txt"], verifierType: "command" },
    ], {
      a: { files: { "a.txt": "A\n" } }, c: { files: { "c.txt": "C\n" } },
      b: { files: { "b1.txt": "B1\n" }, delayMs: { execute: 20_000 } }, "b#continuation": { files: { "b2.txt": "B2\n" } },
    });
    try {
      // a is caught between its landing and the record of it (execution driver R1's D-after-cas), so at the
      // stop it is `collected` with orca/g already moved -- the "already landing" row of spec §3.
      const first = await w.boot(crashAt("D-after-cas"));
      await startGroup(first, w.repoId);
      first.startPump(50);
      await until(() => first.driver?.crashed === "D-after-cas", 120_000, "a to reach its compare-and-swap");
      await inExecute(w, first, ["b"]);
      const [a] = runsOf(first, "a"), [b] = runsOf(first, "b");
      expect([a!.body.state, b!.body.state]).toEqual(["collected", "accepted"]);
      const requestIds = await handoffStop(first);
      expect(requestIds).toHaveLength(2);
      w.die(first);
      const second = await w.boot();
      second.startPump(50);
      await until(() => requestIds.every((id) => requestState(second, id) === "settled-recoverable"), 120_000, "both requests to settle recoverable");
      // spec §11 C1: a settled normally -- done, settled, cleaned up -- and its request settled beside it.
      expect(work(second, "a").status).toBe("done");
      expect(readDriverRun(second.store, a!.runId)).toMatchObject({ state: "settled", drive: { cleanedUp: true } });
      expect(w.show("a.txt")).toBe("A");
      expect(w.landings()).toBe(1);
      expect(readStopIntent(second.store, "g")!.state).toBe("handoff-complete");
      // spec §13.1 C-4: both display settled-recoverable; only the stopped one is continuable.
      const view = readControlGroup(second.store, second.epoch, "g");
      expect(view.runs.filter((run) => run.taskId !== null).map((run) => [run.taskId, run.state, run.continuable]).sort())
        .toEqual([["a", "settled-recoverable", false], ["b", "settled-recoverable", true]]);
      const selections = await resumeAsThePanelWould(second);
      expect(selections.map((selection) => selection.taskId)).toEqual(["b"]);
      await until(() => { noBlocked(second); return ["a", "b", "c"].every((id) => work(second, id).status === "done") && workRuns(second).every((run) => run.body.drive?.cleanedUp === true); }, 300_000, "b's continuation and c to settle");
      const [c] = runsOf(second, "c");
      expect(isAncestor(w.repo, readDriverRun(second.store, a!.runId).drive!.landedCommit!, c!.body.drive.base)).toBe(true);
      expect([w.show("b1.txt"), w.show("b2.txt"), w.show("c.txt")]).toEqual(["B1", "B2", "C"]);
      expect(w.landings()).toBe(3);
      expect([...w.scripted()].sort()).toEqual(["execute a", "execute b", "execute b#continuation", "execute c", "plan a", "plan b", "plan b#continuation", "plan c", "verify b"]);
      expect(await second.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("H6: a graceful shutdown freezes nothing in a driver-owned group, and the restarted panel dispatches the next task with no command", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["a.txt"], verifierType: "command" },
      { taskId: "b", dependsOn: ["a"], targetPaths: ["b.txt"], verifierType: "command" },
    ], { a: { files: { "a.txt": "A\n" }, delayMs: { execute: 4_000 } }, b: { files: { "b.txt": "B\n" } } });
    try {
      const first = await w.boot();
      await startGroup(first, w.repoId);
      first.startPump(50);
      await inExecute(w, first, ["a"]);
      expect(await first.shutdown()).toBe(true);
      // spec §12(3), §13.2 I-8: the shutdown's own ledger entry says why the group was left alone.
      const recorded = lookupCommandResult(first.store, "@global", shutdownCommandId(first.epoch))!.body as { result: { groups: Array<{ groupId: string; disposition: string }> } };
      expect(recorded.result.groups).toEqual([expect.objectContaining({ groupId: "g", disposition: "skipped-driver-owned" })]);
      expect(Number(first.store.db.prepare("SELECT COUNT(*) AS n FROM stop_intents").get()!.n)).toBe(0);
      expect(stopped(first)).toBe(false);
      w.die(first);
      const second = await w.boot();
      second.startPump(50);
      await until(() => { noBlocked(second); return work(second, "b").status === "done" && workRuns(second).every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "a and then b to settle after the restart");
      expect(workRuns(second).map((run) => [run.task, run.body.state])).toEqual(expect.arrayContaining([["a", "settled"], ["b", "settled"]]));
      expect(readStopIntent(second.store, "g")).toBeNull();
      expect(stopped(second)).toBe(false);
      expect([w.show("a.txt"), w.show("b.txt")]).toEqual(["A", "B"]);
      expect(w.calls()).toEqual(["plan", "execute", "plan", "execute"]);
      expect(await second.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  // H7 (a non-driver run still active at shutdown freezes the group as before) needs an active estimate run,
  // which this world cannot make: the estimator here is blocked-capability (execution driver deviation D1).
  // It is covered by T7's unit criterion in tests/panel/shutdownDriverGroup.test.ts
  // ("H7: freezes a driver-owned group as before while a non-driver run (an estimate) is active in it").

  it("G: a delivered stop that yields nothing turns outcome-unknown only past deadline + the adapter's killGraceMs + 60 s", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a1.txt"] }], { a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 8_000 } } });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [a] = runsOf(runtime, "a");
      // ccloop's worker is killed, so no candidate can ever be written: nothing arrives, by construction.
      const accepted = JSON.parse(readFileSync(join(a!.body.drive.sourceDir, "control", "accepted.json"), "utf8")) as { worker: { pid: number } };
      process.kill(accepted.worker.pid, "SIGKILL");
      const deadlineAt = new Date(Date.now() + 2_000).toISOString();
      const [requestId] = await handoffStop(runtime, { handoffDeadlineAt: deadlineAt });
      await until(() => requestState(runtime, requestId!) === "outcome-unknown", 180_000, "the request to turn outcome-unknown");
      const observed = Date.now();
      // The grace the assembly read from this world's adapter config (killGraceMs 5 s) is what the driver used:
      // HANDOFF_EXTRA_GRACE_MS alone would have turned it at deadline + 60 s.
      expect(observed).toBeGreaterThanOrEqual(Date.parse(deadlineAt) + KILL_GRACE_MS + 60_000);
      expect(observed).toBeLessThan(Date.parse(deadlineAt) + KILL_GRACE_MS + 60_000 + 30_000);
      // spec §11 I3: outcome-unknown never kills anything and never lands anything; the run is left as it was.
      expect(readDriverRun(runtime.store, a!.runId).state).toBe("accepted");
      expect(w.landings()).toBe(0);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it.each(["H-after-deliver", "H-after-candidate", "A2-after-bundle", "B-after-accept"] as const)(
    "R-H %s: a death between a handoff action and its record ends where H1 ends, spending no more", async (point) => {
      const w = await world(HALVES_TASKS, HALVES);
      try {
        const first = await w.boot(crashAt(point));
        await startGroup(first, w.repoId);
        first.startPump(50);
        if (point === "B-after-accept") await until(() => first.driver?.crashed === point, 120_000, `the crash at ${point}`);
        // ccloop runs on without the driver; the stop is sent once its execute has begun, as in H1.
        await inExecute(w, first, ["a"]);
        const [requestId] = await handoffStop(first);
        if (point === "A2-after-bundle") {
          await until(() => requestState(first, requestId!) === "settled-recoverable", 120_000, "the request to settle recoverable");
          await resumeAsThePanelWould(first);
        }
        await until(() => first.driver?.crashed === point, 120_000, `the crash at ${point}`);
        w.die(first);
        const second = await w.boot();
        second.startPump(50);
        if (point !== "A2-after-bundle") {
          await until(() => requestState(second, requestId!) === "settled-recoverable", 120_000, "the request to settle recoverable after the restart");
          await resumeAsThePanelWould(second);
        }
        await until(() => { noBlocked(second); return work(second, "a").status === "done" && runsOf(second, "a").every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "the continuation to land after the restart");
        expect([w.show("a1.txt"), w.show("a2.txt")]).toEqual(["A1", "A2"]);
        expect(w.landings()).toBe(1);
        // No more provider calls and no more ccloop runs than the uncrashed H1.
        expect(w.calls()).toEqual(HALVES_CALLS);
        expect(w.scripted()).toEqual(HALVES_SCRIPTED);
        expect(sourceDirs(second)).toHaveLength(2);
        expect(await second.shutdown()).toBe(true);
      } finally { await w.teardown(); }
    });

  it("R-H H-between-commit-and-settle: a death after a landed run settled and before its request did ends settled, and an empty resume reopens the group", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a.txt"], verifierType: "command" }], { a: { files: { "a.txt": "A\n" } } });
    try {
      const first = await w.boot(crashAt("D-after-cas"));
      await startGroup(first, w.repoId);
      first.startPump(50);
      await until(() => first.driver?.crashed === "D-after-cas", 120_000, "a to reach its compare-and-swap");
      const [requestId] = await handoffStop(first);
      w.die(first);
      const second = await w.boot(crashAt("H-between-commit-and-settle"));
      second.startPump(50);
      await until(() => second.driver?.crashed === "H-between-commit-and-settle", 120_000, "the crash between settle and request");
      // The run settled through E; its request, never delivered (a landing run is not interrupted), is still open.
      expect(runsOf(second, "a")[0]!.body.state).toBe("settled");
      expect(requestState(second, requestId!)).toBe("request-pending");
      w.die(second);
      const third = await w.boot();
      third.startPump(50);
      await until(() => requestState(third, requestId!) === "settled-recoverable", 120_000, "the request to settle after the restart");
      const [a] = runsOf(third, "a");
      expect(a!.body).toMatchObject({ state: "settled", drive: { cleanedUp: true } });
      expect(work(third, "a").status).toBe("done");
      expect(w.show("a.txt")).toBe("A");
      expect(w.landings()).toBe(1);
      expect(w.calls()).toEqual(["plan", "execute"]);
      expect(sourceDirs(third)).toHaveLength(1);
      // spec §13.1 I-4: nothing is continuable, and the panel's "Resume (no continuation)" -- no selections -- reopens it.
      expect(readStopIntent(third.store, "g")!.state).toBe("handoff-complete");
      expect(await resumeAsThePanelWould(third)).toEqual([]);
      expect(stopped(third)).toBe(false);
      expect(await third.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
```

- [ ] **Step 3b（闸门）：deadline 一条 —— 只在控制器裁定 D-C3 与 D-C7′ 之后做**

闸门：控制器已裁 (i) D-C3（ccloop T2：被中止的阶段报出它已被观测到的用量，fake codex 的 `usageBeforeDelay`）与 (ii) D-C7′（被 handoff deadline 打断的那个阶段 —— ccloop 事件 `handoff_interrupted`，其 detail 点名该阶段，ccloop `a5dc529` 的 `src/controller/runLoop.ts:1232`／`:1361`／`:1425`／`:1610`／`:1836` 五处写它（规划席 python 现测；T2 之后移动，实施席引用前重测） —— 不列入 `missing`），且两者都已进 Step 1 的 ccloop build（`T2_USAGE_BEFORE_DELAY True`，D-C7′ 对应的判据在 ccloop 侧绿）。**未裁 ⇒ 本 Step 不做，文件里没有这一条（不许用 `it.skip` 占位 —— 门要求 0 skipped），COUNT 为 11。**

按推荐方案写：在 `tests/control/handoffE2E.test.ts` 里 `  it.each(["H-after-deliver", …` 那一行**之前**插入：

```ts
  // Handoff delivery spec §12 (criteria additions) and §13.1 C-3, under the controller's rulings D-C3 (ccloop T2:
  // an aborted phase reports the usage it was observed spending) and D-C7' (a phase the handoff deadline
  // interrupted is not listed missing).
  it("deadline: a phase aborted at the request's deadline still leaves a recoverable checkpoint, and its continuation lands", async () => {
    const w = await world(HALVES_TASKS, {
      a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 120_000 }, usageBeforeDelay: true },
      "a#continuation": { files: { "a1.txt": "A1\n", "a2.txt": "A2\n" } },
    });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [a] = runsOf(runtime, "a");
      const [requestId] = await handoffStop(runtime, { handoffDeadlineAt: new Date(Date.now() + 3_000).toISOString() });
      await until(() => ["settled-recoverable", "settled-unrecoverable", "outcome-unknown"].includes(requestState(runtime, requestId!)), 120_000, "the request to settle");
      const parked = readDriverRun(runtime.store, a!.runId) as unknown as Record<string, any>;
      const checkpoint = checkpointOf(runtime, parked.checkpointId);
      // ccloop C6: its own request is answered even though the phase was cut; C-3: the cut phase's usage was observed.
      expect(checkpoint).toMatchObject({ result: "partial", unresolvedRequestIds: [], missing: [] });
      const usage = runtime.store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq").all(a!.runId).map((row) => JSON.parse(String(row.body)));
      expect(usage.length).toBeGreaterThan(0);
      expect(usage.every((event) => event.cumulative !== null)).toBe(true);
      expect(requestState(runtime, requestId!)).toBe("settled-recoverable");
      await resumeAsThePanelWould(runtime);
      await until(() => { noBlocked(runtime); return work(runtime, "a").status === "done" && runsOf(runtime, "a").every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "the continuation to land");
      expect([w.show("a1.txt"), w.show("a2.txt")]).toEqual(["A1", "A2"]);
      expect(w.calls()).toEqual(HALVES_CALLS);
      expect(w.scripted()).toEqual(HALVES_SCRIPTED);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

```

Expected（闸门已过、Step 6 带 env 跑）：deadline 一条绿。**规划席在闸门未过的 build（T1＋T2 草稿、无 D-C7′）上实测它红，且只红在**：

```
-   "missing": Array [],
+   "missing": Array [
+     "attempts/1/execution.json",
+   ],
```

—— `result:"partial"`、`unresolvedRequestIds: []` 两项已成立（C6 生效），红的正是 D-C7′ 要裁的那一个文件。闸门过了仍红在这里 ⇒ D-C7′ 没进 build，停下。


- [ ] **Step 4：跑，看见红**（带 env）

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"; source "$S/t9-env.sh"
./node_modules/.bin/vitest run tests/panel/assemblyHandoffGrace.test.ts tests/control/handoffE2E.test.ts --reporter=verbose > "$S/t9-red.log" 2>&1; echo "RC=$?" >> "$S/t9-red.log"; cat "$S/t9-red.log"
```

预言（T3–T8 已提交，所以 E2E 大部分场景此刻就该绿 —— 它们是前面各 Task 在真 ccloop 下的承重判据，不是本 Task 实现的东西）：
- `assemblyHandoffGrace` 1 条红：`handoffGraceMsOf is not a function`（导出还不存在；`npm run typecheck` 此刻也红在这个 import，属预期）。
- E2E **只有 G 红**：`outcome-unknown` 出现在约 `deadline + 60 s`，`toBeGreaterThanOrEqual(deadline + 65 000)` 不成立（规划席在副本里对同一形状实测过，见 T9-M1）。
- 其余 10 条绿。**任何一条别的红了 ⇒ 停下**：那是 T3–T8 在真 ccloop 下的缺陷，报控制器，不在本 Task 里修。
- **E2E 显示 skipped ⇒ env 没带上 —— 停下，不许当红证。**

- [ ] **Step 5：`src/panel/controlAssembly.ts`**

`:10`（`import { createExecutionDriver, … } from "../control/executionDriver.js";`）之后加一行：

```ts
import { HANDOFF_EXTRA_GRACE_MS } from "../control/driverHandoff.js";
```

`:108`（`ControlAssemblyInput` 的收尾 `}`）之后、`:110` `choosePort` 的文档注释之前，加：

```ts
/**
 * Handoff delivery spec §3 (controller decision): a delivered request that yields nothing is judged
 * outcome-unknown only past its deadline plus the adapter's own killGraceMs plus HANDOFF_EXTRA_GRACE_MS.
 * Read once, here. A config that cannot be read, or whose killGraceMs is not a non-negative safe integer,
 * counts 0: the grace is never shorter than the fixed part, and an unusable config is the port's to refuse.
 */
export function handoffGraceMsOf(adapterConfigPath: string): number {
  let killGraceMs = 0;
  try {
    const value = (JSON.parse(readFileSync(adapterConfigPath, "utf8")) as { killGraceMs?: unknown } | null)?.killGraceMs;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) killGraceMs = value;
  } catch { killGraceMs = 0; }
  return killGraceMs + HANDOFF_EXTRA_GRACE_MS;
}
```

（`readFileSync` 已在 `:1` 导入。）`createExecutionDriver({…})`（`:236`）里 `:240` 那一行 `kickPump: () => { void pump(); }, crash: input.driverCrash,` 之后加：

```ts
      handoffGraceMs: handoffGraceMsOf(env.ORCA_CCLOOP_ADAPTER_CONFIG!),
```

（只在 `control.executionPort === "configured"` 的分支里 —— unconfigured 不读任何文件，面板逐字节同前。）

- [ ] **Step 6：看见绿，回归装配／关闭／既有 E2E，再跑 `verify:control`**

```bash
cd /Users/biran/code/skills/loop/Orca
S="${SCRATCH:?}"; source "$S/t9-env.sh"
npm run typecheck > "$S/t9-tsc.log" 2>&1; echo "RC=$?" >> "$S/t9-tsc.log"
./node_modules/.bin/vitest run tests/panel/assemblyHandoffGrace.test.ts tests/control/handoffE2E.test.ts --reporter=verbose --reporter=json --outputFile="$S/t9-green.json" > "$S/t9-green.log" 2>&1; echo "RC=$?" >> "$S/t9-green.log"
python3 -c "import json;d=json.load(open('$S/t9-green.json'));print('pending',d['numPendingTests'],'todo',d['numTodoTests'],'failed',d['numFailedTests'],'passed',d['numPassedTests'])" >> "$S/t9-green.log"
./node_modules/.bin/vitest run tests/panel/controlAssemblyDriver.test.ts tests/control/executionDriverE2E.test.ts tests/panel/controlStartup.test.ts tests/panel/controlShutdown.test.ts tests/panel/controlMount.test.ts > "$S/t9-regress.log" 2>&1; echo "RC=$?" >> "$S/t9-regress.log"
npm run verify:control > "$S/t9-verify-control.log" 2>&1; echo "RC=$?" >> "$S/t9-verify-control.log"
cat "$S/t9-tsc.log" "$S/t9-green.log" "$S/t9-regress.log" "$S/t9-verify-control.log"
```

Expected：typecheck RC 0；`pending 0 todo 0 failed 0 passed 12`（deadline 未插入时 `passed 11` —— 见 Step 3b）；回归 RC 0；`verify:control` RC 0（它跑整个 `tests/control`，含本文件，`--maxWorkers=4`；本文件在负载下单条最长约 70 s（G），整文件约 6 分钟 —— 若只有 `executionDriverE2E`／`driverSettle`／本文件的计时红，按 spec §9.1 **单文件重跑绿才算**，重跑命令与结果都进日志；SIGTERM 那条已登记 flake 同理）。
E2E 不需要 `--pool=forks --poolOptions.forks.singleFork`：每条场景自带临时根、自己的 adapter config 与 fake codex 标记文件，文件内顺序执行（执行驱动计划 T9 也是这样跑的）；HOME 改道是整文件的 `beforeAll`／`afterAll`，vitest 的文件隔离保证它不漏到别的文件。

- [ ] **Step 7：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/panel/controlAssembly.ts tests/panel/assemblyHandoffGrace.test.ts tests/control/handoffE2E.test.ts
/usr/bin/git diff --cached --stat > "${SCRATCH:?}/t9-staged.txt"; cat "${SCRATCH:?}/t9-staged.txt"
/usr/bin/git commit -F "${SCRATCH:?}/t9-msg.txt"
```

`t9-msg.txt`：

```
test(control): drive a handoff through real ccloop, end to end

The panel assembly now hands the execution driver its handoff grace: the
adapter's killGraceMs plus 60 s, read once from the adapter config.

Against the real ccloop build with scripted fake codex, a run stopped in
the middle of execute parks its half in a recoverable checkpoint and its
continuation lands the whole task on the predecessor's base; three
parallel runs stopped and continued land serially with exactly two
reconciliations, the second against both earlier landings; a dependent
waits for its dependency's continuation; a run already landing at the
stop lands and only the stopped run is offered for continuation; a
graceful shutdown leaves a driver-owned group running on restart; a stop
that yields nothing turns outcome-unknown only after the adapter's grace;
and a death at each handoff boundary ends where a clean run ends,
spending no more.

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

（Step 3b 若在本 Task 之内做，deadline 一条随同本提交；若在控制器裁定之后才做，另起一笔 `test(control): a handoff deadline cut leaves a recoverable checkpoint`，同样的两行归属。）

**变异**（变异席的副本要带 `ORCA_CCLOOP_BIN`；E2E 慢，每条只跑它点名的那一条，`-t` 写全名；ccloop 侧的变异在 ccloop 的 `clone --local` 副本里改、重新 `npm run build`、把 `ORCA_CCLOOP_BIN` 指向那份副本 —— **只列只有 E2E 抓得住的分支**，单元判据已经钉住的不在这里重复）

| V | 文件 | 变异 | 喂它的场景 | 期望红（且仅） |
|---|---|---|---|---|
| T9-M1 | `src/panel/controlAssembly.ts` | 删 `handoffGraceMs: handoffGraceMsOf(…),` 那一行 | G | `G: a delivered stop that yields nothing …`（**规划席已实测见红**：`expected 1790320011250 to be greater than or equal to 1790320016152`） |
| T9-M2 | `src/panel/controlAssembly.ts` | `handoffGraceMsOf` 改为 `return HANDOFF_EXTRA_GRACE_MS;` | 单元 ＋ G | `is the adapter's killGraceMs plus the fixed extra …` ＋ G |
| T9-M3 | `src/panel/controlAssembly.ts` | 删 `typeof value === "number" && Number.isSafeInteger(value) && value >= 0 &&` 的校验（直接 `killGraceMs = value as number`） | 单元 | `is the adapter's killGraceMs plus the fixed extra …`（`-1` 得 59 999、`"5000"` 得字符串拼接）；E2E 不红（其 config 合法） |
| T9-M4 | ccloop `tests/fixtures/fake-codex.mjs` | 选键时去掉 `#continuation` 那一支（恒取 `<task>`） | H1 | H1 ＋ H3 ＋ R-H 四条 ＋ H5（续跑的 execute 由 `a` 答：只写 `a1.txt` 且再睡 6 s ⇒ `a2.txt` 不存在、`.tasks` 不等）；H2 的内容断言也红（`a.txt`＝`A` 而非 `A2`） —— 这一族同源，预言「上述全部红」，不独占 |
| T9-M5 | `src/control/driverLanding.ts`（T6 的 N2） | 删「同组已有 `reconciling` 的 run 则本轮不进 D」那一个 `return false` | H2 | H2（预言红在 `execute reconcile-*` 为 3 行，或对方集合大小不是 `[1,2]`，或 first-parent 数 > 3；**依赖时序**：三路续跑几乎同时 `collected`，两路冲突并发 ⇒ 后完成者见尖端已移 ⇒ 重落再冲突）。变异席实测；若一次跑没红，连跑 3 次记录每次的三个数，仍不红则登记「N2 的真实路径承重不足」报控制器 |
| T9-M6 | `src/control/driverHandoff.ts`（T4 的 `visitOrder`） | `visitOrder` 改为 `return driverRunIds(store);`（不并 `handoffRunIds`） | H5、R-H `H-between…` | 这两条（`settled` 的 run 带着开着的请求永远没人 settle ⇒ `until` 超时）；T4 的单元判据同样会红 —— 本行记的是「真路径也钉住了」，不算独占 |
| T9-M7 | `src/control/executionSnapshot.ts`（D-SNAP） | `settledShape` 恒原样返回（不去 `amount`） | H1 | H1 起所有续跑场景（A2 读 `readConfirmedTaskExecution` 抛 `recovery-blocked` ⇒ 续跑 `blocked`，`noBlocked` 报名）；预言不独占 |


**需要控制器裁定（本 Task 不自决）**：
1. **D-C3 与 D-C7′**（deadline 一条的闸门）：规划席实测的现状见 Step 3b —— T2 草稿之后只差 D-C7′ 这一处 `missing`。
2. **§11 I6「stop 落在一次失败 attempt 之后」**：fake codex 表达不了（见上文现量），需 ccloop 夹具新增「按 attempt 给 verify 答案」的脚本字段；立项与否由控制器定。不立项则登记为缺口。
3. **T9-M5（N2 的真实路径承重）依赖时序**：若变异席连跑 3 次都不红，登记并报控制器（候选加固：把某一路的续跑 execute 加 `delayMs`，让两路冲突的 `collected` 时刻错开到已知顺序 —— 会改变 H2 的预言，须重新推 `.calls`）。

（`handoffE2E` 为收集到的测试条数：9 个 `it`／`it.each` 调用点，其中 R-H 的 `it.each` 展开 4 条；Step 3b 未做时为 11。）

---

## Task 10：收口 —— 机械判定器、全套门、变异电池、台账

**Files:**
- Create（`git add -f` **单独**加）: `.superpowers/sdd/2026-09-25-handoff-delivery/progress.md`
- Create（scratchpad，**不入库**）: `check-handoff.py`、`gates-handoff.sh`

- [ ] **Step 1：判定器 `check-handoff.py`**（放 scratchpad；形状照上一片的 `check-driver.py`）

```python
# check-handoff.py <orca-vitest-json> <web-vitest-json> <ccloop-vitest-json>
#   -- handoff delivery round (spec docs/superpowers/specs/2026-09-25-handoff-delivery-design.md)
import json, sys
orca, web, ccloop = (json.load(open(path)) for path in sys.argv[1:4])
# Load-sensitive criteria seen red only under concurrent test load (plan §0 last paragraph); each must pass
# when its file is re-run alone -- the gate script does that and hands the result in as FLAKE_RERUN_OK.
FLAKE = {
    "a real SIGTERM to a real panel makes it exit cleanly, having written one shutdown row for its epoch",
    "a person's recovery-retry on a blocked driver run (spec §2.3) drives a retried run on from where it was blocked, to settled",
    "D: landing on orca/<group> (spec §5.1-§5.2) leaves the branch alone when it moved between the merge and the swap, and lands on the new tip next round",
    "D: landing on orca/<group> (spec §5.1-§5.2) recognises a landing it already made and does not merge twice (a death after the swap)",
}
# Every new criterion file of this round, with the exact number of criteria it must report, all passed.
EXPECTED_ORCA = {
    "tests/control/handoffStop.test.ts": 7,
    "tests/control/driverHandoff.test.ts": 14,
    "tests/control/driverContinuation.test.ts": 5,
    "tests/scheduler/reconcileParity.test.ts": 5,
    "tests/control/driverReconcileN.test.ts": 4,
    "tests/panel/shutdownDriverGroup.test.ts": 8,
    "tests/panel/runContinuable.test.ts": 4,
    "tests/panel/assemblyHandoffGrace.test.ts": 1,
    # 12 without the gated deadline scenario (T9 Step 3); 13 once T9 Step 3b has landed.
    "tests/control/handoffE2E.test.ts": 12 if "--no-t2" in sys.argv else 13,
}
EXPECTED_WEB = {"web/tests/handoffResume.test.tsx": 3}
EXPECTED_CCLOOP = {
    "tests/runtime/codex/fakeCodexDelay.test.ts": 5,
    "tests/control/handoffEnteredPhases.test.ts": 6,
    # Task 2 is gated on the controller's ruling D-C3 / D-C7'. Until it lands these two files do not exist; pass
    # --no-t2 and they are not counted. After it lands, the flag must not be passed.
    "tests/runtime/codex/abortedUsage.test.ts": 3,
    "tests/control/handoffDeadlineUsage.test.ts": 1,
}
if "--no-t2" in sys.argv:
    for key in ("tests/runtime/codex/abortedUsage.test.ts", "tests/control/handoffDeadlineUsage.test.ts"):
        EXPECTED_CCLOOP.pop(key)
# The existing criteria this round rewrote (plan §0): each must be present, once, and passed.
REWRITTEN = [
    ("tests/control/executionDriver.test.ts", "D21 (superseded by handoff delivery §4): blocks a continuation run without its registration before any provider attempt, by name"),
    ("tests/control/stopIntent.test.ts", "treats an active run whose only request already settled as a recovery blocker, not as permission for a second request"),
]
problems = []
for name, d in (("orca", orca), ("web", web), ("ccloop", ccloop)):
    if d["numPendingTests"] or d["numTodoTests"]:
        problems.append(f"{name}: pending={d['numPendingTests']} todo={d['numTodoTests']}")
def rows(d, suffix):
    return [a for f in d["testResults"] if f["name"].endswith(suffix) for a in f["assertionResults"]]
for d, expected in ((orca, EXPECTED_ORCA), (web, EXPECTED_WEB), (ccloop, EXPECTED_CCLOOP)):
    for suffix, count in expected.items():
        got = rows(d, suffix)
        if len(got) != count or any(a["status"] != "passed" for a in got):
            problems.append(f"{suffix}: expected {count} passed, got {[a['status'] for a in got]}")
for suffix, title in REWRITTEN:
    got = [a for a in rows(orca, suffix) if a["title"] == title]
    if len(got) != 1 or got[0]["status"] != "passed":
        problems.append(f"rewritten criterion missing or not passed: {suffix} > {title}")
failed = {a["fullName"] for f in orca["testResults"] for a in f["assertionResults"] if a["status"] == "failed"}
if not failed <= FLAKE:
    problems.append(f"orca unexpected failures={sorted(failed - FLAKE)}")
if failed and "--flake-rerun-ok" not in sys.argv:
    problems.append(f"orca flakes failed and were not re-run alone: {sorted(failed)}")
web_failed = [a["fullName"] for f in web["testResults"] for a in f["assertionResults"] if a["status"] == "failed"]
if web_failed:
    problems.append(f"web failures={web_failed}")
print("OK" if not problems else "\n".join(problems))
sys.exit(1 if problems else 0)
```

红证（**必须先看见它退 1**，两次，输出与 RC 整份记进台账）：(a) 拿本计划 §0 的基线 json（`scratchpad/planner/base/orca-full2.json`）与任意一份改动前的 web／ccloop json 喂它 ⇒ 每个新文件一行 `expected N passed, got []`、两条 `rewritten criterion missing` ⇒ RC 1；(b) 造一份把 `tests/control/driverHandoff.test.ts` 的一条改成 `"failed"` 的 json 喂它 ⇒ RC 1（`unexpected failures` 与该文件那一行）。

- [ ] **Step 2：全套门 `gates-handoff.sh`**（逐段单跑，每段各取 RC，全部重定向到文件再整份读回；**不许**用 `npm run verify` 的 `&&` 链）

```bash
#!/bin/bash
S="${SCRATCH:?set SCRATCH to the session scratchpad}"
source "$S/t9-env.sh"
cd /Users/biran/code/skills/loop/Orca
G="$S/gates/handoff"; mkdir -p "$G"
run() { name=$1; shift; "$@" > "$G/$name.log" 2>&1; echo "$name RC=$?" >> "$G/summary.txt"; }
: > "$G/summary.txt"
run typecheck npm run typecheck
run web-build npm run build --workspace web
run test ./node_modules/.bin/vitest run --reporter=json --outputFile="$G/test.json"
( cd web && ../node_modules/.bin/vitest run --reporter=json --outputFile="$G/web.json" ) > "$G/web-test.log" 2>&1; echo "web-test RC=$?" >> "$G/summary.txt"
run verify-control npm run verify:control
run web-control npm run verify:web-control
run web-control-consumer npm run verify:web-control:consumer
run scheduler npm run verify:scheduler
run chain npm run verify:chain
run panel npm run verify:panel
run ws-check npm run --ws check
run claude-md node scripts/check-claude-md-lines.mjs
run hooks-path node scripts/check-hooks-path.mjs
run ledger npm run ledger -- validate .decisions
C=/Users/biran/code/skills/loop/ccloop
( cd "$C" && npm run typecheck ) > "$G/ccloop-typecheck.log" 2>&1; echo "ccloop-typecheck RC=$?" >> "$G/summary.txt"
( cd "$C" && npm run build ) > "$G/ccloop-build.log" 2>&1; echo "ccloop-build RC=$?" >> "$G/summary.txt"
( cd "$C" && ./node_modules/.bin/vitest run --reporter=json --outputFile="$G/ccloop.json" ) > "$G/ccloop-test.log" 2>&1; echo "ccloop-test RC=$?" >> "$G/summary.txt"
( cd "$C" && node scripts/check-known-reds.mjs "$G/ccloop.json" ) > "$G/ccloop-known-reds.log" 2>&1; echo "ccloop-known-reds RC=$?" >> "$G/summary.txt"
echo DONE >> "$G/summary.txt"
```

之后：`test` 的 RC 非 0 时，把失败的每一条所在文件**单文件**重跑（重定向到 `"$G/rerun-<file>.log"`），全绿才给判定器加 `--flake-rerun-ok`；再跑 `python3 "$S/check-handoff.py" "$G/test.json" "$G/web.json" "$G/ccloop.json" [--no-t2] [--flake-rerun-ok] > "$G/check.log" 2>&1; echo "check RC=$?" >> "$G/summary.txt"`。

判定（spec §9.1）：`typecheck`、`web-build`、`web-test`、`check`、`verify-control`、`web-control`、`web-control-consumer`、`scheduler`、`chain`、`panel`、`ws-check`、`claude-md`、`hooks-path` 逐段 RC 0；`ledger` RC ∈ {0,2}；ccloop：`typecheck`、`build` RC 0，`known-reds` RC 0（全套 json 的 RC 可以非 0，只要失败 ⊆ 已知红名单）。**0 skipped**：真 ccloop 的判据文件（`handoffE2E`、上一片的 `executionDriverE2E`）在门里必须带 env 跑，判定器按条数查，skip 即不等。`summary.txt` 与每段日志**整份读回**，结果（只抄工具报数：文件数、条数、RC）写进台账。
⚠️ `verify:control` 会跑 `tests/control` 全部，含两份 E2E（慢）；Bash 给 600000 ms 或放后台，**RC 写进日志文件再读回，不读后台通知的退出码**（handoff §6.8）。

- [ ] **Step 3：变异电池**（**单独的变异席**，不是写实现的那一席 —— handoff §6.4）

在 Orca 与 ccloop 各一个 `git clone --local` 副本里（软链 `node_modules`，Orca 副本另软链 `web/node_modules`；E2E 相关变异要 `source t9-env.sh`），逐条跑 T1–T9 各自的变异表：
1. 每组先跑一次**绿基线**（该组判据文件），RC 0 才往下；
2. 每条：`shasum -a 256` 记前值 → python 整行锚点替换、断言命中 == 1 → 记后值（**相等当场停**）→ 跑「期望红」列的文件（E2E 用 `-t` 全名过滤）→ 记红在哪几条 → `cat` 原文件还原 → `shasum` 等于前值；
3. 实测与预言不一致 ⇒ **记实测，不改判据迁就**；表里标「预言不红／登记」的，实测不红就登记为「该分支无独占判据」并列入报控制器清单；
4. 跨 Task 的红证（例如 T3-M8 让 T4 的 C-1 判据红、T4-M19 让 T5 第 1 条红）**真的重跑一次**，不许纸上推；
5. ccloop 的变异只在 ccloop 副本里（ccloop Rule 17）；T2 的变异只在 T2 落地之后跑；
6. 还原证明：副本 `/usr/bin/git diff | wc -c` 与 `/usr/bin/git diff --cached | wc -c` 都是 0；删副本前 `/bin/rm -f` 软链本身，再 `/bin/rm -rf` 副本。

- [ ] **Step 4：台账 `.superpowers/sdd/2026-09-25-handoff-delivery/progress.md`**

内容：本轮归属（会话、各席模型）；§0 现量结果的复核记录（实施中若推翻了哪条，另起一节写更正，原文不动）；§0.1 各偏离的控制器裁定（逐条：采纳／改法）与**报人**的记录（D-C3、D-C7′ 必须有）；每条变异的「前后 sha256 全 64 位、红集合、RC、是否与预言一致」；判定器红证两次；Step 2 的门表（只抄工具报数）；T9 Step 1 的 ccloop build 头提交主题行；登记为「无独占判据」的分支清单（至少 T4-M4、T4-M11、T4-M13、T4-M15、T4-M18 这几条预言不红的）。

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add -f .superpowers/sdd/2026-09-25-handoff-delivery/progress.md
/usr/bin/git commit -F "${SCRATCH:?}/t10-msg.txt"
```

`t10-msg.txt`：

```
docs(sdd): record the handoff delivery mutation battery and gates

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

（`.superpowers/sdd/**` 被 gitignore，**必须单独** `git add -f`，不和别的路径同一条 add —— handoff §7.2。）

- [ ] **Step 5：交回控制器的清单**（写进本席报告，不写进仓库）：两仓 `ls-remote` 与本地 main 的比对（开工一次、收尾一次）；§0.1 各条的实际处理；所有「预言不红／登记」的变异实测结果；H1／H2 的 `.calls`／`.tasks` 实测序列；E2E 的实测耗时（只抄工具报数）；D-C3／D-C7′ 报人的原话与人的答复（没有答复就写「未答复，T2 与 deadline 一例未做」）；**push、合并进 main、删分支或 worktree 一律没做，列进 `awaitingHuman`**。

---

## 自审（写计划席按 superpowers:writing-plans 做的三项，结果如下）

**1. spec 覆盖**

| spec 节／条 | 落在 |
|---|---|
| §1 问题（m7：请求无消费者；D21；m5） | T4（消费者＝H 步）、T5（去 D21）、T7（m5） |
| §2 范围①–⑤、诚实的验收表述 | Global Constraints；T9 文件头注释 |
| §3 H 步与表的每一行（未 accept／unknown／已 accept／已 collected） | T4（`stepH` 各支；表见 T4 开头） |
| §3「一条原则」 | Global Constraints；T4 H-settle 不落地；§0.1 D-LANDED |
| §3 宽限期 | T4（`settleIfPastGrace`、`HANDOFF_EXTRA_GRACE_MS`）、T9（装配传 `killGraceMs + 60 s`） |
| §3 C 步无限等待改掉（X1） | T4（`stepC` 的 X1）、判据 X1 |
| §3 崩溃恢复「先意图后动作」、重放语义 | T4（投递后才落 `collecting`；重放答 `complete`）；§0 (1)；R-H 判据（T4 单元、T9 真 ccloop） |
| §3 Task 0 现量两项 | §0 (1)(2) |
| §4 A1 去门、预算衔接 | T5；§0 (3) |
| §4 A2 方案 X（继承 base）、bundle、`toStartEnvelope` | T5；§0 (4)；判据 H1（T9）、T5 第 1、2 条 |
| §4 续跑链、前任工作区清理 | T5 第 2 条、`cleanupPredecessor` |
| §4.1 串行（H3）、面板「C 等 A」 | T9 的 H3；§0 (5) 登记 |
| §5.1 两处缺口、§5.2 N1／N2／N3 | T6（N1、N2、N-parity）；N3 登记于 §0.1 末段 |
| §6 优雅关闭（m5）与 ERRATUM | T7（跳过、`skipped-driver-owned`、ERRATUM 全文） |
| §7 残留与 Rule 17 | Global Constraints；§0.1 登记（源目录现场、`.resume-staging-*`） |
| §8 C5 | T1；§0 (8) |
| §9.1 成功判据 | T10 Step 2 |
| §9.2 H1–H5、X1、N1u、N-parity、R-H | H1／H2／H3／H5：T9（真 ccloop）＋ T4／T5 单元；H4：T4；X1：T4；N1u、N-parity：T6；R-H：T4（合成 port）＋ T9（真 ccloop） |
| §9 末段「既有判据」 | §0「会红的既有判据」两节；T3、T5、T8 的改写步骤 |
| §10 登记 | §0.1 末段 |
| §11 C1 | T3（`settleCompletedRunRequestInTransaction`）、T4（`settled` 支）、H5 |
| §11 C2 ＋ ERRATUM（§11.1） | T3（导出、规范字节、bundle 接受）、T4（H-settle）、T7（ERRATUM 第 2 点）；台账守恒断言：T4 第 1 条（`committedAndUsed`）、T9 H1 |
| §11 C3（词表映射） | T4（`result:"partial"`、ccloop 的 `result` 留在 packet） |
| §11 C4（拆行、`B-after-accept`） | T4（`start-pending` 两支、判据「does not restart a prepared run…」） |
| §11 I1（blocked 一行、H8） | T4（`closeBlocked`、H8 两条） |
| §11 I3（`ADOPTABLE_STATES`、`outcome-unknown` 继续收集） | T3（导出）、T4（宽限期那条判据） |
| §11 I4（请求体重放） | 被 §13.2 I-10 取代 ⇒ T3（`handoffRequestFromOutbox`） |
| §11 I5（窗口、bundle 复用） | T4（C1 两事务、`H-between-commit-and-settle`）、T3／T5（`readExistingResumeBundle`、A2-after-bundle） |
| §11 I6（祖先而非相等、失败 attempt 之后） | T5（base 断言）、T9 H1 |
| §11 I7（N2 计数、单调 spawn 键） | T6；§13.2 I-6 ⇒ `.tasks`（T1，§0.1 D-TASKS） |
| §11 I9（restartable 新支） | T3、T4 |
| §11 Minor M1–M6 | M4：T5；M5：T6；M6：§0 现跑为准；其余只是事实更正，无代码 |
| §12 m5／C5／既有判据授权／fake claude 不做 | T7、T1、§0、Global Constraints |
| §12(1) C6 | T1 |
| §12(2) stop 之后冲突 | 被 §13.1 C-5 取代 ⇒ T4（C-5 那条判据） |
| §12(3) 关闭（`disposition` 加值） | T7 |
| §12 判据增补（H8、C6 判据、deadline E2E、重复解冲突 token 全记） | T4（H8）、T1（C6）、T9（deadline，门控）、T6（I7 判据） |
| §13.1 C-2（C7） | T1；§0 (9)；D-C7′（T2） |
| §13.1 C-3 | §0 (10)；§0.1 D-C3；T2（门控） |
| §13.1 C-5（held、`freezeRun` blocker） | T3、T4 |
| §13.1 C-4 ＋ I-4（`continuable`、Resume (no continuation)、H5 面板层） | T8；T9（H5 面板层） |
| §13.2 C-1 | T3（`persistCanonicalCheckpoint`）、T4（第 2 条：导出＋注册都通过）；变异 T3-M8 |
| §13.2 C-6 | T3（续跑子支）、T5（第 3 条） |
| §13.2 I-1 | T4（外部段＋一个事务） |
| §13.2 I-2 | T4（`handoffRunIds`、`visitOrder`） |
| §13.2 I-3 | T4（`closeBlocked`）；§0.1 D-LANDED |
| §13.2 I-5 | T5（`withinGrant`）；§0.1 D-HASH |
| §13.2 I-6 | T6、T9；§0.1 D-TASKS |
| §13.2 I-7 | T1（`#continuation`）；§0 (11) |
| §13.2 I-8 | T7；§0.1 D-SKIP |
| §13.2 I-9 | T1 |
| §13.2 I-10 | T3 |
| §13.2 Minor a–h | a：T3；b：登记；c：T6（哈希后缀）；d：登记；e：T4（`terminalOutcome`）；f：T4（`complete` 也算投递成功）、T9；g：§0 现跑；h：T4 |
| §13.3 会红的既有判据 | §0 两节（现跑结果比 §13.3 多一条 `stopIntent`，少一条 ccloop） |

**2. 占位扫描**：python 逐行扫全文，模式 `TBD`／`TODO`／`待定`／`similar to Task`／`handle errors|edge cases`／`add appropriate`／`fill in`／`XXX`／行尾省略号：**零命中**（`@@` 的命中全部是 diff 的 hunk 头，不是占位）。尖括号的命中（`<runId>`、`<g>`、`<stateDir>` 等）全是路径／记法里的变量名，不是待填内容；`<implementer's own model>` 是指示实施席填自己的模型（与上一片计划同一写法）。扫描脚本与结果：`scratchpad/planner/selfreview.txt`。

**3. 类型／名字一致性**：逐名对过 brief（`scratchpad/planner/brief.md` 的 Interfaces 一节）与各 Task 的使用处：`settleCompletedRunRequestInTransaction`、`handoffRequestFromOutbox`、`persistCanonicalCheckpoint`、`readExistingResumeBundle`（T3 定义，T4／T5 使用）；`openRequestOf`、`handoffRunIds`、`visitOrder`、`stepH`、`restartRun`、`settleHandoffCheckpoint`、`collectInto`、`savedReport`、`HANDOFF_EXTRA_GRACE_MS`（T4 定义，T9 的装配用 `handoffGraceMsOf`）；`CrashPoint` 新四值（T4 定义，T5 用 `A2-after-bundle`，T9 的 R-H 五个崩溃点都在其中或是上一片的 `B-after-accept`）；`withinGrant`、`toStartEnvelope` 第五参数（T5）；`frozenAllocationShape`（T4 定义并在 `executionSnapshot.ts` 与 `controlViews.ts` 两处用）；`planReconciliationOf`／`synthesizeReconcileContractOf`／`otherTaskIds`（T6）；`skipped-driver-owned`（T7 在 `controlLifecycle.ts`、`webProtocol.ts`、`web/src/controlTypes.ts` 三处一致）；`continuable`（T8 服务端必填、web 可选，`webParity` 归一化补 `?? false`）；ccloop 侧 `enteredPhaseFiles`（T1）、`usageBeforeDelay`／`CodexPhaseAborted`／`observedTurnUsage`（T2）、`${marker}.tasks`（T1 产、T9 数）。判定器 `EXPECTED_*` 的条数与各 Task 写明的条数一致：Orca 7/14/5/5/4/8/4/1/12(＋1)、web 3、ccloop 5/6/(3/1)。**已知的不一致，交控制器**：T2 的两份判据文件名（`abortedUsage`、`handoffDeadlineUsage`）不在 brief 的清单里（门控 Task，判定器用 `--no-t2` 处理）；T6 的 `spawnSeq` 初值按 spec 写「行数」，写作席建议 MAX（§0.1 D-SPAWNKEY）。

