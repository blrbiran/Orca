# claude 中止前观测用量（stream-json）—— 进度台账

唯一进度源。历史一个字不改，写错了另起一节更正（CLAUDE.md Rule 13）。
spec：`docs/superpowers/specs/2026-09-27-claude-stream-usage-design.md`。

## §1 brainstorming、两次付费形状探针、spec（控制器会话 `4d2e426e`，Claude Opus 5.5，2026-09-27；开工观测锚点＝Orca 主题行 `test(control): drive real claude through a 1M window and a two-task reconciliation in the live acceptance script`、ccloop 主题行 `docs(handoff): real claude also ran a 1M window and a two-task reconciliation once each`）

- Human（2026-09-27）：「都提交，ccmem 那行我已经自己改，然后继续下一个」⇒ 按 handoff §4.0 的顺序开 stream-json 逐条 usage；控制器判为 architectural。
- 现状由只读子代理整理（本会话对话里有全文）；要点见 spec §1。
- Human：「批准付费探针」。探针一（2026-09-27T05:55:58Z–05:56:18Z，`evidence/probe.mjs`）：`stream-json --verbose` 完整一次（claude 自报 $0.1670808）＋ SIGTERM 一次（退出 143、无 `result`，花费工具未给，上限 $2）。结论见 spec §2.1。
- 控制器给出 A／B／C；Human：「B」。探针二（2026-09-27T07:37:44Z–07:38:01Z，`evidence/probe-partial.mjs`，加 `--include-partial-messages`）：完整一次，claude 自报 $0.1670808。结论见 spec §2.2。
- 三次探针前后 `~/.claude/projects` 顶层条目相同；之后 `pgrep -fl "claude.exe -p"` RC 1。
- 本台账付费合计（工具报数相加，被杀那次未报）：$0.1670808＋$0.1670808＝$0.3341616。
- 设计第 1 段（用量怎么算）Human：「对，继续下一段」；第 2 段（判据、fake、变异）Human：「同意，继续」。
- **更正（控制器在对话里的说法）**：第 2 段说要人点名改写的既有判据「只有两条」，全树扫描得出四条，名单写在 spec §5.3。已在交 spec 时当面说明。
- spec 已写，自查四项（占位、内部一致、范围、歧义）已过。等人审 spec；审过才进 writing-plans。

## §2 人审 spec 时的自审与修订（控制器会话 `4d2e426e`，2026-09-27；接在 §1 之后）

- Human：`/superpowers:using-superpowers review @docs/superpowers/specs/2026-09-27-claude-stream-usage-design.md`。控制器逐条对代码与证据核对承重主张：
  - 成立：stream-json 的 `result.usage` 与 `json` 回包 usage 的键集合相同（各 11 个键；对照 `../2026-09-26-agent-selection/evidence/live-claude-2-raw-001.json`）⇒ 「正常阶段逐位不变」的前提成立。
  - 🔴 C1：runner 只收 `CCLOOP_CLAUDE_COMMAND`／`_EXTRA_ARGS` 与 stdin 请求，cwd 是 worktree（`src/runtime/claude/claudeAgentAdapter.ts` 的 `spawn(… { cwd: context.worktreePath … })`）⇒ spec 原文「写到证据目录」没有路径通道，照 cwd 写会进 worktree。
  - 🔴 C2：`--include-partial-messages` 下约 70.5 字节／输出 token（不加时约 26.0），`user` 事件回显工具结果；runner 今天整条累积 stdout（`scripts/claude-phase-runner.mjs` 的 `stdout += chunk`、`maxBuffer: 10 * 1024 * 1024`）⇒ 长 execute 在 stream 下可能撞上限。
  - 🟡 I1：handoff 请求的 deadline 经 `abortSignal` 走 `aborted`（`tests/control/handoffDeadlineUsage.test.ts` 的形状）；run 运行时预算／`timeoutMs` 走 adapter 的 `timeout`，本轮不覆盖（codex 同）。spec 原文的「deadline」有歧义。
  - ⚪ m1：工具报数为 `0.16708079999999997`（探针一完整那次）与 `0.1670808`（探针二），spec 与本台账 §1 都写成了 `0.1670808`。
- Human：「同意，继续」⇒ spec 就地改入（未发布，`ls-remote` 核过：spec 那一笔不在远端）：新增 `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH`、只保留 `result` 行＋观测＋滚动末 8,192 字符、`flood` 夹具模式、N9／N10、M9–M11，§1／§3.4 写明 deadline 的所指，§2 抄精确报数。
- **更正本台账 §1**：「$0.1670808＋$0.1670808＝$0.3341616」应为工具报数 `0.16708079999999997` 与 `0.1670808`；两者相加的值不作为新的报数，只列原数。
- 知情（Human 2026-09-27，会话中途）：「codex cli额度被reset了。现在可以跑codex」。本轮用不到真 codex；按执行规矩，真 codex 每一次仍要人单独点头。

## §3 SDD ledger — plan: docs/superpowers/plans/2026-09-27-claude-stream-usage.md（控制器会话 `4d2e426e`，2026-09-27；接在 §2 之后）

