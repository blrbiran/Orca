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

### §3.3 Task 1 完成（ccloop）

- 提交（ccloop main，本地）：`feat(control): carry loop or single-call work in a protocol-3 start envelope`（06b6453，BASE 8d4d406）。
- 实施席自报：RED 12 failed／2 passed（改回 protocol.ts、判据已改写）；GREEN 14 文件／94 条全过、0 skipped；`npm run typecheck` rc=0；brief 的 6 条变异在 `git clone --local` 副本里各自打红预言的判据后还原。报告全文：`task-1-report.md`（本目录，未入库过程文件）。
- S6 实际改写：与 §3.2 名单逐文件一致（评审逐文件核过；`StartEnvelopeV2` 全树零命中；唯一残留 `protocol: 2,` 在 `tests/control/command.test.ts:102`，是已退役的 capabilities 应答字面量，不在名单内、未改）。
- Ruling: 评审的 Important「Step 6 台账未写」— 该步由控制器在派发时明确保留（台账在 Orca 仓、实施席只在 ccloop 仓写），控制器在本节补写 — 若错：无代码后果。
- Task 1: minor (deferred): brief 的变异清单没覆盖 `loopWorkSchema` 的 `kind: z.literal("loop")` 与 single-call `sourceDir` 规范化两支（终审时看要不要补变异）。
- Task 1: complete (commits 8d4d406..06b6453, review clean after controller ruling on the ledger step)

### §3.4 Task 2 完成（ccloop）

- 提交：`feat(control): answer whether an agent can run a single call, and refuse single-call work for one that cannot`（d85776b，BASE 06b6453）。没有改既有判据（未用 S6）。
- 实施席自报：RED 时 C1、C3 如预言红；GREEN 10 文件／114 条全过；typecheck rc=0；4 条变异在副本里都打红了预言的判据。评审直接读过 `$SCRATCH` 里的 red／green／tsc／mut1 原始输出，与报告一致。
- Task 2: complete (commits 06b6453..d85776b, review clean)

### §3.5 Task 3 完成（ccloop）

- 提交：`test(claude): let the fake claude CLI answer one tool-less structured call`（05fd82f，BASE d85776b）。没有用 S6。
- 实施席自报：`fakeClaudeCli.test.ts` 16/16 通过（RED 时新增的 4 条红，既有 12 条保持绿）；typecheck 干净；4 条变异都打红了预言的判据。F3 在 RED 时红成 5000ms 超时，而不是预言的「unknown argument --tools」文字。根因相同（fake 在吐流之前就退出了），只是红的表现形式不同。
- Task 3: minor (deferred): 两条路径没有判据覆盖：`mode: "ok"` 下 single-call 的默认回答；single-call 找不到脚本条目时的 exit 3。
- Task 3: complete (commits d85776b..05fd82f, review clean)

### §3.6 Task 4 完成（ccloop）

- 提交：`feat(claude): run one tool-less structured call with an output cap through the phase runner`（731f450，BASE 05fd82f）。
- 实施席自报：`tests/runtime/claude` 10 文件／96 条全过；typecheck rc=0；8 条变异里 7 条打红了预言的判据。实施席没有在实现前先看红，而是改用变异逐条证明每条判据都能红；评审判定这份替代证据够用。
- 变异 6（runner 里 `valid` 恒 true）没打红：adapter 会再做一遍同样的结构检查，把它盖住了。runner 那一行因此不承重；adapter 条件里的 `outputError !== null` 一支也被 `output === null` 完全吸收。
- Ruling: 提交归属行写的是实施席自己的模型（Sonnet 5），不是 brief 里写的 Opus 5.5 — 与 Orca handoff §九历轮裁定一致：作者确实是它，写成 Opus 才是假话；不 amend — 若错：人决定是否改写这批提交的元数据。
- Task 4: minor (deferred): runner 与 adapter 的输出有效性检查重复，runner 那一支不承重（变异 6 活着）。
- Task 4: minor (deferred): adapter 的 `phase()` 与 `singleCall()` 处理 outcome 的代码几乎逐字重复（brief 原样指定）。
- Task 4: complete (commits 05fd82f..731f450, review clean)

### §3.7 Task 5 完成（ccloop）——Part A 全部落地

- 提交：`feat(control): run single-call work in the worker without touching git, and settle it like any run`（0bd781f，BASE 731f450）。没有用 S6。
- 实施席自报：先看到红（W1／W2 红在 `control-work-kind-unsupported`，W3／W4 红在轮询超时）；9 个判据文件 53/53 通过；typecheck rc=0；13 条变异（brief 12 条，加一条 m13）都红，还原后 diff 为 0 字节。
- Ruling（F10 补正）: brief 里 W1 那一行拿内存里的 schema 算 `JSON.stringify` 是错的。accept 用 ccloop 的 `canonicalJson`（按 `localeCompare` 排 key）写 `envelope.json`，所以真正交给 `--json-schema` 的字符串已经重排过 key。实施席把判据改成直接读 fake 记下的 argv，评审确认这才是 F10 要量的东西 — Orca 永远不拿这个哈希去比（F10：只比 prompt）— 若错：无代码后果。
- 残留：变异 m02 超时，在 OS tmpdir 留下 4 个目录 `ccloop-single-call-{source-DsM2xH,source-htHYQo,aux-05ypLh,aux-BDC0v8}`，另外 `$SCRATCH/t5-mut-clone` 还在；fake／worker 进程 `pgrep` 为空。删不删归人（未动）。
- Task 5: minor (deferred): `singleCall.ts` 先判 `signal.aborted`、后判 `SingleCallOutputInvalid`。竞态下会把 adapter 已经量到的 usage 丢掉，记成 null。结果仍是安全的（null，从不当 0），修法是把两个判断对调。
- Task 5: minor (deferred): 一般失败路径（`claude-exit-error`／`claude-timeout`，work 记 null）没有 ccloop 判据，这正是起草发现 7 那条路。
- Task 5: minor (deferred): 「请求在进程注册之前就已经落盘」这条路径没有判据。
- Task 5: complete (commits 731f450..0bd781f, review clean)

