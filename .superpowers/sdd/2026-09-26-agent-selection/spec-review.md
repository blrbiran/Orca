# Spec 复审：agent 选择（安装表、分层默认值、claude 走 control）

> **归属**：独立复审子 agent，受 Orca 控制器会话 `75ec878e` 派遣，2026-09-26。只读复审，两仓均未改动。
> **观测锚点**：Orca `d115b81`（`docs(spec): design agent selection: installation table, layered defaults, claude over control`）；ccloop `f4e49a2`（`docs(handoff): roll the Orca section: C5-C7 and C-3 landed here for the handoff delivery round`）。
> 下文所有行号都是本会话在上述两笔提交上用 `cat -n`／`sed -n`／`grep -n` 实读得到的。唯一执行过的命令：`claude --help`、`claude --version`（输出写入 scratchpad 后整份读回；版本 `2.1.282 (Claude Code)`）。
> 被审 spec：`docs/superpowers/specs/2026-09-26-agent-selection-design.md`（下称「spec」）。

---

## Critical

### C1. 「fake claude」在两个仓里指的是两层不同的东西；§4.8／§9.3–5／§9.11 按 CLI 层来写，现有文件却是 runner 层的替身

- **spec 位置**：§4.8、§9 第 3/4/5/11 条。
- **spec 的说法**：补 `tests/fixtures/fake-claude.mjs`，「把收到的 argv（含 `--model`）逐次写进 `.calls` 日志」；判据 5 说「runner 的子进程（fake claude 起的孙进程）」。
- **证据**：
  - ccloop `tests/fixtures/fake-claude.mjs:1-6` 从 stdin 读**一个 JSON 请求** `{phase, prompt, runDir, …}`，直接打印结构化结果。它替身的是 `scripts/claude-phase-runner.mjs`（adapter 的 `command`），**不是** `claude` CLI。
  - 用它的地方：`tests/runtime/claude/subprocessClaudeAdapter.test.ts:52-54`（`command: ["node", "tests/fixtures/fake-claude.mjs"]`）；CLI 层的假 claude 是同一测试文件 `:56-63` 的 `createFakeClaudeBinary` 现场生成的。
  - `ClaudeAgentAdapter` 的链路是 adapter → runner → `claude`（runner `:381-396` 用 `execFile("claude", ["-p","--output-format","json","--json-schema",…, request.prompt])`）。要证明「`--model` 到了 CLI」，替身必须站在 **`claude` 二进制**这一层：解析 `-p --output-format json --json-schema <schema> <prompt>`，打印 `{structured_output, usage}`。
  - `.calls` 的格式已经是承重判据：ccloop `fake-codex.mjs:25` 每次调用只追加 `phase\n`，`:31` 的注释写明「`<marker>.calls` keeps its format」；Orca `tests/control/fixtures/ccloopWorld.ts:130-132` 按「每行一个 phase」读它，`tests/control/handoffE2E.test.ts:160` 等处断言 `toEqual(HALVES_CALLS)`。把 argv 写进 `.calls` 会让这些判据全红，而 §9.11 恰好要求在 fake claude 下把 ④ 的这些场景「再各跑一次」。
- **为什么要紧**：照原文实施，要么把旧 `SubprocessClaudeAdapter` 的判据改坏（§11 说旧的保留不动），要么造出一个站错层的替身，§9.11 的「选择一路到了 CLI 参数」证明不了任何事。这是跨仓词表不一致的第六次：「fake claude」。
- **建议改法**：新写 `tests/fixtures/fake-claude-cli.mjs`（或同义文件名），站在 CLI 层，说 runner 的 argv 协议；旧 `fake-claude.mjs` 原样保留给旧 adapter 用。argv 写进**新的** `<marker>.argv`（每次调用一行 JSON），`.calls` 和 `.tasks` 保持「phase」「phase key」的格式，claude 替身照样写这两种格式，这样 `ccloopWorld` 的 `calls()` 不改就能用。fake codex 已经在 `fake-codex.mjs:11` 把 `args` 写进 marker（每次覆盖），同样改成追加到 `.argv`。

### C2. 安装记录的 `command` 是单个绝对路径，表达不了 E2E 世界里的 fake codex，也比今天的 codex 配置表达力弱