- Human（2026-09-27）：「/handoff 这个session中，尽量将这些要做的task完整做完，这个session暂时不要考虑context大小. 继续做 writing-plan。接着使用 subagent-driven 的方式完成相关功能。这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。…」
- 计划提交：Orca 主题行 `docs(plan): task-by-task implementation of the claude stream-usage spec`。检查点 `chore(checkpoint): orca-dev-4d2e426e, level 334495 …`（越过 T1 是人明示的）。
- 执行前扫描（共享文件／接口的每一对，与每个 Task 的自洽）：

| 对象 | 产出 ↔ 消费 | 结果 |
|---|---|---|
| T1↔T2 | fake 的 argv（`stream-json`、两个布尔参数）、固定 usage、marker 的 `observedUsagePathEnv` ↔ runner 判据 N1／N6／N7／N9a／N10 | 一致（15／1109） |
| T1↔T3 | `usage-then-hang`／`start-then-hang` ↔ adapter 判据 N2／N3／N4／N9b | 一致（1109／1103） |
| T2↔T3 | `CCLOOP_CLAUDE_OBSERVED_USAGE_PATH`、`observed-usage.json`、schema `ccloop-claude-observed-usage-v1` ↔ `readObservedTokens` | 一致；T2 改写 `claudeAgentAdapter.test.ts` 两条、T3 往同文件追加，顺序执行无冲突 |
| T1／T3↔T4 | `script` 模式 `usageBeforeDelay`（stream）＋ adapter ↔ control 判据 `[15, 1124]` | 一致（15＋1109） |
| T1–T3↔T5 | ccloop build ↔ Orca D1 | 需控制器建 ccloop clone 的 build |
| T1 | 判据 5 条 ↔ fake 实现 | 自洽 |
| T2 | 切行判据的四段 chunk ↔ `createLineSplitter` 实现；`messageTotal` ↔ 「0／负数／非数」判据 | 手推一致 |
| T3 | N9b 依赖 worktree 是 git 仓库 | 计划已给回退写法 |
| T4 | 复制既有判据只改指定处 | 自洽 |
| T5 | `handoffStop` 加可选参数 | 默认行为不变 |