### §3.8 Part B 的 S6 名单（Orca，控制器 2026-09-28 在改写之前记入）

依据同 §3.2（S6 ＋ S8）。表外判据一条不改。

#### O1

- [ ] **Step 5: S6 改写既有判据（逐条；只动点名的行）**

| 文件:行 | 所在 `it`（或 helper） | 改成 |
|---|---|---|
| `tests/control/startEnvelope.test.ts:53` | `copies the claim from the run row and the contract hash from the ledger, field by field` | `expect(built.protocol).toBe(3);` |
| `tests/control/startEnvelope.test.ts:64` | 同上 | `expect(built.work).toEqual({ kind: "loop", contract, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" });` |
| `tests/control/ccloopPort.test.ts:21` | helper `fixture()`（文件内每个用 `envelope` 的 `it`） | `protocol:3`，`work:{kind:"loop",…}` |
| `tests/control/ccloopPort.test.ts:157` | `asks capabilities about exactly the given selection and returns ccloop's resolution without the protocol tag` | `toEqual` 对象末尾加 `singleCallExecution:null`（替身默认值，=真 ccloop 对 codex 的答案） |
| `tests/control/webCcloopSmoke.test.ts:216` | `refuses an envelope that is not V2 and reads a well-formed one as no execution yet`（真 ccloop） | 信封改 `protocol: 3`、`work: { kind: "loop", … }`；**`it` 名改为 `…that is not V3…`** |
| `tests/control/webCcloopSmoke.test.ts:237` | 同上 | `port.inspect({ ...envelope, protocol: 2 as 3 })` 仍期望 `control-peer-exit:2:control-protocol-unsupported`（外来版本现在是 2，编码的仍是「非本协议即拒」） |
| `tests/control/ccloopPortMissingTable.test.ts:53` | `still inspects and collects an accepted run, and capabilities is refused as agents-table-invalid` | `protocol: 3`，`work: { kind: "loop", … }` |
| `tests/control/projectionJournal.test.ts:107` | `projects claim, starting, and accepted run/work transitions once per transaction` | 同上 |
| `tests/control/projectionJournal.test.ts:128` | `projects starting and unknown run transitions without changing authority` | 同上 |
| `tests/control/dispatch.test.ts:12` | helper `setup`（文件内全部 `it`） | 同上 |
| `tests/control/handoffTransaction.test.ts:18` | helper `started`（文件内全部 `it`） | 同上 |
| `tests/control/legacyAgentRouting.test.ts:101` | `requests a handoff after asking about the handed-off run's selection, not the handoff item's` | 同上 |
| `tests/control/ccloopProtocol.integration.test.ts:59` | `accepts, accounts, commits a handoff, resumes a dirty snapshot, and collects a fresh execution`（真 ccloop） | 同上 |
| `tests/control/profiledService.test.ts:94` | 信封 helper（文件内用到它的全部 `it`） | 同上 |
| `tests/control/executionDriver.test.ts:64` | `builds the workspace at orca/<group>'s tip and stores the rewritten envelope, leaving the person's checkout alone` | 断言前加 `if (envelope.work.kind !== "loop") throw new Error("loop expected");`（类型收窄，断言不变） |
| `tests/control/driverContinuation.test.ts:69` | `keeps its predecessor's base though the tip moved, carries the checkpoint, is cut to the remaining grant, and lands` | 同上 |
| `tests/control/planImport.test.ts:109` | helper `setup` | resolution 字面量加 `singleCallExecution: "v1" as const`（tsc 强制） |

不需要改的（登记理由）：`tests/control/capabilitySchema.test.ts:21`、`tests/control/webFaults.test.ts:277`、`fake-ccloop-control.mjs:35` 说的是 **capabilities** 的旧 protocol 2，与信封无关；`tests/control/unconfiguredPort.test.ts:42` 是 `as never` 的占位，端口在读信封之前就抛。

