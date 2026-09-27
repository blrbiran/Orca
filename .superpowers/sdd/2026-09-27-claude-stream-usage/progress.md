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