- Ruling: 两仓直接在 `main` 上落本地提交，不建 worktree —— CLAUDE.md Rule 15 把删 worktree 列为需人单独授权，历轮都在 `main` 上提交 —— 错了的代价：提交已在 `main`，人要回退就 `git revert`。
- Ruling: 本台账（`progress.md`）即 SDD ledger，以本节为身份行；收尾**不删**本目录 —— Rule 13 规定 `.superpowers/sdd/**` 是证据链、一个字不改 —— 错了的代价：多留一个目录。
- Ruling: spec §5.3 点名的四条改写，视为人在「继续做 writing-plan…有问题先按你的建议执行」里认可了 spec（含该名单）—— 名单在 spec 里逐条写明、人随后让继续 —— 错了的代价：人不认可就回退那四处断言改动（Task 2 一笔里）。
- Ruling: spec §6 第 4 条付费验证本轮**不跑** —— handoff 执行规矩：付费 claude 每一次都要人重新开口，「按你的建议执行」不等于对一次具体付费调用点头 —— 错了的代价：少一次真 claude 证据，留给人决定。
- Ruling: 终审派一个评审员同时看两仓的 diff —— 本轮 Orca 只改一条判据，拆两席无收益 —— 错了的代价：终审漏看 Orca 那一处的概率略高。
- Task 1: 实施者停在既有判据 `tests/runtime/claude/fakeClaudeCli.test.ts > fake claude CLI (Orca agent selection, spec §4.8) > rejects an argument the phase runner never passes, so runner drift is loud` —— 它拿 `--verbose` 当「runner 永不传的参数」，本轮起 runner 就传它。spec §5.3 的全树扫描只找了 argv 位置／长度断言，漏了这一条。未提交。
- Ruling: 该判据改写为用 `--continue`（真 claude 有、runner 不传的参数）作例，其余一字不动 —— 保留它编码的意图（runner 漂移要响），只换掉本轮起不再成立的例子；人说「有问题先按你的建议执行」—— 错了的代价：人若要别的写法，回退这一处断言（Task 1 那一笔）。这是**第五条**点名改写，spec §5.3 另起更正。
- Task 1 评审：Spec ❌ 一条 Important —— `flood` 模式吐两次 `message_start`（计划 Step 3 给的代码 `emitStart()` 后又调 `emitClosedMessage()`）。Minor（deferred）：`observedUsagePathEnv` 只测了「未设」那一支（设了的那一支由 Task 2 N9a 覆盖）。
- Ruling: 该发现属计划本身的错（plan-mandated），按 spec §5.1「按 §2.2 的顺序吐」修：拆出 `emitMessageTail`，flood 只发一次 `message_start`，flood 判据加「恰好一个 `message_start`」—— 错了的代价：无（夹具更贴近真形状）。
- Task 1: fix round 1/5 (1 addressed, 0 open — flood 只发一次 message_start；commits ab58edd..df6c636)。deferred minor：`emitMessageTail` 注释只写了 flood 的动机。
- Task 1: complete (ccloop commits fe4f3ed..df6c636, review clean)
- Task 2: 实施者 BLOCKED（未提交）—— `tests/runtime/claude/subprocessClaudeAdapter.test.ts` 15/28 红：旧 `SubprocessClaudeAdapter` 也走同一个 runner，它的 claude 替身吐单行裸对象 `{structured_output, usage}`（没有 `type:"result"`），stream 版 runner 只认 `type:"result"`。spec §3.1(2) 的前提「`json` 回包就是一行 `type:"result"`」对真 claude 成立，对这些替身不成立。
- Ruling: runner 取回包的规则加一条窄兼容 —— 最后一条 `type:"result"` 的行；没有时取最后一个带 `structured_output` 键的 JSON 对象行 —— 不改 15 条既有判据，真 claude 的行为不变（真回包带 `type:"result"`）—— 错了的代价：runner 多认一种回包形状；真 claude 的流里只有 `result` 事件带 `structured_output`（spec §2），不会误认。另加一条只加判据钉住这条兼容。
- Task 2: 实施者 DONE —— ccloop 主题行 `feat(claude): read claude's stream line by line and keep the usage it streamed on disk`（6 个文件；`tests/runtime/claude` 9 文件／79 条全绿，含 `subprocessClaudeAdapter` 28 条；typecheck RC 0，实施者报数）。新增兼容判据一条（裸 `structured_output` 行被接受、`type:"result"` 行优先）。
- Task 2 评审（opus）：Spec ✅；四个命名风险（`spawn` 下的中止路径、失败文字逐字相同、切行与 UTF-8、观测只在有路径且 total 非空时写）都核过。Important 一条：N10 从没被看见红（它在改动前就绿，因为 fake 只在 stream 下 flood）。
- 控制器补跑 M11（clone `scratchpad/ccloop-m11`，内容＝上面那一笔；在 `runClaude` 里恢复整条累积并在超过 10 MiB 时杀进程并 reject）：`claudePhaseRunnerStream.test.ts` **只红 N10**（`1 failed | 5 passed (6)`，日志 `scratchpad/sdd/m11.log`）；`git checkout` 还原，`git diff`／`git diff --cached` 均 0 字节。
- Ruling: N10 那条 Important 由 M11 实测红闭合，不改代码 —— Rule 9 要的是「看见它红」，代码本身评审判为合规 —— 错了的代价：无。
- Task 2: minor (deferred): 观测文件的 `fields` 照抄 claude 的原始 usage 对象（含 `service_tier`、`server_tool_use`、嵌套 `cache_creation` 等），与 runner「白名单之外的 usage 字段从不复制」的注释口径不一致；spec §3.1(6) 没定义 `fields`。建议下一会话在 Task 3 之前或终审时收窄为白名单字段。
- Task 2: minor (deferred): 同内容的 `message_delta` 重复时仍重写一次观测文件；`createLineSplitter` 对未收尾长行每块都重算 `Buffer.byteLength`（正确但二次方）；`writeObservation` 在写与 rename 之间被 SIGKILL 会在证据目录留 `observed-usage.json.tmp-<pid>`；没有跨块多字节 UTF-8 的判据；`claudePhaseRunnerEnv` 一处改写注释位置在被改行之后。
- Task 2: complete (ccloop commits df6c636..d743172, review clean after M11)
- **人（2026-09-27）：`/mattpocock-skills:handoff task 2完成后先做交接…`** ⇒ 本会话到此停止派发；Task 3–6 未开始，由下一会话从 Task 3 接手（见 handoff）。
- **接手（控制器会话 `5b01dbd9`，Claude Opus 5.5，2026-09-27）**：开工 `ls-remote` 三仓远端 main 均等于本地 main（ccloop 主题行 `docs(handoff): replace the Orca section with a fourteenth version …`、Orca 主题行 `docs(handoff): hand the stream-usage round over at Task 3 …`、ccmem 主题行 `docs(handoff): real claude also ran a 1M window …`）；三仓工作树干净。Human：「同意，继续」（对控制器列出的 Task 3→6、终审、handoff 的做法）。task-3/4/5-brief 与计划原文逐字相同（`diff` 只差计划里的 Task 6，那是控制器自己做的）。
- Ruling: `constraints.md` 里的日志目录指向上一会话的 scratchpad；本会话每次派发附一句改用 `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5b01dbd9-b39e-4ad9-9580-d6041840e94b/scratchpad/sdd/`，`constraints.md` 原文不改 —— Rule 13（本目录历史不改）—— 错了的代价：无，日志只是过程文件。
- Ruling: 本 skill 要求收尾删掉 plan workspace；本轮**不删**（沿用上一会话同名裁定）—— 错了的代价：多留一个目录。
- Task 3: BASE ccloop `93bd3f5`（主题行 `docs(handoff): replace the Orca section with a fourteenth version …`）。
- Task 3: 实施者 BLOCKED（未提交）—— 5 条新判据全绿，但既有判据 `tests/runtime/claude/claudeAgentAdapter.test.ts > ClaudeAgentAdapter (Orca agent selection, spec §4.7) > keeps private per-call evidence and does not record the environment in request.json` 红：它用 `toEqual` 钉死证据目录恰好 6 个文件名，而 adapter 从此总设观测路径、runner 在正常跑完的阶段也会写 `observed-usage.json`。计划与 spec §5.3 的全树扫描都没扫到这种「证据目录清单」断言。
- Ruling: 该判据的文件名清单加 `observed-usage.json`（仍是精确 `toEqual`），其余一字不动 —— spec §3.1(6) 规定 runner 每次观测变化就写、写时并不知道阶段会不会被中止，所以正常阶段留下观测文件是 spec 的直接推论；改后的清单仍精确，且判据里既有的「每个文件 0600」循环从此也钉住观测文件的权限；另一条路（阶段正常结束时删观测文件）要加 spec 没有的代码并丢掉证据 —— 错了的代价：人若要「正常阶段不留观测文件」，回退这一处断言并在 adapter 里加删除（Task 3 那一笔）。这是**第六条**点名改写，spec §5.3 另起更正（spec 已发布，只追加）。
- Task 3: 实施者 DONE —— ccloop 主题行 `feat(claude): report the usage claude streamed before a phase was aborted`（2 个文件；`tests/runtime/claude` 9 文件／84 条全过，typecheck RC 0，实施者报数；并实测 fake `ok` 模式经 runner 确实写出 `observed-usage.json`，total 1109）。review 包 `review-task3.diff`（SDD 脚本的 review-package 在 Orca 仓里找不到 ccloop 的提交 ⇒ 控制器在 ccloop 里手工生成同样三段：log、stat、`diff -U10`）。
- Task 3 评审（opus）：Spec ✅、Approved，0 Critical／0 Important；两处命名风险（`ClaudePhaseAborted`／`observedTokens` 的其他消费点 —— 只有 `runLoop.ts` 的 `observedTokensOf`、与 codex 同路；环境变量不进 `request.json`）核过；评审员列了 8 条变异各自由哪条判据打红（控制器在 Task 6 实测 spec 的 M7／M8）。
- Task 3: minor (deferred): `outcome.json` 的 `observedUsagePath` 字段无判据钉（删掉全绿）。
- Task 3: minor (deferred): N2／N4 按「文件存在」轮询，若 `message_delta` 与 `message_start` 分两次到达 runner，中止可能落在两者之间而读到 1103（低概率 flake；可改为轮询到 `openMessage === false`）。
- Task 3: minor (deferred): `readObservedTokens` 的 docstring 与 `run()` 新 env 行没写 round 名／spec 节与「为什么给路径」。
- Task 3: minor (deferred): runner 在 write 与 rename 之间被 SIGKILL 会留 `observed-usage.json.tmp-<pid>`（与 Task 2 那条同一件事）。
- Task 3: complete (ccloop commits 93bd3f5..11eb860, review clean)
- Task 4: BASE ccloop `11eb860`。
- Task 4: 实施者 DONE —— ccloop 主题行 `test(control): book the usage a claude execute streamed before the handoff deadline cut it`（`agentsFixture.ts` 只加 `sealClaude`、新文件 `claudeHandoffDeadlineUsage.test.ts`；新判据 1 条过、codex 版 `handoffDeadlineUsage` 仍过、typecheck RC 0，实施者报数；用量实测正是 `[["work",15],["work",1124],["handoff",0]]`）。实施者的红证：把本判据脚本的 `usageBeforeDelay` 改 false ⇒ 红在等观测文件的 poll（不是用量断言本身；产品侧变异 M7／M8 由控制器在 Task 6 实测）。
- 归属记录：Task 3 那一笔的 trailer 写 `Claude Opus 5.5 (1M context)`（实施者实为 sonnet，照 constraints.md 抄的），Task 4 那一笔写 `Claude Sonnet 5`（实施者按其系统提示）。两笔都不改（只在本地，但 CLAUDE.md 偏好新提交而非 amend；trailer 不影响判据）。
- Task 4: BASE 11eb860，review 包 `review-task4.diff`。
- Task 4 评审（sonnet）：Spec ✅、Approved，0 Critical／0 Important；评审员用字面 `diff` 对照 codex 原判据，差异只有 brief 列的几处。
- Task 4: minor (deferred): 实施者的红证只打到「没有观测」那一支（红在 poll），没打到「观测存在但值错／为 null」那一支 ⇒ **Task 6 的 M7 必须对 `claudeHandoffDeadlineUsage.test.ts` 实跑、确认红在用量断言**。
- Task 4: complete (ccloop commits 11eb860..fee7f2a, review clean)
- Ruling: Task 5 Step 2 的「用本轮之前的 ccloop build 跑一次 D1 应红」改由控制器在 Task 6 做：在 Task 1–3 的 build 上只打 M7（adapter 读观测处写死 null）再跑 D1 —— 本轮之前的 clone（`fe4f3ed`）里的 fake claude 不认 stream-json／`usageBeforeDelay`，D1 在那上面红的原因会混进夹具，不能单独归因到产品 —— 错了的代价：无（变异更窄）。
- Task 5: BASE Orca `b76fa0f`；控制器给的 env：`ORCA_CCLOOP_BIN` ＝ scratchpad `ccloop-t3/dist/cli.js`（ccloop `11eb860` 的 clone build，含 Task 1–3），`ORCA_AGENTS_TABLE` ＝ scratchpad `fixture-table/agents.json`（fake codex `integration`、`9.9.9-fake`）。⚠️ `agentSelectionE2E` 整个 describe 是 `skipIf(!realBinary)` ⇒ 不设 `ORCA_CCLOOP_BIN` 时 D1 静默跳过，必须核「1 passed」而不是「0 failed」。
- Task 5: 实施者 DONE —— Orca 主题行 `test(control): continue a claude run cut at the handoff deadline, now that ccloop reports what claude streamed`（只追加 D1、`handoffStop` 加可选 payload）；`-t D1` ⇒ 1 passed／5 skipped（不是整文件跳过）；整文件 6 passed、248.83 s；typecheck RC 0（实施者报数；env 为控制器给的 `ccloop-t3` build 与夹具表，HOME＋四个 XDG 根改道）。review 包 `review-task5.diff`。
- Task 5 评审（sonnet）：Spec ✅、Approved，0 Critical／0 Important／0 Minor；`handoffStop` 既有三处调用都不带第二参、行为不变；评审员沿 `recordUsage`／`collectInto` 追了 D1 的用量断言在 M7／M8 下各在哪一层红（预言，Task 6 实测）。
- Task 5: complete (Orca commits b76fa0f..d8f3046, review clean)
- Task 6: 开始（控制器自己做）。变异副本 scratchpad `ccloop-mut`（ccloop `fee7f2a`，`npm run build` RC 0），脚本 scratchpad `mutations.py`（逐条整串锚点、命中数必须为 1；跑 `tests/runtime/claude` ＋ `tests/control/claudeHandoffDeadlineUsage.test.ts` 的 json 报告；`git checkout -- <file>` 还原并量 `git diff`／`git diff --cached` 字节数；HOME＋四个 XDG 根改道到输出目录）。
- Task 6 变异实测（控制器会话 `5b01dbd9`；副本 `ccloop-mut` ＝ ccloop `fee7f2a`；命令 `python3 scratchpad/mutations.py <clone> <out>`，每条跑 `tests/runtime/claude` ＋ `tests/control/claudeHandoffDeadlineUsage.test.ts` 的 json 报告，原始报告 `scratchpad/mut/M*.json`、汇总 `summary.json`）。N 编号：N1／N6／N7／N9a／N10 在 `claudePhaseRunnerStream.test.ts`，N5 在 `claudeStream.test.ts`，N2／N3／N4／N5b／N9b 在 `claudeAgentAdapter.test.ts`，N8 ＝ `claudeHandoffDeadlineUsage.test.ts`。每条还原后 `git diff`／`git diff --cached` 都是 **0 字节**；跑完后副本里的 `tests/runtime/claude`、两个 control 判据文件、`scripts/`、`src/runtime/claude` 与 ccloop 主树逐字节相同（`diff -r`）；副本 `git status --short` 只有 `?? node_modules`（软链）。