普查（落地前后各跑一次，结果写进台账）：

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && rg -n "protocol: ?2\b|\"protocol\": ?2\b" src tests scripts web/src web/tests > "$SCRATCH/o1-census.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/o1-tsc.txt" 2>&1; echo rc=$?
```
Expected（落地后）：普查只剩 `capabilitySchema.test.ts:21`、`webFaults.test.ts:277`、`fake-ccloop-control.mjs:35`、`unconfiguredPort.test.ts:42`、`webCcloopSmoke.test.ts` 那条故意喂 2 的外来版本；tsc rc=0。tsc 若点出本表之外缺 `singleCallExecution` 的 resolution 字面量（测试夹具）⇒ 补 `singleCallExecution: "v1"`，并**逐条补进本表与台账**。

#### O2

- [ ] **Step 6: S6 改写与夹具补 resolution**

| 文件:行 | 所在 `it`（或 helper） | 改成 | 类别 |
|---|---|---|---|
| `tests/control/estimator.test.ts:32-34` | `freezes exact input formula, contract constants, and checks later degradation` | `const serialized = Math.ceil((Buffer.byteLength(ESTIMATE_INSTRUCTIONS["1"]!) + 2 + canonicalBytes(result.request).length) * 2 / 3);`，:33-34 两句不动；上方注释 `// Human ruling S6 (2026-09-27, session f341f05f): the input formula counts the whole prompt ccloop hands the model -- the v1 instruction, a blank line and the request bytes (single-call estimate spec §4.2) -- not the request alone.`；import 加 `ESTIMATE_INSTRUCTIONS` | 判据改写 |
| `tests/control/fixtures/web.ts:88` | `webFixture` | `estimatorObservation: () => ({ profile: frozen, observed, probeFailureCode: null, resolution: prepared.observation.resolution })` | 夹具 |
| `tests/panel/controlLifecycle.test.ts:44` | helper `shutdownHarness` | 桩加 `resolution: fixtureResolutionFor(profileSnapshot().profile.capabilities)` | 夹具 |
| `tests/panel/controlReadApi.test.ts:125` | 文件内 helper | 桩加 `resolution: fixtureResolutionFor(selected.snapshot.profile.capabilities)` | 夹具 |
| `tests/panel/fixtures/controlPanel.ts:156` | helper | 同上 | 夹具 |
| `tests/control/planImport.test.ts:339` | `persists a terminal %s preflight without a scheduler wake` | 桩加 `resolution: fixtureResolutionFor(observed)` | 夹具 |
| `tests/control/planImport.test.ts:422` | 崩溃点 `it.each` 的 deps | 桩加 `resolution: fixtureResolutionFor(selected.snapshot.profile.capabilities)` | 夹具 |
| `tests/control/agentPlanImport.test.ts:119` | `refuses an import whose operator layers changed after the estimator slot was resolved` | 桩加 `resolution: fixtureResolutionFor(h.frozen.snapshot.profile.capabilities)` | 夹具 |
| `tests/control/webFaults.test.ts:81` | `dies before the import commit with nothing booked, and the identical command then imports once` | 同上 | 夹具 |
| `tests/control/webFaults.test.ts:249` | `applies a cross-group shutdown to every group or to none, and an epoch replays it once` | 同上 | 夹具 |

每处夹具改动的注释：`// Single-call estimate spec §4.4: the injected observation carries ccloop's resolution, which answers singleCallExecution "v1", so this estimate queues exactly as before the single-call gate.`（夹具不是判据，不写 S6；照 Global Constraints 列进台账「夹具改动」）。
不改的、已核过的：`tests/control/fixtures/ccloopWorld.ts` 的 `startGroup:221`／`agentSelectionE2E.test.ts:75` 断言导入为 `blocked-capability`——真 ccloop 对 codex 答 `singleCallExecution: null`、`contextWindowTokens: null`，结论不变；`estimator.test.ts:36-43` 与 `:68-78` 的退化判据用的是真 router 探测（fixture 答 `"v1"`），只靠 handoff 两条子句拦，不变。

### §3.9 Task O1 完成（Orca）

- 提交：`feat(control): speak start envelope protocol 3 and read ccloop's single-call capability beside the seven keys`（dfe2398，BASE 60b5d58）。
- 实施席自报：`singleCallWire.test.ts` 4/4；brief 点名的 14 个文件 178/178；typecheck rc=0；真 ccloop E2E（ccloop 0bd781f 在 scratchpad build）9/9、0 skipped；M-O1a–f 六条变异都打红了预言的判据。评审自己复跑 typecheck 与 72 条聚焦判据，并做了 `protocol: 2` 普查，结果与报告一致。
- S6 改写：§3.8 O1 表里 15 处，全部照表执行。
- 夹具改动（S6 表之外，只为通过 tsc，不改任何断言；评审逐个读过所在文件的全部断言后确认）：
  - `tests/control/profiles.test.ts` 两处 resolution 字面量补 `singleCallExecution`；
  - `tests/panel/controlReadApi.test.ts` 一处；
  - `tests/panel/fixtures/controlPanel.ts` 一处；
  - `tests/control/agentPlanImport.test.ts` 只改一处 mock-port 调用点。`answered()` 这个 helper 刻意不动，因为它兼作 FrozenSlot 的相等基线：若给它补上 `singleCallExecution`，一条未点名的既有判据会红；
  - `roundPeer.ts` 按 kind 收窄。
- Task O1: complete (commits 60b5d58..dfe2398, review clean)

### §3.10 Task O2 完成（Orca）

- 提交：`feat(control): write the v1 estimate instruction and its JSON Schema, count the whole prompt, and gate on single-call`（4b5db1f，BASE d04f5dd）。
- 实施席自报：Step 7 命令 11 文件／160 条全过；typecheck rc=0；M-O2a–j 十条变异都打红了预言的判据。
- S6 改写：只有一条，`tests/control/estimator.test.ts` > 「freezes exact input formula…」，输入公式现在数整条 prompt（指令＋空行＋请求）。
- 夹具改动（brief 表之外）：
  - `tests/control/planImport.test.ts` 的 SIGKILL 子进程脚本：`fixtures/agents.ts` 在模块顶层 import vitest，子进程里加载不了，改为内联一份与 `fixtureResolutionFor` 逐字段相同的字面量；
  - `tests/panel/fixtures/controlPanel.ts` 默认的 `port.resolveAgent` mock 补 `singleCallExecution`：O1 漏了这一处，O2 的闸一读它，`controlApi.test.ts` 就红了。
- Ruling: 上面两处夹具改动事后认可 — 按 brief 字面，表外判据红了应该停下报控制器；但这两处都只是补输入、不改任何断言，评审独立核过 — 若错：无行为后果，只是流程上没停。
- 挂账（O1 残留）：O1 评审漏看了 `controlPanel.ts` 那处 mock，所以 O1 的「夹具改动」清单不全；O2 已补上。
- Task O2: minor (deferred): `readEstimateContract` 在 O2 没有判据，由 O3 用到。
- Task O2: complete (commits d04f5dd..4b5db1f, review clean)