- **spec 位置**：§4.2（`"command": "/abs/path/codex"`、「`command` 必须是绝对路径」）、§9.11。
- **证据**：
  - ccloop `src/runtime/codex/protocol.ts:7`：`command: z.tuple([z.string().min(1).refine(isAbsolute)]).rest(z.string())`，今天是 argv 元组。
  - Orca `tests/control/fixtures/ccloopWorld.ts:76`：`command: [process.execPath, fakeCodex, "script", marker, scriptPath]`，E2E 就靠这五个元素开动 fake codex。
- **为什么要紧**：按原文，§9.11 的混组 E2E 连 fake codex 都开不起来；claude 这边也要 `node runner.mjs` 再带上 fake CLI。
- **建议改法**：`command` 定为 `[absPath, ...args]` 元组（与 `parseCodexConfig` 一致），detect 草稿写单元素元组；或者明确要求 fake 改成带 shebang 的可执行文件，模式／marker 改走环境变量，并把这一条写进 §4.8。两条路任选一条，但 spec 必须选定。

### C3. 派活时的能力闸门在新设计里没有定义：`probe(profile)` 的调用点都不带选择

- **spec 位置**：§6.5 最后两条（「能力交集按 (profile, 选择) 求，冻结时算一次」「`router.probe(profile)` 的面板展示改为对『操作者默认选择』求」）。
- **证据**：下面这些调用点在派活或续跑之前都会重新探测，全部调的是不带选择的 `capabilities()`：
  - Orca `src/control/webDispatch.ts:85`（`scheduleStart`）、`:165`（`deliverScheduledStart`），两处都经 `profileRouter.probe(bindings.worker / bindings.handoff)`；
  - `src/control/dispatch.ts:52`、`:77`：`assertCapabilities(…, await port.capabilities())`；
  - `src/control/service.ts:77`、`:83-90`；
  - `src/control/webService.ts:228`、`:266`（估算）；`src/control/planImport.ts:274`；`src/control/stopIntent.ts:562`（model-assisted handoff）；`src/panel/controlConfig.ts:206`（面板视图）；
  - 探测本身在 `src/control/profiles.ts:147-157` → `ccloopPort.ts:74-78`（`raw("capabilities", {})`）。
- **为什么要紧**：v3 下 `capabilities` 必须带选择。spec 只规定了面板展示用「操作者默认」。如果实施者把这个口径推广到派活闸门：(a) 混组里 claude 任务会拿 codex 的能力放行；(b) 确认之后改操作者默认值会改变已确认组的派活结果，直接违反 §6.4 第 5 步和 §9.8 想守的那条保证。
- **建议改法**：逐个调用点写明探测用哪个选择：派活、续跑、reconcile-start 用**该 run 冻结的** `agent`；handoff profile 的探测用被 handoff 的那个 run 的选择（handoff 没有槽位，要写明）；估算用冻结的 estimator 选择；只有面板视图用操作者默认。再补一条判据：先确认，再把操作者默认改成一个能力更差的 agent，派活照常进行，闸门看到的是冻结选择。

### C4. 「确认绑定用户看到的 `proposalVersion`」对选择而言是空洞的，而且 confirm 今天是同步的

- **spec 位置**：§6.8 第三条、§6.4。
- **证据**：
  - `set-agent-preferences` 改的是操作者层，它有自己的 revision（§6.2），**不推进** `proposalVersion`；安装表和描述默认值的变化也不推进。`confirmPayloadSchema`（`src/control/webProtocol.ts:599-608`）只绑定 `planHash`／`proposalVersion`／profile id 与 hash／`contextPolicy`。
  - `src/control/webService.ts:387`：`confirm(command): WebCommandResult` 是同步的。§6.4 第 2 步却要在 confirm 里调 `port.capabilities`（异步）。
- **为什么要紧**：用户在提案视图看到的是 X（预解析结果），另一个标签页改了操作者默认值，这边再点确认，冻结的是 Y。「用户看到的就是被冻结的」这条保证没有任何机制在守。
- **建议改法**：confirm 的 payload 加一个 `selectionsHash`：面板预解析得到的逐槽位 `{partial, selection, configHash}` 的规范哈希。confirm 仿照 `importControlPlanAsync`（`planImport.ts:258-286`）的写法：先在事务外解析和探测，事务内重新核对，`selectionsHash` 不等就拒（给一个具名码，例如 `agent-selection-changed`）。判据：预解析之后改操作者默认值，再带旧的 hash 确认，必须被拒。