| | 预言红 | 实测红（全名见 summary.json） | 对上 |
|---|---|---|---|
| M0 基线 | — | 0 红，85 过 | — |
| M1 不写观测 | N2 N3 N4 N6 N8 N9 O1 | N2 N3 N4 N6 N8 N9b ＋ 证据清单判据（第六条改写那条）；N9a 不红（它测的是「无路径时不写」，与本变异同向） | 是（O1 另跑） |
| M2 收尾用 start 值 | N2 | N2 N4 N6 N8 ＋ `counts each message once` | 是 |
| M3 不按 id 去重 | N2 | N2 N4 N6 N8 ＋ `counts each message once` | 是 |
| M4 总数 0 也写 | N5 | `gives no total for nothing, for zero …`（N5）＋ `ignores a message_delta with no open message …` | 是 |
| M5 只在退出时写 | N6 | N2 N3 N4 N6 N8 N9b | 是 |
| M6 回到 json | N7（N1 可能） | N7 ＋ 12 条（含 argv 改写的四条、N2–N4、N6、N8、N9b）；N1 不红 | 是 |
| M7 adapter 写死 null | N2 N3 N4 N8 O1 | N2 N3 N4 N8 —— **N8 红在 `claudeHandoffDeadlineUsage.test.ts:74` 的用量 `toEqual`**（闭合 Task 4 那条 deferred） | 是（O1 另跑） |
| M8 中止 execute 有观测也回 null | N4 | N4 N8 ＋ `SubprocessClaudeAdapter > waits for close before interrupting a close-pending successful execute`（**已知红名单第 51 行那条 flake**，本变异不碰 `SubprocessClaudeAdapter`） | 是 |
| M9 runner 不剥路径变量 | N9 | N9a | 是 |
| M10 写到 worktree | N9 | N2 N3 N4 N6 N8 N9b ＋ 证据清单判据 | 是 |
| M11 整条累积＋10 MiB 上限 | N10 | N10（与上一会话在 `d743172` 上的实测一致） | 是 |
- Task 6 O1 实测：副本 `ccloop-m1`／`ccloop-m7`（ccloop `fee7f2a` ＋ 各一处变异，`git diff --stat` 各 1 行，build RC 0）作 `ORCA_CCLOOP_BIN`，Orca 主树只跑 `tests/control/agentSelectionE2E.test.ts -t D1`（HOME＋四个 XDG 根改道）：两次都 `1 failed | 5 skipped`，红在 `agentSelectionE2E.test.ts:324` —— `expected 'settled-unrecoverable' to be 'settled-recoverable'`（日志 `scratchpad/sdd/o1-m1.log`、`o1-m7.log`）。⇒ 这就是 Task 5 Step 2「本轮之前的行为应红」的窄化形态（控制器裁定见上）。
- Task 6 ccloop 全量门（副本 `ccloop-mut` ＝ ccloop `fee7f2a`，未变异；`cd` 进副本；`ECC_GATEGUARD=off DISABLE_OMC=1`，HOME＋四个 XDG 根改道到 `scratchpad/ccloop-full-home`）：`npm run typecheck` RC 0；`npm run build` RC 0；`vitest run --reporter=json` RC 1 ⇒ **88 文件／1027 条，1024 过、3 红、0 pending**，json 里 88 个文件路径全在副本下；`node scripts/check-known-reds.mjs` **RC 0**（名单 14、failed 3、unexpected 0）：`stopProof`（稳定红）、`codexWatchdog` 的 `still reaps registered groups when the observation file becomes unwritable`、`run-scenario CLI > records env names only …`（后两条是名单内的负载型 flake）。改道 HOME 下只有 `.npm/`（`_logs` 与 `_update-notifier-last-checked`）。日志 `scratchpad/sdd/ccloop-full.*`。跑前 `pgrep -fl "ccloop-agents-version|worker.js|fake-claude-cli|fake-codex"` RC 1（无进程）。
- 终审（opus，一席看两仓，包 `review-final.diff`）：**Needs fixes**，0 Critical。Important：①N6（`claudePhaseRunnerStream.test.ts:77–81`）有竞态、评审员在一次与 N6 无关的变异下**亲眼见它红**（fake 把 `message_start` 与消息尾分两次 `write`，N6 只等文件存在就 SIGKILL，delta 可能来不及处理）；N2／N4（`claudeAgentAdapter.test.ts`，即 Task 3 那条 deferred）与 N8（`claudeHandoffDeadlineUsage.test.ts:59`）同形、较少暴露；②Orca 全量门未入账。Minor：spec §3.1(3) 没为回包兼容裁定追加更正；无法解析回包的报错文字变了（路径不变）；`message_delta` 配对不看 `parent_tool_use_id`（未测量，登记为已知局限）；`claudeStream.test.ts:45` 的单行上限两支各自删掉都不红。评审员自跑 11 条变异（`scratchpad/review-muts.py`、`sdd/review-mut/`，还原后 0 字节）：RA／RC／RF／RG／RH／RK 见红；**RB1、RB2（上限两支）、RD（`setEncoding`）、RE（写观测的 catch）、RI（`total !== null` 守卫）、RJ（`outcome.json.observedUsagePath`）不红**。评审员对本轮全部 `Ruling:` 判 sound（四条 §5.3 改写的认可「成立但薄」，建议终审时把六条当面列给人）。
- 🔴 **作废：会话中的第一次 Orca 全量（`scratchpad/sdd/orca-full.*`，19:22 起跑）** —— 它的 `ORCA_CCLOOP_BIN` 指 `ccloop-mut`，而终审员 19:27–19:29 在同一副本里改过 `scripts/claude-phase-runner.mjs`（runner 由 adapter 从副本的 `scripts/` 现读），且加了并发负载。该次结果不作为证据；修复后在新副本上重跑两仓全量门。该进程不杀（杀进程要人授权），让它自己跑完。教训：**被别的门当作 `ORCA_CCLOOP_BIN` 的副本，不许同时拿来做变异。**
- Ruling: 终审 Important ① 修：N6、N2、N4、N8 四处的等待条件由「观测文件存在」改为「解析后 `openMessage === false`」，断言本身一字不动；N3 本来就要开口快照，保持等文件存在 —— 等待条件只是让测试等到 fake 已吐完的状态，判据更严不更松；N6 所在的 Task 2 那一笔**已在远端**（`git merge-base --is-ancestor` 现测），所以 N6 这一处是本轮第**七**条点名改写，spec §5.3 另起更正；N2／N4／N8 属未发布的本轮新判据 —— 错了的代价：回退这四处等待条件（一笔提交）。
- Ruling: 终审 Minor「上限两支各自不红」修（只加判据，`claudeStream.test.ts` 追加一条，分别打 `:91` 与 `:97` 两支）；RD／RE／RI／RJ、`parent_tool_use_id` 配对、报错文字变化登记为挂账不修 —— RD 要改 fake 的输出方式（夹具被多条既有判据共用），RE 的行为 spec 没定义，RI 删掉无害（adapter 拒收 null），RJ 无读者 —— 错了的代价：这四处分支仍无红证，留给人决定。
- Ruling: spec §3.1(3) 的回包兼容更正由控制器在收尾追加（spec 已发布，只追加）—— 错了的代价：无。
- 作废那次 Orca 全量的结果（**只作线索，不作证据**）：web build／typecheck／web tsc RC 0；根 vitest 220 文件／2004 条、2001 过、3 红、0 pending；web vitest 21 文件／113 条全过；真 `~/.orca` 三个条目前后 `stat` 相同。红：`driverLanding.test.ts` X1、`controlShutdown.test.ts`（两条都是 handoff 登记的负载型 flake）、**`tests/chain/gateCheck.test.ts` K13（`without CLAUDE_CONFIG_DIR the user-level settings are $HOME/.claude/settings.json …`）——不在任何名单里，待干净重跑时单文件判别**。
- K13 判别：作废那次全量里它是 `Test timed out in 5000ms`；在同一副本 `orca-full`（Orca `d8f3046`）单跑 `tests/chain/gateCheck.test.ts` 连 3 次（HOME＋四个 XDG 根改道）都 RC 0、19/19 过、K13 355 ms（日志 `scratchpad/sdd/k13-{1,2,3}.log`）⇒ **新登记的负载型 flake**（与本轮改动无关：本轮 Orca 只加了 D1）。
- 终审修复 DONE —— ccloop 主题行 `test(claude): wait for the fake's message to close before aborting, and pin each branch of the line cap`（4 文件；实施者报数：主树 `tests/runtime/claude` ＋ `claudeHandoffDeadlineUsage` 连 3 次各 86/86、typecheck RC 0；副本 `scratchpad/fix/ccloop-fixmut` 里：删上限 A 支 ⇒ 新判据红；B 支**整支删掉是等价变异**（任何以换行收尾的输入都被 A 支的长度检查遮住，B 支的可观测作用只剩内存上界），只去掉 `dropping = true` ⇒ 新判据红；runner 不写观测 ⇒ N6 N2 N4 N8 全红；每次还原 0 字节）。报告 `final-fix-report.md`，复审包 `review-final-fix.diff`。
- 干净重跑的两仓门（**取代作废那一次**）：副本 `scratchpad/ccloop-gate`（ccloop 主题行同上那一笔）与 `scratchpad/orca-gate`（Orca 主题行 `test(control): continue a claude run cut at the handoff deadline …` 那一笔）都是新 clone，门跑期间**没有任何一席在它们里面做变异**。
  - ccloop（`cd` 进副本，`ECC_GATEGUARD=off DISABLE_OMC=1`，HOME＋四个 XDG 根改道）：typecheck RC 0；build RC 0；vitest json **88 文件／1028 条，1025 过、3 红、0 pending**，路径全在副本下；`check-known-reds` **RC 0**（名单 14、failed 3、unexpected 0：`stopProof`、`codexWatchdog … unwritable`、`run-scenario CLI > records claudeChildExited as NOT_OBSERVABLE …`）；改道 HOME 下只有 `.npm/`；副本 `git status` 只有 `?? node_modules`。日志 `scratchpad/sdd/gate2/ccloop-*`。