### §3.11 Task O3 完成（Orca）

- 提交：`feat(control): drive an estimate run through one ccloop single call and settle it into the estimate`（6224f92，BASE c1dd788）。
- **Task 0 第 4 项实测**：修 F1 之前，A1 抛 `start-intent-missing`（webDispatch.ts:370，经 reserveProviderAttemptInTransaction:395、stepA1:181），如预言红；修 F1 之后，「A1 ＋ recordUsage ＋ completeEstimate」的守恒式成立，由 `driverEstimate.test.ts` 的 Task 0 判据钉住。
- 实施席自报：10 个点名文件 141/141；typecheck rc=0；另加一条判据「调用失败且无用量 ⇒ `estimate-usage-unknown`」；M-O3a–h 都红（M-O3b 红在 B′ 的 `inspect-unknown`，不是预言的 `profile-changed`）；自加的 M-O3i（删 F6 让出检查）存活，归 O4 H3 补红。
- Ruling: `driverHandoff.ts` 的 `restartRun` 加了「无工作区就跳过清理」，超出 brief 文件清单 — tsc 要求，且估算 run 走得到这里；和计划分给 O4 的是同一段代码 — 若错：O4 这一处只剩改注释。
- 转给 O4（评审 ⚠️）：
  - (a) H2 的红预言已经过期（守卫已在），H2 的红证改由 M-O4c 提供；
  - (b) F6 让出之后 run 仍是 `accepted`，下一轮走的是 `stepH → deliverAndCollect` 的 work 路径，要到 O4 加上估算分支才真正闭环；
  - (c) 经 `restartRun` 结算的估算 run 只结算了请求，估算本身仍是 `running`、run 仍是 `active=1`，O4 要保证记成 `interrupted` 并退回承诺；
  - (d) `stepCEstimate` 的 `commitTerminal` 在 await 之后没有复查 `state === "accepted"`（Minor 1），O4 正好改到这段，顺手补上。
- Task O3: minor (deferred): 估算 run 在 A1 因确定性原因抛错时（`drive` 为 undefined），每轮只打 stderr、重试，从不 block。这是既有模式，work run 也一样。
- Task O3: complete (commits c1dd788..6224f92, review clean)

### §3.12 Task O4 完成（Orca）

- 提交：`feat(control): stop, restart and recover an estimate run without touching the target repository`（7fce7d8，BASE 55abc88）。无 S6、无夹具输入改动；harness 原样挪到 `tests/control/fixtures/estimateHarness.ts`（评审逐行核过，是纯挪动）。
- **Task 0 第 2 项实测（真）**：修复前 `recoverControl(…, {driverOwnsWebRuns:true})` 把在飞与已完成（`ready`）两种估算 run 都放进 `blockedRunIds`。E3 在 M-O4d 下直接量到 `dispatchBlocked === true`。修复后在 `driverOwnsWebRuns` 下，任何状态的估算 run 都会被跳过。
- 实施席自报：8 个单元文件 116/116；typecheck rc=0；E2／E3 2/2、0 skipped（ccloop-bin 在 0bd781f）；M-O4a–e 都打红了预言的判据。M-O4e 现在能杀死 O3 里存活的那条 F6 变异。
- (c) 实测：`restartRun` 已经会走到 `terminaliseRun → interruptEstimate`，H2 已钉住。
- Task O4: minor (deferred): (d) 的守卫（await 之后复查 `accepted`）没有判据，M-O4f 存活。今天走不到它，但按 Rule 9 应补一条 `duringCollect` 注入判据 ⇒ 列入终审修复清单。
- Task O4: minor (deferred): E3 没有断言重启前后 `git worktree list` 不变 ⇒ 列入终审修复清单。
- Task O4: minor (deferred): `estimateE2E.test.ts` 有未用的 `readFileSync` import；还导出了尚未被引用的 helper，其中 `estimateOutput` 与夹具里的同名、内容却不同。
- Task O4: minor (deferred): 两种情形没有判据：用量未知的估算 run 遇到 stop 时，照 spec §6.5.1 结算成 `settled-restartable`（组的 `usageUnknown` 仍然为真，不会当成 0）；已 prepared 的 `start-pending`／`unknown` 估算 run 走 `inspectUnderStop`。
- 残留：`$SCRATCH/o4-mut`。
- Task O4: complete (commits 55abc88..7fce7d8, review clean)

### §3.13 Task O5 完成（Orca）

- 提交：`test(control): an estimate runs end to end under real ccloop and fake claude, and its advice reaches the proposal`（9553ff3，BASE 8ed12b8）。
- 实施席自报：`estimateE2E.test.ts` E1／E2／E3 3 过、0 skipped（真 ccloop 0bd781f ＋ fake claude），typecheck rc=0。
- 变异 M-O5a：`driverRunIds` 去掉估算分支 ⇒ E1 红，红因是「估算 running；confirm confirmed；start 回 `estimate-in-flight`」。这就是 spec §1 推断的「claude 1M 导入后卡死」的实测。
- 变异 M-O5b：`maxOutputTokens` 改成 1 ⇒ E1 只红在 `maxOutputTokensEnv` 那一行。
- Ruling: 实施席改了 brief 字面范围之外的既有 helper `confirmSoft`（之前没有调用方），把 `handoffAtContextTokens` 从 null 改成回显 profile 声明的窗口。原因：只要窗口已知，confirm 就拒 null（`webService.ts:433` 的 `execution-policy-unrepresentable`）；评审确认这处改动不削弱 E1、不影响其他判据 — 若错：只影响测试 helper。
- ⚠️ **产品问题，归人**：夹具与 Web 部署都常用「一个 profile 给所有角色」，estimator 要跑就得声明窗口（claude 1M），而 worker 共用同一个 profile，于是 confirm 强制操作者给一个数值 handoff 阈值，没法表达「不按上下文交接」。这是 agent 选择那一轮就有的不变式，本轮只是让它更容易撞上。本轮不改。
- Task O5: minor (deferred): 计划文件 Part B 那一处 `handoffAtContextTokens: null` 字面量同样过不了 confirm（计划是已提交的文档，由终审或 handoff 记更正）。
- Task O5: complete (commits 8ed12b8..9553ff3, review clean)