### C5. 解冲突 run 和估算 run 冻结下来的 `configHash` 没有任何核对方

- **spec 位置**：§3 I1（「解冲突继承同一份选择」）、§4.9、§6.4 第 4 步、§6.6 最后一条。
- **证据**：
  - 解冲突走的是 `ccloop run`，不是 `control accept`（`src/control/driverLanding.ts:283-285` → `src/scheduler/ccloopRunner.ts:277-288`）。ccloop `src/cli.ts:179-190`、`:217-225` 的 run 路径根本没有 hash 核对。spec §4.9 只给了 `--agent-selection <file>`，没给 hash。
  - 估算 run 今天根本没人执行（execution-driver spec 第 28 行：导入后 estimate 停在 `running`；`webDispatch.ts:442-446` 只 claim 不执行）。更要紧的是，它的 `configHash` 在 `src/control/webService.ts:292` 写的是 **`estimate.profile.profileHash`**：Orca 里的 `configHash` 今天就已经有第二种意思。
- **为什么要紧**：确认之后改了安装表，reconcile 会悄悄跑在另一份物化配置上，I1 只对 `control accept` 这条路成立。§6.4 第 4 步写进组记录的 estimator／reconcile `configHash` 是没人读的数据。
- **建议改法**：选择文件写成 `{selection, configHash}`；`ccloop run --agents --agent-selection` 物化后比对哈希，不等就以 `control-config-hash-mismatch`（或 `run-config-hash-mismatch`）退出，并加一条判据。估算这边写明「只记录，要等 ⑤ 才有核对方」，同时点名 `webService.ts:292` 的 `configHash: profileHash` 要么改成冻结的 estimator `configHash`，要么把这个字段改名，别再和新定义混用。

### C6. 「版本漂移由 `configHash` 捕获」只对人手记进表里的漂移成立；原地升级抓不到

- **spec 位置**：§4.2 第二条（控制器决定）。
- **证据**：本机 codex 是 `~/.nvm/.../bin/codex -> ../lib/node_modules/@openai/codex/bin/codex.js`（`ls -l` 实测），`npm i -g` 升级只换目标、不换路径。cc-switch `src-tauri/src/commands/misc.rs:547` 记载 codex 独立安装是 `<CODEX_HOME>/packages/standalone/releases/<ver>-<target>/`，外加一个 `current` 软链。claude 会自动更新。这几种情况下表里的 `command` 和 `version` 都不变，所以哈希也不变。
- **为什么要紧**：spec 声称的保证是「不引入版本比较语义，因为 hash 会捕获」。实际上最常见的漂移（自动更新）恰好不被捕获，这是一条空洞保证。
- **建议改法**：二选一，并写进 spec。(a) 把说法收窄成「只捕获表里记录的变化；二进制原地升级不被捕获」，登记进 §11。(b) accept 时对 `command` 跑一次 `--version`，与表里的 `version` 比，不等就报具名错 `agent-version-drift`；或者记录 realpath 加内容哈希，accept 时核对。

### C7. 停机证明「零注册 ⇒ `isolated:true`」的机制本身没有修，只修了 claude 这一个实例

- **spec 位置**：§1.2、§9.3、§3「新 agent kind ＝ 一个描述＋一个适配器，Orca 零改动」。
- **证据**：ccloop `src/control/stopProof.ts:100-108`，`probeAll` 对空数组返回 `true`；`:114-119` 两轮都只看注册表。`worker.ts:66-78` 初始化成 `[]`。判据 3 只断言 `ClaudeAgentAdapter` 下非空。
- **为什么要紧**：spec 明确把「新 kind 只要一个适配器」当作留给以后的接口。将来任何一个忘了调 `onProcessRegistered` 的适配器（opencode、pi……）都会原样复现这个 🔴 空洞，而且没有判据会红。
- **建议改法**：在 worker 里按 phase 记「已进入的 phase 数」（`runLoop` 调 `plan`/`execute`/`verify` 之前落盘）。`proveStopped` 在「进入过的 phase 数 > 0 且注册表为空」时返回 `null`。判据：用一个不注册的替身 adapter 跑满一个 phase，`proveStopped` 必须是 `null`；变异：删掉这条检查，判据变红。

---

## Important

### I1. envelope v2 与 `claim.agent` 的消费者没有列全

