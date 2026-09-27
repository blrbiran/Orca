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