### §3.14 Task O6 完成（Orca web）

- 提交：`feat(web): apply the model's suggestions per field, per row or all at once, and show its reasons`（356ecc0，BASE 2b199a7）。只改了 `web/src/BudgetEditor.tsx` 和一个新判据文件，没有新增 CSS（沿用 `button` 的主题 token）。
- 实施席自报：`budgetSuggestions.test.tsx` 5/5；相关 web 判据共 33/33；web tsc 干净；`webParity` 3/3；M-O6a–e 都红。
- Ruling: 新判据有两处与 brief 字面不同，评审认可：① 基线夹具改成带一个 `queued` 估算，因为既有的 Re-estimate 按钮只要有估算就会渲染；② brief 给的判据抓不到 M-O6d，另加一条直接断言，让它能红 — 若错：只影响新判据。
- Task O6: complete (commits 2b199a7..356ecc0, review clean)

### §3.15 Task O7 完成（Orca）——计划的全部 Task 落地

- 提交：`test(scripts): a live estimate scenario for claude, run first against the fake`（1e40cc6，BASE f8dfdce）。
- 实施席自报：
  - typecheck rc=0；
  - `--fake-claude --scenario estimate --task-tokens 150000 --group-tokens 800000`：rc=0、`failed: []`，estimateQueued／estimateReady／estimateUsageBooked／estimateToolsOff／startAllowed／orcaHomeUntouched 全为 true；
  - `--fake-claude --scenario single` 回归：rc=0；
  - M-O7a（`driverRunIds` 去掉估算分支）：rc=1，estimateReady、startAllowed 如预言红，另有 12 条连带红。
- Ruling: confirm 的 `handoffAtContextTokens` 改为回显 profile 声明的窗口，与 O5 的 `confirmSoft` 同一修法。评审确认 single／conflict／deadline 三个场景的窗口仍是 null，行为不变 — 若错：只影响验收脚本。
- Ruling: 实施席多改了 `checks.providerCalls` 里 reconcile 计数的那个三元式（brief 没点到的第 4 处 `scenario === "single"`）。它先实测到 `failed: ["providerCalls"]`，再改 — 若错：只影响验收脚本。
- 真 `~/.orca` 前后 `ls -la` 相同（控制器现测：只有 2026-09-27 21:36／21:37 的 `control/` 与 `reviews.jsonl`）。
- Task O7: complete (commits f8dfdce..1e40cc6, review clean)

### §3.16 终审（Opus，只读，跨两仓）

- 结论：**With fixes**。Critical 0。
- Important #1：`claude-timeout`／`exit-error`／`spawn-error` 时 work 记 null，组被 `usageUnknown` 永久卡住。比 spec §10 登记的「中止且无观测」更宽。
- Important #2：§8.5 的干净门与变异总表还没入台账。
- Minor 1–6。
- Ruling（修复波，一次派发，Opus）：以下几项现在修：
  - ccloop：C1（超时及其他失败带上观测用量）、C2（T5 两个判断对调）、C3（single-call 超时 = grant − 10 s）；
  - Orca：O-a（(d) 守卫判据）、O-b（E3 断言 worktree 不变）、O-c（用量未知时 stop 的判据）、O-d（调用记录不合法 ⇒ block `single-call-record-invalid`）、O-e（web 基线加直接断言）。
  - 依据：终审分诊与 Rule 9；§10 登记之外、能直接卡死组的路径能修就修。若错：多一轮修复。
- Ruling：以下几项登记、不修，写进 spec §10 更正与 handoff：
  - Minor 2：prompt 作为单个 argv 参数，Linux 上限 128 KiB；
  - Minor 3：`--tools ""` 只做过静态验证；
  - Minor 6：应用建议后，未保存的 draft 仍会显示；
  - 修复后仍剩的一个窗口：spawn 失败、或出流之前就退出 ⇒ 用量 null ⇒ 组卡在 usageUnknown。
  - 依据：前三项都不在本轮验收路径上；最后一项是 Web spec 对用量未知的既定语义，要改它就得先定义「可证明零花费」，那是新设计。若错：Linux 部署时估算会 spawn 失败，并卡住组。
- 终审分诊中标为 keep 的 deferred 项与 Ruling：照单保留。见终审报告：T1、T3、T4×2、T5（请求先于注册）、O2、O3、O4（readFileSync 等）、O5 计划字面量，以及 §3 的全部 Ruling。

### §3.17 终审修复波与复审

- 提交：
  - ccloop `fix(control): book a failed single call's observed usage, keep output-invalid ahead of a racing stop, and leave a time margin under the grant`（e7c964b）；
  - Orca `fix(control): block an unreadable single-call record by name, and pin the estimate's final-review criteria`（5b116ce）。