- **spec 位置**：§4.6、§5、§6.6 第一条（「envelope 自带选择」）。
- **证据**（每一处都要跟着改，spec 一处都没点名）：
  - Orca `src/control/dispatch.ts:50`：`if(input.protocol!==1) throw …control-protocol-unavailable`；
  - `src/control/schema.ts:31`：`startEnvelopeSchema` 的 `protocol: z.literal(1)`，claim 是 strict 的；
  - `src/control/executionPort.ts:7`：`StartEnvelope { protocol:1 … }`；
  - `src/control/startEnvelope.ts:84-99`：从 run 行拼 claim，`protocol: 1 as const`；
  - `src/control/ownership.ts:9`：`assertClaimIdentity` 的键列表里没有 `agent`；`src/control/schedulerBridge.ts:25-26`：`claimOnly`；
  - 造 run 行的地方都要把 `agent` 拷过去：`webDispatch.ts:283`、`continuation.ts:41`、`budget.ts:111`／`:128`、`service.ts:119`；
  - ccloop `src/control/protocol.ts:143-151`、`:245-248`（`version !== 1` ⇒ `control-protocol-unsupported`）；`src/control/worker.ts:106` 用 `parseControlRequest("accept", …)` 读已落盘的 `envelope.json`：升级前 accept 的 run，升级后 worker 读不回来。
- **建议改法**：§5 加一张「消费者清单」表；写明「升级不跨越在飞的 run」（项目未上线，可以接受，但要写出来）。

### I2. capabilities v3（应答变成嵌套结构）的消费者没有列全

- **证据**：`src/control/types.ts:14`：`Capabilities = CapabilityViewV1 & { protocol: 2 }`；`src/control/budget.ts:84-88`：`assertCapabilities` 用 `capabilitiesSchema`（`webProtocol.ts:97`，`protocol: z.literal(2)`）校验 claim 带的能力；`ccloopPort.ts:74-78`；`unconfiguredPort.ts`；Orca 的协议替身 `tests/control/fixtures/fake-ccloop-control.mjs:5`、`:14`（写死 `--adapter` 的 argv 位置和 `protocol:2`）；`tests/control/fixtures/ccloopWorld.ts:37-41`。ccloop G1 spec §7.2 记过同样的教训：协议替身**本身就是判据**，「不改它，那道门量的还是旧协议」。
- **建议改法**：写明 v3 应答里的 `capabilities` 子对象仍叫 `CapabilityViewV1`（不带 protocol），列出上面每一处；§4.10 的「报人指名」清单把 Orca 这边的替身也收进去。

### I3. plan 文件删了 `configHash`，但规范化计划、草稿 work item、面板一致性检查、执行快照都没跟上

- **spec 位置**：§6.2 最后一条、§6.4 第 4 步。
- **证据**：已发布的 Web spec（`2026-09-19-web-recoverable-control-design.md:622`）里 `ControlPlanV1.tasks[].configHash` 进了 `planHash`；`planImport.ts:113`、`:210` 在导入时写入；`schema.ts:26` 的 `workSchema.configHash` 是 `min(1)`，草稿阶段就要有值；`src/panel/controlViews.ts:395` 以计划为准核 `body.configHash !== task.configHash`，不等就报 `work-item-authority`；`planFile.ts:240` 缺 `configHash` 就拒。执行快照 `executionSnapshot.ts:237-249` 里没有选择，`readConfirmedTaskExecution`（`:275-299`）也不核选择。
- **为什么要紧**：选择和 `configHash` 从计划搬到了 work item，但「以谁为权威」没有重新定义，面板的完整性检查会一上来就把所有任务判成 `work-item-authority`。选择不在快照哈希里，冻结的完整性就少了一层。
- **建议改法**：`ControlPlanV1` 去掉 `configHash`，并按 Rule 13 在 Web spec 里另起一节更正；草稿 work item 的 `configHash` 改成 `null`，确认时写入；执行快照升 v2，带上逐任务的 `{agent, configHash, 能力交集}` 和组的 estimator／reconcile 选择，`readConfirmedTaskExecution` 与 `controlViews` 都以快照为权威来核。

### I4. 每个 control 方法都要带 `--agents` 并读表：表坏了，在飞的 run 就收不回来

