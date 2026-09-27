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
