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

## §3 SDD 执行（控制器会话 f341f05f，2026-09-28 起）

SDD ledger — plan: docs/superpowers/plans/2026-09-27-single-call-estimate.md
（本台账首行不是 SDD 模板的身份行：首行已提交，Rule 13 不改历史，身份行放在本节。）

- Ruling: 两仓直接在 `main` 上落本地提交，不建 worktree — 计划 Global Constraints 与历轮做法如此，`git worktree list` 现测 main 上没有别的 agent 在干活（UI 线已并入 main）— 若错：要人把这批提交挪到分支上，提交本身不丢。
- Ruling: 实施席 Sonnet（完整代码转录＋多文件改写）；T5／O3／O4 实施用 Opus（跨文件、状态机）；任务评审 Sonnet，T5／O3／O4 评审 Opus；终审 Opus — 计划各 Task 都给了完整代码 — 若错：多几轮修复。
- Ruling: 起草席发现（计划 Part A／B 开头两张表）全部照起草席的选择执行，另有控制器裁定：ccloop 发现 1（S6 与 ccloop Rule 15(a)）⇒ 名单先入台账再改、最后报人；F10 ⇒ 只比 prompt 哈希；fake `delayMs` 取 `{ "single-call": n }` — 若错：S6 名单那批改写要人事后逐条认可或回退。

### §3.1 预检扫描（任务对之间共享的文件／接口）

| 对 | 产出 → 消费 | 结果 |
|---|---|---|
| T1 → T5 | T1 在 worker 放临时守卫 `control-work-kind-unsupported`；T5 用分叉替换 | 一致（T5 Files 列了 worker.ts） |
| T1 → T2／T4／T5 | `LoopStartEnvelope`／`SingleCallStartEnvelope`／`isLoopEnvelope`／`SingleCallWork` | 名字一致 |
| T2 → T5 | accept 闸 `single-call-unsupported`；descriptor `singleCallExecution(config)` | 一致 |
| T3 → T4／T5 | fake：`--tools ""` 判 single-call；脚本键 `"single-call"`；`delayMs: {"single-call": n}`；marker `maxOutputTokensEnv` | 一致 |
| T4 → T5 | `RuntimeAdapter.singleCall?(SingleCallRequest)`；中止抛带 `observedTokens` 的错；`single-call-output-invalid` | 一致 |
| T5 → O3 | call record 字段（`promptSha256`、`responseSchemaSha256`、`outcome`、`outputRef{artifactId,hash}`、`errorCode`）；零 handoff event | Orca `singleCallRecordSchema` strict 与 ccloop `SingleCallRecordV1` 字段逐一对上 |
| T2 → O1 | 解析应答顶层 `singleCallExecution` | 一致 |
| T3 → O4／O5／O7 | fake 脚本条目形状 | 已对齐 `delayMs`（控制器改 Orca 侧三处） |
| O1 → O2 | `AgentResolution.singleCallExecution`；`frozenSlotOf`；`observation.resolution` | 一致 |
| O2 → O3 | `buildEstimatePrompt`、`BUDGET_ESTIMATE_JSON_SCHEMA`、`classifyEstimateOutput`、`completeEstimateInStore` | 一致 |
| O3 → O4 | `isEstimateRun`；`drive.workspacePath === null`；`stepCEstimate` | 一致 |
| O3／O4 → O5 | `ccloopWorld` 新选项 `declaredContextWindowTokens`、`SingleCallScriptEntry` | 一致 |
| O5 → O6 | E1 里「应用一条建议」走服务端 `proposal-edit`，不经 web | 不冲突 |
| 每个 Task 自洽 | 判据引用的函数都在本 Task 或更早的 Produces 里 | 未见自相矛盾；跨仓 E2E 依赖 Part A 全落地（F16） |

### §3.2 Task 1 Step 0：S6 名单（ccloop，控制器 2026-09-28 记入，改写之前）

依据：人裁 S6「这个session 中如果有需要的话，我授权你改。」＋ S8「这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」ccloop Rule 15(a) 要的逐条指名由下表承担，**人最后统一审**。表外判据一条不改。