- **spec 位置**：§4.5、§4.2（「读表……不合法 ⇒ `agents-table-invalid`」）。
- **证据**：今天 `command.ts:120-135` 对所有方法都核 `--adapter-config` 的路径，但只有 accept 解析文件（`accept.ts:91`）。spec 把「读表并校验」写在命令层，没说 inspect、collect、handoff、read-evidence 也要不要解析。
- **为什么要紧**：人把表改坏一半（JSON 语法错误）的那段时间里，inspect 和 collect 全部失败，recovery 被堵住。
- **建议改法**：写明只有 `capabilities` 和 `accept` 解析表，其余方法不读表（或者只核路径）。加一条判据：accept 之后把表写坏，collect 仍然成功。

### I5. `killGraceMs`：Orca 读的是当前的表，ccloop 用的是冻结的配置

- **spec 位置**：§6.6 第三条。
- **证据**：`src/panel/controlAssembly.ts:117-123`：`handoffGraceMsOf` 自己解析配置文件；ccloop worker 用的是 accept 时冻结进 `config.json` 的值（`accept.ts:112-116`；`runCodexPhase.ts:65`）。
- **为什么要紧**：Orca 要自己解析 ccloop 的表 schema，这违背 I3 的精神（物化规则只住在 ccloop 一处）；表改过之后，两边的宽限期就不一样了。
- **建议改法**：capabilities 的 v3 应答里带回物化配置的 `killGraceMs`（和 `timeoutMs`），Orca 把它和选择一起冻结在 work item 上。`handoffGraceMsOf(run)` 读冻结值，Orca 不再解析表。

### I6. `contextWindowTokens` 在两边有两个意思

- **spec 位置**：§3 的「选择」一行、§4.1、§4.6（「contextWindowTokens 取自选择」）。
- **证据**：在选择里，`null` 表示「用 agent 自己的默认」（§4.1）。在能力里，`null` 表示「不知道／不可用」：`profiles.ts:98-101` 求交时遇 `null` 就是 `null`，`estimator.ts:71` 遇 `null` 就阻塞估算，`contextControl.ts:56-60` 遇 `null` 就判观察无效。另外，「能力取自选择」等于把一个**请求值**当成**观测值**报出去：假如 claude 静默忽略了 1M 参数，能力照样报 1M。这和 `ccloopPort.ts:52-72` 那条「不许替对端编造观测」的规矩相冲突，只不过这回编造的是 ccloop 自己。
- **建议改法**：选择字段改名（例如 `contextWindow`，取值 `"agent-default" | number`），或者在 §3 里写明这两种 `null` 的区别；capabilities 的 `contextWindowTokens` 只在描述里有 **Task 0 核实过的**映射时才非 `null`。

### I7. profile v2 仍然带着与模型绑定的字段

- **证据**：`webProtocol.ts:111-126`：`contextTokenizer`、`estimatorPreflight.tokenizer`；`resolved.tokenizerArtifactHashes`／`secretValueHashes`（`:126-139`）。§6.5 把它们列在「留」里。
- **为什么要紧**：模型身份已经搬进了选择，但分词器声明还在一份组级的 worker profile 里。一个声明了 codex 分词器的 profile 去跑 claude 任务，上下文观测和估算的前提就错了。
- **建议改法**：分词器挪到描述或 capabilities 的应答里（按 kind 或 model 给）；或者写一条约束「profile 的分词器只对某些 kind 有效」，在冻结时核对；实在不做，就登记进 §11。

### I8. 分层合并的规则能读成几种意思

- **spec 位置**：§6.1、§6.2、§6.3。
- **有歧义的地方**：
  - (a) 「换 agent 的层会重置」和「若某层设了 `agent`」不是一回事：任务层显式写了与上层相同的 agent，要不要丢掉组层给的 model？
  - (b) 标题写的是「重置 model／上下文」，正文只描述了 model；
  - (c) 操作者层的文档形状 `{defaultAgent, perAgent, estimator, reconcile}` 不是 `PartialSelection`，而 §6.3 的 `resolveSelection(layers)` 的输入形状没有定义；
  - (d) reconcile 槽：`operator.reconcile` 和组层的 `agent`（worker）谁优先？estimator 的「缺省：操作者默认」指的是 `operator.estimator`，还是操作者的 worker 默认？
  - (e) 哪一层都没给 agent（新装的机器、操作者没设过偏好）时怎么办：§7 没有对应的错误码，而且描述默认值补不出 installationId。