- 终审修复复审（sonnet）：F1、F2 都 ADDRESSED，修复 diff 没有新问题；等价变异论证经复审员手工追 `createLineSplitter` 核实。
- 终审收口：Critical 0；Important 两条 —— 竞态已修；Orca 全量门见下一行。Minor 的处置见上面的裁定与 spec §8。spec 追加 §8「实施期更正」（原文不动）。
  - Orca（`orca-gate`，`ORCA_CCLOOP_BIN` ＝ `ccloop-gate/dist/cli.js`，夹具表 fake codex `integration`，HOME＋四个 XDG 根改道）：web build RC 0；typecheck RC 0；根 vitest json **220 文件／2004 条，2003 过、1 红、0 pending、0 todo**；web tsc RC 0；web vitest **21 文件／113 条全过**；D1 过；真 `~/.orca` 三个条目前后 `stat` 相同；改道 HOME 下只有 `.npm/`；副本 `git status` 只有两个 `node_modules` 软链。日志 `scratchpad/sdd/gate2/orca-*`。
  - 唯一的红：`tests/control/driverRecovery.test.ts > … > drives a retried run on from where it was blocked, to settled`（`Test timed out in 5000ms`），handoff §三已把它登记为 ④ 轮的负载型 flake。**判别过程（systematic-debugging）**：
    - 同一副本、同一命令单文件先连跑 3 次，**3/3 红**，都是 5.0 s 超时；所以一开始不能按「单跑绿就不是回归」放过。
    - 这条判据用的是假 port，不读 `ORCA_CCLOOP_BIN`／`ORCA_AGENTS_TABLE`／HOME；本轮 Orca 只在另一个文件里加了 D1。
    - 放宽超时后，主树、副本不带 env、副本只改 HOME、副本只设 ORCA 变量，四种都在 1.8–2.0 s 内过。整文件放宽超时 8/8 过，该条 1840 ms。
    - 随后用**与最初完全相同的命令**又跑 3 次，**3/3 过**，该条 1778／1914／2283 ms；那时 load average 在 21–24，而最初连红时约为 37（20:01 的 `uptime`）。
    - 高负载主要来自本会话以外：WindowServer、Chrome、cmux，还有一个不是本会话起的 `node (vitest 6)`，已跑 7 分钟、没动它。
    ⇒ 定为负载依赖的超时，与本轮改动无关。**但它在高负载下能连红 3 次，「单跑一次绿就放过」对它不够用；应在负载降下来之后再重跑，并记下 `uptime`。**