**S6 名单**（都是「只改 envelope 字面量」；每个文件动的是它的 fixture 或 envelope 字面量，所以**读这个 fixture 的每条判据都算在内**）：

| 文件 | 改动点（行号 measured 2026-09-27, re-measure before use） | 受影响的判据 |
|---|---|---|
| `tests/control/protocol.test.ts` | `fixture()` 19–97 行；**另外整条改写**判据 `names unsupported protocol versions separately from invalid requests`（129–143 行） | 文件里全部 8 条：`round-trips the strict payload for every method`、`names unsupported protocol versions separately from invalid requests`、`rejects unsafe integers, malformed identities, and malformed hashes`、`requires a canonical absolute sourceDir with no symlink ancestor`、`keeps an input bundle inside the canonical source input directory`、`canonicalizes object keys recursively while preserving array order`（不读 fixture，不受影响）、`derives the control root from the accepted source directory`、`requires a full agent selection on the claim and at most a partial one on capabilities` |
| `tests/control/accept.test.ts` | `fixture()` 77–96 行 | `durable control acceptance` 下全部 7 条 |
| `tests/control/workerLaunch.test.ts` | `fixture()` 26–32 行 | `does not accept a recycled live PID with a mismatched UTC start identity` |
| `tests/control/collect.test.ts` | `fixture()` 32–38 行 | `filters afterSeq without renumbering`、`rechecks the content hash on every read`、`rejects traversal, symlink, FIFO, and evidence over 16 MiB` |
| `tests/control/handoff.test.ts` | `fixture()` 70–76 行；判据内字面量 195–201 行 | `named handoff request` 与 `mechanical handoff packet` 下全部 7 条（其中 `watches a latched deadline through packet, zero handoff usage, seal, and released lease` 用的是它自己的字面量） |
| `tests/control/handoffEnteredPhases.test.ts` | `fixture()` 44–50 行 | 两个 describe 下全部 7 条 |
| `tests/control/phasesCompleted.test.ts` | 159–165 行 | `writes one count per phase a registering adapter completed, and the run still proves isolation` |
| `tests/control/handoffDeadlineUsage.test.ts` | 36–42 行 | `books the observed tokens as a known cumulative and still hands off a partial candidate that answers its request` |
| `tests/control/claudeHandoffDeadlineUsage.test.ts` | 35–41 行 | 同名的那一条（claude 版） |
| `tests/control/claudeEndToEnd.test.ts` | 66–76 行 | `carries the claimed selection to the claude CLI's argv and still proves the run stopped`（跑的是 build，只在门上跑） |
| `tests/control/endToEnd.test.ts` | 29 行（单行字面量） | `control protocol through the built CLI` 下全部判据（跑的是 build，只在门上跑） |
| `tests/control/resultRepository.test.ts` | 44–47 行（`as unknown as` 强转） | `C2 reads its own run's attempt ref, not the shared path-derived one a later run overwrote`、`C1 shares the object store by hard links instead of copying it` |
| `tests/control/agentsFixture.ts`（helper `startEnvelope`） | 96–115 行 | `agentsControl.test.ts` 里用到它的判据：`acceptFixture()` 的全部使用者（`seals the materialized agent config whose canonical hash the claim carries`、`refuses a claim whose selection changed after its configHash was taken, before any worker`、`accepts a claim frozen before the CLI was upgraded, once the table records the new version`、`accepts a claim frozen before the CLI moved or its run limits changed, under the table as it is now`、`refuses a CLI whose --version drifted from the table, before anything is persisted`、`fails without a code and without persisting anything`、`reads the table only for capabilities and accept: a table broken after accept blocks neither inspect nor collect`、`keeps inspect and collect working after the table is deleted, while capabilities still refuses it`），外加 `refuses a sealed config whose schema or kind does not hold, or that is not JSON, before any phase`、`registers the claude phase's process group in processes.json, and that record proves nothing while the group lives` |