- **建议改法**：给出 `resolveSelection` 的形式定义（输入类型、逐字段的伪代码），(a) 到 (e) 每条给一个裁定和一条判据；(e) 建议给具名码 `agent-unselected`。

### I9. estimator 在两处冻结，互相矛盾；导入的行为也变了

- **证据**：§6.4 第 4 步说确认时把 estimator 选择写进组记录；下一段又说导入时冻结，`reestimate` 按当时的层重解。估算只能在确认之前发起（`webService.ts:226` 的 `prestart(group)`），所以确认时写下的 estimator 值没有读者。§7 把「plan 导入时槽位解析失败」列为拒绝导入；今天的行为是探测失败只让估算停在 `blocked-capability`，导入照样成功（`planImport.ts:174` 的 `preflightEstimate`；`ccloopWorld` 就靠这一点在「窗口为 `null`」时照常跑）。
- **建议改法**：删掉第 4 步里的 estimator；写明 estimator 解析失败时是退化成 `blocked-capability`，还是拒绝导入。

### I10. 新命令需要新的目标类型；也缺一张「封闭 schema／枚举跟改清单」

- **证据**：`src/control/commandLedger.ts:40-47`：scope 只有 `group`／`global`／`repository`，而 `set-agent-preferences` 的目标是 operator；`panelOperatorId` 存在 `meta` 表（`src/panel/controlApi.ts:176-183`）。执行驱动 spec §7.4（第 183 行）因为评审 I10 专门立了「封闭 schema 跟改清单」，本 spec 没有。
- **建议改法**：新增目标 `{kind:"operator", operatorId}` 和 scope，revision 取自 `agent_preferences.revision`（仿 `repositoryRevision`，`commandLedger.ts:54-60`）。补清单：`commandVerbSchema`（`webProtocol.ts:518-532`）、raw 与 effective 两套 variants、result kinds、`web/src/controlTypes.ts`、`controlPlanSchema`、`planTaskSchema` 与 `planFileSchema`、`workSchema`、`executionSnapshotSchema`、两仓各自的 `startEnvelopeSchema` 和 `capabilitiesSchema`。

### I11. 旧路径和环境变量的消费者漏了

- **证据**：
  - `service.ts:119`：旧 `ControlService` 的 reconcile work 直接继承父任务的 `configHash`，和新的 reconcile 槽冲突；
  - `runTask` 由旧的 `orca run` 和驱动的解冲突共用（`ccloopRunner.ts:54-61`、`:277-288`）；
  - ccloop 的 `resume` 和 `sweep` 只认 `--adapter`（`cli.ts:149-157`、`:179-190`）：用 `--agents` 起的 run 没法 resume，也没法被 sweep；
  - `ORCA_CCLOOP_ADAPTER_CONFIG` 的其余消费者：`src/panel/controlOptions.ts:107`、`src/panel/controlConfig.ts:57`、`:71-73`（`execution-port-adapter-config-mismatch` 不变量）、`src/control/unconfiguredPort.ts:23`、`web/src/ControlPanel.tsx:102`、`scripts/verify-control.mjs:7-9`、`scripts/live-driver-acceptance.ts:118`、`:137`、`src/cli.ts:59`。
- **建议改法**：§6.6 列全这些消费者；对 resume 和 sweep 明确表态（加 `--agents` 形态，或者登记为不支持）。

### I12. §4.10 的「报人指名」清单只列了 ccloop

- **证据**：Orca 这边编码了旧线上契约的判据有：`tests/control/fixtures/fake-ccloop-control.mjs`、`ccloopWorld.ts:29-36`（`ccloopHash` 在测试里重算 configHash，I3 之后必须改成从 capabilities 取）、`ccloopWorld.ts:99`（plan 里的 `configHash`）、`webCcloopSmoke.test.ts`、`handoffE2E.test.ts`（`.calls`）。
- **建议改法**：Task 0 的清单覆盖两个仓。

### I13. 判据本身的问题