- 实施席自报：
  - ccloop 两个 single-call 判据文件 17 过；Orca driverEstimate＋driverEstimateHandoff 18 过；web budgetSuggestions 6 过；全部 0 skipped；
  - estimateE2E 3 过、0 skipped，ORCA_CCLOOP_BIN 用 e7c964b 的 build；
  - 三仓 typecheck 干净；C1、C2、C3、M-O4f、O-d、O-e 各自的变异都红。
- 复审（Sonnet，限定范围）：8 项全部 ADDRESSED，无新破损，没有改写任何既有判据。
- O-d 前提更正：修复前坏记录并不会每轮抛错。driver 的 pass 级 catch 当轮就把 run block 掉，只是原因写的是原始 zod 文本；这次修复把它改成具名的 `single-call-record-invalid`。终审那句「spins forever」不准确。
- Final: minor (deferred)：
  - grant ≤ 10 s 时，调用的超时只剩 1 ms。生产的 `ESTIMATE_GRANT` 是 900 s，不受影响。
  - W8 的竞态是用 spy 注入的，真 runner 走不到。
  - loop 阶段超时仍不带观测用量（C1 只改了 single-call）。
  - `errorCodeOf` 用冒号切分，路径里带冒号时会切错（既有代码）。
- 变异总表（Ruling）：每个 Task 的 Mutation 行都由实施席在各自的 `git clone --local` 里跑过，看到红，还原为 0 字节 diff。逐条结果在各 `task-*-report.md` 与 `final-fix-report.md`。控制器不再重跑一遍全部 ~60 条，独立证据交给下面两仓的干净门 — 若错：某条变异的「红」只有实施席自报；每个 Task 的评审都读过报告，O1、T2 的评审还直接读过原始输出。

### §3.18 两仓干净门（2026-09-28）

- **ccloop**（Sonnet 门席；clone 内容＝e7c964b，HOME＋四个 XDG 根改道）：
  - build／typecheck RC 0；
  - vitest json 1059 条、1057 过、2 红：`stopProof`，以及 codexWatchdog 的日期 flake；
  - `node scripts/check-known-reds.mjs` **RC 0**（名单 14 个，意外 0）；
  - 改道后的 HOME 下只有 `~/.npm/_logs`。
- **Orca 第一次**（门席；clone 内容＝b7ff534）：
  - web build／typecheck／web tsc RC 0；
  - 2084 条、2082 过、2 红：
    - `driverRecovery`：负载 flake，单跑 3/3 过；
    - **`tests/agents/command.test.ts` >「orca agents show … exits 0」**：3/3 稳定红。根因是测试里内嵌的假 ccloop 应答缺 `singleCallExecution`，属于 O1 的遗漏。
  - web 148/148；`verify:panel` 15/15 PASS；estimateE2E 3/3、singleCallWire 4/4，均 0 skipped；真 `~/.orca` 前后 stat 相同。
- **修复**：`test(agents): let the embedded fake ccloop answer singleCallExecution beside capabilities`（18ace7e）。
  - 同形的还有 `tests/panel/controlConfig.test.ts:52` 与 `controlConfigPort.test.ts:66`（codex ⇒ null），一并补上。只补夹具输入，不改任何断言。
  - Ruling: 不单独派评审 — 与 O1、O2 已认可的夹具改动同形，改后又在最终树上重跑了全量 — 若错：人审夹具改动时一并看。
- **Orca 最终树重跑**（控制器；clone 内容＝18ace7e，env 同上，开跑前 uptime 5.69／5.31／6.38）：
  - web build RC 0；
  - 229 文件／2084 条、2083 过、1 红（`driverRecovery`），0 pending；
  - 同一 clone 单跑 `driverRecovery` 3 次，3/3 rc=0（load 5.58–8.58）⇒ 负载 flake；
  - `tests/agents/command.test.ts` 13/13；estimateE2E 3/3、singleCallWire 4/4，0 skipped；
  - 真 `~/.orca` stat 前后 diff 为空。
- 孤儿进程：本会话 `ccloop-bin` clone 的 `worker.js`（pid 66955，E2E 留下），未杀，归人。
- **本轮收口。** 全部提交只在本地，推送归人。

### §3.19 人审前的更正（会话 `fa672d9e`，2026-09-28；本节只追加，上文一字未改）

人在会话里说「注释还原和改数都做，stash 删」，另外授权杀孤儿进程。本节记下这几件事，以及人审准备过程中核出的偏差。

