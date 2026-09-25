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