- **§9.8 后半句不可能红**：「确认后改操作者默认值 ⇒ 已冻结的 `configHash` 不变」读回的是存储里的值，没有任何代码会重算它（Rule 9 推论 2 的形状）。改成：改完默认值之后跑一次派活，断言发出去的 envelope 里的 `claim.agent`、fake 的 `.argv` 里的 `--model`、以及闸门探测时用的选择，都是冻结值。这一条同时覆盖 C3。
- **§9.4 有时序竞争**：注册回调抛错之后，adapter 杀掉进程组。「变异：先写 stdin」下，runner 能不能在被杀之前把 fake CLI 拉起来并写下 `.calls`，取决于 node 启动快慢，变异可能照样绿。改成：注册回调挂起在一个由测试控制的 promise 上；断言用 runner 自己的「stdin 已收到」标记（或 `.argv` 为空），在回调放行之前就量。
- **§9.2 缺反方向**：改表里**另一条**安装记录，这一条的哈希必须不变；否则改任何一条都会让所有组失效。
- **§4.8 的 `usageBeforeDelay` 没有读者**：§4.7 规定被中止时恒抛 `observedTokens: null`，fake claude 提前报 usage 也不会被读。要么删掉，要么说明它读在哪里。
- **没有判据的行为**：control 下旧的 `--adapter` 被拒；envelope `protocol: 1` 被拒；`ccloop run` 的 `--agents` 与 `--adapter` 互斥；reconcile 的选择到达 CLI 的 argv；`handoffGraceMs` 按 run 取值；plan 文件带 `configHash` 被拒、`agent` 字段被接受；`env`／`secretEnv` 被 strict 拒收（I4 的机制）；`proposal-set-agent` 推进 `proposalVersion`；`set-agent-preferences` 的 revision 过期；表是软链或非普通文件时被拒；§8 的临时文件残留与清理。

### I14. 安全与信任边界

- **表的属主和 mode 不核**：§4.2 只核 `O_NOFOLLOW`、普通文件、realpath。而表里写的是 ccloop 要执行的二进制；§8 又规定已存在的表不改 mode，所以一张 0666 的表会被照单全收。建议 ccloop 读表时要求属主是 euid、`mode & 0o022 == 0`（父目录同样），否则报 `agents-table-invalid`。
- **detect 会执行 PATH 里所有叫 claude／codex 的候选**：包括相对路径条目和全局可写目录。建议跳过非绝对路径的 PATH 条目和全局可写目录。
- **model 字符串来自浏览器，信任边界放宽了**：Web spec §3.1（`2026-09-19-…:133`）只允许浏览器发「稳定 id、组命令、可编辑的数值策略」，model 是自由字符串。spec 应当另起一节更正 Web spec，并规定 `validateSelection` 拒绝以 `-` 开头、含空白或控制字符的 model；runner 的「额外参数」要以 JSON 数组经环境变量传入，不许按空白切分。
- **「本设计认 `CLAUDE_CONFIG_DIR`／`CODEX_HOME`」没有机制**：配置目录不在安装记录里，因而不进哈希；子进程继承的是 daemon 的环境（`runCodexPhase.ts:47`、runner `:394` 都是 `env: process.env`）。建议把 `configDir` 记进安装记录，spawn 时显式设置对应的环境变量，让它进哈希。

### I15. claude 的工具子进程可能脱离进程组

- **spec 位置**：§4.7「runner 与 claude 子进程同属该进程组」、判据 5。
- **问题**：claude 的 Bash 等工具拉起的进程（包括后台进程），如果另开了进程组或会话，按 `-pgid` 杀不到，`stopProof.ts:74-98` 的探测也看不到，于是又回到 `isolated:true` 空洞成立。判据 5 的孙进程是非 detached 的，照不出这种情况。
- **建议改法**：Task 0 零成本核一下（读文档或源码；不核就登记），把它写进 §11 的已知限制，别让 §9.5 被读成「整棵树都杀掉了」。

---

## Minor