- 收尾 `pgrep -fl "ccloop-agents-version|worker.js|fake-claude-cli|fake-codex"` RC 1（没有孤儿进程）。
- Task 6: complete（变异表、两仓干净门、终审与修复、复审都已入账）。
- 收尾：spec 追加 §8「实施期更正」；三份 handoff 滚动更新（Orca §三／§4.0，ccloop「Orca 那条线」第十五版，ccmem §15 第十三版）。本会话**没有付费调用**、没杀任何进程、没 push。scratchpad 里的 clone（`ccloop-pre`／`-t3`／`-mut`／`-m1`／`-m7`／`-gate`、`orca-full`／`-gate`、`fix/ccloop-fixmut`）是本会话自己的临时副本，没删（删要人开口；它们不是仓库的 worktree）。
- Human（2026-09-27，会话 `5b01dbd9` 收尾报审之后）：「认可改写判据。允许付费验证。推送都是我来做，你不要做」⇒ spec §5.3＋§8.2 的七条点名改写由人认可；spec §6.4 付费验证（真 claude，deadline 中止 → 续跑落地，n＝1）由人授权**一次**；推送归人，控制器不 push。（台账里其余 `Ruling:` 人未逐条表态。）
- Task 7（人授权付费验证后，控制器会话 `5b01dbd9`）：验收脚本加 `--scenario deadline`，并把 tee 保存的 stream-json 解析改为取最后一条 `type:"result"` 行（Orca 主题行 `test(control): a live deadline scenario for claude, and read the stream-json envelope the tee now keeps`）。实施者（opus）报数：fake deadline RC 0；在「adapter 写死 null」的 build 上 RC 1，红在 `requestRecoverable`／`observedUsageBooked`；fake single RC 0；typecheck RC 0。实施者偏离 brief 两处，评审（sonnet，「Safe to run once」）判为必要、不削弱检查：①deadline 场景的 `--task-attempts` 默认 2；②被停的 run 不发布，`published` 对它只查 `publishError`。评审提醒：美元统计不被任何 check 卡住，要人工看；`executeWasCut` 没被单独打红过。另登记：`--scenario conflict` 用默认额度会在 proposal-edit 报 `group-budget-unavailable`（本笔之前就如此，未修）。
- **付费验证（spec §6.4，人授权一次，n＝1）**：2026-09-27T12:42:10Z–12:43:20Z，`tsx scripts/live-driver-acceptance.ts --ccloop-bin scratchpad/ccloop-gate/dist/cli.js --output scratchpad/live-deadline --claude <nvm claude 2.1.283> --model claude-opus-5-5 --scenario deadline`，脚本 RC 1。`summary.json` 在 `scratchpad/live-deadline/`。
  - ✅ **成立**：`executeWasCut`（execute 的 `outcome.json` 为 `aborted`）；`observedUsageBooked`（中止前观测 40,176 token 记为已知用量）；`requestRecoverable`（`settled-recoverable`）；`unknownWorkFalse`；`ledgerKnown`；`ledgerMatchesCcloop`（188,578 ＝ 188,578）；`orcaHomeUntouched`；`claudeProjectsUntouched`（顶层 24 项，前后相同）；`claudeArgvModel`（4 次都是 `claude-opus-5-5`）；`shutdownClean`。收尾 `pgrep -fl "claude.exe -p"` RC 1。
  - ❌ **续跑没有落地**：续跑 run 在 execute 后 `loop_exhausted`（"runtime or token budget exhausted"），状态 `blocked`／`terminal:exhausted`，没有 verify。原因已核：续跑 contract 的 `tokenBudget` 是 **90,477**（任务额度 150,000 减去前任已用），续跑的 plan 19,347 ＋ execute 109,588 ＝ 128,935，超了。这是脚本默认 `--task-tokens 150000` 太紧，不是本轮代码的缺陷。连带失败的检查：`runSettled`、`workDone`、`cleanedUp`、`landedBytes`、`onlyTargetChanged`、`published`、`providerCalls`。
  - **花费（claude 自报，逐次原样）**：`0.15783999999999998`、`0.0273526`、`0.1074448`（三次完成的调用，合计 `claudeReportedUsd` 0.2926374）；另有**被中止的 execute 一次，花费拿不到**（`claudeCallsWithoutCost` 1）。
  - ⇒ **能说的只有**：真 claude 下，被 handoff deadline 中止的 execute 报出了观测到的用量，run 可续、组用量已知（n＝1）。**续跑落地在真 claude 下没跑成**；要证明它，得加大 `--task-tokens` 再付费跑一次，这需要人重新点头。
