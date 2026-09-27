# ⑤ 预算预估链（single-call estimate）—— 进度台账

- 控制器会话 `f341f05f`（Claude Opus 5.5），2026-09-27 起。
- spec：`docs/superpowers/specs/2026-09-27-single-call-estimate-design.md`；计划：`docs/superpowers/plans/2026-09-27-single-call-estimate.md`。
- 本台账只追加；写错了另起一节记更正（Rule 13）。`Ruling:` 行＝控制器替人做的决定，人最后统一审。

## §1 人裁（原话）

- S1–S7 见 spec §2（逐字）。
- S8（2026-09-27）：「这个session中，尽量将这些要做的task完整做完，这个session暂时不要考虑context大小。做完 writing-plan后，接着使用 subagent-driven 的方式完成相关功能。这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」
  - 含义：计划不停下等审；执行方式 subagent-driven；问题先按控制器建议做、记 `Ruling:`、最后统一报人；Rule 6 的会话上下文额度本会话由人放开（越线须在检查点记下，不是静默越线）。
  - 未放开的：push、合并进 main 以外的分支操作、删分支／worktree、付费 claude、真 codex、删用户数据、杀进程——仍各要人单独点头。

## §2 Task 0

### 2.1 第 1 项：输出上限与关工具（静态，2026-09-27，未调模型）

命令（输出整份在 `evidence/`）：`claude --version`、`claude --help`、`codex --version`、`codex exec --help`；另对两个二进制跑 `strings` 后用 python 查 `CLAUDE_CODE_MAX_OUTPUT_TOKENS`／`max_output_tokens` 的上下文（strings 输出未入库，体积大）。

- claude 2.1.283：`--tools <tools...>` 帮助原文「Use "" to disable all tools」；输出上限无 CLI 参数，包内有 `_Le("CLAUDE_CODE_MAX_OUTPUT_TOKENS",process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,n.default,n.upperLimit).effective`，并在 `max_tokens` 处使用 ⇒ 用环境变量设。**只是静态证据，真 CLI 行为未验**（验要付费，归人）。
- codex-cli 0.155.1：`codex exec --help` 无模型输出上限参数；二进制字符串里 `model_max_output_tokens` 0 次命中，`max_output_tokens` 17 次，看过的都属 exec 工具的 pragma（`yield_time_ms`／`max_output_tokens`），与模型输出无关。
- Ruling：claude 答 `singleCallExecution: "v1"`（`--tools ""` ＋ `CLAUDE_CODE_MAX_OUTPUT_TOKENS`）；codex 答 `null`，codex adapter 不加 `singleCall`。