- **M1**（§3 I1）：「续跑、解冲突继承同一份选择」紧接着就说「解冲突用组的 reconcile 槽」，前后两句打架。改成「续跑继承同一份；解冲突用组冻结的 reconcile 选择」。
- **M2**（§1.7）：「cc-switch 不认 `CODEX_HOME`」不准确。它不读这个环境变量，但会从真身路径推出 `CODEX_HOME` 并传给 installer（`src-tauri/src/commands/misc.rs:556`、`:604`）。
- **M3**（§4.2、§4.3）：没写 `command` 存的是 path 还是 realpath。nvm 装的 codex 和 claude 是 `#!/usr/bin/env node` 脚本，worker 的 PATH 里得有 node。
- **M4**（§4.6）：现在有三个版本号并存（envelope 2、capabilities 3、handoff request 1）。应写明 ccloop `protocolVersion()`（`protocol.ts:224-230`）对 handoff、collect、read-evidence 读的是 `input.protocol`。
- **M5**（§6.3）：用「应答与请求逐字段比」来反推来源，前提是 ccloop 原样回显请求里给了的字段（不把别名规范化成全名）。这条要写成契约。
- **M6**（§8、§4.7）：「下次 init 清掉临时文件」要限定成只清自己命名模式的文件、不跟随软链；`request.json` 不得记录环境变量。
- **M7**：真 claude 的 `-p` 会把会话写进配置目录，而 `--no-session-persistence` 这个参数是存在的（`claude --help` 第 140-142 行）。付费跑那一片要按 Rule 17 登记。
- **M8**：`claude` 自己也有 `--agents` 参数和 `agents` 子命令（help 第 14-18、264 行），和 `ccloop agents`、`--agents <table>` 同名。文档里要分清。
- **M9**（§9.5）：「runner 的子进程（fake claude 起的孙进程）」把层级说乱了。应为：fake claude 是 runner 的子进程，fake claude 拉起的是 runner 的孙进程。
- **M10**（§4.2）：沿用 `parseCodexConfig` 的上限时要写全：`timeoutMs ≤ 2_147_483_647`、`killGraceMs ≤ 60_000`（`protocol.ts:10-11`）。

---

## 核实无误的事实性陈述

- §1.1：`command.ts:123`（`argv[2] !== "codex"`）、`accept.ts:91` 与 `worker.ts:107`（`parseCodexConfig`）、`worker.ts:153`（`new CodexAdapter(config)`）；`defaultHandler` 回常量，`contextWindowTokens: null`（`command.ts:139-153`）。
- §1.2：`subprocessClaudeAdapter.ts:25-28` 是非 detached 的 spawn，`:49` 只对子进程发 `SIGTERM`，全文没有 `onProcessRegistered`；`stopProof.ts:100-108` 对空数组返回 `true`；闩住检查挂在 `onProcessRegistered` 上（`worker.ts:157-163`）。
- §1.3：runner 用 `-p --output-format json`（`:381-396`），usage 由 `buildUsageEvidence` 从最后的信封里取（`:113-149`、`:444`）。
- §1.4：`controlAssembly.ts:135`、`ccloopPort.ts:33-35`、`executionPort.ts:24`、`driverLanding.ts:285`、`webProtocol.ts:143`，全部命中。
- §1.5：`adapterConfigRef` 在 `src/` 里只出现在 `webProtocol.ts:109` 的 schema 定义中；plan 的 `configHash` 来自 `planTaskSchema`（`planFile.ts:108`）；accept 核 canonical hash（`accept.ts:91-95`）。
- §1.6：`continuation.ts:35`、`executionDriver.ts:314`、`dispatch.ts:24` 都按 `configHash` 相等核对；`set-workspace-mode` 的形状（`workspaceSettings.ts`、`commandLedger.ts:50-59`）；`confirmPayloadSchema` 绑定 `proposalVersion`（`webProtocol.ts:599-608`）。
- §1.7：`ONE_M_CONTEXT_MARKER = "[1m]"`（`claude_desktop_config.rs:33`）；`struct ToolInstallation`（`misc.rs:2384` 起）；`enum AppType` 的成员与 spec 所列一致（`app_config.rs:396` 起）。
- §4.1 Task 0 的前提：`claude --help`（2.1.282）的 `--model` 只写了别名（`fable`／`opus`／`sonnet`）和全名（`claude-fable-5`），没有 `[1m]`；`--autocompact <auto|tokens>` 是 100k–1M 的自动压缩窗口，不是上下文窗口。spec 的描述准确。
- §4.7 的时序可行：runner 在 `readStdin()`（`:432`）之后才拉起 claude，所以「先注册、后写 stdin」能挡住 claude 被拉起；`runCodexPhase.ts:47`、`:51`、`:89-97` 是可以照抄的形状（detached、`-pid` 杀组、注册之后才 `stdin.end`）。
- §6.6：`handoffGraceMsOf` 读不到时取 0（`controlAssembly.ts:117-123`）。
- 推送顺序、Rule 15 的处理（§5 末）与 CLAUDE.md 一致。