- **更正 §3.9「§3.8 O1 表里 15 处」**：O1 表是 **17 行**。
  - 测量：python 数 `#### O1` 到 `#### O2` 之间以 `` | `tests `` 开头的行，观测时在提交 `71cc92f` 上。
  - 17 行逐条点名见 §3.8 的 O1 表本身；按表执行这一点不变。
- **更正两份 handoff 里的「13 个测试文件＋helper」**（Orca 和 ccloop 的 handoff 都有这句；它们是活文档，已就地改）：
  - `06b6453` 动的是 **12 个测试文件，加 helper `tests/control/agentsFixture.ts`**，共 13 个路径。§3.2 的表本身是对的。
  - 测量：`git -C ccloop show --name-only --format= 06b6453 -- tests`。
- **补 §3.9 的「夹具改动」清单**：`dfe2398` 还动了下面这些，台账此前没登记：
  - `tests/control/fixtures/fake-ccloop-control.mjs`：**替身的行为改了**：
    - 信封只认 3；
    - `work.kind` 未知时以 `control-request-invalid` 拒绝，这是新增的拒绝；
    - capabilities 应答新增 `singleCallExecution`，默认 null；
    - 新增旋钮 `omitSingleCall`／`singleCallExecution`。
  - `tests/control/fixtures/agents.ts`：`fixtureResolveAgent` 默认答 `"v1"`；新增 `fixtureResolutionFor`。
  - `tests/control/fixtures/store.ts`：`resolvedAs` 默认答 `"v1"`。
  - `tests/control/fixtures/driverPort.ts`：遇到非 loop 的 work 抛错；`resolveAgent` 答 `"v1"`。
  - `tests/control/fixtures/archive.ts`、`tests/control/fixtures/crash-worker.mjs`：只改 envelope 字面量。
  - ⚠️ 默认 `"v1"` 有没有让某条「不该排队」的判据变成空绿，**没量过**。
- **注释还原**：提交 `71cc92f`，主题行 `test(control): put back the published agent-selection ruling comments the protocol-3 rewrite replaced`。
  - 起因：`dfe2398` 用 S6 行替换了远端 `bc9a466` 上已发布的归属注释 `Rewritten for agent selection (2026-09-26, human ruling …)`，还就地改写了 fake 替身里两行已发布注释。
  - 做法：原文逐字放回，S6 行留在它下面作为更正；fake 替身的两行各加一条具名 ERRATUM。
  - 证明：
    - diff 只含注释行；
    - 补回的 11 行都与 `bc9a466` 上的文件逐字相同（python 核对，rc=0）；
    - `npm run typecheck` rc=0；
    - 8 个相关文件的 vitest 79 过、3 skipped。skipped 的是 `webCcloopSmoke` 里要真 ccloop 二进制的那几条，本次没有设 `ORCA_CCLOOP_BIN`，**没跑**。
  - 没动的：源码 doc 注释随代码一起改写的 5 处。它们算不算违反「已发布注释不改」，归人裁：
    - `src/control/schema.ts`、`src/control/executionDriver.ts`、`src/control/driverHandoff.ts`、`src/control/recovery.ts`（出自 `dfe2398`／`6224f92`／`7fce7d8`）；
    - `scripts/live-driver-acceptance.ts`（出自 `1e40cc6`）。
- **残留处置（人授权）**：
  - 孤儿 `worker.js`（pid 66955）已杀，`pgrep` rc=1；
  - Orca `stash@{0}` 已删，它就是 §九 记的那个旧 stash，内容是更早轮次的 handoff 编辑；
  - OS tmp 下 4 个 `ccloop-single-call-*` 目录与 scratchpad 里的各个 clone **未动**。

### §3.20 夹具默认 `"v1"` 会不会让判据空绿（会话 `fa672d9e`，2026-09-28；本节只追加）

人要求：「量一下夹具默认 v1 会不会让判据空绿。doc注释的修改你看下是否合理，不合理就改回去。」

**环境**：
- 全新 `git clone --local`，内容＝`4ada41d`，放在本会话 scratchpad，软链 `node_modules`，先 build web；
- `ORCA_CCLOOP_BIN` 指 ccloop clone 的 build，内容＝`66729d6`；
- `ORCA_AGENTS_TABLE` 是 fake codex `integration` 模式的夹具表；
- HOME 与四个 XDG 根改道；
- 每条都跑全量：`vitest run --reporter=json`，结果重定向到文件后用 python 读回；
- 主工作树零触碰；每条变异跑完 `git checkout` 还原，`git diff` 与 `git diff --cached` 都是 0 字节。

**结果**（「新红」＝M0 基线里没有的红）：

| 变异 | 改了什么 | 结果 |
|---|---|---|
| M0 | 不改 | 2084 条、2083 过、1 红、0 pending。红的是已登记 flake `controlShutdown`（`a real SIGTERM…`），开跑时 load 3.88 |
| M1 | `estimator.ts` 的 `buildBudgetEstimateRequest` 删掉 `singleCallExecution !== "v1"` 条件 | 新红：`estimatePrompt.test.ts` >「is blocked-capability unless ccloop answers singleCallExecution v1, and a claim degrades the same way」；另有已登记负载 flake `driverRecovery` |
| M2 | `estimator.ts` 的 `estimateCapabilityDegraded` 删掉同一条件 | 新红与 M1 相同（同一条判据，加上 `driverRecovery` flake） |
| M3 | 共享夹具的默认值 `"v1"` 改成 null，共 6 处：`fixtures/agents.ts` 两处、`fixtures/store.ts`、`fixtures/driverPort.ts`、`panel/fixtures/controlPanel.ts` 两处 | 2014 过、70 红；除 `controlShutdown` 外 69 条新红，分布在 16 个文件（清单在本会话 scratchpad 的 `m/M3.json`） |
| M4 | `ccloopPort.ts` 解析之后强行把 `singleCallExecution` 置为 `"v1"` | 新红：`ccloopPort.test.ts` >「asks capabilities about exactly the given selection…」、`singleCallWire.test.ts` >「returns ccloop's answer as given, and refuses an answer without the field」；另有已登记负载 flake `driverRecovery`、`handoffE2E` H5 |

**结论**：
- **没有发现空绿。**
  - 默认 `"v1"` 是承重的：翻成 null 后，69 条读这些夹具的判据全红，说明它们确实观测到了估算排队。
  - 闸门两处、port 直通这一处，都各有判据能被看见红。
- ⚠️ 弱点：`estimator.ts` 的两处闸门**只有 `estimatePrompt.test.ts` 那一条判据守着**。
  - `agentSelectionE2E` 在真 ccloop 下对 codex 断言 `blocked-capability`，但在 M1 下仍然是绿的：`contextWindowTokens: null` 这个条件同样会把它拦下，所以它不是这道闸门的独立守卫。§3.8 已经写过「结论不变」，本次量到的也是这样。
  - 要不要补第二条独立守卫，归人定。

**doc 注释（§3.19 留下的 5 处）**：
- 先例（python 扫 2026-09-15 到 09-27 期间动过 `src` 的 159 笔）：删掉的注释行有 75 行，ERRATUM 只有 9 条，而且这 9 条都是在更正原本就写错的注释。代码行为变了、doc 注释跟着就地改，是本仓库的常规做法。
- 逐处核对：
  - `executionDriver.ts` 的 `portFor`、`driverHandoff.ts` 的 `handoffRunIds`、`recovery.ts` 的跳过注释，都与现在的代码相符，保留；
  - `live-driver-acceptance.ts` 的 agent-selection 注释是随代码挪进 `setPreferences()` 的，原文逐字还在，保留；
  - `schema.ts`：两行意思重复，而且丢了 `Agent selection spec §4.6` 指针。**本笔把重复的那一行改成带回这个指针**，只改注释，`npm run typecheck` rc=0。

### §3.21 人审结论（会话 `292277d5`，2026-09-28；本节只追加，上文一字未改）

人对 handoff §9.0e 编号 1–27 的回复（原话摘录）：「24 … => 补」「25 … => 你的建议是什么？为什么？」「26 挂账修哪几条？ => 同意候选的四条」「27 残留删不删？ => 删」「审阅清单的其他部分同意」「这次session 你可以先把我的决策记下来，先不做。」

- **1–23：认可。** 含 S6 两份名单（ccloop §3.2、Orca §3.8）、夹具改动（§3.9、§3.19）与 §3 的全部 `Ruling:`。**不回退任何一条。**
- **24：补。** 给 `estimator.ts` 的两处 v1 闸门（`buildBudgetEstimateRequest`、`estimateCapabilityDegraded`）各补一条独立于 `estimatePrompt.test.ts` 的判据。判据要在 §3.20 的 M1、M2 下被看见红，而且不能靠 `contextWindowTokens: null` 顺带拦下。**未做。**
- **25：未决。** 人要控制器给建议和理由，建议写在本会话的对话里，等人拍板。控制器现测到的事实（观测时 HEAD＝主题行 `docs(handoff): record the review preparation, the numbered checklist the human answers against, and two lessons`）：
  - confirm 的规则在 `src/control/webService.ts:433`：窗口已知 ⇒ 阈值必须是 ≤ 窗口的数；窗口为 null ⇒ 阈值必须是 null。
  - 这个阈值今天是**惰性**的：`src/control/contextControl.ts:59` 在 `contextObservation` 不是 `realtime`／`phase-end` 时直接返回 invalid，而 ccloop 对 claude 和 codex 都答 `"unavailable"`。
- **26：四条都修。** 四条是：spawn 失败或出流前退出 ⇒ `usageUnknown` 卡组（要先定义「可证明零花费」）；Linux argv 128 KiB；应用建议后 draft 仍显示；loop 阶段超时不带观测用量。**未做。**
- **27：删。** **未做**（人说「先不做」）。范围按现测更正：
  - handoff 写的「4 个」不对。现测 `$TMPDIR` 下共有 **52 个** `ccloop-single-call-*`：`table` 32、`admitted` 8、`refused` 8、`aux` 2、`source` 2。
    测量命令：python 按 `rsplit('-',1)[0]` 统计 `ls $TMPDIR` 的结果。mtime 分布是 2026-09-28 01 时 42 个、02 时 4 个、06 时 6 个。
  - 来源：
    - `aux`、`source` 出自 ccloop `tests/control/singleCall.test.ts`。这个文件有 `afterEach` 负责 `rm`，所以只有超时或被杀时才会留下。这 4 个就是 handoff 里说的「4 个」。
    - `table`、`admitted`、`refused` 出自 ccloop `tests/control/singleCallCapability.test.ts:20,54,63`，**文件里没有任何 `rm`**。**每跑一次 ccloop 全量就漏 6 个目录**（4 个 table、1 个 refused、1 个 admitted）。
    - 这是本轮 ccloop 提交带进来的**新缺陷**，只登记，没修。
  - 删的时候，Orca 会话 `f341f05f`、`fa672d9e` 的 scratchpad clone 也在范围内。删之前要再现测一遍清单。52 个是否都在人说的「删」里面，交给人确认。

### §3.22 25、27 的人裁（会话 `292277d5`，2026-09-28；本节只追加）

- **25：采纳控制器的建议。** 人原话：「25 同意建议」。建议内容：
  - **现在不改代码，只登记**：confirm 强制填数值阈值这件事今天是惰性的，因为 ccloop 对两种 agent 都答 `contextObservation: "unavailable"`（`src/control/contextControl.ts:59`）。
  - **等 ccloop 能实时观测上下文时，加一个显式的关闭值**，例如 `{ kind: "off" } | { kind: "at", tokens }`。**不放宽 `null`**，否则「忘了填」和「选择不交接」分不出来。
  - 今天的绕法：给 estimator 和 worker 选不同的 profile。
  - UI 上标明「当前 agent 不观测上下文，此值不生效」，这一条可以并进 26 一起做。
- **27：删全部。** 人原话：「包括全部，且需要后续尽快修」。
  - 范围是 §3.21 现测的 52 个 `ccloop-single-call-*`，加上会话 `f341f05f`、`fa672d9e` 的 scratchpad clone。
  - 泄漏源 `singleCallCapability.test.ts` 要**尽快修**，优先级高于 26。修它要改 ccloop 的既有判据文件（只加清理，不改断言），按 ccloop Rule 15(a) 开工前要逐条列出给人看。
  - **本会话仍然不执行**（人在上一条说过「先不做」）。
