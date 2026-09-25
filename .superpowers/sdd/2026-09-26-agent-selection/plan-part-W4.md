# Agent 选择 —— 计划 W4 部分：T7（Orca 线上 v2／v3）、T12（解冲突 run 走 `--agents`）、T13（`orca agents` ＋ Web spec 两节 ERRATUM）

> **归属**：计划写作席 W4（Claude Opus 5.5），Orca 控制器会话 `75ec878e` 派出，2026-09-26。
> **观测锚点**：Orca 主题行 `chore(checkpoint): orca-dev-75ec878e, level 335434 of 1000000 (T1 330000, T2 450000, band 1)` 那一笔（`545f452`）；ccloop 主题行 `docs(handoff): roll the Orca section: C5-C7 and C-3 landed here for the handoff delivery round`（`f4e49a2`）。**行号会移动 ⇒ 引用前现测。**
> **本部分的代码全部在写作席副本里实跑过**：`scratchpad/W4/orca`（`git clone --local`，基于 `545f452`；`node_modules` 软链主树）。下文每个 diff 都是从该副本 `git diff` 机械导出的，不是手抄；实跑结果与命令见各 Task 的 Expected 与 §W4.3。ccloop 的 T1–T6 尚未落地，**依赖真 ccloop 新 build 的判据（`ORCA_CCLOOP_BIN` 门控的四个文件）没有跑过**，Task 7 Step 8 写明了怎么跑、预期什么。
> 已收到并已落实的控制器裁定：W6-11、W6-12、W6-15（有一处冲突，见 M-3）、W6-18、W6-19、T1 的 probeVersion 规则、W5 的 (1)(2)(3)。

---

## W4 现量

### W4.1 代码现量（HEAD `545f452`；命令：`cat -n <file>` 或 `sed -n '<a>,<b>p' <file>` 读，`grep -n` 定位；ccloop 同法读 `f4e49a2`）

| # | 事实 | 位置 |
|---|---|---|
| 1 | start envelope 是 `protocol: z.literal(1)`，claim 无 `agent` | `src/control/schema.ts:33`；类型 `src/control/executionPort.ts:7` |
| 2 | `workSchema`（legacy `putWork` 与解冲突预备 work 用）是 `.strict()`，有 `configHash` 无 `agent` | `src/control/schema.ts:26` |
| 3 | 端口的两个能力方法：可选 `probeProfileCapabilities?()` 与 `capabilities()` | `src/control/executionPort.ts:15-16`；实现 `src/control/ccloopPort.ts:74-78`；拒绝实现 `src/control/unconfiguredPort.ts:27-28` |
| 4 | 端口选项 `{binary, adapter:"codex", adapterConfigPath, timeoutMs}`，argv `control <m> --adapter codex --adapter-config <file>` | `src/control/ccloopPort.ts:33-35`、`:38`；`executionPort.ts:24` |
| 5 | `Capabilities = CapabilityViewV1 & {protocol:2}`，进 claim 命令载荷（`ClaimInput.capabilities`）；`assertCapabilities` 用 `capabilitiesSchema`（带 `protocol:2`） | `src/control/types.ts:14`、`:30`；`src/control/budget.ts:84-88`；`src/control/webProtocol.ts:96` |
| 6 | 造 claim／run 行、拷 `configHash` 的四处：`claimWork`（含 handoff 父 run 分支）、`claimContinuation`、`webDispatch` 的 run 构造、估算 run | `src/control/budget.ts:111`、`:128`；`src/control/continuation.ts:41`；`src/control/webDispatch.ts:283`；`src/control/webService.ts:292` |
| 7 | 派活闸门调 `port.capabilities()`：`startClaim` 与 `reconcileStart` 的 absent 分支；`protocol!==1` 闸 | `src/control/dispatch.ts:50`、`:52`、`:77` |
| 8 | `assertClaimIdentity` 的键表不含选择 | `src/control/ownership.ts:9` |
| 9 | `claimOnly` 逐字段拷 claim；legacy 预检调 `profiledCapabilities`／`legacyCapabilities`；legacy envelope `protocol:1` | `src/control/schedulerBridge.ts:24-27`、`:125-127`、`:157` |
| 10 | `toStartEnvelope` 的 run 行 schema 与拼装 | `src/control/startEnvelope.ts:17-31`、`:76-96` |
| 11 | `ControlService` 的能力方法（`legacyCapabilities`／`profiledCapabilities` 先 router.probe 再 `port.capabilities()`）与三处 legacy 造 envelope | `src/control/service.ts:76-91`、`:119`、`:177` |
| 12 | router 的 `probe(profile)` 调 `port.probeProfileCapabilities`，`ownPort` 绑定两个能力方法，`unboundPort` | `src/control/profiles.ts:147-166`、`:60-78`、`:43-50` |
| 13 | 其余 `router.probe` 调用点（全部无选择）：`scheduleStart`、`deliverScheduledStart`、估算创建与领取、导入预检、面板 `readView`、model-assisted handoff | `src/control/webDispatch.ts:85`、`:165`；`src/control/webService.ts:228`、`:266`；`src/control/planImport.ts:274`；`src/panel/controlConfig.ts:206`；`src/control/stopIntent.ts:562` |
| 14 | 面板读模型的 run 行 schema 是 `.strict()` ⇒ run 行多一个 `agent` 字段就整组拒读 | `src/panel/controlViews.ts:106-144` |
| 15 | `ORCA_CCLOOP_ADAPTER_CONFIG` 的消费者 | `src/panel/controlOptions.ts:107`；`src/panel/controlAssembly.ts:117-124`（`handoffGraceMsOf` 读 adapter 配置的 `killGraceMs`）、`:135`、`:188`、`:255-257`；`src/panel/controlConfig.ts:32`、`:57`、`:71-73`、`:148`；`src/cli.ts:59`（USAGE）；`web/src/ControlPanel.tsx:102`；`scripts/verify-control.mjs:7-9`；`scripts/live-driver-acceptance.ts:62-69`（本地重算 `ccloopHash`）、`:99-103`、`:118`、`:137`；判据侧见 #20 |
| 16 | 解冲突 run：`runTask(..., {adapter:"codex", adapterConfig: deps.adapterConfigPath, ...})`；`runTask` 拼 `--adapter <a> --adapter-config <f>` | `src/control/driverLanding.ts:282-285`；`src/scheduler/ccloopRunner.ts:48-62`（`RunTaskOptions`）、`:278-288`；`ExecutionDriverDeps.adapterConfigPath` 在 `src/control/executionDriver.ts:57-59` |
| 17 | handoff 宽限：`deps.handoffGraceMs ?? HANDOFF_EXTRA_GRACE_MS`，同步判断 | `src/control/driverHandoff.ts:180-183`；`executionDriver.ts:66-67` |
| 18 | 错误目录：`control-adapter-config-invalid`（internal）；durable 表无任何 `agent-*` 码 | `src/control/errors.ts:140`；`:8-122` |
| 19 | 控制 store 无只读打开：非恢复打开被占 ⇒ `control-writer-active` | `src/control/store.ts:45-69` |
| 20 | 判据侧硬编码旧线：`fake-ccloop-control.mjs` 按 `--adapter-config` 位置读配置；`ccloopWorld.ts` 本地重算 ccloop 的 canonical hash（`:29-36`）、写 adapter 配置（`:76-78`）、plan 行 `configHash: ccloopHash(adapter)`（`:98`）、env（`:108`）；`fake-ccloop-run.mjs` 读 `--adapter-config`；`fake-control-peer.mjs` 答 protocol 2 | `tests/control/fixtures/fake-ccloop-control.mjs:5-6`；`tests/control/fixtures/ccloopWorld.ts`；`tests/control/fixtures/fake-ccloop-run.mjs:12`；`tests/control/fixtures/fake-control-peer.mjs:17` |
| 21 | ccloop 侧今天：`parseCommand` 只收 `--adapter codex --adapter-config`；control 出错走 stderr `<message>\n`、RC 1（协议错 2） | ccloop `src/control/command.ts:113-137`、`:211-218` |
| 22 | Web spec 待加 ERRATUM 的原文位置：`ControlPlanV1` 的 `configHash: string;`、「`configHash` is the validated…」、「target and config hashes」、§3.1「adapter type and adapter configuration;」与「The browser may send stable IDs…」；文件 1692 行、以换行结尾、已有四节 ERRATUM 的写法（英文、归属行、「The original text above is kept verbatim.」） | `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md:622`、`:629`、`:633`、`:126`、`:133`；末尾 `:1647-1692` |

### W4.2 与 spec／骨架／裁定不符之处（**不静默偏离**；每条给建议，控制器定）

| # | spec／骨架／裁定原文 | 实测事实 | 本计划怎么写（建议） |
|---|---|---|---|
| M-1 | 骨架共用接口只列 `resolveAgent`／`listAgents`；spec §5.1 把 `types.ts（Capabilities）`、`budget.ts（assertCapabilities）`、`webProtocol.ts（capabilitiesSchema）` 列为 capabilities v3 的消费者 | `Capabilities` 带 `protocol:2` 标签、进 claim 命令载荷（W4.1 #5）；v3 下这个标签不再对应任何线上形状 | **删** `Capabilities` 类型与 `capabilitiesSchema`；claim 载荷与 `assertCapabilities` 一律用无标签的 `CapabilityViewV1`／`capabilityViewSchema`；v3 的两种应答 schema 放在 `ccloopPort.ts`（与其余应答 schema 同处）。代价：`capabilitySchema.test.ts` 整条改写（见红表） |
| M-2 | W5 裁定 (3)：T7 给 `workSchema`／`WorkInput`／`Claim` 加 `agent`，「T11 之前草稿照今天带 configHash」 | Web 的 work item 在 T11 冻结之前**没有任何生产代码写 `agent`** ⇒ T7→T11 期间 Web run 行无 `agent`，`toStartEnvelope` 以 `start-envelope-conflict`（`run:agent`）拒，驱动环 A2 block | **接受生产上的这段空窗**（项目未上线），判据侧用三个**临时桥**在导入后把完整选择写进 work item：`tests/control/fixtures/web.ts`（`FIXTURE_AGENT`）、`tests/control/fixtures/ccloopWorld.ts` 的 `startGroup`（问真端口 `resolveAgent({agent:"codex"})`）、`scripts/live-driver-acceptance.ts`。三处都带注释 `Agent selection plan T7 bridge … T11 … deletes this`，**T11 必须删掉这三处**（`grep -rn "T7 bridge" tests scripts`）。备选：不加桥，接受 driver 系判据在 T7→T11 期间红 —— 不建议 |
| M-3 | W6-15：「T7 之后 ccloopWorld 的 plan 行不再带 configHash」 | 与 W5 (3)「T11 之前草稿照今天带 configHash」冲突：T10 之前 `planTaskSchema` 仍要求 `configHash`（`src/scheduler/planFile.ts:240` 的 `task-control-metadata`），不带就导入失败 | 按 **W5 (3)** 写：T7 的 plan 行仍带 `configHash`，但值来自 `resolveAgent`（不再本地重算，满足派发原文「configHash from resolveAgent not recomputed」）；W6-15 的命名全部照办（`<root>/agents.json`、0600、变量名 `table`、`codex` 一行、`ORCA_AGENTS_TABLE`）。T10 删 plan 行的 `configHash`，T16 看到的终态与 W6-15 一致 |
| M-4 | 骨架：T12 做「解冲突 run 走 `ccloop run --agents --agent-selection`」，依赖 T6、T11；T7 依赖 T5 | T7 撤掉 `ORCA_CCLOOP_ADAPTER_CONFIG` 之后，驱动环的解冲突 run 再没有 adapter 配置可用（W4.1 #16）⇒ T7→T12 期间所有冲突落地必红 | **机制挪进 T7**：`RunTaskOptions` 加 `--agents` 变体、`driverLanding` 写 0600 选择文件、`fake-ccloop-run.mjs` 改收新形态并拒旧形态；T7 的选择来源是**被冲突 run 自己冻结的 `{agent, configHash}`**（今天解冲突与 worker 用同一份配置，等价）。T12 只把来源换成组的 `reconcileSlot` 并在缺失时 block。⇒ **T7 依赖改为 T5＋T6** |
| M-5 | 骨架：「`handoffGraceMs` 用冻结值」归 T11 | T7 撤 env 之后 `handoffGraceMsOf(adapterConfigPath)` 没有输入；不给就回落 60 s，`handoffE2E` 的 G 场景（断言 ≥ deadline＋killGraceMs＋60 s）在 T7→T11 期间红 | T7 给出 `driverHandoff.handoffGraceMsOf(port, agent)`：按 run 冻结的选择问 ccloop 的 `killGraceMs`（每个 run 在一个驱动环生命期里只问一次，且只在已过 deadline＋60 s 之后才问），取不到或不是非负安全整数 ⇒ 按 0 计（与旧规则同一下限）。T11 把函数体换成读 work item 冻结的 `killGraceMs` |
| M-6 | W5-M2 (a)：`probe(profile, selection?)`，无选择时走 T7 自定的临时路径 | 选项里「listAgents＋profile 的声明能力」会让 `setObserved` 类判据（`webContinuation`、`estimator`、`webCcloopSmoke` 的降级场景）失效 —— 能力不再来自端口 | 临时路径＝**表里 id 字典序第一条安装、不覆盖任何字段，`resolveAgent` 它**：能力仍然来自 ccloop（不以声明冒充观测），降级类判据不改；表为空 ⇒ `control-capability-probe-failed`。标 **TEMPORARY**，并由一条同样标 TEMPORARY 的判据钉住（T11 连同该路径一起删）。测试替身（`web.ts`、`controlPanel.ts`、三个面板判据的端口）因此都答一条 `codex` 安装 |
| M-7 | spec §6.4 末段：闸门逐调用点用冻结选择（T11） | legacy 路径（`ControlService` 的 `claimLegacy`／`claimProfiled`／`reconcileBudget*`／`startProfiled`／`reconcileStartForRun`／`requestHandoff`／`continueTask`、`schedulerBridge` 预检）也调旧能力方法，T7 不改就编译不过 | T7 让它们问「将要派的那个选择」：claim 用 `work.agent`、start 用 `input.claim.agent`、续跑用前任的 `agent`、handoff 用被 handoff 的 run 的 `agent`、legacy 解冲突用被冲突任务的 `agent`；group 级预检（`run()`、`preflight`）对 `workAgents` 返回的每个不同选择各探一次。这是 legacy 路径的**最终**形态，T11 只动 Web 闸门 |
| M-8 | spec §6.7：`orca agents show` 打印「每条安装记录与当前操作者默认值的解析结果」 | 操作者默认值在面板的控制 store（T9 的 `agent_preferences`）；CLI 打开它会与在跑的面板抢单写者锁（W4.1 #19），且 store 没有只读打开 | `show` 打印 `ccloop agents validate` 的原样输出（格式归 T2，不在这里解析，只用其退出码）与**每条安装在无任何层覆盖时的解析**（`resolveAgent({agent:id})`）；操作者默认值的解析在面板 Agents 页（T14/T15）看。若人要 CLI 也打印，需先给 store 加只读打开（另起） |
| M-9 | spec §3、§8：「Orca 默认 `~/.orca/agents.json`，可由 `ORCA_AGENTS_TABLE` 改道」 | 面板今天要求两个 env 都给才算 configured（`controlOptions.ts:107`，判据「needs both variables」钉着） | 面板**保持两个 env 都给**（`ORCA_CCLOOP_BIN`＋`ORCA_AGENTS_TABLE`），不回落缺省路径；缺省路径只用在 `orca agents init|show`。控制器决定，可逆 |
| M-10 | 对 ccloop 的依赖（T1／T2／T3／T5） | 这些不在 Orca 里 | (a) fake codex 与 fake-claude-cli 答 `--version` 且不记 `.calls`／`.tasks`／`.argv`（T1 裁定已写）；(b) envelope `protocol:1` 被 ccloop 拒时的码按今天的 `control-protocol-unsupported` 写（`webCcloopSmoke`）；(c) AgentError 在 stderr 以 `<code>` 或 `<code>:<detail>` 开头（`peerErrorCode` 据此取码，W6-11 的改名抛出靠它）；(d) ccloop 对**缺 `agent` 的 partial** 的行为 spec 未定 —— 本部分没有任何调用点发缺 `agent` 的请求（临时路径总带 `agent`） |
| M-11 | 骨架：`src/control/agentSelection.ts` 的类型；W5 (1)：T8 先于 T7 | — | T7 **不建** `agentSelection.ts`，只 import T8 建的 `AgentSelection`／`PartialSelection`／`ContextWindow`／`AgentResolution`；`AgentsView` 定义在 `executionPort.ts`（骨架把它写在 ExecutionPort 段）；zod 形状 `contextWindowSchema`／`agentSelectionSchema`／`partialSelectionSchema` 放 `schema.ts`（线上原语的家）。若 T8 也在别处定义了同名 zod schema，以先落地者为准、后者 import |
| M-12 | W6-11／W6-12 | — | 端口路径检查的码 `control-adapter-config-invalid` 改名 `control-agents-table-invalid`（internal）；W6-12 的六个码（`agent-installation-missing`、`agent-context-unsupported`、`agent-selection-invalid`、`agent-version-drift`、`agents-table-invalid`、`agent-unselected`）进 durable 表 422；`resolveAgent`／`listAgents` 把 ccloop 的前五个按原名抛出（`listAgents` 也做，因 `agents-table-invalid` 同样可能从它来 —— 比 W6-11 字面多一处，控制器可删） |
| M-13 | spec M5「请求里给了的字段原样回显」 | 回显由 ccloop 保证，Orca 的来源标注靠它 | 端口核对回显：给了的字段不等 ⇒ `control-response-invalid`（detail `selection-not-echoed:<field>`）。控制器决定，可逆 |
| M-14 | 骨架：T13 依赖 T7 | ERRATUM 的内容引用 T10／T11 的形状（草稿 `configHash:null`、执行快照 v2、`selectionsHash`、带 `configHash` 的 plan 被拒） | T13 可在 T7 后任何时候落，但 ERRATUM 的**措辞**按 spec 写；若 T10／T11 实施时改了名，另起一节更正（Rule 13，不改已写的） |
| M-15 | 骨架 Global Constraints：「全量套件不并发跑」 | 写作席按 brief 只许单文件；本部分的「全部相关文件」是**逐个单跑、串行**的（`scratchpad/W4/runone.sh`） | 实施席在 T7 收尾照 T17 的门跑全量 |

### W4.3 实跑记录（副本 `scratchpad/W4/orca`）

全部在 `scratchpad/W4/orca`（`git clone --local` of `545f452`）里，分支 `t7`（本部分 T7 的全部改动，外加一份与骨架逐字相同的 T8 类型文件 `src/control/agentSelection.ts`，不属于本部分）、`t13`（＋T13）、`t12`（＋T12）、`t12s`（＋一个只在副本里的 T11 替身，见 Task 12）。日志与 JSON 都在 `scratchpad/W4/`；逐文件单跑的脚本是 `scratchpad/W4/runone.sh`（`env -u ORCA_CCLOOP_BIN ./node_modules/.bin/vitest run <file> --reporter=json --outputFile=<json>`，串行），汇总脚本 `summ.py`。

| 什么 | 命令 | 结果 |
|---|---|---|
| typecheck，分支 `t7` | `./node_modules/.bin/tsc --noEmit -p tsconfig.json > ../tsc-t7.log 2>&1` | rc=0 |
| typecheck，分支 `t13` | 同上 → `../tsc-t13.log` | rc=0 |
| typecheck，分支 `t12` | 同上 → `../tsc-t12.log` | rc=0 |
| web typecheck | `(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json)` → `../../webtsc.log` | rc=0 |
| `tests/control/*.test.ts` ＋ `tests/panel/*.test.ts` ＋ `tests/agents/command.test.ts`，逐个单跑（先 `vite build` 了 web） | `../runone.sh ../runs5 <96 个文件>`；`python3 ../summ.py ../runs5/*.json > ../runs5-summ.txt` | 96 个文件全部 rc=0，零失败；skip 只有 `ORCA_CCLOOP_BIN` 门控的：`ccloopProtocol.integration` 3、`executionDriverE2E` 9、`handoffE2E` 12、`webCcloopSmoke` 3（另 2 条 passed） |
| 上面跑完后又加了两条端口判据（具名拒绝、TEMPORARY 探测），单跑重测 | `../runone.sh ../runs4 tests/control/ccloopPort.test.ts tests/control/profiles.test.ts` | ccloopPort 15/15、profiles 10/10 |
| web banner | `(cd web && ../node_modules/.bin/vitest run tests/controlPortBanner.test.tsx) > ../../webbanner.log` | 6/6 |
| T12（分支 `t12s`，带 T11 替身） | `../runone.sh ../runs6 tests/control/driverReconcile.test.ts tests/control/driverReconcileN.test.ts tests/control/driverHandoff.test.ts tests/control/blockedStaysPut.test.ts` | 26/26、5/5、29/29、4/4 |
| Web spec 只追加 | `git diff -- <web spec> > ../errata.diff; ./node_modules/.bin/tsx src/cli.ts check-append-only < ../errata.diff > ../errata-check.log` | rc=0，`ok: append-only` |
| 变异 | `python3 mutate.py mut muts-t7.json mut-t7.out`（`mut` 是副本的 `git clone --local`，检出对应分支；每条改一处、单跑一个文件、还原，最后记 `git diff --stat`） | 见各 Task 的变异表 |
| 会红的既有判据 | 见红表上方的「测法」 | 见红表 |
| **没跑的** | 真 ccloop 新 build 下的 `webCcloopSmoke`（real 三条）、`executionDriverE2E`、`handoffE2E`、`ccloopProtocol.integration` | ccloop T1–T6 尚未存在；Task 7 Step 8 写了命令与预期 |

---

## 既有判据会红 —— 全名清单（Orca；按人 2026-09-26「同意修改几个仓库的现有test」整条改写，不放宽，改后注释 `// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): <它现在编码什么>`）

**测法**：在副本 `scratchpad/W4/orca-red` 里放 T7＋T12＋T13 的最终 `src/`、最终夹具（`tests/**/fixtures/**`），但把**被本部分改过的每个判据文件恢复成 `545f452` 的原样**，逐文件单跑（`vitest run <file> --reporter=json`，输出进文件后整份读回）。下表是其中红的每一条；「改写」一栏是本计划给它的整条改写所在 Step。夹具与替身（spec §4.10 把 `fake-ccloop-control.mjs`、`ccloopWorld.ts` 也算判据）单列在表后。

共 **147** 条（28 个文件）。

| # | 判据全名（文件 ＞ describe ＞ it） | 红因（现跑的第一行失败信息） | 改写在 |
|---|---|---|---|
| 1 | `tests/control/blockedStaysPut.test.ts` ＞ a blocked run keeps the step it was blocked at through a later error (final fix wave FR-C2) > a conflict-parked run whose H-settle throws once stays at D; a retry resumes it at D and it is parked held, its change in a checkpoint | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 2 | `tests/control/capabilitySchema.test.ts` ＞ capabilitiesSchema > is the view schema plus protocol, with no independent field list | TypeError: Cannot read properties of undefined (reading 'safeParse') | T7 Step 4 |
| 3 | `tests/control/ccloopPort.test.ts` ＞ production ccloop execution port > answers a profile probe through the router instead of being reported as a failed probe | ControlError: control-agents-table-invalid | T7 Step 1 |
| 4 | `tests/control/ccloopPort.test.ts` ＞ production ccloop execution port > passes the peer's own v2 answer through, substituting nothing | ControlError: control-agents-table-invalid | T7 Step 1 |
| 5 | `tests/control/ccloopPort.test.ts` ＞ production ccloop execution port > does not invent a substitute source for a peer's observation -- an overridden field passes through unchanged | ControlError: control-agents-table-invalid | T7 Step 1 |
| 6 | `tests/control/ccloopPort.test.ts` ＞ production ccloop execution port > therefore, with a peer answering the v2 default, keeps handoffControl durable and handoffExecution non-null through intersectCapabilities | ControlError: control-agents-table-invalid | T7 Step 1 |
| 7 | `tests/control/ccloopPort.test.ts` ＞ production ccloop execution port > uses direct argv plus stdin JSON and validates successful responses | ControlError: control-agents-table-invalid | T7 Step 1 |
| 8 | `tests/control/ccloopPort.test.ts` ＞ production ccloop execution port > propagates exit 2 stably and refuses malformed or oversized stdout | ControlError: control-agents-table-invalid | T7 Step 1 |
| 9 | `tests/control/ccloopPort.test.ts` ＞ production ccloop execution port > validates evidence identity, base64 and hash | ControlError: control-agents-table-invalid | T7 Step 1 |
| 10 | `tests/control/ccloopPort.test.ts` ＞ production ccloop execution port > requires absolute canonical regular binary and config files | ControlError: control-agents-table-invalid | T7 Step 1 |
| 11 | `tests/control/commands.test.ts` ＞ control commands > rejects dangling dependencies, duplicate task IDs and cycles while preserving approved graph | ZodError: [ | T7 Step 6 |
| 12 | `tests/control/commands.test.ts` ＞ control commands > latches stop and retains a proposal instead of replacing an active contract | ZodError: [ | T7 Step 6 |
| 13 | `tests/control/continuation.test.ts` ＞ continuation claims > exports and binds the verified resume bundle before starting and replays one new run | TypeError: this.legacyExecutionPort(...).resolveAgent is not a function | T7 Step 6 |
| 14 | `tests/control/dispatch.test.ts` ＞ durable starts > recovers the accepted identity after the peer drops its response, without another launch | AssertionError: expected [Function] to throw error including 'start-outcome-unknown' but got '[\n  {\n    "received": 1,\n    "code…' | T7 Step 4 |
| 15 | `tests/control/dispatch.test.ts` ＞ durable starts > writes the full immutable intent before handing off to the peer and rejects altered identity | AssertionError: expected [Function] to throw error including 'run-generation-conflict' but got '[\n  {\n    "received": 1,\n    "code…' | T7 Step 4 |
| 16 | `tests/control/dispatch.test.ts` ＞ durable starts > keeps unknown ownership despite a dead service PID, expired clock or unavailable inspect | ControlError: start-intent-missing | T7 Step 4 |
| 17 | `tests/control/dispatch.test.ts` ＞ durable starts > does not send an absent start after stop is latched | ControlError: start-intent-missing | T7 Step 4 |
| 18 | `tests/control/dispatch.test.ts` ＞ durable starts > rechecks stop after asynchronous capability discovery before creating a start intent | AssertionError: expected [Function] to throw error including 'group-stopped' but got '[\n  {\n    "received": 1,\n    "code…' | T7 Step 4 |
| 19 | `tests/control/driverHandoff.test.ts` ＞ a landing whose worktree removal failed after the swap (controller ruling T4-I1) > leaves a run blocked at R whose reconciled merge is already on orca/g to a person: its request stays open | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 20 | `tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) > RC1: a separate run resolves the conflict and it lands as a merge of the tip and the run's own attempt | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 21 | `tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) > books the reconciliation's spend on the group once, and the ledger still conserves | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 22 | `tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) > blocks the conflict before any reconciliation run when the group cannot afford it | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 23 | `tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) > blocks a reconciliation that leaves conflict markers, and orca/<group> keeps only the first landing | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 24 | `tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) > blocks a reconciliation that ended failed, and still books its spend on the group | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 25 | `tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) > blocks at R, before spawning, a reconciliation the group can no longer afford | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 26 | `tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) > waits for a reconciliation still running, and collects it once it ends, with one spawn | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 27 | `tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) > after a restart, waits on a recorded live reconciliation process instead of spawning a second one | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 28 | `tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) > spawns the reconciliation as its own process group with its output in files, and a new driver after stop() finishes it with one spawn | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 29 | `tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) > after a restart with a spawn recorded but no process id, blocks instead of running a second reconciliation | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 30 | `tests/control/driverReconcile.test.ts` ＞ a reconciliation whose landing swap fails without the tip moving (final review I2) > blocks at R naming the leftover lock, and spawns no second reconciliation | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 31 | `tests/control/driverReconcile.test.ts` ＞ a person's retry of a run blocked at R (final review I4) > re-runs a failed reconciliation: two spawns, two distinct bookings, never three | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 32 | `tests/control/driverReconcile.test.ts` ＞ a person's retry of a run blocked at R (final review I4) > retries a collected reconciliation whose landing failed without running it again or booking it twice | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 33 | `tests/control/driverReconcileN.test.ts` ＞ N1u: the other side of a conflict is every landed task it touches (spec §5.2 N1) > answers both landed tasks, sorted by task id, where the two-sided rule escalated "2"; none still escalates "0" | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 34 | `tests/control/driverReconcileN.test.ts` ＞ three runs conflicting on one file (spec §5.2 N1, N2) > lands all three with exactly two reconciliations, the second against both landed tasks | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 35 | `tests/control/driverReconcileN.test.ts` ＞ three runs conflicting on one file (spec §5.2 N1, N2) > N2: while one run of the group is reconciling, a sibling collected run does not land until the reconciliation has | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 36 | `tests/control/driverReconcileN.test.ts` ＞ a reconciliation reset by a moved tip and spawned again (spec §11 I7, §13.2 I-6) > books both spawns on the group under two distinct keys | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 37 | `tests/control/driverReconcileN.test.ts` ＞ the spawn key after a spawn that died unbooked (controller ruling D-SPAWNKEY, 2026-09-25) > resumes above the largest booked spawn number, not the number of booked spawns | TypeError: The "path" argument must be of type string or an instance of Buffer or URL. Received undefined | T7 Step 7 |
| 38 | `tests/control/endToEnd.test.ts` ＞ rejects a malformed peer capability answer the guard clauses never read | AssertionError: expected [Function] to throw error including 'control-capability-unsupported' but got 'this.legacyExecutionPort(...).resolve…' | T7 Step 6 |
| 39 | `tests/control/errorClassification.test.ts` ＞ control error classification > classifies helper-mediated control-adapter-config-invalid as internal | AssertionError: expected undefined to be 'internal' // Object.is equality | T7 Step 6 |
| 40 | `tests/control/finalReview.test.ts` ＞ final review regressions > requires explicit observations of both budget buckets: none | ZodError: [ | T7 Step 6 |
| 41 | `tests/control/finalReview.test.ts` ＞ final review regressions > requires explicit observations of both budget buckets: work | ZodError: [ | T7 Step 6 |
| 42 | `tests/control/finalReview.test.ts` ＞ final review regressions > requires explicit observations of both budget buckets: handoff | ZodError: [ | T7 Step 6 |
| 43 | `tests/control/finalReview.test.ts` ＞ final review regressions > requires explicit observations of both budget buckets: both | ZodError: [ | T7 Step 6 |
| 44 | `tests/control/finalReview.test.ts` ＞ final review regressions > claims the newly approved target version while preserving same-version idempotence | TypeError: this.legacyExecutionPort(...).resolveAgent is not a function | T7 Step 6 |
| 45 | `tests/control/finalReview.test.ts` ＞ final review regressions > refuses recovery while live service orchestration owns the store | Error: Test timed out in 30000ms. | T7 Step 6 |
| 46 | `tests/control/handoffTransaction.test.ts` ＞ handoff transaction > persists one immutable request intent before RPC and retries the same request | ZodError: [ | T7 Step 6 |
| 47 | `tests/control/handoffTransaction.test.ts` ＞ handoff transaction > keeps both reservations and ownership when no quiet proof is available | ZodError: [ | T7 Step 6 |
| 48 | `tests/control/planImport.test.ts` ＞ immutable plan import > normalizes sets, archives contracts, and keeps imported authority unchanged after source edits | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 49 | `tests/control/planImport.test.ts` ＞ immutable plan import > replays the original result without rereading a changed source or changed server defaults | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 50 | `tests/control/planImport.test.ts` ＞ immutable plan import > replays asynchronously before capability I/O and cannot hang on a lost-response retry | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 51 | `tests/control/planImport.test.ts` ＞ immutable plan import > returns a same-id raw conflict before capability I/O | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 52 | `tests/control/planImport.test.ts` ＞ immutable plan import > durably rejects an initially stale import before any defaults, profile, probe, or source callbacks | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 53 | `tests/control/planImport.test.ts` ＞ immutable plan import > rechecks revision after a successful in-flight probe before source I/O | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 54 | `tests/control/planImport.test.ts` ＞ immutable plan import > rechecks command identity after an in-flight probe and creates no duplicate effects | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 55 | `tests/control/planImport.test.ts` ＞ immutable plan import > persists and replays a durable missing profile rejection across a later config change | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 56 | `tests/control/planImport.test.ts` ＞ immutable plan import > persists and replays a durable changed profile rejection across a later config change | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 57 | `tests/control/planImport.test.ts` ＞ immutable plan import > lets a concurrent same-id commit win when an in-flight probe rejects durably | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 58 | `tests/control/planImport.test.ts` ＞ immutable plan import > persists revision conflict before a failing in-flight probe and replays it before changed defaults | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 59 | `tests/control/planImport.test.ts` ＞ immutable plan import > does not persist an unexpected asynchronous preparation failure | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 60 | `tests/control/planImport.test.ts` ＞ immutable plan import > does not persist an transient asynchronous preparation failure | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 61 | `tests/control/planImport.test.ts` ＞ immutable plan import > turns a real probe failure into a terminal import without optimistic capability | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 62 | `tests/control/planImport.test.ts` ＞ immutable plan import > persists a terminal blocked-capability preflight without a scheduler wake | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 63 | `tests/control/planImport.test.ts` ＞ immutable plan import > persists a terminal input-too-large preflight without a scheduler wake | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 64 | `tests/control/planImport.test.ts` ＞ immutable plan import > rejects duplicate task and leaves the group completely absent | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 65 | `tests/control/planImport.test.ts` ＞ immutable plan import > rejects duplicate dependency and leaves the group completely absent | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 66 | `tests/control/planImport.test.ts` ＞ immutable plan import > rejects dangling dependency and leaves the group completely absent | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 67 | `tests/control/planImport.test.ts` ＞ immutable plan import > rejects a contract outside the closed ccloop V1 schema | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 68 | `tests/control/planImport.test.ts` ＞ immutable plan import > rolls back every import row when interrupted before commit | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 69 | `tests/control/planImport.test.ts` ＞ immutable plan import > rejects a plan inode swap between trusted resolution and descriptor validation | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 70 | `tests/control/planImport.test.ts` ＞ immutable plan import > is absent or fully replayable after real SIGKILL before-commit | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 71 | `tests/control/planImport.test.ts` ＞ immutable plan import > is absent or fully replayable after real SIGKILL after-commit | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 72 | `tests/control/planImport.test.ts` ＞ immutable plan import > fails closed when an archived content-addressed plan is missing or damaged | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 73 | `tests/control/planImport.test.ts` ＞ immutable plan import > fails closed on structurally valid but malformed proposal and estimate authority | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 74 | `tests/control/planImport.test.ts` ＞ immutable plan import > fails closed on noncanonical proposal bytes and an estimate request hash mismatch | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 75 | `tests/control/planImport.test.ts` ＞ immutable plan import > persists non-allowlisted source rejection without creating a group | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 76 | `tests/control/profiledService.test.ts` ＞ profiled service execution > rejects stale, missing, and unavailable profiles before claim state or provider invocation | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 77 | `tests/control/profiledService.test.ts` ＞ profiled service execution > persists the binding and starts only through the selected profile port | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 78 | `tests/control/profiledService.test.ts` ＞ profiled service execution > freshly rejects stale, missing, and unavailable profiles at start without invoking a provider | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 79 | `tests/control/profiledService.test.ts` ＞ profiled service execution > freshly validates the persisted profile before reconciling an unknown start | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 80 | `tests/control/profiledService.test.ts` ＞ profiled service execution > rejects strict profiles whose matching proof omits the tokens work dimension | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 81 | `tests/control/profiledService.test.ts` ＞ profiled service execution > rejects a task-only profile where a separate handoff profile is required | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 82 | `tests/control/profiledService.test.ts` ＞ profiled service execution > lets drain pass a hanging claim probe, then rejects its writer | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 83 | `tests/control/profiledService.test.ts` ＞ profiled service execution > lets drain pass a hanging reconcile probe, then rejects its writer | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 84 | `tests/control/profiledService.test.ts` ＞ profiled service execution > lets drain pass a hanging start call and forbids its post-I/O status write | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 85 | `tests/control/profiledService.test.ts` ＞ profiled service execution > lets drain pass hanging evidence I/O and rejects every later evidence writer | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 86 | `tests/control/profiledService.test.ts` ＞ profiled service execution > lets drain pass a hanging handoff call and rejects its later evidence writer | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 87 | `tests/control/profiledService.test.ts` ＞ profiled service execution > releases admission after reconcile and claim exceptions | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 88 | `tests/control/profiles.test.ts` ＞ trusted execution profiles > routes only an allowlisted work kind with the exact frozen hash | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 89 | `tests/control/profiles.test.ts` ＞ trusted execution profiles > rejects forged router entries and refuses to probe a profile from another router | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 90 | `tests/control/profiles.test.ts` ＞ trusted execution profiles > owns immutable snapshot and port method bindings after construction | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 91 | `tests/control/profiles.test.ts` ＞ trusted execution profiles > preserves the original receiver for captured port methods | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 92 | `tests/control/profiles.test.ts` ＞ trusted execution profiles > degrades a failed or malformed capability probe to wholly unavailable | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 4 |
| 93 | `tests/control/projectionJournal.test.ts` ＞ projection journal > projects claim, starting, and accepted run/work transitions once per transaction | ZodError: [ | T7 Step 6 |
| 94 | `tests/control/projectionJournal.test.ts` ＞ projection journal > projects starting and unknown run transitions without changing authority | AssertionError: expected [Function] to throw error including 'start-outcome-unknown' but got '[\n  {\n    "received": 1,\n    "code…' | T7 Step 6 |
| 95 | `tests/control/schedulerBridge.test.ts` ＞ reserves reconciliation once from remaining group budget and refuses stopped groups | TypeError: this.legacyExecutionPort(...).resolveAgent is not a function | T7 Step 6 |
| 96 | `tests/control/schedulerBridge.test.ts` ＞ gets capabilities from the peer before a service claim | AssertionError: expected [Function] to throw error including 'control-capability-unsupported' but got 'this.legacyExecutionPort(...).resolve…' | T7 Step 6 |
| 97 | `tests/control/schedulerBridge.test.ts` ＞ runs a real conflicting graph through durable control: success | ZodError: [ | T7 Step 6 |
| 98 | `tests/control/schedulerBridge.test.ts` ＞ runs a real conflicting graph through durable control: budget | ZodError: [ | T7 Step 6 |
| 99 | `tests/control/schedulerBridge.test.ts` ＞ runs a real conflicting graph through durable control: stopped | ZodError: [ | T7 Step 6 |
| 100 | `tests/control/schedulerBridge.test.ts` ＞ runs a real conflicting graph through durable control: crash | ZodError: [ | T7 Step 6 |
| 101 | `tests/control/startEnvelope.test.ts` ＞ translating a frozen dispatch envelope into a start envelope > copies the claim from the run row and the contract hash from the ledger, field by field | ControlError: start-envelope-conflict:run:agent | T7 Step 4 |
| 102 | `tests/control/startEnvelope.test.ts` ＞ translating a frozen dispatch envelope into a start envelope > drops the run row's own extra columns instead of smuggling them onto the wire | ControlError: start-envelope-conflict:run:agent | T7 Step 4 |
| 103 | `tests/control/startEnvelope.test.ts` ＞ translating a frozen dispatch envelope into a start envelope > translates a handoff-phase envelope with the same claim and the same ledger hash | ControlError: start-envelope-conflict:run:agent | T7 Step 4 |
| 104 | `tests/control/startEnvelope.test.ts` ＞ translating a frozen dispatch envelope into a start envelope > carries a continuation's ledger hash rather than the predecessor's | ControlError: start-envelope-conflict:run:agent | T7 Step 4 |
| 105 | `tests/control/startEnvelope.test.ts` ＞ the translation refuses before anything is dispatched > refuses a run row missing a claim field, rather than dispatching the string "undefined" | AssertionError: expected 'start-envelope-conflict\|run:agent' to be 'start-envelope-conflict\|run:ownerToken' // Object.is equality | T7 Step 4 |
| 106 | `tests/control/startEnvelope.test.ts` ＞ the translation refuses before anything is dispatched > refuses when the envelope and the run name different runs | AssertionError: expected 'start-envelope-conflict\|run:agent' to be 'start-envelope-conflict\|identity:run-1' // Object.is equality | T7 Step 4 |
| 107 | `tests/control/startEnvelope.test.ts` ＞ the translation refuses before anything is dispatched > refuses when they disagree about the generation, not only the run id | AssertionError: expected 'start-envelope-conflict\|run:agent' to be 'start-envelope-conflict\|identity:run-1' // Object.is equality | T7 Step 4 |
| 108 | `tests/control/unconfiguredPort.test.ts` ＞ the unconfigured execution port > refuses every method it has, not merely the obvious ones | TypeError: port.probeProfileCapabilities is not a function | T7 Step 4 |
| 109 | `tests/control/unconfiguredPort.test.ts` ＞ the unconfigured execution port > exposes the optional probe, so a missing port is never reported as a missing capability | AssertionError: expected 'undefined' to be 'function' // Object.is equality | T7 Step 4 |
| 110 | `tests/control/unconfiguredPort.test.ts` ＞ the unconfigured execution port > refuses a second time exactly as it refused the first, holding no state | TypeError: port.capabilities is not a function | T7 Step 4 |
| 111 | `tests/control/webCcloopSmoke.test.ts` ＞ the frozen dispatch envelope reaches a real process (task 10 step 4) > carries the ledger's claim identity byte-for-byte and is durably accepted once | ControlError: control-agents-table-invalid | T7 Step 8 |
| 112 | `tests/control/webCcloopSmoke.test.ts` ＞ the frozen dispatch envelope reaches a real process (task 10 step 4) > latches the stop under the ledger's request identity and returns evidence the store re-hashes | ControlError: control-agents-table-invalid | T7 Step 8 |
| 113 | `tests/panel/assemblyHandoffGrace.test.ts` ＞ the handoff grace the assembly hands the driver (spec §3) > is the adapter's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable | TypeError: __vite_ssr_import_5__.handoffGraceMsOf is not a function | T7 Step 7 |
| 114 | `tests/panel/controlAssemblyDriver.test.ts` ＞ the execution driver in the panel's assembly (spec §2.1) > knows its own repository for set-workspace-mode only with a configured port (configured=true) | AssertionError: expected false to be true // Object.is equality | T7 Step 7 |
| 115 | `tests/panel/controlAssemblyDriver.test.ts` ＞ the execution driver in the panel's assembly (spec §2.1) > is present with a configured port, with its roots created 0700 beside the store directory, and shuts down cleanly | AssertionError: expected null not to be null // Object.is equality | T7 Step 7 |
| 116 | `tests/panel/controlAssemblyDriver.test.ts` ＞ the execution driver in the panel's assembly (spec §2.1) > stops the driver on a close with no shutdown before it, and a stopped driver stays stopped (ruling P10) | TypeError: Cannot convert undefined or null to object | T7 Step 7 |
| 117 | `tests/panel/controlConfig.test.ts` ＞ trusted panel control config > resolves only stable repository and plan IDs and never exposes trusted paths | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 118 | `tests/panel/controlConfig.test.ts` ＞ trusted panel control config > rejects allowlisted plan escapes and symlinked path components at startup | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 119 | `tests/panel/controlConfig.test.ts` ＞ trusted panel control config > rejects a plan or ancestor swapped to a symlink after startup | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 120 | `tests/panel/controlConfig.test.ts` ＞ trusted panel control config > rejects duplicate IDs and invalid trusted executable paths before serving config | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 121 | `tests/panel/controlConfigPort.test.ts` ＞ the served config states whether an execution port is configured > serves "unconfigured" when the panel was started without one | ControlError: control-trusted-config-invalid:Required | T7 Step 6 |
| 122 | `tests/panel/controlConfigPort.test.ts` ＞ the served config states whether an execution port is configured > serves "configured" when it was | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 123 | `tests/panel/controlConfigPort.test.ts` ＞ the served config states whether an execution port is configured > does not answer the port question from a profile's probe failure | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 124 | `tests/panel/controlConfigPort.test.ts` ＞ the served config states whether an estimator was chosen > serves null defaults rather than refusing to build | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 125 | `tests/panel/controlConfigPort.test.ts` ＞ the served config states whether an estimator was chosen > still refuses an estimator that was named and does not resolve | AssertionError: expected [Function] to throw error including 'control-trusted-config-invalid' but got 'Cannot read properties of undefined (…' | T7 Step 6 |
| 126 | `tests/panel/controlConfigPort.test.ts` ＞ the two pairs cannot disagree > refuses a configured port with no adapter config | AssertionError: expected 'TypeError: Cannot read properties of …' to be 'execution-port-adapter-config-mismatch' // Object.is equality | T7 Step 6 |
| 127 | `tests/panel/controlConfigPort.test.ts` ＞ the two pairs cannot disagree > refuses an unconfigured port that still carries one, which is the other direction | AssertionError: expected 'Required' to be 'execution-port-adapter-config-mismatch' // Object.is equality | T7 Step 6 |
| 128 | `tests/panel/controlConfigPort.test.ts` ＞ the two pairs cannot disagree > refuses half an estimator in both directions | AssertionError: expected 'TypeError: Cannot read properties of …' to be 'estimator-defaults-incomplete' // Object.is equality | T7 Step 6 |
| 129 | `tests/panel/controlOptions.test.ts` ＞ resolveControlOptions reports whether an execution port is configured > calls the port configured only when both are set and non-empty | AssertionError: expected 'unconfigured' to be 'configured' // Object.is equality | T7 Step 7 |
| 130 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > authenticates reads, enforces canonical sinceChangeSeq spelling, and keeps immediate kill absent | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 131 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > returns sorted complete, incremental, ahead, and retained-gap summaries | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 132 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > reloads confirmed profiles, snapshot hashes, estimate output, and paused state without exposing trusted paths | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 133 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > fails closed when confirmed allocation or derived-contract authority is missing, forged, or belongs to another task | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 134 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > accepts a globally deduplicated derived contract when each group snapshot independently proves its authority | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 135 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > rejects malformed or cross-record-inconsistent persisted run authority instead of synthesizing display values | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 136 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > requires canonical stop authority and preserves revision and blocker evidence on group read failures | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 137 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > rejects budget and graph legacy stopped flags without canonical stop intents | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 138 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > blocks a 'checkpoint' evidence collection containing a 'null' element | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 139 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > blocks a 'checkpoint' evidence collection containing a 'invalid' element | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 140 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > blocks a 'outbox' evidence collection containing a 'null' element | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 141 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > blocks a 'outbox' evidence collection containing a 'invalid' element | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 142 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > blocks a 'handoff' evidence collection containing a 'null' element | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 143 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > blocks a 'handoff' evidence collection containing a 'invalid' element | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 144 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > blocks a 'recovery' evidence collection containing a 'null' element | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 145 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > blocks a 'recovery' evidence collection containing a 'invalid' element | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 146 | `tests/panel/controlReadApi.test.ts` ＞ canonical control read API > returns persisted command results, sorted recovery, verified evidence manifests, and exact typed misses | TypeError: Cannot read properties of undefined (reading 'bind') | T7 Step 6 |
| 147 | `web/tests/controlPortBanner.test.tsx` ＞ the panel says when it has no execution port > shows it, and names the two variables that fix it | AssertionError: expected '<section aria-label="Task control"><h…' to contain 'ORCA_CCLOOP_ADAPTER_CONFIG' | T7 Step 7 |

**现跑没红、但 typecheck 会红（vitest 不做类型检查）**，同样整条改写（T7 Step 6）：
- `tests/control/budget.test.ts` —— `import type { …, Capabilities }` 引用了被删的类型（M-1）；运行期判据不变，改写只换类型名（`CapabilityViewV1`）。
- `tests/control/commandLedger.test.ts` ＞ command ledger（`it.each` 参数化）＞ `rolls explicitly non-durable control-adapter-config-invalid failures back during expand` 与 `… during apply` —— `control-adapter-config-invalid` 不再是 `KnownControlErrorCode`；这两个参数名消失、换成 `control-agents-table-invalid` 的两条（同一 `it.each`，同一断言）。`tests/control/errorClassification.test.ts` 的对应参数 `classifies helper-mediated control-adapter-config-invalid as internal` 在上表里（现跑也红）。

**`ORCA_CCLOOP_BIN` 门控、本次 skip 的判据**（真 ccloop 新 build 下按旧文件跑必红：旧文件用 `adapter`／`adapterConfigPath` 端口选项、`probeProfileCapabilities`／`capabilities()`、envelope `protocol: 1`、本地重算 configHash），改写在 T7 Step 8：
- `tests/control/webCcloopSmoke.test.ts` ＞ the shipped consumer answers for its own capabilities (task 10 step 4) ＞ claims phase-end usage and soft enforcement, and the ledger opens no strict run on it
- 同上 ＞ blocks only at delivery when the observation degrades after a clean schedule
- 同上 ＞ refuses an envelope that is not V1 and reads a well-formed one as no execution yet（改写后名为 `… not V2 …`）
- `tests/control/ccloopProtocol.integration.test.ts` ＞ real ccloop protocol ＞ accepts, accounts, commits a handoff, resumes a dirty snapshot, and collects a fresh execution
- 同上 ＞ recovers the Orca SIGKILL boundary without duplicating checkpoint or D3 Markdown: after-archive／before-projection（不直接依赖线形状，但整个 describe 以 `ORCA_AGENTS_TABLE` 门控，旧名 `ORCA_CCLOOP_ADAPTER_CONFIG` 下它们不再运行 —— 门控条件改名，判据体不变）
- `tests/control/executionDriverE2E.test.ts`、`tests/control/handoffE2E.test.ts` 的全部判据**文件本身不改**，经 `ccloopWorld.ts`（替身，T7 Step 8）换到新线；按旧 `ccloopWorld` 跑必红（它写 adapter 配置、设 `ORCA_CCLOOP_ADAPTER_CONFIG`）。

**被改写的替身与夹具**（spec §4.10：替身本身就是判据）：`tests/control/fixtures/fake-ccloop-control.mjs`（整份换新线）、`tests/control/fixtures/ccloopWorld.ts`（安装表、`versionOf`、configHash 取自 `resolveAgent`、T7 桥）、`tests/control/fixtures/fake-ccloop-run.mjs`（收 `--agents`／`--agent-selection`、拒 `--adapter`、记 `.selections`）、`tests/control/fixtures/fake-control-peer.mjs`（capabilities 答选择的解析）、`tests/control/fixtures/{store,peer,roundPeer,driverPort,web}.ts`（端口替身换 `resolveAgent`／`listAgents`；`store.ts` 加 `fixtureAgent`／`resolvedAs`／`agentsView`，`caps` 去掉 `protocol`；`web.ts` 加 `FIXTURE_AGENT` 与 T7 桥）、`tests/control/fixtures/{archive.ts,crash-worker.mjs}`（envelope `protocol: 2`）、`tests/control/fixtures/candidate.ts`（候选身份去掉 `agent`）、`tests/control/fixtures/driverHarness.ts`（`agentsTablePath`、`killGraceMs` 旋钮）、`tests/panel/fixtures/controlPanel.ts`（端口替身、`agentsTable`）。

**T12 另改写一条（T7 新增的，不属于「既有」但照同样的注释规矩）**：`tests/control/driverReconcile.test.ts` ＞ reconciling a conflict (spec §5.3) ＞ spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding a frozen selection with its configHash (agent selection spec §4.9)。**T13 不改任何既有判据。**

---

### Task 7: Orca 线上 v2／v3 —— envelope `protocol: 2` ＋ `claim.agent`、capabilities `protocol: 3`（`resolveAgent`／`listAgents`）、`--agents <table>`、`ORCA_AGENTS_TABLE`

**依赖**：T8（`src/control/agentSelection.ts` 的类型，W5 (1)）、ccloop T5（control 新线）、ccloop T6（`ccloop run --agents`，见 M-4）。
**Files**（行号为 `545f452` 现量）:
- Modify（src）: `src/control/schema.ts:1-33`、`src/control/types.ts:1-36`、`src/control/executionPort.ts:1-26`（整份替换）、`src/control/ccloopPort.ts:1-90`、`src/control/errors.ts:83`、`:140`、`src/control/webProtocol.ts:92-96`、`src/control/unconfiguredPort.ts:4-34`、`src/control/profiles.ts:1-169`、`src/control/budget.ts:4-7`、`:84-85`、`:111`、`:128`、`src/control/service.ts:1-178`、`src/control/dispatch.ts:50-52`、`:77`、`src/control/ownership.ts:9-11`、`src/control/schedulerBridge.ts:11`、`:24-27`、`:125-127`、`:157`、`src/control/startEnvelope.ts:5`、`:27`、`:77`、`:87`、`src/control/continuation.ts:41`、`src/control/webDispatch.ts:12`、`:21`、`:283`、`src/control/queries.ts:1-57`、`src/control/stopIntent.ts:18`、`:117`、`:562`、`src/control/executionDriver.ts:30`、`:57-73`、`src/control/driverHandoff.ts:17-18`、`:162`、`:176-183`、`src/control/driverLanding.ts:285`、`src/scheduler/ccloopRunner.ts:7`、`:48-73`、`:278-288`、`src/panel/controlViews.ts:12`、`:117`、`src/panel/controlOptions.ts:105-107`、`src/panel/controlConfig.ts:28-33`、`:57`、`:68-73`、`:148`、`src/panel/controlAssembly.ts:11`、`:111-124`、`:130-137`、`:188`、`:255-257`、`src/cli.ts:59`、`web/src/ControlPanel.tsx:102`、`scripts/verify-control.mjs:7-14`、`scripts/live-driver-acceptance.ts:25`、`:61-69`、`:99-103`、`:118`、`:137`、`:152`、`:160`。
- Modify（替身与夹具）: `tests/control/fixtures/{fake-ccloop-control.mjs, fake-ccloop-run.mjs, fake-control-peer.mjs, store.ts, peer.ts, roundPeer.ts, archive.ts, candidate.ts, crash-worker.mjs, driverPort.ts, driverHarness.ts, web.ts, ccloopWorld.ts}`、`tests/panel/fixtures/controlPanel.ts`。
- Test: 新判据在 `tests/control/{ccloopPort,dispatch,startEnvelope,profiles,driverHandoff,driverReconcile}.test.ts`；改写的既有判据见「既有判据会红」表。

**Interfaces**
- Consumes：T8 的 `AgentSelection`、`PartialSelection`、`ContextWindow`、`AgentResolution`（`src/control/agentSelection.ts`）；ccloop T5 的 `control <method> --agents <table>`、envelope v2、capabilities v3、AgentError 的 stderr 形状；ccloop T6 的 `ccloop run --agents <table> --agent-selection <file>`（选择文件 `{selection, configHash}`）；T1 的 `probeVersion` 规则（`[...command,"--version"]`，stdout 里第一个 `\d+\.\d+\.\d+(-[\w.]+)?`）。
- Produces（骨架名）：`ExecutionPort.resolveAgent(partial): Promise<AgentResolution>`、`ExecutionPort.listAgents(): Promise<AgentsView>`、`AgentsView`（`executionPort.ts`）、`StartEnvelope`（`protocol: 2`）、`Claim.agent`／`WorkBase.agent`、run 行 `agent`、`createCcloopExecutionPort({binary, agentsTablePath, timeoutMs})`、环境变量 `ORCA_AGENTS_TABLE`。本 Task 另产出（骨架未列，供 T11/T12/T16 用）：`schema.ts` 的 `contextWindowSchema`／`agentSelectionSchema`／`partialSelectionSchema`；`ccloopPort.ts` 的 `peerErrorCode(error)`；`ExecutionProfileRouter.probe(profile, selection?: AgentSelection)`（TEMPORARY 可选，T11 改必填）；`queries.ts` 的 `workAgents(store, groupId)`；`driverHandoff.ts` 的 `handoffGraceMsOf(port, agent)`（T11 改读冻结值）；`ccloopRunner.ts` 的 `AgentsRunTaskOptions`／`AdapterRunTaskOptions`／`AGENT_SELECTION_FILE`；`ExecutionDriverDeps.agentsTablePath`（取代 `adapterConfigPath`）；夹具 `fixtureAgent`／`resolvedAs`／`agentsView`（`tests/control/fixtures/store.ts`）、`FIXTURE_AGENT`（`web.ts`）、`versionOf`（`ccloopWorld.ts`）。

`$S` ＝ 实施席自己的 scratchpad 日志目录。本 Task 中间各步 **typecheck 不会绿**（改的是跨四十个文件的一个接口），只跑点名的单文件；typecheck 在 Step 9 收口。

- [ ] **Step 1: 写端口的失败判据（RED）** —— 改写 `tests/control/ccloopPort.test.ts`（七条既有判据整条改写＋七条新判据：按选择问 capabilities、`agent:null` 列表、回显核对、拒 protocol-2 形状、ccloop 具名拒绝按原名抛出、`peerErrorCode`、TEMPORARY 无选择探测），并把替身 `tests/control/fixtures/fake-ccloop-control.mjs` 整份换成新线（它本身就是判据，G1 §7.2）：

`tests/control/ccloopPort.test.ts`：

````diff
diff --git a/tests/control/ccloopPort.test.ts b/tests/control/ccloopPort.test.ts
index 187c36a..3a8bae3 100644
--- a/tests/control/ccloopPort.test.ts
+++ b/tests/control/ccloopPort.test.ts
@@ -3,7 +3,8 @@ import { createHash } from "node:crypto";
 import { tmpdir } from "node:os";
 import { join, resolve } from "node:path";
 import { describe, expect, it } from "vitest";
-import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
+import { createCcloopExecutionPort, peerErrorCode } from "../../src/control/ccloopPort.js";
+import { ControlError } from "../../src/control/errors.js";
 import { createExecutionProfileRouter, intersectCapabilities, resolveProfile } from "../../src/control/profiles.js";
 import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
 import type { StartEnvelope } from "../../src/control/executionPort.js";
@@ -12,11 +13,13 @@ async function fixture(mode = "ok", extra:Record<string,unknown> = {}) {
   const root=await realpath(await mkdtemp(join(tmpdir(),"orca-ccloop-port-")));
   const binary=join(root,"fake;ccloop");
   await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"),binary);await chmod(binary,0o700);
-  const record=join(root,"record.json"),config=join(root,"adapter.json");
-  await writeFile(config,JSON.stringify({mode,record,...extra}),{mode:0o600});
-  const port=createCcloopExecutionPort({binary,adapter:"codex",adapterConfigPath:config,timeoutMs:10_000});
-  const envelope:StartEnvelope={protocol:1,claim:{groupId:"g",workItemId:"w",taskId:"t",runId:"r",generation:1,graphVersion:1,targetVersion:1,commandId:"c",configHash:"a".repeat(64),grant:{work:{tokens:1,activeMs:1,attempts:1,sessions:1},handoff:{tokens:1,activeMs:1,attempts:0,sessions:0}},ownerToken:"owner"},contractHash:"b".repeat(64),inputCheckpoint:null,work:{contract:{objective:"ship",scope:{allowedPaths:["src/**"]},acceptance:{commands:["true"]}},targetRepo:root,base:"HEAD",sourceDir:root}};
-  return {root,binary,config,record,port,envelope};
+  // Agent selection spec §6.6: the port is given a binary and an agents table. The stand-in reads its own knobs from
+  // the file passed as the table, so this is not a real table.
+  const record=join(root,"record.json"),table=join(root,"agents.json");
+  await writeFile(table,JSON.stringify({mode,record,...extra}),{mode:0o600});
+  const port=createCcloopExecutionPort({binary,agentsTablePath:table,timeoutMs:10_000});
+  const envelope:StartEnvelope={protocol:2,claim:{groupId:"g",workItemId:"w",taskId:"t",runId:"r",generation:1,graphVersion:1,targetVersion:1,commandId:"c",configHash:"a".repeat(64),agent:{agent:"codex",model:"fixture-model",contextWindow:"agent-default"},grant:{work:{tokens:1,activeMs:1,attempts:1,sessions:1},handoff:{tokens:1,activeMs:1,attempts:0,sessions:0}},ownerToken:"owner"},contractHash:"b".repeat(64),inputCheckpoint:null,work:{contract:{objective:"ship",scope:{allowedPaths:["src/**"]},acceptance:{commands:["true"]}},targetRepo:root,base:"HEAD",sourceDir:root}};
+  return {root,binary,table,record,port,envelope};
 }
 
 const hx=(v:string)=>v.repeat(64);
@@ -37,9 +40,11 @@ describe("production ccloop execution port",()=>{
     // Assembly plan Task 3. Reading `typeof port.probeProfileCapabilities` would pass while the
     // method stayed unreachable, so this drives the real router: what matters is that the answer
     // arrives from the port and `probeFailureCode` stays null.
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): a probe is of one
+    // selection now (spec §6.4); the answer still has to arrive from the port with probeFailureCode null.
     const h=await fixture();
     const router=createExecutionProfileRouter([resolveProfile(probeSnapshot(),h.port)]);
-    const observation=await router.probe(router.list()[0]!);
+    const observation=await router.probe(router.list()[0]!,{agent:"codex",model:"fixture-model",contextWindow:"agent-default"});
     expect(observation.probeFailureCode).toBe(null);
     expect(observation.probeFailureCode).not.toBe("control-capability-probe-failed");
   });
@@ -51,9 +56,11 @@ describe("production ccloop execution port",()=>{
   // the v2 default) AND that it is a genuine pass-through rather than a hardcode that happens to
   // match the default -- the second `fixture` call overrides one field and asserts the override
   // survives, which a hardcoded `"durable"` could never do.
-  it("passes the peer's own v2 answer through, substituting nothing",async()=>{
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the view now arrives inside
+  // one selection's capabilities-v3 resolution; it is still the peer's own answer, passed through whole.
+  it("passes the peer's own capabilities-v3 view through, substituting nothing",async()=>{
     const h=await fixture();
-    expect(await h.port.probeProfileCapabilities!()).toEqual({
+    expect((await h.port.resolveAgent({agent:"codex"})).capabilities).toEqual({
       usageObservation:"phase-end",
       budgetEnforcement:"soft",
       contextObservation:"unavailable",
@@ -69,13 +76,17 @@ describe("production ccloop execution port",()=>{
     // would be silently overridden. Answering "phase-end" here and asserting "phase-end" back --
     // not "durable" -- is what tells a pass-through apart from a hardcode that merely matches the
     // default by coincidence.
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the override is the view
+    // inside the resolution (capabilities protocol 3); the same field must come back as the peer stated it.
     const h=await fixture("ok",{capabilities:{
-      protocol:2,usageObservation:"phase-end",budgetEnforcement:"soft",contextObservation:"unavailable",
+      usageObservation:"phase-end",budgetEnforcement:"soft",contextObservation:"unavailable",
       handoffControl:"phase-end",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:null,
     }});
-    expect(await h.port.probeProfileCapabilities!()).toMatchObject({handoffControl:"phase-end"});
+    expect((await h.port.resolveAgent({agent:"codex"})).capabilities).toMatchObject({handoffControl:"phase-end"});
   });
-  it("therefore, with a peer answering the v2 default, keeps handoffControl durable and handoffExecution non-null through intersectCapabilities",async()=>{
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): "v2 default" became the
+  // default view of a capabilities-v3 resolution; the intersection it pins is unchanged.
+  it("therefore, with a peer answering the default view, keeps handoffControl durable and handoffExecution non-null through intersectCapabilities",async()=>{
     // Human authorization 2026-09-24, G1 seam A Task 4. Renamed from its pre-G1 form, which
     // recorded that a claim closed on capabilities failed because the port could not observe
     // `handoffControl`/`handoffExecution` at all. That gap is closed now that ccloop's `capabilities`
@@ -84,31 +95,82 @@ describe("production ccloop execution port",()=>{
     // -- it is not a claim that Web dispatch to real ccloop is fully wired (that is Tasks 5/6).
     const h=await fixture();
     const declared=probeSnapshot().profile.capabilities;
-    const observed=intersectCapabilities(declared,await h.port.probeProfileCapabilities!());
+    const observed=intersectCapabilities(declared,(await h.port.resolveAgent({agent:"codex"})).capabilities);
     expect(observed.handoffControl).toBe("durable");
     expect(observed.handoffExecution).toBe("mechanical-in-run-v1");
   });
   it("uses direct argv plus stdin JSON and validates successful responses",async()=>{
     // Human authorization 2026-09-24, G1 seam A Task 4: only the `protocol` expectation changes,
     // from v1 to the v2 wire vocabulary the fake binary now answers with.
-    const h=await fixture();expect(await h.port.capabilities()).toMatchObject({protocol:2,budgetEnforcement:"soft"});
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): capabilities answer protocol 3
+    // (the tag is stripped, the resolution kept), the argv is `--agents <table>` and the envelope is protocol 2.
+    const h=await fixture();expect(await h.port.resolveAgent({agent:"codex"})).toMatchObject({configHash:"d".repeat(64),capabilities:{budgetEnforcement:"soft"}});
     expect(await h.port.accept(h.envelope)).toEqual({kind:"accepted",executionId:"execution-1",configHash:"a".repeat(64)});
-    const recorded=JSON.parse(await readFile(h.record,"utf8"));expect(recorded.argv).toEqual(["control","accept","--adapter","codex","--adapter-config",h.config]);expect(JSON.parse(recorded.stdin)).toEqual(h.envelope);
+    const recorded=JSON.parse(await readFile(h.record,"utf8"));expect(recorded.argv).toEqual(["control","accept","--agents",h.table]);expect(JSON.parse(recorded.stdin)).toEqual(h.envelope);
   });
   it("propagates exit 2 stably and refuses malformed or oversized stdout",async()=>{
-    await expect((await fixture("exit2")).port.capabilities()).rejects.toMatchObject({
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the same three refusals,
+    // reached through resolveAgent, the only capabilities call left.
+    await expect((await fixture("exit2")).port.resolveAgent({agent:"codex"})).rejects.toMatchObject({
       name: "ControlError", code: "control-peer-exit", detail: "2:remote-refusal", message: "control-peer-exit:2:remote-refusal",
     });
-    await expect((await fixture("bad-json")).port.capabilities()).rejects.toThrow("control-response-invalid");
-    await expect((await fixture("oversized")).port.capabilities()).rejects.toThrow("control-response-too-large");
+    await expect((await fixture("bad-json")).port.resolveAgent({agent:"codex"})).rejects.toThrow("control-response-invalid");
+    await expect((await fixture("oversized")).port.resolveAgent({agent:"codex"})).rejects.toThrow("control-response-too-large");
   });
   it("validates evidence identity, base64 and hash",async()=>{
     const ref={artifactId:"evidence-proof",hash:createHash("sha256").update("proof").digest("hex")},h=await fixture("ok",{evidence:"proof",collectRef:ref});
     await h.port.collect(h.envelope,0);expect((await h.port.readEvidence(ref)).toString()).toBe("proof");
     const bad=await fixture("ok",{evidence:"proof",badHash:true,collectRef:ref});await bad.port.collect(bad.envelope,0);await expect(bad.port.readEvidence(ref)).rejects.toThrow("artifact-hash-mismatch");
   });
-  it("requires absolute canonical regular binary and config files",async()=>{
-    const h=await fixture();expect(()=>createCcloopExecutionPort({binary:"relative",adapter:"codex",adapterConfigPath:h.config,timeoutMs:1})).toThrow("control-binary-invalid");
-    const link=join(h.root,"config-link");await symlink(h.config,link);expect(()=>createCcloopExecutionPort({binary:h.binary,adapter:"codex",adapterConfigPath:link,timeoutMs:1})).toThrow("control-adapter-config-invalid");
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the agents table takes the
+  // adapter config's place and its own refusal code (spec §6.6); the symlink is still refused.
+  it("requires absolute canonical regular binary and agents table files",async()=>{
+    const h=await fixture();expect(()=>createCcloopExecutionPort({binary:"relative",agentsTablePath:h.table,timeoutMs:1})).toThrow("control-binary-invalid");
+    const link=join(h.root,"table-link");await symlink(h.table,link);expect(()=>createCcloopExecutionPort({binary:h.binary,agentsTablePath:link,timeoutMs:1})).toThrow("control-agents-table-invalid");
+  });
+  it("asks capabilities about exactly the given selection and returns ccloop's resolution without the protocol tag",async()=>{
+    const h=await fixture();
+    const resolution=await h.port.resolveAgent({agent:"codex",model:"gpt-6-sol"});
+    expect(JSON.parse(JSON.parse(await readFile(h.record,"utf8")).stdin)).toEqual({agent:{agent:"codex",model:"gpt-6-sol"}});
+    expect(resolution).toEqual({selection:{agent:"codex",model:"gpt-6-sol",contextWindow:"agent-default"},configHash:"d".repeat(64),timeoutMs:120000,killGraceMs:5000,
+      capabilities:{usageObservation:"phase-end",budgetEnforcement:"soft",contextObservation:"unavailable",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:null}});
+  });
+  it("lists the installations by asking capabilities with agent null",async()=>{
+    const h=await fixture();
+    expect(await h.port.listAgents()).toEqual({installations:[{id:"codex",kind:"codex",defaults:{model:"fixture-model",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"0.0.0-fixture"}]});
+    expect(JSON.parse(JSON.parse(await readFile(h.record,"utf8")).stdin)).toEqual({agent:null});
+  });
+  it("refuses a resolution that does not echo a field the request gave (spec M5)",async()=>{
+    const h=await fixture("rewrite-model");
+    await expect(h.port.resolveAgent({agent:"codex",model:"claude-opus-5-5"})).rejects.toMatchObject({code:"control-response-invalid",detail:"selection-not-echoed:model"});
+    // A field the request left to the descriptor may come back as anything the descriptor says.
+    expect((await h.port.resolveAgent({agent:"codex"})).selection.model).toBe("rewritten-model");
+  });
+  it("refuses a capabilities answer in the retired protocol-2 shape",async()=>{
+    await expect((await fixture("protocol-2")).port.resolveAgent({agent:"codex"})).rejects.toThrow("control-response-invalid");
+    await expect((await fixture("protocol-2")).port.listAgents()).rejects.toThrow("control-response-invalid");
+  });
+  it("TEMPORARY (plan T11 deletes it): a probe given no selection asks about the table's first installation, with nothing overridden",async()=>{
+    const h=await fixture("ok",{installations:[{id:"zeta",kind:"claude",defaults:{model:"m",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"1.0.0"},{id:"alpha",kind:"codex",defaults:{model:"m",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"1.0.0"}]});
+    const router=createExecutionProfileRouter([resolveProfile(probeSnapshot(),h.port)]);
+    expect((await router.probe(router.list()[0]!)).probeFailureCode).toBe(null);
+    expect(JSON.parse(JSON.parse(await readFile(h.record,"utf8")).stdin)).toEqual({agent:{agent:"alpha"}});
+    const empty=await fixture("ok",{installations:[]});
+    const emptyRouter=createExecutionProfileRouter([resolveProfile(probeSnapshot(),empty.port)]);
+    expect((await emptyRouter.probe(emptyRouter.list()[0]!)).probeFailureCode).toBe("control-capability-probe-failed");
+  });
+  it("rethrows ccloop's named refusals of a selection or table under their own names, and any other exit as a peer exit (agent selection spec §7)",async()=>{
+    for(const code of ["agent-installation-missing","agent-context-unsupported","agent-selection-invalid","agent-version-drift","agents-table-invalid"]){
+      await expect((await fixture("ok",{refuse:`${code}: detail`})).port.resolveAgent({agent:"codex"})).rejects.toMatchObject({name:"ControlError",code});
+    }
+    await expect((await fixture("ok",{refuse:"agents-table-invalid"})).port.listAgents()).rejects.toMatchObject({code:"agents-table-invalid"});
+    await expect((await fixture("ok",{refuse:"control-command-invalid"})).port.resolveAgent({agent:"codex"})).rejects.toMatchObject({code:"control-peer-exit",detail:"1:control-command-invalid"});
+  });
+  it("reads ccloop's error code out of a peer exit, and nothing out of any other failure",async()=>{
+    const refused=await (await fixture("exit2")).port.resolveAgent({agent:"codex"}).catch((error:unknown)=>error);
+    expect(peerErrorCode(refused)).toBe("remote-refusal");
+    expect(peerErrorCode(new ControlError("control-peer-exit","1:agent-version-drift:table says 2.1.0"))).toBe("agent-version-drift");
+    expect(peerErrorCode(new ControlError("control-response-invalid"))).toBe(null);
+    expect(peerErrorCode(new Error("control-peer-exit:1:agent-version-drift"))).toBe(null);
   });
 });
````

`tests/control/fixtures/fake-ccloop-control.mjs`：

````diff
diff --git a/tests/control/fixtures/fake-ccloop-control.mjs b/tests/control/fixtures/fake-ccloop-control.mjs
index cf65de9..2c55b30 100644
--- a/tests/control/fixtures/fake-ccloop-control.mjs
+++ b/tests/control/fixtures/fake-ccloop-control.mjs
@@ -2,25 +2,46 @@
 import { createHash } from "node:crypto";
 import { readFile, writeFile } from "node:fs/promises";
 
-const [control, method, adapterFlag, adapter, configFlag, configPath] = process.argv.slice(2);
-const config = JSON.parse(await readFile(configPath, "utf8"));
+// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): this stand-in speaks the wire
+// of agent selection spec §4.5/§4.6/§5 -- `control <method> --agents <table>` (the retired `--adapter` form is
+// refused by name, as ccloop refuses it), envelope protocol 2 with `claim.agent`, and capabilities protocol 3: the
+// table view for `{agent: null}`, one selection's resolution for `{agent: partial}` (requested fields echoed, the
+// fixture's defaults for the rest). Its own knobs live in the file passed as the table: it never parses a real one.
+const [control, method, agentsFlag, tablePath, ...rest] = process.argv.slice(2);
+if (control !== "control" || agentsFlag !== "--agents" || tablePath === undefined || rest.length > 0) {
+  process.stderr.write("control-command-invalid\n"); process.exit(2);
+}
+const config = JSON.parse(await readFile(tablePath, "utf8"));
 let stdin = "";
 for await (const chunk of process.stdin) stdin += chunk;
 if (config.record) await writeFile(config.record, JSON.stringify({ argv: process.argv.slice(2), stdin }));
 if (config.mode === "exit2") { process.stderr.write("remote-refusal\n"); process.exit(2); }
+if (config.refuse) { process.stderr.write(`${config.refuse}\n`); process.exit(1); }
 if (config.mode === "bad-json") { process.stdout.write("not-json\n"); process.exit(0); }
 if (config.mode === "oversized") { await new Promise(resolve=>process.stdout.write(JSON.stringify({blob:"x".repeat(25 * 1024 * 1024)})+"\n",resolve)); process.exit(0); }
 const payload = JSON.parse(stdin || "{}");
-const v2default = { protocol:2,usageObservation:"phase-end",budgetEnforcement:"soft",contextObservation:"unavailable",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:null };
-const caps = config.capabilities ?? v2default;
+const view = { usageObservation:"phase-end",budgetEnforcement:"soft",contextObservation:"unavailable",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:null };
+const defaults = { agent:"codex",model:"fixture-model",contextWindow:"agent-default" };
+const envelopeOk = (input) => input?.protocol === 2 && input.claim?.agent !== undefined;
 let value;
-if (method === "capabilities") value = caps;
-else if (method === "accept" || method === "inspect") value = { kind:"accepted",executionId:"execution-1",configHash:payload.claim.configHash };
+if (method === "capabilities") {
+  if (config.mode === "protocol-2") value = { protocol:2,...view };
+  else if (payload.agent === null) value = { protocol:3,installations:config.installations ?? [{ id:"codex",kind:"codex",defaults:{model:"fixture-model",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"0.0.0-fixture" }] };
+  else {
+    const selection = { ...defaults, ...payload.agent };
+    if (config.mode === "rewrite-model") selection.model = "rewritten-model";
+    value = { protocol:3,selection,configHash:config.configHash ?? "d".repeat(64),timeoutMs:120000,killGraceMs:5000,capabilities:config.capabilities ?? view };
+  }
+}
+else if (method === "accept" || method === "inspect") {
+  if (!envelopeOk(payload)) { process.stderr.write("control-envelope-invalid\n"); process.exit(2); }
+  value = { kind:"accepted",executionId:"execution-1",configHash:payload.claim.configHash };
+}
 else if (method === "handoff") value = { kind:"latched",requestId:payload.request.requestId };
 else if (method === "collect") value = { events:config.collectRef?[{runId:payload.input.claim.runId,generation:payload.input.claim.generation,eventSeq:1,bucket:"work",cumulative:null,source:config.collectRef}]:[],candidate:null,terminal:null };
 else if (method === "read-evidence") {
   const bytes = Buffer.from(config.evidence ?? "evidence");
   value = { artifactId:payload.ref.artifactId,hash:config.badHash ? "0".repeat(64) : createHash("sha256").update(bytes).digest("hex"),base64:bytes.toString("base64") };
 }
-else throw new Error(`unexpected method ${control} ${method} ${adapterFlag} ${adapter} ${configFlag}`);
+else throw new Error(`unexpected method ${control} ${method} ${agentsFlag}`);
 process.stdout.write(`${JSON.stringify(value)}\n`);
````


- [ ] **Step 2: 跑，确认红**
  `./node_modules/.bin/vitest run tests/control/ccloopPort.test.ts > $S/t7-s2-red.log 2>&1; echo rc=$?`
  Expected：rc=1；`resolveAgent is not a function`／`listAgents is not a function`／`control-adapter-config-invalid` 与 `--adapter` 相关的断言失败（端口仍是旧形状）。

- [ ] **Step 3: 端口、schema、类型、错误目录、router（GREEN 的前半）**

`src/control/schema.ts`：

````diff
diff --git a/src/control/schema.ts b/src/control/schema.ts
index c425373..533c0c6 100644
--- a/src/control/schema.ts
+++ b/src/control/schema.ts
@@ -23,14 +23,20 @@ export const commandEnvelopeSchema = z.object({
   payload:z.custom<unknown>((value)=>value!==undefined,{message:"payload-required"}),
 }).strict();
 export const groupSchema = z.object({groupId:idSchema,projectKey:z.string().trim().min(1),goal:z.string().trim().min(1),successConditions:z.array(z.string().trim().min(1)).min(1),budgetMode:z.enum(["strict","soft"]).default("strict"),limit:amountSchema,reviewReserve:amountSchema,deadlineAt:z.string().datetime({offset:true}).nullable()}).strict();
-export const workSchema = z.object({workItemId:idSchema,taskId:idSchema.nullable(),kind:z.enum(["task","decompose","reconcile","handoff","goal-review","memory"]),dependsOn:z.array(idSchema),contract:z.unknown(),configHash:z.string().min(1),grant:grantSchema,parentRunId:idSchema.optional()}).strict().superRefine((value,ctx)=>{
+// Agent selection spec §3 (`agent-selection-v1`): model and contextWindow are opaque to Orca (I2); ccloop's
+// descriptor is the only judge of what a kind can express, so these check shape only.
+export const contextWindowSchema = z.union([z.literal("agent-default"),z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]);
+export const agentSelectionSchema = z.object({agent:idSchema,model:z.string().min(1).max(200),contextWindow:contextWindowSchema}).strict();
+export const partialSelectionSchema = z.object({agent:idSchema.optional(),model:z.string().min(1).max(200).optional(),contextWindow:contextWindowSchema.optional()}).strict();
+export const workSchema = z.object({workItemId:idSchema,taskId:idSchema.nullable(),kind:z.enum(["task","decompose","reconcile","handoff","goal-review","memory"]),dependsOn:z.array(idSchema),contract:z.unknown(),configHash:z.string().min(1),agent:agentSelectionSchema,grant:grantSchema,parentRunId:idSchema.optional()}).strict().superRefine((value,ctx)=>{
   if ((value.kind === "handoff") !== (value.parentRunId !== undefined)) ctx.addIssue({code:"custom",message:"handoff-parent-required"});
 });
 
 export const artifactSchema=z.object({artifactId:idSchema,hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
 export const inputCheckpointSchema=z.object({predecessorRunId:idSchema,checkpointId:idSchema,checkpointHash:z.string().regex(/^[a-f0-9]{64}$/),bundlePath:z.string().min(1)}).strict();
 export const handoffRequestSchema=z.object({protocol:z.literal(1),requestId:idSchema,runId:idSchema,generation:safeInteger.positive(),reason:z.enum(["budget","context","human","graph-change","shutdown"]),deadlineAt:z.string().datetime({offset:true})}).strict();
-export const startEnvelopeSchema=z.object({protocol:z.literal(1),claim:z.object({groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,commandId:idSchema,configHash:z.string().min(1),grant:grantSchema,ownerToken:idSchema}).strict(),contractHash:z.string().regex(/^[a-f0-9]{64}$/),inputCheckpoint:inputCheckpointSchema.nullable(),work:z.object({contract:z.unknown(),targetRepo:z.string().min(1),base:z.string().min(1),sourceDir:z.string().min(1)}).strict()}).strict();
+// Agent selection spec §4.6: StartEnvelopeV2 is V1 with `protocol: 2` and the claim carrying the complete, frozen selection.
+export const startEnvelopeSchema=z.object({protocol:z.literal(2),claim:z.object({groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,commandId:idSchema,configHash:z.string().min(1),agent:agentSelectionSchema,grant:grantSchema,ownerToken:idSchema}).strict(),contractHash:z.string().regex(/^[a-f0-9]{64}$/),inputCheckpoint:inputCheckpointSchema.nullable(),work:z.object({contract:z.unknown(),targetRepo:z.string().min(1),base:z.string().min(1),sourceDir:z.string().min(1)}).strict()}).strict();
 export const candidateSchema=z.object({
  groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,
  checkpointId:idSchema,usageHighWater:safeInteger,result:z.enum(["complete","partial","failed"]),artifacts:z.array(artifactSchema),snapshot:artifactSchema.nullable(),
````

`src/control/types.ts`：

````diff
diff --git a/src/control/types.ts b/src/control/types.ts
index f5d8f12..fe68f7a 100644
--- a/src/control/types.ts
+++ b/src/control/types.ts
@@ -1,4 +1,5 @@
 import type { CapabilityViewV1 } from "./webProtocol.js";
+import type { AgentSelection } from "./agentSelection.js";
 
 export type WorkKind = "task" | "decompose" | "reconcile" | "handoff" | "goal-review" | "memory";
 export type WebWorkKind = "budget-estimate" | "task" | "handoff" | "goal-review";
@@ -11,7 +12,6 @@ export interface Identity {
   groupId: string; workItemId: string; taskId: string | null; runId: string;
   generation: number; graphVersion: number; targetVersion: number;
 }
-export type Capabilities = CapabilityViewV1 & { protocol: 2 };
 export interface GroupInput {
   groupId: string; projectKey: string; goal: string; successConditions: string[];
   budgetMode?: BudgetMode; limit: Amount; reviewReserve: Amount;
@@ -19,7 +19,7 @@ export interface GroupInput {
 }
 export interface WorkBase {
   workItemId: string; taskId: string | null;
-  dependsOn: string[]; contract: unknown; configHash: string; grant: Grant;
+  dependsOn: string[]; contract: unknown; configHash: string; agent: AgentSelection; grant: Grant;
 }
 export type WorkInput = WorkBase & (
   | {kind:"handoff";parentRunId:string}
@@ -27,12 +27,12 @@ export type WorkInput = WorkBase & (
 );
 export interface ClaimInput extends CommandMeta {
   groupId: string; workItemId: string; graphVersion: number; targetVersion: number;
-  capabilities: Capabilities;
+  capabilities: CapabilityViewV1;
   executionProfile?: ExecutionProfileBinding;
   handoffProfile?: ExecutionProfileBinding;
 }
 export interface Claim extends Identity {
-  commandId: string; configHash: string; grant: Grant; ownerToken: string;
+  commandId: string; configHash: string; agent: AgentSelection; grant: Grant; ownerToken: string;
 }
 export interface ArtifactRef { artifactId: string; hash: string }
 export type HandoffReason = "budget" | "context" | "human" | "graph-change" | "shutdown";
````

`src/control/executionPort.ts`：

````diff
diff --git a/src/control/executionPort.ts b/src/control/executionPort.ts
index c7d0471..2ca9140 100644
--- a/src/control/executionPort.ts
+++ b/src/control/executionPort.ts
@@ -1,19 +1,25 @@
-import type { Candidate, Capabilities, Claim, StopProof, UsageEvent, ArtifactRef, HandoffRequest, HandoffAck } from "./types.js";
+import type { Candidate, Claim, StopProof, UsageEvent, ArtifactRef, HandoffRequest, HandoffAck } from "./types.js";
 import type { InputCheckpointV1 } from "./resumeBundle.js";
 import { ControlError } from "./errors.js";
 import { createCcloopExecutionPort } from "./ccloopPort.js";
-import type { CapabilityViewV1 } from "./webProtocol.js";
-export type ProfileCapabilityProbe = CapabilityViewV1;
-export interface StartEnvelope { protocol:1;claim:Claim;contractHash:string;inputCheckpoint:InputCheckpointV1|null; work:{contract:unknown;targetRepo:string;base:string;sourceDir:string} }
+import type { AgentResolution, ContextWindow, PartialSelection } from "./agentSelection.js";
+export interface StartEnvelope { protocol:2;claim:Claim;contractHash:string;inputCheckpoint:InputCheckpointV1|null; work:{contract:unknown;targetRepo:string;base:string;sourceDir:string} }
 export type ExecutionStatus={kind:"absent"}|{kind:"accepted";executionId:string;configHash:string}|{kind:"unknown"}|{kind:"stopped";proof:StopProof};
 export interface ExecutionReport {
  events:UsageEvent[];candidate:Candidate|null;
  terminal:{outcome:"succeeded"|"blocked_waiting_human"|"exhausted"|"cancelled"|"failed";attemptSha:string|null;sourceDir:string;repoDir:string}|null;
 }
+/** Agent selection spec §4.6: `control capabilities` with `agent: null` -- the installation table as ccloop reads it. */
+export interface AgentsView { installations: Array<{ id: string; kind: string; defaults: { model: string; contextWindow: ContextWindow }; contextOptions: ContextWindow[]; version: string }> }
 export interface ExecutionPort {
-  /** A full V1 probe. Absence is capability-unavailable, never inferred. */
-  probeProfileCapabilities?():Promise<ProfileCapabilityProbe>;
-  capabilities():Promise<Capabilities>;
+  /**
+   * Agent selection spec §4.6 (capabilities protocol 3 with a selection). ccloop fills the descriptor's
+   * defaults, validates, materializes and answers the configHash: Orca never computes one (spec I3).
+   * There is no capability probe without a selection -- a gate asks about the selection it will dispatch.
+   */
+  resolveAgent(partial:PartialSelection):Promise<AgentResolution>;
+  /** Capabilities protocol 3 with `agent: null`: the installations the panel may offer. */
+  listAgents():Promise<AgentsView>;
   readEvidence(ref:ArtifactRef):Promise<Buffer>;
   accept(input:StartEnvelope):Promise<ExecutionStatus>;
   inspect(input:StartEnvelope):Promise<ExecutionStatus>;
@@ -21,6 +27,6 @@ export interface ExecutionPort {
   collect(input:StartEnvelope,afterSeq:number):Promise<ExecutionReport>;
 }
 /** No legacy runner fallback: production is enabled only by explicit immutable options. */
-export function productionExecutionPort(options?:{binary:string;adapter:"codex";adapterConfigPath:string;timeoutMs:number}):ExecutionPort {
+export function productionExecutionPort(options?:{binary:string;agentsTablePath:string;timeoutMs:number}):ExecutionPort {
  if(!options)throw new ControlError("control-protocol-unavailable");return createCcloopExecutionPort(options);
 }
````

`src/control/ccloopPort.ts`：

````diff
diff --git a/src/control/ccloopPort.ts b/src/control/ccloopPort.ts
index 8d68f37..c7bdce8 100644
--- a/src/control/ccloopPort.ts
+++ b/src/control/ccloopPort.ts
@@ -3,11 +3,12 @@ import { createHash } from "node:crypto";
 import { lstatSync, realpathSync } from "node:fs";
 import { isAbsolute, join } from "node:path";
 import { z } from "zod";
-import type { ExecutionPort, ExecutionReport, ExecutionStatus, StartEnvelope } from "./executionPort.js";
-import type { ArtifactRef, Capabilities, HandoffAck, HandoffRequest } from "./types.js";
+import type { AgentsView, ExecutionPort, ExecutionReport, ExecutionStatus, StartEnvelope } from "./executionPort.js";
+import type { ArtifactRef, HandoffAck, HandoffRequest } from "./types.js";
+import type { AgentResolution, PartialSelection } from "./agentSelection.js";
 import { ControlError, type NonDurableControlErrorCode } from "./errors.js";
-import { artifactSchema, candidateSchema, safeInteger } from "./schema.js";
-import { capabilitiesSchema } from "./webProtocol.js";
+import { agentSelectionSchema, artifactSchema, candidateSchema, contextWindowSchema, idSchema, safeInteger } from "./schema.js";
+import { capabilityViewSchema } from "./webProtocol.js";
 
 const MAX_OUTPUT=24*1024*1024;
 const executionStatusSchema=z.discriminatedUnion("kind",[
@@ -25,17 +26,39 @@ const eventSchema=z.object({runId:z.string().min(1),generation:safeInteger.posit
 const terminalSchema=z.object({status:z.enum(["succeeded","blocked_waiting_human","exhausted","cancelled","failed"]),currentAttempt:safeInteger,attemptsUsed:safeInteger,lastTransitionAt:z.string(),waitingOnHuman:z.boolean(),stopReason:z.string().nullable(),budgetSnapshot:z.object({attemptsRemaining:safeInteger,timeRemainingMs:safeInteger,tokenBudgetRemaining:safeInteger}).strict(),recentFailures:z.array(z.object({rejectCategory:z.string(),primaryTargetPaths:z.array(z.string()),failingCommand:z.string().nullable()}).strict())}).strict();
 const collectionSchema=z.object({events:z.array(eventSchema),candidate:candidateSchema.nullable(),terminal:terminalSchema.nullable()}).strict();
 const evidenceSchema=z.object({artifactId:z.string().min(1),hash:z.string().regex(/^[a-f0-9]{64}$/),base64:z.string()}).strict();
+// Agent selection spec §4.6: capabilities protocol 3. Two shapes, chosen by the request: `agent: null` answers the
+// table view, a partial selection answers that selection's resolution (the eight-field view carries no protocol tag).
+const agentsViewSchema=z.object({protocol:z.literal(3),installations:z.array(z.object({id:idSchema,kind:z.string().min(1),defaults:z.object({model:z.string().min(1),contextWindow:contextWindowSchema}).strict(),contextOptions:z.array(contextWindowSchema).min(1),version:z.string().min(1)}).strict())}).strict();
+const agentResolutionSchema=z.object({protocol:z.literal(3),selection:agentSelectionSchema,configHash:z.string().regex(/^[a-f0-9]{64}$/),timeoutMs:safeInteger.positive().max(2_147_483_647),killGraceMs:safeInteger.max(60_000),capabilities:capabilityViewSchema}).strict();
+
+/**
+ * The ccloop error code inside a `control-peer-exit` (ccloop prints `<code>[:detail]` on stderr and exits non-zero),
+ * or null for any other failure. Agent selection spec §7: `agent-selection-rejected:<taskId|slot>:<ccloop code>`
+ * names the code, so it is read here, where the peer's output is parsed, and nowhere else.
+ */
+export function peerErrorCode(error:unknown):string|null {
+ if(!(error instanceof ControlError)||error.code!=="control-peer-exit"||error.detail===undefined)return null;
+ const match=/^[^:]*:([a-z][a-z0-9-]*)/.exec(error.detail);return match?match[1]!:null;
+}
+/** Agent selection spec §7: ccloop's refusals of a selection or table, which a caller must be able to tell apart. */
+const NAMED_REFUSALS=new Set(["agent-installation-missing","agent-context-unsupported","agent-selection-invalid","agent-version-drift","agents-table-invalid"] as const);
+type NamedRefusal=typeof NAMED_REFUSALS extends Set<infer T>?T:never;
+/** A capabilities call's failure: one of ccloop's named refusals is rethrown under its own name, anything else as it was. */
+function named(error:unknown):unknown {
+ const code=peerErrorCode(error);
+ return code!==null&&NAMED_REFUSALS.has(code as NamedRefusal)?new ControlError(code as NamedRefusal,(error as ControlError).detail):error;
+}
 
 function regularAbsolute(path:string,code:NonDurableControlErrorCode,executable=false):string {
  try {const stat=lstatSync(path);if(!isAbsolute(path)||realpathSync(path)!==path||!stat.isFile()||stat.isSymbolicLink()||(executable&&(stat.mode&0o111)===0))throw new Error();return path;}
  catch{throw new ControlError(code);}
 }
-export function createCcloopExecutionPort(options:{binary:string;adapter:"codex";adapterConfigPath:string;timeoutMs:number}):ExecutionPort {
- const binary=regularAbsolute(options.binary,"control-binary-invalid",true),config=regularAbsolute(options.adapterConfigPath,"control-adapter-config-invalid");
- if(options.adapter!=="codex"||!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<=0)throw new ControlError("control-port-options-invalid");
+export function createCcloopExecutionPort(options:{binary:string;agentsTablePath:string;timeoutMs:number}):ExecutionPort {
+ const binary=regularAbsolute(options.binary,"control-binary-invalid",true),table=regularAbsolute(options.agentsTablePath,"control-agents-table-invalid");
+ if(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<=0)throw new ControlError("control-port-options-invalid");
  const evidenceContext=new Map<string,StartEnvelope>(),key=(ref:ArtifactRef)=>`${ref.artifactId}:${ref.hash}`;
  const raw=(method:string,payload:unknown)=>new Promise<unknown>((resolve,reject)=>{
-   const child=execFile(binary,["control",method,"--adapter",options.adapter,"--adapter-config",config],{encoding:"utf8",maxBuffer:MAX_OUTPUT,timeout:options.timeoutMs},(error,stdout,stderr)=>{
+   const child=execFile(binary,["control",method,"--agents",table],{encoding:"utf8",maxBuffer:MAX_OUTPUT,timeout:options.timeoutMs},(error,stdout,stderr)=>{
     if(error){const e=error as Error&{code?:number|string;killed?:boolean};if(e.code==="ERR_CHILD_PROCESS_STDIO_MAXBUFFER"||/maxBuffer/i.test(e.message))return reject(new ControlError("control-response-too-large"));if(e.killed)return reject(new ControlError("control-peer-timeout"));const suffix=String(stderr).trim();return reject(new ControlError("control-peer-exit",`${String(e.code)}${suffix?":"+suffix:""}`));}
     if(Buffer.byteLength(stdout)>MAX_OUTPUT||Buffer.byteLength(stderr)>MAX_OUTPUT)return reject(new ControlError("control-response-too-large"));
     try{resolve(JSON.parse(stdout));}catch{reject(new ControlError("control-response-invalid"));}
@@ -45,37 +68,27 @@ export function createCcloopExecutionPort(options:{binary:string;adapter:"codex"
  const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{const parsed=schema.safeParse(value);if(!parsed.success)throw new ControlError("control-response-invalid");return parsed.data;};
  const port:ExecutionPort={
   /**
-   * Assembly plan Task 3. The router needs this method to exist (`profiles.ts:67-69,150`), and
-   * without it every Web claim is reported as `control-capability-probe-failed` -- a probe that was
-   * never attempted, blamed on the adapter.
+   * Agent selection spec §4.6. The request's own fields come back verbatim (spec M5: an alias is not
+   * normalised), which is what lets a caller tell a layer's value from a descriptor default; an answer that
+   * changed one is not this selection's answer, so it is refused rather than passed on.
    *
-   * ⚠️ *** ccloop's control protocol has no V1 profile probe. *** `control capabilities` answers
-   * seven fields (ccloop `src/control/command.ts`, the `method === "capabilities"` arm) and none of
-   * them covers `contextObservation`, `handoffControl`, `handoffExecution`, `contextWindowTokens` or
-   * a `requestBoundProof` descriptor. So this translates what ccloop states and says `unavailable` /
-   * `null` for what it does not -- it does NOT infer them, per `ExecutionPort`'s own contract and the
-   * standing rule that Orca may not invent a substitute source for a peer's observation.
-   *
-   * The consequence is deliberate and fail-closed: a claim through this port reaches
-   * `control-capability-unsupported` (`service.ts`'s `profiledCapabilities` requires
-   * `handoffControl === "durable"`), which is accurate. Dispatching Web work to real ccloop needs
-   * ccloop's `capabilities` to grow these fields first; that is a ccloop-side change, recorded in
-   * both handoffs, and nothing on this side may paper over it.
-   *
-   * *** ERRATUM (2026-09-24, G1 seam A) *** The paragraph above describes the state before the
-   * capability vocabulary was settled: ccloop's `capabilities` now answers the eight-field v2
-   * shape, so this method passes the peer's answer through and substitutes nothing. The rule it
-   * cites -- that Orca may not invent a substitute source for a peer's observation -- is
-   * unchanged and is now enforced by a criterion in `tests/control/ccloopPort.test.ts`
-   * ("does not invent a substitute source for a peer's observation -- an overridden field passes
-   * through unchanged") rather than by hardcoded `unavailable`s. See
-   * docs/superpowers/specs/2026-09-24-g1-control-wire-contract-design.md in the ccloop repository.
+   * The standing rule of the retired `probeProfileCapabilities` still holds: Orca does not invent a substitute
+   * for a field ccloop did not state -- the view is the peer's, unaltered (criterion in ccloopPort.test.ts).
    */
-  async probeProfileCapabilities(){
-   const {protocol:_protocol,...view}=parse(capabilitiesSchema,await raw("capabilities",{})) as Capabilities;
-   return view;
+  async resolveAgent(partial:PartialSelection):Promise<AgentResolution>{
+   let answer:unknown;
+   try{answer=await raw("capabilities",{agent:partial});}catch(error){throw named(error);}
+   const {protocol:_protocol,...resolution}=parse(agentResolutionSchema,answer);
+   for(const key of ["agent","model","contextWindow"] as const){
+    if(partial[key]!==undefined&&resolution.selection[key]!==partial[key])throw new ControlError("control-response-invalid",`selection-not-echoed:${key}`);
+   }
+   return resolution;
+  },
+  async listAgents():Promise<AgentsView>{
+   let answer:unknown;
+   try{answer=await raw("capabilities",{agent:null});}catch(error){throw named(error);}
+   const {protocol:_protocol,...view}=parse(agentsViewSchema,answer);return view;
   },
-  async capabilities(){return parse(capabilitiesSchema,await raw("capabilities",{})) as Capabilities;},
   async accept(input){return parse(executionStatusSchema,await raw("accept",input)) as ExecutionStatus;},
   async inspect(input){return parse(executionStatusSchema,await raw("inspect",input)) as ExecutionStatus;},
   async requestHandoff(input,request){return parse(handoffAckSchema,await raw("handoff",{input,request})) as HandoffAck;},
````

`src/control/errors.ts`：

````diff
diff --git a/src/control/errors.ts b/src/control/errors.ts
index 6e73078..b6a5e84 100644
--- a/src/control/errors.ts
+++ b/src/control/errors.ts
@@ -81,6 +81,14 @@ export const durableCommandErrorStatuses = {
   // Same shape and same reason as the line above: a state a person is told about, not a crash.
   "control-estimator-unconfigured": 422,
   "control-protocol-unavailable": 422,
+  // Agent selection spec §7: ccloop's named refusals of a selection (the port rethrows them by name) and Orca's own
+  // "no layer chose an agent". Durable and 422 like the port codes above: understood, and not performable as asked.
+  "agent-context-unsupported": 422,
+  "agent-installation-missing": 422,
+  "agent-selection-invalid": 422,
+  "agent-unselected": 422,
+  "agent-version-drift": 422,
+  "agents-table-invalid": 422,
   "control-terminal-pending": 422,
   "dependency-not-done": 422,
   "duplicate-proposal-target": 422,
@@ -137,7 +145,7 @@ export const nonDurableControlErrorClassifications = {
   "cleanup-path-invalid": "internal",
   "cleanup-source-reused": "internal",
   "command-id-conflict": "internal",
-  "control-adapter-config-invalid": "internal",
+  "control-agents-table-invalid": "internal",
   "control-async-transaction": "internal",
   "control-binary-invalid": "internal",
   "control-capability-probe-failed": "transient",
````

`src/control/webProtocol.ts`：

````diff
diff --git a/src/control/webProtocol.ts b/src/control/webProtocol.ts
index 41b8192..9eb176a 100644
--- a/src/control/webProtocol.ts
+++ b/src/control/webProtocol.ts
@@ -89,11 +89,9 @@ const declaredCapabilitiesSchema = capabilityViewSchema.extend({
   handoffExecution: z.enum(["mechanical-in-run-v1", "model-assisted-v1"]),
 }).strict();
 
-// The v2 wire vocabulary: the view schema plus the protocol tag. No independent field list --
-// this is the single source of truth for what a v2 capabilities payload looks like. Defined here
-// rather than in schema.ts to avoid a runtime ESM import cycle (schema.ts is imported by
-// webProtocol.ts for primitives like safeInteger/idSchema).
-export const capabilitiesSchema = capabilityViewSchema.extend({ protocol: z.literal(2) }).strict();
+// Agent selection spec §4.6 / §5: the protocol-2 capabilities payload is gone. `control capabilities`
+// answers protocol 3 (a table view, or one selection's resolution whose `capabilities` is this view with
+// no protocol tag); those response schemas live with the port that parses them (ccloopPort.ts).
 
 export const executionProfileSnapshotSchema = z
   .object({
````

`src/control/unconfiguredPort.ts`：

````diff
diff --git a/src/control/unconfiguredPort.ts b/src/control/unconfiguredPort.ts
index 5148b51..874a6a5 100644
--- a/src/control/unconfiguredPort.ts
+++ b/src/control/unconfiguredPort.ts
@@ -3,14 +3,14 @@ import type { ExecutionPort } from "./executionPort.js";
 
 /**
  * Assembly design spec §3 / ruling R5. A panel is allowed to boot with no `ORCA_CCLOOP_BIN` +
- * adapter config: it mounts the control plane, serves every read, and refuses the commands that
- * need an execution port. This is the object that does the refusing.
+ * agents table (`ORCA_AGENTS_TABLE`, agent selection spec §6.6): it mounts the control plane, serves
+ * every read, and refuses the commands that need an execution port. This is the object that does the
+ * refusing.
  *
  * It is deliberately NOT a stub that answers plausibly. Every method rejects with one closed code,
- * including the optional `probeProfileCapabilities` -- if that one were left off, the router would
- * report `control-capability-probe-failed` (`profiles.ts:150`) and an operator who forgot an
- * environment variable would be told their adapter lacks a capability. The two failures need
- * different answers because they need different fixes.
+ * `resolveAgent` included -- the router folds a probe throw into a failure code, and an operator who
+ * forgot an environment variable must be told that, not that their agent lacks a capability. The two
+ * failures need different answers because they need different fixes.
  *
  * The one thing this must never be is a fallback to `legacyExecutionPort`: that runner has no
  * ledger authority and no handoff protocol, so "quietly ran the work somewhere else" is strictly
@@ -20,12 +20,12 @@ export function createUnconfiguredControlPort(): ExecutionPort {
   const refuse = (): never => {
     throw new ControlError(
       "control-port-unconfigured",
-      "this panel has no execution port: set ORCA_CCLOOP_BIN and ORCA_CCLOOP_ADAPTER_CONFIG and restart it.",
+      "this panel has no execution port: set ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE and restart it.",
     );
   };
   return Object.freeze({
-    probeProfileCapabilities: async () => refuse(),
-    capabilities: async () => refuse(),
+    resolveAgent: async () => refuse(),
+    listAgents: async () => refuse(),
     readEvidence: async () => refuse(),
     accept: async () => refuse(),
     inspect: async () => refuse(),
````

`src/control/profiles.ts`：

````diff
diff --git a/src/control/profiles.ts b/src/control/profiles.ts
index de05082..d24311e 100644
--- a/src/control/profiles.ts
+++ b/src/control/profiles.ts
@@ -1,5 +1,6 @@
 import { ControlError, type KnownControlErrorCode } from "./errors.js";
-import type { ExecutionPort, ProfileCapabilityProbe } from "./executionPort.js";
+import type { ExecutionPort } from "./executionPort.js";
+import type { AgentSelection, PartialSelection } from "./agentSelection.js";
 import { sha256Canonical } from "./canonicalJson.js";
 import {
   capabilityViewSchema,
@@ -26,7 +27,12 @@ export interface ObservedProfile {
 
 export interface ExecutionProfileRouter {
   resolve(workKind: WebWorkKindV1, profileId: string, expectedHash: string): FrozenProfile;
-  probe(profile: FrozenProfile): Promise<ObservedProfile>;
+  /**
+   * Agent selection spec §6.4 (C3): a probe is of one selection -- the one the caller is about to dispatch, freeze
+   * or show. `selection` is optional only until agent selection plan T11, which makes it required and passes the
+   * frozen one at every gate; until then a call without it takes the TEMPORARY path of `temporaryProbeSelection`.
+   */
+  probe(profile: FrozenProfile, selection?: AgentSelection): Promise<ObservedProfile>;
   list(): readonly FrozenProfile[];
 }
 
@@ -41,7 +47,8 @@ export const unavailableCapabilities: CapabilityViewV1 = Object.freeze({
 });
 
 const unboundPort: ExecutionPort = {
-  capabilities: async () => { throw new ControlError("control-protocol-unavailable"); },
+  resolveAgent: async () => { throw new ControlError("control-protocol-unavailable"); },
+  listAgents: async () => { throw new ControlError("control-protocol-unavailable"); },
   readEvidence: async () => { throw new ControlError("control-protocol-unavailable"); },
   accept: async () => { throw new ControlError("control-protocol-unavailable"); },
   inspect: async () => { throw new ControlError("control-protocol-unavailable"); },
@@ -58,16 +65,16 @@ function deepFreeze<T>(value: T): T {
 }
 
 function ownPort(port: ExecutionPort): ExecutionPort {
-  const capabilities = port.capabilities.bind(port);
+  const resolveAgent = port.resolveAgent.bind(port);
+  const listAgents = port.listAgents.bind(port);
   const readEvidence = port.readEvidence.bind(port);
   const accept = port.accept.bind(port);
   const inspect = port.inspect.bind(port);
   const requestHandoff = port.requestHandoff.bind(port);
   const collect = port.collect.bind(port);
-  const probeProfileCapabilities = port.probeProfileCapabilities?.bind(port);
   const owned: ExecutionPort = {
-    ...(probeProfileCapabilities ? { probeProfileCapabilities: () => probeProfileCapabilities() } : {}),
-    capabilities: () => capabilities(),
+    resolveAgent: (partial) => resolveAgent(partial),
+    listAgents: () => listAgents(),
     readEvidence: (ref) => readEvidence(ref),
     accept: (input) => accept(input),
     inspect: (input) => inspect(input),
@@ -85,7 +92,7 @@ function proofMatches(left: CapabilityViewV1["requestBoundProof"], right: Capabi
   return left !== null && right !== null && sha256Canonical(left) === sha256Canonical(right);
 }
 
-export function intersectCapabilities(declared: DeclaredCapabilities, observed: ProfileCapabilityProbe): CapabilityViewV1 {
+export function intersectCapabilities(declared: DeclaredCapabilities, observed: CapabilityViewV1): CapabilityViewV1 {
   const usageOrder = ["unavailable", "phase-end", "realtime"] as const;
   const enforcementOrder = ["unavailable", "soft", "bounded"] as const;
   const handoffOrder = ["unavailable", "phase-end", "durable"] as const;
@@ -105,6 +112,18 @@ export function intersectCapabilities(declared: DeclaredCapabilities, observed:
   };
 }
 
+/**
+ * TEMPORARY (agent selection plan T7; plan T11 deletes it with the optional parameter above). What a probe with no
+ * selection asks about: the installation with the lexically first id in the port's own table, with no field
+ * overridden, so the capabilities still come from ccloop for an installation that exists (nothing is taken from the
+ * profile's declaration). With several installations this is arbitrary; that is why it may not outlive T11.
+ */
+async function temporaryProbeSelection(port: ExecutionPort): Promise<PartialSelection> {
+  const ids = (await port.listAgents()).installations.map((installation) => installation.id).sort();
+  if (ids.length === 0) throw new ControlError("control-capability-probe-failed", "agents-table-empty");
+  return { agent: ids[0] };
+}
+
 export function resolveProfile(snapshot: ExecutionProfileSnapshotV1, port: ExecutionPort = unboundPort): FrozenProfile {
   const parsed = executionProfileSnapshotSchema.safeParse(snapshot);
   if (!parsed.success) throw new ControlError("control-profile-invalid", parsed.error.issues[0]?.message);
@@ -144,11 +163,11 @@ export function createExecutionProfileRouter(
       }
       return profile;
     },
-    async probe(profile: FrozenProfile): Promise<ObservedProfile> {
+    async probe(profile: FrozenProfile, selection?: AgentSelection): Promise<ObservedProfile> {
       if (byId.get(profile.snapshot.profile.profileId) !== profile) throw new ControlError("profile-changed");
       try {
-        if (!profile.port.probeProfileCapabilities) throw new ControlError("control-capability-probe-failed");
-        const result = capabilityViewSchema.safeParse(await profile.port.probeProfileCapabilities());
+        const agent: PartialSelection = selection ?? await temporaryProbeSelection(profile.port);
+        const result = capabilityViewSchema.safeParse((await profile.port.resolveAgent(agent)).capabilities);
         if (!result.success) throw new ControlError("control-capability-probe-failed");
         return Object.freeze({
           profile,
````

`src/control/budget.ts`：

````diff
diff --git a/src/control/budget.ts b/src/control/budget.ts
index ccf7617..13cb95e 100644
--- a/src/control/budget.ts
+++ b/src/control/budget.ts
@@ -1,10 +1,10 @@
 import { controlGraph } from "./graph.js";
 import { randomUUID } from "node:crypto";
 import type { ControlStore } from "./store.js";
-import type { Amount, BudgetMode, Capabilities, Claim, ClaimInput, ExecutionProfileBinding, Grant, RunView, StopProof, WorkInput } from "./types.js";
+import type { Amount, BudgetMode, Claim, ClaimInput, ExecutionProfileBinding, Grant, RunView, StopProof, WorkInput } from "./types.js";
 import { ControlError } from "./errors.js";
 import { amountSchema, safeInteger, workSchema } from "./schema.js";
-import { capabilitiesSchema } from "./webProtocol.js";
+import { capabilityViewSchema, type CapabilityViewV1 } from "./webProtocol.js";
 import { applyCommand, dimensions, fits, zero } from "./commands.js";
 import { readGroup, readWork, saveGroup, saveWork, allWork, readBudgetProposal, type GroupRecord } from "./queries.js";
 import { canonicalBytes } from "./canonicalJson.js";
@@ -81,8 +81,8 @@ export function syncWebBudget(store:ControlStore,group:GroupRecord,currentRun:Ru
 export function componentMin(a:Amount,b:Amount):Amount {
   return {tokens:Math.min(a.tokens,b.tokens),activeMs:Math.min(a.activeMs,b.activeMs),attempts:Math.min(a.attempts,b.attempts),sessions:Math.min(a.sessions,b.sessions)};
 }
-export function assertCapabilities(mode:BudgetMode,c:Capabilities):void {
-  if(!capabilitiesSchema.safeParse(c).success) throw new ControlError("control-capability-unsupported");
+export function assertCapabilities(mode:BudgetMode,c:CapabilityViewV1):void {
+  if(!capabilityViewSchema.safeParse(c).success) throw new ControlError("control-capability-unsupported");
   if(c.usageObservation==="unavailable" || c.budgetEnforcement==="unavailable" || c.handoffControl!=="durable" || c.handoffExecution===null) throw new ControlError("control-capability-unsupported");
   if(mode==="strict" && (c.budgetEnforcement!=="bounded" || c.requestBoundProof===null)) throw new ControlError("control-capability-unsupported");
 }
@@ -108,7 +108,7 @@ export function claimWork(store:ControlStore,input:ClaimInput, preparedWork?:Wor
       if(parent.groupId!==groupId || parent.taskId!==work.taskId || parent.state==="settled" || parent.configHash!==work.configHash || parent.handoffWorkItemId) throw new ControlError("handoff-parent-invalid");
       if(!fits(work.grant.handoff,zero(),parent.remaining.handoff) || dimensions.some(k=>work.grant.work[k]!==0)) throw new ControlError("handoff-budget-unavailable");
       parent.handoffWorkItemId=workItemId;saveRun(store,parent);
-      return {groupId:parent.groupId,workItemId:parent.workItemId,taskId:parent.taskId,runId:parent.runId,generation:parent.generation,graphVersion:parent.graphVersion,targetVersion:parent.targetVersion,commandId:parent.commandId,configHash:parent.configHash,grant:parent.grant,ownerToken:parent.ownerToken};
+      return {groupId:parent.groupId,workItemId:parent.workItemId,taskId:parent.taskId,runId:parent.runId,generation:parent.generation,graphVersion:parent.graphVersion,targetVersion:parent.targetVersion,commandId:parent.commandId,configHash:parent.configHash,agent:parent.agent,grant:parent.grant,ownerToken:parent.ownerToken};
     }
     if(group.stopped) throw new ControlError("group-stopped");
     if(group.deadlineAt && Date.now()>=Date.parse(group.deadlineAt)) throw new ControlError("group-deadline-expired");
@@ -125,7 +125,7 @@ export function claimWork(store:ControlStore,input:ClaimInput, preparedWork?:Wor
       if(!fits(group.used,reserved,group.limit)) throw new ControlError("group-budget-unavailable");
       group.reserved=reserved;
     }
-    const claim:Claim={groupId,workItemId,taskId:work.taskId,runId:"run-"+randomUUID(),generation:1,graphVersion,targetVersion,commandId:meta.commandId,configHash:work.configHash,grant:work.grant,ownerToken:randomUUID()};
+    const claim:Claim={groupId,workItemId,taskId:work.taskId,runId:"run-"+randomUUID(),generation:1,graphVersion,targetVersion,commandId:meta.commandId,configHash:work.configHash,agent:work.agent,grant:work.grant,ownerToken:randomUUID()};
     const run:RunRecord={...claim,...(executionProfile?{executionProfile}:{}),...(handoffProfile?{handoffProfile}:{}),executionId:null,state:"claimed",checkpointId:null,recoverable:false,remaining:structuredClone(work.grant),cumulative:{work:zero(),handoff:zero()},unknown:{work:true,handoff:true},highWater:0,breaches:[],handoffWorkItemId:null};
     store.db.prepare("INSERT INTO runs VALUES (?,?,?,?,1,?)").run(claim.runId,groupId,workItemId,1,JSON.stringify(run));
     work.status="running";saveWork(store,groupId,work);
````


  跑 `./node_modules/.bin/vitest run tests/control/ccloopPort.test.ts > $S/t7-s3.log 2>&1; echo rc=$?` ⇒ Expected rc=0，15 passed（副本实测：15/15）。

- [ ] **Step 4: claim／run／envelope 带选择 —— 失败判据与夹具（RED）**
  新判据：`dispatch.test.ts` 两条（闸门问 claim 自己的冻结选择；claim 的选择与 run 不等 ⇒ `run-owner-conflict`、零发送）、`startEnvelope.test.ts` 一条（run 行无完整选择 ⇒ `start-envelope-conflict|run:agent`）、`profiles.test.ts` 一条（router 原样探测给它的选择）；既有判据的改写（红表中标 Step 4 的各条）与夹具：

`tests/control/dispatch.test.ts`：

````diff
diff --git a/tests/control/dispatch.test.ts b/tests/control/dispatch.test.ts
index 726998b..ab0be7c 100644
--- a/tests/control/dispatch.test.ts
+++ b/tests/control/dispatch.test.ts
@@ -8,7 +8,7 @@ import { getGroup,getRun } from "../../src/control/queries.js";
 import { hashPayload,setGroupStopped } from "../../src/control/commands.js";
 import { openTestStore,seedBudgetCase } from "./fixtures/store.js";
 import { fakePeer } from "./fixtures/peer.js";
-const setup=async()=>{const h=await openTestStore();const s=seedBudgetCase(h.store);const claim=claimWork(h.store,s.t1Claim);return {...h,envelope:{protocol:1 as const,claim,contractHash:hashPayload(s.w1.contract),inputCheckpoint:null,work:{contract:s.w1.contract,targetRepo:h.root,base:"HEAD",sourceDir:h.root}}};};
+const setup=async()=>{const h=await openTestStore();const s=seedBudgetCase(h.store);const claim=claimWork(h.store,s.t1Claim);return {...h,envelope:{protocol:2 as const,claim,contractHash:hashPayload(s.w1.contract),inputCheckpoint:null,work:{contract:s.w1.contract,targetRepo:h.root,base:"HEAD",sourceDir:h.root}}};};
 describe("durable starts",()=>{
  it("recovers the accepted identity after the peer drops its response, without another launch",async()=>{
   const h=await setup();try{
@@ -69,12 +69,33 @@ describe("durable starts",()=>{
  it("rechecks stop after asynchronous capability discovery before creating a start intent",async()=>{
   const h=await setup();try{
    const root=join(h.root,"peer");const peer=fakePeer(root);
-   await expect(startClaim(h.store,{...peer,capabilities:async()=>{
+   // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): capability discovery is
+   // `resolveAgent` of the claim's selection now (spec §6.4); stop still lands during it and is still re-checked.
+   await expect(startClaim(h.store,{...peer,resolveAgent:async partial=>{
     setGroupStopped(h.store,"g1",true,{commandId:"stop-during-discovery",expectedRevision:3,by:"human"});
-    return peer.capabilities();
+    return peer.resolveAgent(partial);
    }},h.envelope)).rejects.toThrow("group-stopped");
    await expect(readFile(join(root,"launches"))).rejects.toThrow();
   }finally{await h.dispose();}
  });
 
+ it("asks the capability gate about the claim's own frozen selection, at start and at a re-send (agent selection spec §6.4)",async()=>{
+  const h=await setup();try{
+   const root=join(h.root,"peer");const peer=fakePeer(root);const asked:unknown[]=[];
+   const recording={...peer,resolveAgent:async(partial:Parameters<typeof peer.resolveAgent>[0])=>{asked.push(partial);return peer.resolveAgent(partial);},accept:async()=>{throw new Error("connection-before-send");}};
+   await expect(startClaim(h.store,recording,h.envelope)).rejects.toThrow("start-outcome-unknown");
+   await reconcileStart(h.store,{...recording,accept:peer.accept,inspect:async()=>({kind:"absent" as const})},h.envelope.claim.runId);
+   expect(asked).toEqual([h.envelope.claim.agent,h.envelope.claim.agent]);
+   expect(h.envelope.claim.agent).toEqual({agent:"codex",model:"fixture-model",contextWindow:"agent-default"});
+  }finally{await h.dispose();}
+ });
+ it("refuses an envelope whose claim names a selection other than the run's frozen one, before anything is sent",async()=>{
+  const h=await setup();try{
+   const root=join(h.root,"peer");
+   await expect(startClaim(h.store,fakePeer(root),{...h.envelope,claim:{...h.envelope.claim,agent:{...h.envelope.claim.agent,model:"another-model"}}})).rejects.toThrow("run-owner-conflict");
+   await expect(readFile(join(root,"launches"))).rejects.toThrow();
+   expect(h.store.db.prepare("SELECT id FROM outbox WHERE kind='start'").get()).toBeUndefined();
+  }finally{await h.dispose();}
+ });
+
 });
````

`tests/control/startEnvelope.test.ts`：

````diff
diff --git a/tests/control/startEnvelope.test.ts b/tests/control/startEnvelope.test.ts
index 7785eb7..d2135a4 100644
--- a/tests/control/startEnvelope.test.ts
+++ b/tests/control/startEnvelope.test.ts
@@ -36,6 +36,7 @@ function ledgerEnvelope(over: Partial<DispatchEnvelopeV1> = {}): DispatchEnvelop
 const runRow = (over: Record<string, unknown> = {}) => ({
   groupId: "g1", workItemId: "w1", taskId: "t1", runId: "run-1", generation: 2,
   graphVersion: 4, targetVersion: 7, commandId: "start-g1-w1", configHash: hx("c"),
+  agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 },
   grant: { work: amount(5), handoff: amount(3) }, ownerToken: "owner-token-1",
   state: "running", recoverable: false, highWater: 0,
   ...over,
@@ -45,12 +46,15 @@ const work = { sourceDir: "/tmp/src", targetRepo: "/tmp/repo", base: "v1" };
 const contract = { objective: "ship" };
 
 describe("translating a frozen dispatch envelope into a start envelope", () => {
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): StartEnvelopeV2 -- protocol 2,
+  // and the run's frozen selection travels in the claim (spec §4.6).
   it("copies the claim from the run row and the contract hash from the ledger, field by field", () => {
     const built = toStartEnvelope(ledgerEnvelope(), runRow(), work, contract);
-    expect(built.protocol).toBe(1);
+    expect(built.protocol).toBe(2);
     expect(built.claim).toEqual({
       groupId: "g1", workItemId: "w1", taskId: "t1", runId: "run-1", generation: 2,
       graphVersion: 4, targetVersion: 7, commandId: "start-g1-w1", configHash: hx("c"),
+      agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 },
       grant: { work: amount(5), handoff: amount(3) }, ownerToken: "owner-token-1",
     });
     // Named separately from the deep-equal above: this is the one field that comes from the ledger
@@ -60,10 +64,11 @@ describe("translating a frozen dispatch envelope into a start envelope", () => {
     expect(built.work).toEqual({ contract, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" });
   });
 
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): `agent` is a claim field now.
   it("drops the run row's own extra columns instead of smuggling them onto the wire", () => {
     const built = toStartEnvelope(ledgerEnvelope(), runRow(), work, contract);
     expect(Object.keys(built.claim).sort()).toEqual(
-      ["commandId", "configHash", "generation", "grant", "graphVersion", "groupId", "ownerToken", "runId", "targetVersion", "taskId", "workItemId"],
+      ["agent", "commandId", "configHash", "generation", "grant", "graphVersion", "groupId", "ownerToken", "runId", "targetVersion", "taskId", "workItemId"],
     );
   });
 
@@ -98,6 +103,14 @@ describe("the translation refuses before anything is dispatched", () => {
     expect(codeOf(() => toStartEnvelope(ledgerEnvelope(), without, work, contract))).toBe("start-envelope-conflict|run:ownerToken");
   });
 
+  it("refuses a run row with no frozen selection, naming the field, rather than dispatching a claim without one", () => {
+    const { agent, ...without } = runRow();
+    expect(agent).toEqual({ agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 });
+    expect(codeOf(() => toStartEnvelope(ledgerEnvelope(), without, work, contract))).toBe("start-envelope-conflict|run:agent");
+    // A partial selection is not a frozen one: ccloop would fill the rest, and the claim would no longer say what ran.
+    expect(codeOf(() => toStartEnvelope(ledgerEnvelope(), runRow({ agent: { agent: "claude" } }), work, contract))).toMatch(/^start-envelope-conflict\|run:agent/);
+  });
+
   it("refuses when the envelope and the run name different runs", () => {
     expect(codeOf(() => toStartEnvelope(ledgerEnvelope(), runRow({ runId: "run-2" }), work, contract)))
       .toBe("start-envelope-conflict|identity:run-1");
````

`tests/control/profiles.test.ts`：

````diff
diff --git a/tests/control/profiles.test.ts b/tests/control/profiles.test.ts
index 16864f7..d1bc93d 100644
--- a/tests/control/profiles.test.ts
+++ b/tests/control/profiles.test.ts
@@ -1,12 +1,13 @@
 import { describe, expect, it } from "vitest";
-import type { ExecutionPort, ProfileCapabilityProbe } from "../../src/control/executionPort.js";
+import type { ExecutionPort } from "../../src/control/executionPort.js";
+import type { PartialSelection } from "../../src/control/agentSelection.js";
 import {
   createExecutionProfileRouter,
   intersectCapabilities,
   resolveProfile,
   unavailableCapabilities,
 } from "../../src/control/profiles.js";
-import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
+import type { CapabilityViewV1, ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
 
 const hash = (value: string) => value.repeat(64);
 
@@ -55,24 +56,17 @@ function snapshot(
   };
 }
 
-function port(probe: ProfileCapabilityProbe | (() => Promise<ProfileCapabilityProbe>)): ExecutionPort {
+// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the probe is a
+// resolution of the selection asked about (capabilities protocol 3); `asked` records every selection it was given.
+const asked: PartialSelection[] = [];
+function port(probe: CapabilityViewV1 | (() => Promise<CapabilityViewV1>)): ExecutionPort {
   const result = typeof probe === "function" ? probe : async () => probe;
   return {
-    probeProfileCapabilities: result,
-    // Human authorization 2026-09-24, G1 seam A Task 6 (capability vocabulary sync): `durableAccept`/
-    // `ownershipIsolation`/`evidenceRetention`/`requestBoundEvidence` are retired v1 fields; this
-    // mock's `capabilities()` is unused by this suite's assertions (only `probeProfileCapabilities`
-    // is exercised), so it is rewritten as a plain valid v2 answer, whole swap not a weakening.
-    capabilities: async () => ({
-      protocol: 2,
-      usageObservation: "realtime",
-      budgetEnforcement: "bounded",
-      contextObservation: "unavailable",
-      handoffControl: "durable",
-      handoffExecution: "mechanical-in-run-v1",
-      contextWindowTokens: null,
-      requestBoundProof: null,
-    }),
+    resolveAgent: async (partial) => {
+      asked.push(partial);
+      return { selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default", ...partial }, configHash: hash("c"), timeoutMs: 1, killGraceMs: 0, capabilities: await result() };
+    },
+    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
     readEvidence: async () => Buffer.alloc(0),
     accept: async () => ({ kind: "unknown" }),
     inspect: async () => ({ kind: "unknown" }),
@@ -114,7 +108,7 @@ describe("trusted execution profiles", () => {
     const frozen = resolveProfile(snapshot(), mutablePort);
     const router = createExecutionProfileRouter([frozen]);
     const owned = router.resolve("task", "worker", frozen.profileHash);
-    mutablePort.probeProfileCapabilities = async () => ({ ...unavailableCapabilities, usageObservation: "realtime" });
+    mutablePort.resolveAgent = async () => { throw new Error("the replaced method was called"); };
     mutablePort.accept = async () => ({ kind: "accepted", executionId: "mutated", configHash: hash("0") });
 
     await router.probe(owned);
@@ -126,10 +120,10 @@ describe("trusted execution profiles", () => {
   it("preserves the original receiver for captured port methods", async () => {
     class ReceiverPort implements ExecutionPort {
       #accepts = 0;
-      probeProfileCapabilities = async () => snapshot().profile.capabilities;
-      // Human authorization 2026-09-24, G1 seam A Task 6 (capability vocabulary sync): rewritten to
-      // the v2 vocabulary; unused by this suite's assertions, same treatment as `port()` above.
-      capabilities = async () => ({ protocol: 2 as const, ...snapshot().profile.capabilities });
+      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the two capability
+      // methods are the resolution and the table view now; unused by this criterion's assertions.
+      resolveAgent = async () => ({ selection: { agent: "codex", model: "m", contextWindow: "agent-default" as const }, configHash: hash("c"), timeoutMs: 1, killGraceMs: 0, capabilities: snapshot().profile.capabilities });
+      listAgents = async () => ({ installations: [] });
       readEvidence = async () => Buffer.alloc(0);
       async accept() { this.#accepts += 1; return { kind: "accepted" as const, executionId: `receiver-${this.#accepts}`, configHash: hash("a") }; }
       inspect = async () => ({ kind: "unknown" as const });
@@ -148,7 +142,7 @@ describe("trusted execution profiles", () => {
 
   it("intersects every ordered capability and keeps proof only on exact descriptor equality", () => {
     const declared = snapshot().profile.capabilities;
-    const observed: ProfileCapabilityProbe = {
+    const observed: CapabilityViewV1 = {
       usageObservation: "phase-end",
       budgetEnforcement: "soft",
       contextObservation: "phase-end",
@@ -187,6 +181,15 @@ describe("trusted execution profiles", () => {
     });
   });
 
+  it("probes exactly the selection it is asked about (agent selection spec §6.4)", async () => {
+    const frozen = resolveProfile(snapshot(), port(snapshot().profile.capabilities));
+    const router = createExecutionProfileRouter([frozen]);
+    asked.length = 0;
+    const observed = await router.probe(router.resolve("task", "worker", frozen.profileHash), { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 });
+    expect(asked).toEqual([{ agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }]);
+    expect(observed.probeFailureCode).toBeNull();
+  });
+
   it("rejects profiles whose context tokenizer or task output limit does not match the declaration", () => {
     expect(() => resolveProfile(snapshot({}, { contextTokenizer: null }), port(unavailableCapabilities))).toThrow("control-profile-invalid");
     expect(() => resolveProfile(snapshot({}, { workMaxOutputTokens: null }), port(unavailableCapabilities))).toThrow("control-profile-invalid");
````

`tests/control/unconfiguredPort.test.ts`：

````diff
diff --git a/tests/control/unconfiguredPort.test.ts b/tests/control/unconfiguredPort.test.ts
index 78bc223..ea84ff9 100644
--- a/tests/control/unconfiguredPort.test.ts
+++ b/tests/control/unconfiguredPort.test.ts
@@ -39,12 +39,14 @@ function controlProfileSnapshot(profileId: string, workKinds: ExecutionProfileSn
 
 describe("the unconfigured execution port", () => {
   const port = createUnconfiguredControlPort();
-  const envelope = { protocol: 1, claim: {}, contractHash: "x", inputCheckpoint: null, work: {} } as never;
+  const envelope = { protocol: 2, claim: {}, contractHash: "x", inputCheckpoint: null, work: {} } as never;
 
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the port's two capability
+  // methods are resolveAgent and listAgents now (spec §4.6); every method is still named and still refuses.
   it("refuses every method it has, not merely the obvious ones", async () => {
     const calls: Array<[string, Promise<unknown>]> = [
-      ["probeProfileCapabilities", port.probeProfileCapabilities!()],
-      ["capabilities", port.capabilities()],
+      ["resolveAgent", port.resolveAgent({ agent: "codex" })],
+      ["listAgents", port.listAgents()],
       ["readEvidence", port.readEvidence({ artifactId: "a", hash: "h" } as never)],
       ["accept", port.accept(envelope)],
       ["inspect", port.inspect(envelope)],
@@ -54,7 +56,7 @@ describe("the unconfigured execution port", () => {
     // Every method of ExecutionPort is named here on purpose: a port that refuses six of seven is
     // a port with one silent hole, and the hole is the method nobody thought to list.
     expect(calls.map(([name]) => name).sort()).toEqual(
-      ["accept", "capabilities", "collect", "inspect", "probeProfileCapabilities", "readEvidence", "requestHandoff"],
+      ["accept", "collect", "inspect", "listAgents", "readEvidence", "requestHandoff", "resolveAgent"],
     );
     for (const [name, call] of calls) {
       await call.then(
@@ -67,10 +69,12 @@ describe("the unconfigured execution port", () => {
     }
   });
 
-  it("exposes the optional probe, so a missing port is never reported as a missing capability", async () => {
-    // Without this method the router answers control-capability-probe-failed (profiles.ts:150) and
-    // an operator who forgot an environment variable is told their adapter is inadequate.
-    expect(typeof port.probeProfileCapabilities).toBe("function");
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the probe is resolveAgent,
+  // which every port must have; what this pins is unchanged -- the router reports the port's own name.
+  it("exposes the probe, so a missing port is never reported as a missing capability", async () => {
+    // Without the port's own refusal the router answers control-capability-probe-failed and an
+    // operator who forgot an environment variable is told their adapter is inadequate.
+    expect(typeof port.resolveAgent).toBe("function");
     const router = createExecutionProfileRouter([resolveProfile(controlProfileSnapshot("worker", ["task"]), port)]);
     const observed = await router.probe(router.list()[0]!);
     expect(observed.probeFailureCode).toBe("control-port-unconfigured");
@@ -84,8 +88,9 @@ describe("the unconfigured execution port", () => {
   });
 
   it("refuses a second time exactly as it refused the first, holding no state", async () => {
-    const first = await port.capabilities().catch((error: ControlError) => error.code);
-    const second = await port.capabilities().catch((error: ControlError) => error.code);
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): asked through resolveAgent.
+    const first = await port.resolveAgent({ agent: "codex" }).catch((error: ControlError) => error.code);
+    const second = await port.resolveAgent({ agent: "codex" }).catch((error: ControlError) => error.code);
     expect([first, second]).toEqual(["control-port-unconfigured", "control-port-unconfigured"]);
   });
 });
````

`tests/control/capabilitySchema.test.ts`：

````diff
diff --git a/tests/control/capabilitySchema.test.ts b/tests/control/capabilitySchema.test.ts
index 70eb59e..3746800 100644
--- a/tests/control/capabilitySchema.test.ts
+++ b/tests/control/capabilitySchema.test.ts
@@ -1,8 +1,12 @@
 import { describe, expect, it } from "vitest";
-import { capabilitiesSchema, capabilityViewSchema } from "../../src/control/webProtocol.js";
+import { capabilityViewSchema } from "../../src/control/webProtocol.js";
 
-describe("capabilitiesSchema", () => {
-  it("is the view schema plus protocol, with no independent field list", () => {
+// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the protocol-2 payload
+// (`capabilitiesSchema`, the view plus a protocol tag) is gone. Capabilities protocol 3 carries the eight-field view
+// untagged inside one selection's resolution (spec §4.6), so this now pins that the view stays closed: no tag of any
+// protocol, no retired v1 field, no value outside the vocabulary.
+describe("capabilityViewSchema", () => {
+  it("is the closed eight-field view that capabilities protocol 3 carries untagged", () => {
     const view = {
       usageObservation: "phase-end",
       budgetEnforcement: "soft",
@@ -13,10 +17,10 @@ describe("capabilitiesSchema", () => {
       requestBoundProof: null,
     };
     expect(capabilityViewSchema.safeParse(view).success).toBe(true);
-    expect(capabilitiesSchema.safeParse({ protocol: 2, ...view }).success).toBe(true);
     // Old vocabulary must be rejected, named individually.
-    expect(capabilitiesSchema.safeParse({ protocol: 2, ...view, durableAccept: true }).success).toBe(false);
-    expect(capabilitiesSchema.safeParse({ protocol: 1, ...view }).success).toBe(false);
-    expect(capabilitiesSchema.safeParse({ protocol: 2, ...view, budgetEnforcement: "unsupported" }).success).toBe(false);
+    expect(capabilityViewSchema.safeParse({ protocol: 2, ...view }).success).toBe(false);
+    expect(capabilityViewSchema.safeParse({ protocol: 3, ...view }).success).toBe(false);
+    expect(capabilityViewSchema.safeParse({ ...view, durableAccept: true }).success).toBe(false);
+    expect(capabilityViewSchema.safeParse({ ...view, budgetEnforcement: "unsupported" }).success).toBe(false);
   });
 });
````

`tests/control/profiledService.test.ts`：

````diff
diff --git a/tests/control/profiledService.test.ts b/tests/control/profiledService.test.ts
index 9bd6bc6..3af8db2 100644
--- a/tests/control/profiledService.test.ts
+++ b/tests/control/profiledService.test.ts
@@ -8,7 +8,7 @@ import { ControlService, type ExecutionProfileSelection } from "../../src/contro
 import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
 import { collectControlled } from "../../src/control/schedulerBridge.js";
 import { getGroup } from "../../src/control/queries.js";
-import { caps, amount, openTestStore, seedBudgetCase } from "./fixtures/store.js";
+import { amount, openTestStore, resolvedAs, seedBudgetCase } from "./fixtures/store.js";
 
 const digest = (byte: string) => byte.repeat(64);
 const latch = () => { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; };
@@ -50,10 +50,17 @@ function capableProbe() {
   return structuredClone(profileSnapshot().profile.capabilities);
 }
 
+// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the port's one capability
+// question is resolveAgent (capabilities protocol 3, spec §4.6), which both the router's probe and the service's own
+// check ask; `probing(view)` answers it with `view` for whatever selection is asked.
+const probing = (view: () => ReturnType<typeof capableProbe> | Promise<ReturnType<typeof capableProbe>>): Pick<ExecutionPort, "resolveAgent"> => ({
+  resolveAgent: async (partial) => resolvedAs(await view(), partial),
+});
+
 function port(overrides: Partial<ExecutionPort> = {}): ExecutionPort {
   return {
-    probeProfileCapabilities: async () => capableProbe(),
-    capabilities: async () => caps,
+    ...probing(() => capableProbe()),
+    listAgents: async () => ({ installations: [] }),
     readEvidence: async () => Buffer.alloc(0),
     accept: async (input) => ({ kind: "accepted", executionId: `execution-${input.claim.runId}`, configHash: input.claim.configHash }),
     inspect: async () => ({ kind: "unknown" }),
@@ -73,7 +80,7 @@ function serviceWith(store: Awaited<ReturnType<typeof openTestStore>>["store"],
 }
 
 function envelope(claim: Awaited<ReturnType<ControlService["claimProfiled"]>>, contract: unknown, root: string): StartEnvelope {
-  return { protocol: 1, claim, contractHash: hashPayload(contract), inputCheckpoint: null, work: { contract, targetRepo: root, base: "HEAD", sourceDir: `${root}/${claim.runId}` } };
+  return { protocol: 2, claim, contractHash: hashPayload(contract), inputCheckpoint: null, work: { contract, targetRepo: root, base: "HEAD", sourceDir: `${root}/${claim.runId}` } };
 }
 
 describe("profiled service execution", () => {
@@ -84,7 +91,7 @@ describe("profiled service execution", () => {
         seedBudgetCase(h.store);
         let accepts = 0;
         const selected = port({
-          probeProfileCapabilities: async () => mode === "unavailable" ? { ...capableProbe(), handoffControl: "unavailable" } : capableProbe(),
+          ...probing(() => mode === "unavailable" ? { ...capableProbe(), handoffControl: "unavailable" } : capableProbe()),
           accept: async () => { accepts += 1; return { kind: "unknown" }; },
         });
         const { service, selection, handoffSelection } = serviceWith(h.store, selected);
@@ -121,7 +128,7 @@ describe("profiled service execution", () => {
         const seeded = seedBudgetCase(h.store);
         let available = true, accepts = 0;
         const selected = port({
-          probeProfileCapabilities: async () => available ? capableProbe() : { ...capableProbe(), handoffControl: "unavailable" },
+          ...probing(() => available ? capableProbe() : { ...capableProbe(), handoffControl: "unavailable" }),
           accept: async () => { accepts += 1; return { kind: "unknown" }; },
         });
         const { service, selection, handoffSelection } = serviceWith(h.store, selected);
@@ -146,7 +153,7 @@ describe("profiled service execution", () => {
         const seeded = seedBudgetCase(h.store);
         let available = true, accepts = 0;
         const selected = port({
-          probeProfileCapabilities: async () => available ? capableProbe() : { ...capableProbe(), handoffControl: "unavailable" },
+          ...probing(() => available ? capableProbe() : { ...capableProbe(), handoffControl: "unavailable" }),
           accept: async () => { accepts += 1; throw new Error("lost-start-response"); },
           inspect: async () => ({ kind: "absent" }),
         });
@@ -174,7 +181,7 @@ describe("profiled service execution", () => {
         seedBudgetCase(h.store);
         const workerSnapshot = profileSnapshot();
         workerSnapshot.profile.capabilities.requestBoundProof!.workDimensions = workDimensions;
-        const selected = port({ probeProfileCapabilities: async () => structuredClone(workerSnapshot.profile.capabilities) });
+        const selected = port({ ...probing(() => structuredClone(workerSnapshot.profile.capabilities)) });
         const worker = resolveProfile(workerSnapshot, selected), handoff = resolveProfile(handoffSnapshot(), port());
         const router = createExecutionProfileRouter([worker, handoff]);
         const service = new ControlService(h.store, port(), { profileRouter: router });
@@ -203,7 +210,7 @@ describe("profiled service execution", () => {
     const entered = latch(), resume = latch();
     try {
       seedBudgetCase(h.store);
-      const { service, selection, handoffSelection } = serviceWith(h.store, port({ probeProfileCapabilities: async () => { entered.release(); await resume.promise; return capableProbe(); } }));
+      const { service, selection, handoffSelection } = serviceWith(h.store, port({ ...probing(async () => { entered.release(); await resume.promise; return capableProbe(); }) }));
       const claim = service.claimProfiled("g1", "T1", selection, handoffSelection);
       await entered.promise;
       await service.admissionGate.beginDrain().beforeWriterTransaction;
@@ -218,7 +225,7 @@ describe("profiled service execution", () => {
     const entered = latch(), resume = latch();
     try {
       seedBudgetCase(h.store);
-      const { service, selection, handoffSelection } = serviceWith(h.store, port({ probeProfileCapabilities: async () => { entered.release(); await resume.promise; return capableProbe(); } }));
+      const { service, selection, handoffSelection } = serviceWith(h.store, port({ ...probing(async () => { entered.release(); await resume.promise; return capableProbe(); }) }));
       const reconcile = service.reconcileBudgetProfiled("g1", "T1", selection, handoffSelection);
       await entered.promise;
       await service.admissionGate.beginDrain().beforeWriterTransaction;
````

`tests/control/fixtures/store.ts`：

````diff
diff --git a/tests/control/fixtures/store.ts b/tests/control/fixtures/store.ts
index 215c62c..b64d3ef 100644
--- a/tests/control/fixtures/store.ts
+++ b/tests/control/fixtures/store.ts
@@ -12,15 +12,24 @@ import { createHash } from "node:crypto";
 import { writeFileSync } from "node:fs";
 import { createGroup, putWork } from "../../../src/control/commands.js";
 import type { ControlStore } from "../../../src/control/store.js";
-import type { Capabilities, ClaimInput, WorkInput } from "../../../src/control/types.js";
+import type { ClaimInput, WorkInput } from "../../../src/control/types.js";
+import type { AgentResolution, AgentSelection, PartialSelection } from "../../../src/control/agentSelection.js";
+import type { AgentsView } from "../../../src/control/executionPort.js";
+import type { CapabilityViewV1 } from "../../../src/control/webProtocol.js";
 // Human authorization (2026-09-24, ruling-88): upgraded to the v2 wire vocabulary (G1 seam A
-// Task 3) so callers exercise a strict-capable answer under `capabilitiesSchema` rather than the
-// retired v1 shape.
-export const caps:Capabilities={protocol:2,usageObservation:"realtime",budgetEnforcement:"bounded",contextObservation:"realtime",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:200000,requestBoundProof:{scheme:"adapter-request-bound-v1",version:"1",workDimensions:["activeMs","tokens"],handoffDimensions:["activeMs","tokens"],evidenceKind:"offline-peer-v1"}};
+// Task 3) so callers exercise a strict-capable answer rather than the retired v1 shape.
+// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the view carries no protocol
+// tag any more -- capabilities protocol 3 answers it inside one selection's resolution (spec §4.6).
+export const caps:CapabilityViewV1={usageObservation:"realtime",budgetEnforcement:"bounded",contextObservation:"realtime",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:200000,requestBoundProof:{scheme:"adapter-request-bound-v1",version:"1",workDimensions:["activeMs","tokens"],handoffDimensions:["activeMs","tokens"],evidenceKind:"offline-peer-v1"}};
+/** Agent selection spec §3: the complete selection every legacy fixture work item is frozen with. */
+export const fixtureAgent:AgentSelection={agent:"codex",model:"fixture-model",contextWindow:"agent-default"};
+/** A capabilities-v3 answer for `partial`: the given fields echoed (spec M5), the fixture's defaults for the rest. */
+export const resolvedAs=(capabilities:CapabilityViewV1,partial:PartialSelection={}):AgentResolution=>({selection:{...fixtureAgent,...partial},configHash:"config1",timeoutMs:120_000,killGraceMs:5_000,capabilities});
+export const agentsView:AgentsView={installations:[{id:"codex",kind:"codex",defaults:{model:"fixture-model",contextWindow:"agent-default"},contextOptions:["agent-default"],version:"0.0.0-fixture"}]};
 export const amount=(tokens:number,activeMs=10000,attempts=10,sessions=10)=>({tokens,activeMs,attempts,sessions});
 export function seedBudgetCase(store:ControlStore,mode:"strict"|"soft"="strict") {
   createGroup(store,{groupId:"g1",projectKey:"example/repo",goal:"Ship",successConditions:["checks pass"],budgetMode:mode,limit:amount(100,1000000,100,100),reviewReserve:amount(10,100,1,1),deadlineAt:null},{commandId:"create",expectedRevision:0,by:"human"});
-  const w1:WorkInput={workItemId:"T1",taskId:"T1",kind:"task",dependsOn:[],contract:{scope:{allowedPaths:["one"]}},configHash:"config1",grant:{work:amount(60,100000,2,2),handoff:amount(10,1000,0,0)}};
+  const w1:WorkInput={workItemId:"T1",taskId:"T1",kind:"task",dependsOn:[],contract:{scope:{allowedPaths:["one"]}},configHash:"config1",agent:fixtureAgent,grant:{work:amount(60,100000,2,2),handoff:amount(10,1000,0,0)}};
   const w2:WorkInput={...w1,workItemId:"T2",taskId:"T2",contract:{scope:{allowedPaths:["two"]}},grant:{work:amount(25,100000,2,2),handoff:amount(5,1000,0,0)}};
   putWork(store,"g1",w1,{commandId:"w1",expectedRevision:1,by:"human"});
   putWork(store,"g1",w2,{commandId:"w2",expectedRevision:2,by:"human"});
````

`tests/control/fixtures/peer.ts`：

````diff
diff --git a/tests/control/fixtures/peer.ts b/tests/control/fixtures/peer.ts
index e2da401..17c28ec 100644
--- a/tests/control/fixtures/peer.ts
+++ b/tests/control/fixtures/peer.ts
@@ -4,5 +4,5 @@ import { resolve } from "node:path";
 import type { ExecutionPort } from "../../../src/control/executionPort.js";
 export function fakePeer(root:string,mode=""):ExecutionPort {
  const request=async(method:string,payload:unknown)=>JSON.parse((await promisify(execFile)(process.execPath,[resolve("tests/control/fixtures/fake-control-peer.mjs"),root,method,JSON.stringify(payload),mode])).stdout);
- return {capabilities:()=>request("capabilities",{}),accept:input=>request("accept",input),inspect:input=>request("inspect",input),requestHandoff:(input,handoff)=>request("handoff",{input,request:handoff}),collect:(input,afterSeq)=>request("collect",{input,afterSeq}),readEvidence:async()=>Buffer.alloc(0)};
+ return {resolveAgent:partial=>request("capabilities",{agent:partial}),listAgents:()=>request("capabilities",{agent:null}),accept:input=>request("accept",input),inspect:input=>request("inspect",input),requestHandoff:(input,handoff)=>request("handoff",{input,request:handoff}),collect:(input,afterSeq)=>request("collect",{input,afterSeq}),readEvidence:async()=>Buffer.alloc(0)};
 }
````

`tests/control/fixtures/roundPeer.ts`：

````diff
diff --git a/tests/control/fixtures/roundPeer.ts b/tests/control/fixtures/roundPeer.ts
index e6c7247..4b4f9d1 100644
--- a/tests/control/fixtures/roundPeer.ts
+++ b/tests/control/fixtures/roundPeer.ts
@@ -3,12 +3,12 @@ import { join } from "node:path";
 import { createHash } from "node:crypto";
 import { fakePeer } from "./peer.js";
 import { git } from "./archive.js";
-import { caps } from "./store.js";
+import { agentsView, caps, resolvedAs } from "./store.js";
 import type { ExecutionPort,StartEnvelope,ExecutionReport } from "../../../src/control/executionPort.js";
 export function roundPeer(root:string):ExecutionPort {
  const peer=(input:StartEnvelope)=>fakePeer(join(root,input.claim.runId));
  return {
-  capabilities:async()=>caps,
+  resolveAgent:async partial=>resolvedAs(caps,partial),listAgents:async()=>agentsView,
   accept:input=>peer(input).accept(input),inspect:input=>peer(input).inspect(input),
   requestHandoff:(input,request)=>peer(input).requestHandoff(input,request),
   readEvidence:async ref=>readFile(join(root,ref.artifactId)),
````

`tests/control/fixtures/archive.ts`：

````diff
diff --git a/tests/control/fixtures/archive.ts b/tests/control/fixtures/archive.ts
index 3bfb69e..5d72bb5 100644
--- a/tests/control/fixtures/archive.ts
+++ b/tests/control/fixtures/archive.ts
@@ -10,7 +10,7 @@ export function git(repo:string,...args:string[]):Buffer {return execFileSync("g
 export async function archiveCase() {
  const h=await openTestStore();const seed=seedBudgetCase(h.store);const claim=claimWork(h.store,seed.t1Claim);
  const sourceDir=join(h.root,"runs",claim.runId),repoDir=join(sourceDir,"repo");await mkdir(repoDir,{recursive:true});
- await startClaim(h.store,fakePeer(join(h.root,"peer")),{protocol:1,claim,contractHash:hashPayload(seed.w1.contract),inputCheckpoint:null,work:{contract:seed.w1.contract,targetRepo:h.root,base:"HEAD",sourceDir}});
+ await startClaim(h.store,fakePeer(join(h.root,"peer")),{protocol:2,claim,contractHash:hashPayload(seed.w1.contract),inputCheckpoint:null,work:{contract:seed.w1.contract,targetRepo:h.root,base:"HEAD",sourceDir}});
  git(repoDir,"init","-q");
  await writeFile(join(repoDir,"tracked"),"HEAD\n");await writeFile(join(repoDir,"deleted"),"delete me\n");
  git(repoDir,"add",".");git(repoDir,"commit","-qm","base");git(repoDir,"checkout","--detach","-q");
````

`tests/control/fixtures/candidate.ts`：

````diff
diff --git a/tests/control/fixtures/candidate.ts b/tests/control/fixtures/candidate.ts
index e650a78..be97898 100644
--- a/tests/control/fixtures/candidate.ts
+++ b/tests/control/fixtures/candidate.ts
@@ -12,7 +12,8 @@ export async function candidateCase() {
  recordUsage(h.store,{runId:h.claim.runId,generation:1,eventSeq:1,bucket:"work",cumulative:{tokens:40,activeMs:20,attempts:1,sessions:1},source});
  recordUsage(h.store,{runId:h.claim.runId,generation:1,eventSeq:2,bucket:"handoff",cumulative:{tokens:0,activeMs:0,attempts:0,sessions:0},source});
  const archive=await archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof:proof});
- const {commandId:_commandId,configHash:_configHash,grant:_grant,ownerToken:_ownerToken,...candidateIdentity}=h.claim;
+ // Agent selection: the claim carries `agent` too; a candidate names the run, not its selection.
+ const {commandId:_commandId,configHash:_configHash,agent:_agent,grant:_grant,ownerToken:_ownerToken,...candidateIdentity}=h.claim;
  const candidate:Candidate={...candidateIdentity,checkpointId:"cp1",usageHighWater:2,result:"complete",artifacts:[...archive.artifacts,source,stopSource,handoff],snapshot:archive.snapshot,missing:[],unresolvedRequestIds:[],stopProof:proof,terminalOutcome:"succeeded",handoff};
  return {...h,candidate};
 }
````

`tests/control/fixtures/crash-worker.mjs`：

````diff
diff --git a/tests/control/fixtures/crash-worker.mjs b/tests/control/fixtures/crash-worker.mjs
index 2e9f322..9dbaec3 100644
--- a/tests/control/fixtures/crash-worker.mjs
+++ b/tests/control/fixtures/crash-worker.mjs
@@ -22,7 +22,7 @@ writeFileSync(join(root,"run.json"),JSON.stringify({runId:claim.runId,target,bas
 await mark("after-claim");
 const peer=roundPeer(join(root,"peer")),service=new ControlService(store,peer);
 const sourceDir=join(root,"runs",claim.runId);mkdirSync(join(root,"runs"),{recursive:true});
-await startClaim(store,peer,{protocol:1,claim,contractHash:hashPayload(seed.w1.contract),inputCheckpoint:null,work:{contract:seed.w1.contract,targetRepo:target,base,sourceDir}});
+await startClaim(store,peer,{protocol:2,claim,contractHash:hashPayload(seed.w1.contract),inputCheckpoint:null,work:{contract:seed.w1.contract,targetRepo:target,base,sourceDir}});
 await mark("after-accept");
 const report=await collectControlled(service,claim.runId),terminal=report.terminal;
 const run={runId:claim.runId,workdir:sourceDir,outcome:terminal.outcome,attemptSha:terminal.attemptSha};
````

`tests/control/fixtures/fake-control-peer.mjs`：

````diff
diff --git a/tests/control/fixtures/fake-control-peer.mjs b/tests/control/fixtures/fake-control-peer.mjs
index 8ba1c45..54e0226 100644
--- a/tests/control/fixtures/fake-control-peer.mjs
+++ b/tests/control/fixtures/fake-control-peer.mjs
@@ -14,7 +14,11 @@ let accepted=existsSync(file)?JSON.parse(readFileSync(file,"utf8")):null;
 // they never gated anything. Nothing in v2 replaces them; `handoffControl` and `requestBoundProof`
 // are separate guarantees (handoff latching and per-request bound evidence, respectively) that
 // are also gated on (handoffControl in every budget mode, requestBoundProof in strict mode), not successors to the deleted booleans.
-if(method==="capabilities") console.log(JSON.stringify({protocol:2,usageObservation:"realtime",budgetEnforcement:"bounded",contextObservation:"unavailable",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:{scheme:"adapter-request-bound-v1",version:"1",workDimensions:["activeMs","tokens"],handoffDimensions:["activeMs","tokens"],evidenceKind:"offline-peer-v1"}}));
+// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): `capabilities` is asked
+// about one selection (`{agent: partial}`) and answers its resolution -- the given fields echoed, fixture defaults
+// for the rest -- carrying the same strict-capable view as before; `{agent: null}` answers an empty table view.
+const view={usageObservation:"realtime",budgetEnforcement:"bounded",contextObservation:"unavailable",handoffControl:"durable",handoffExecution:"mechanical-in-run-v1",contextWindowTokens:null,requestBoundProof:{scheme:"adapter-request-bound-v1",version:"1",workDimensions:["activeMs","tokens"],handoffDimensions:["activeMs","tokens"],evidenceKind:"offline-peer-v1"}};
+if(method==="capabilities") console.log(JSON.stringify(input.agent===null?{installations:[]}:{selection:{agent:"codex",model:"fixture-model",contextWindow:"agent-default",...input.agent},configHash:"c".repeat(64),timeoutMs:120000,killGraceMs:5000,capabilities:view}));
 else if(method==="collect") console.log(existsSync(join(root,"report.json"))?readFileSync(join(root,"report.json"),"utf8"):JSON.stringify({events:[],candidate:null,terminal:null}));
 else if(method==="handoff") console.log(JSON.stringify({kind:"latched",requestId:input.request.requestId}));
 else if(method==="inspect") console.log(JSON.stringify(mode==="unknown"?{kind:"unknown"}:accepted?accepted.status:{kind:"absent"}));
````

`tests/control/fixtures/driverPort.ts`：

````diff
diff --git a/tests/control/fixtures/driverPort.ts b/tests/control/fixtures/driverPort.ts
index b870feb..6a5970d 100644
--- a/tests/control/fixtures/driverPort.ts
+++ b/tests/control/fixtures/driverPort.ts
@@ -44,6 +44,8 @@ export function fakeCcloopPort(input: {
   workTokens?: (workItemId: string) => number;
   /** Handoff delivery (Task 4): runs inside every `collect` that found an execution, before it answers. */
   duringCollect?: () => Promise<void>;
+  /** Agent selection: the killGraceMs every resolution answers (0 unless said otherwise). */
+  killGraceMs?: number;
 }): FakeCcloop {
   const calls = { accept: [] as StartEnvelope[], inspect: 0, collect: 0, handoff: [] as HandoffRequest[] };
   const handoffs = new Map<string, HandoffRequest>();
@@ -105,8 +107,9 @@ export function fakeCcloopPort(input: {
   };
 
   const port: ExecutionPort = {
-    probeProfileCapabilities: async () => input.capabilities,
-    capabilities: async () => ({ protocol: 2 as const, ...input.capabilities }),
+    // Agent selection spec §4.6: capabilities protocol 3 -- the selection asked about, echoed and filled.
+    resolveAgent: async (partial) => ({ selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default", ...partial }, configHash: "c".repeat(64), timeoutMs: 120_000, killGraceMs: input.killGraceMs ?? 0, capabilities: input.capabilities }),
+    listAgents: async () => ({ installations: [] }),
     async accept(envelope) {
       calls.accept.push(structuredClone(envelope));
       await input.delayAccept?.();
````

`tests/control/fixtures/web.ts`：

````diff
diff --git a/tests/control/fixtures/web.ts b/tests/control/fixtures/web.ts
index 344e910..d0f3991 100644
--- a/tests/control/fixtures/web.ts
+++ b/tests/control/fixtures/web.ts
@@ -8,6 +8,7 @@ import { importControlPlan } from "../../../src/control/planImport.js";
 import { canonicalBytes, sha256Canonical } from "../../../src/control/canonicalJson.js";
 import { readArchivedPlan, readBudgetProposal } from "../../../src/control/queries.js";
 import type { ExecutionPort } from "../../../src/control/executionPort.js";
+import type { AgentSelection, PartialSelection } from "../../../src/control/agentSelection.js";
 import type { CapabilityViewV1, ExecutionProfileSnapshotV1, RawAuthorityCommandV1, ConfirmPayload } from "../../../src/control/webProtocol.js";
 
 export const profileSnapshot = (): ExecutionProfileSnapshotV1 => ({
@@ -22,6 +23,9 @@ export const profileSnapshot = (): ExecutionProfileSnapshotV1 => ({
 // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
 export interface WebFixtureTask { taskId: string; dependsOn?: string[]; targetVersion?: number; configHash?: string; targetPaths?: string[] }
 
+/** Agent selection spec §3: the complete selection this fixture's task work items are frozen with. */
+export const FIXTURE_AGENT: AgentSelection = { agent: "codex", model: "fixture-model", contextWindow: "agent-default" };
+
 export async function webFixture(snapshot = profileSnapshot(), tasks: readonly WebFixtureTask[] = [{ taskId: "a" }]) {
   const h = await openTestStore();
   let observed: CapabilityViewV1 = structuredClone(snapshot.profile.capabilities);
@@ -29,8 +33,10 @@ export async function webFixture(snapshot = profileSnapshot(), tasks: readonly W
   // Human authorization 2026-09-24, G1 seam A Task 6 (capability vocabulary sync): the mock now
   // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
   // carries, so the peer's raw answer stays schema-valid and strict-mode-safe.
-  const port = { accept, probeProfileCapabilities: async () => observed,
-    capabilities: async () => ({ protocol: 2 as const, ...snapshot.profile.capabilities }),
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the probe is now a resolution of
+  // the selection being asked about (capabilities protocol 3); its capability view is still the mutable `observed`.
+  const port = { accept, resolveAgent: async (partial: PartialSelection) => ({ selection: { ...FIXTURE_AGENT, ...partial }, configHash: sha256Canonical({}), timeoutMs: 120_000, killGraceMs: 5_000, capabilities: observed }),
+    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
     readEvidence: async () => Buffer.alloc(0), inspect: async () => ({ kind: "unknown" }), requestHandoff: async () => ({ kind: "unknown" }), collect: async () => ({ events: [], candidate: null, terminal: null }) } as unknown as ExecutionPort;
   const supplied = resolveProfile(snapshot, port), router = createExecutionProfileRouter([supplied]);
   const frozen = router.resolve("budget-estimate", "all", supplied.profileHash);
@@ -55,6 +61,12 @@ export async function webFixture(snapshot = profileSnapshot(), tasks: readonly W
   const imported = importControlPlan({ ...deps, estimatorObservation: () => ({ profile: frozen, observed, probeFailureCode: null }) }, {
     schema: "orca-raw-command-v1", commandId: "import", expectedRevision: 0, actorId: "human", verb: "import-plan", target: { kind: "group", groupId: "g" }, payload: { groupId: "g", repoId: "repo", planId: "plan" } });
   if ("error" in imported || imported.result.kind !== "imported") throw new Error(JSON.stringify(imported));
+  // Agent selection plan T7 bridge -- plan T11 freezes a selection into every task work item at confirm and deletes
+  // this. Until then nothing in the product writes one, so the fixture does, or no claim could carry `claim.agent`.
+  for (const task of tasks) {
+    const row = h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(task.taskId)!;
+    h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), agent: FIXTURE_AGENT }), task.taskId);
+  }
   let sequence = 0;
   const raw = (commandId: string, expectedRevision: number, verb: RawAuthorityCommandV1["verb"], target: RawAuthorityCommandV1["target"], payload: unknown) => ({
     schema: "orca-raw-command-v1", commandId, actorId: "human", expectedRevision, verb, target, payload,
````

`tests/panel/fixtures/controlPanel.ts`：

````diff
diff --git a/tests/panel/fixtures/controlPanel.ts b/tests/panel/fixtures/controlPanel.ts
index 2d656a5..c923a37 100644
--- a/tests/panel/fixtures/controlPanel.ts
+++ b/tests/panel/fixtures/controlPanel.ts
@@ -27,7 +27,8 @@ import { buildApi } from "../../../src/panel/api.js";
 import { verifyControlJsonBody } from "../../../src/panel/controlApi.js";
 import { createTrustedControlConfig } from "../../../src/panel/controlConfig.js";
 import { ReviewsWriter } from "../../../src/panel/reviewsStore.js";
-import { profileSnapshot } from "../../control/fixtures/web.js";
+import { FIXTURE_AGENT, profileSnapshot } from "../../control/fixtures/web.js";
+import type { PartialSelection } from "../../../src/control/agentSelection.js";
 
 export const PANEL_TOKEN = "b".repeat(64);
 export const GROUP = "grp-1";
@@ -35,7 +36,7 @@ export const GROUP = "grp-1";
 export interface Paths {
   planPath: string;
   binary: string;
-  adapter: string;
+  agentsTable: string;
   repo: string;
 }
 
@@ -87,9 +88,9 @@ export function createHarness(): Harness {
     const contractPath = join(contracts, "a.json");
     await writeFile(contractPath, canonicalBytes(contract));
     const binary = join(root, "ccloop");
-    const adapter = join(root, "adapter.json");
+    const agentsTable = join(root, "agents.json");
     await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
-    await writeFile(adapter, "{}");
+    await writeFile(agentsTable, "{}");
     const planPath = join(repo, "plans", "plan.json");
     await writeFile(planPath, JSON.stringify({
       targetRepo: repo, ccloopBin: binary, runsDir: root, workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo",
@@ -97,7 +98,7 @@ export function createHarness(): Harness {
       // Seam B (human ruling 2026-09-24, named under ruling 88): targetVersion is one positive safe integer from plan to wire.
       tasks: [{ taskId: "a", contract: contractPath, dependsOn: [], targetVersion: 1, configHash: "c".repeat(64) }],
     }));
-    return { planPath, binary, adapter, repo };
+    return { planPath, binary, agentsTable, repo };
   }
 
   return {
@@ -114,8 +115,8 @@ export function createHarness(): Harness {
       // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
       // carries, so the peer's raw answer stays schema-valid and strict-mode-safe.
       const port = {
-        probeProfileCapabilities: async () => capabilities() as never,
-        capabilities: async () => ({ protocol: 2 as const, ...snapshot.profile.capabilities }),
+        resolveAgent: async (partial: PartialSelection) => ({ selection: { ...FIXTURE_AGENT, ...partial }, configHash: "c".repeat(64), timeoutMs: 120_000, killGraceMs: 5_000, capabilities: capabilities() }) as never,
+        listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
         readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
         requestHandoff: async (_input: unknown, request: { requestId: string }) => ({ kind: "unknown", requestId: request.requestId }),
         collect: async () => ({ events: [], candidate: null, terminal: null }),
@@ -123,8 +124,8 @@ export function createHarness(): Harness {
       const frozen = resolveProfile(snapshot, port);
       const router = createExecutionProfileRouter([frozen], { now: () => new Date("2030-01-01T00:00:00.000Z") });
       const trustedConfig = createTrustedControlConfig({
-        epoch, stateDir: store.stateDir, executablePath: paths.binary, adapterConfigPath: paths.adapter,
-      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
+        epoch, stateDir: store.stateDir, executablePath: paths.binary, agentsTablePath: paths.agentsTable,
+      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real agents table, so the pair says "configured".
         archiveRoot: root, exportRoot: root, evidenceRoot: root, shutdownGraceMs: 1_000,
         repositories: [{ repoId: "repo", displayName: "Repo", path: paths.repo }],
         plans: [{ planId: "plan", repoId: "repo", displayName: "Plan", path: paths.planPath }],
````


  跑 `for f in dispatch startEnvelope profiles unconfiguredPort capabilitySchema profiledService; do ./node_modules/.bin/vitest run tests/control/$f.test.ts > $S/t7-s4-$f.log 2>&1; echo $f rc=$?; done > $S/t7-s4.txt`
  Expected：`dispatch`、`startEnvelope` rc=1（新判据红：claim 没有 `agent`、`protocol` 仍是 1）；其余 rc 取决于 Step 3 已落的部分，读回 `$S/t7-s4.txt` 记下。

- [ ] **Step 5: claim／run／envelope 带选择（GREEN）**

`src/control/service.ts`：

````diff
diff --git a/src/control/service.ts b/src/control/service.ts
index 1fa1cd6..b743065 100644
--- a/src/control/service.ts
+++ b/src/control/service.ts
@@ -1,9 +1,11 @@
 import type { ControlStore } from "./store.js";
 import type { ExecutionPort } from "./executionPort.js";
 import { productionExecutionPort } from "./executionPort.js";
-import type { Capabilities, Claim, ExecutionProfileBinding, Grant, WorkInput, HandoffReason } from "./types.js";
+import type { Claim, ExecutionProfileBinding, Grant, WorkInput, HandoffReason } from "./types.js";
+import type { AgentSelection, PartialSelection } from "./agentSelection.js";
+import type { CapabilityViewV1 } from "./webProtocol.js";
 import { assertCapabilities, claimWork, readRun, componentMin, subtract, add } from "./budget.js";
-import { allWork, readGroup, readWork } from "./queries.js";
+import { allWork, readGroup, readWork, workAgents } from "./queries.js";
 import { ControlError } from "./errors.js";
 import type { ApprovedReconcileBudget } from "../scheduler/reconcile.js";
 import { grantSchema, handoffRequestSchema } from "./schema.js";
@@ -41,7 +43,7 @@ export class ControlService {
   async run(groupId:string, planPath:string, options: Omit<import("../scheduler/run.js").RunOptions,"adapter"|"adapterConfig"> = {}):Promise<number> {
     const release=this.store.beginOperation();
     try {
-    await this.legacyCapabilities(groupId);
+    for(const agent of workAgents(this.store,groupId))await this.legacyCapabilities(groupId,agent);
     const {loadRound,runPreparedRound}=await import("../scheduler/run.js");
     const {makeControlledExecution}=await import("./schedulerBridge.js");
     const loaded=await loadRound(planPath);
@@ -63,9 +65,9 @@ export class ControlService {
     if (!this.options.profileRouter) throw new ControlError("control-protocol-unavailable");
     return this.options.profileRouter.resolve(selection.workKind, selection.profileId, selection.profileHash);
   }
-  async probeExecutionProfile(selection: ExecutionProfileSelection): Promise<ObservedProfile> {
+  async probeExecutionProfile(selection: ExecutionProfileSelection, agent: AgentSelection): Promise<ObservedProfile> {
     const profile = this.executionProfile(selection);
-    return this.options.profileRouter!.probe(profile);
+    return this.options.profileRouter!.probe(profile, agent);
   }
   legacyExecutionPort():ExecutionPort { return this.port ?? productionExecutionPort(); }
   executionPort(selection?: ExecutionProfileSelection): ExecutionPort { return selection ? this.executionProfile(selection).port : this.legacyExecutionPort(); }
@@ -73,23 +75,24 @@ export class ControlService {
     const binding=readRun(this.store,runId).executionProfile;
     return binding ? this.executionProfile(binding).port : this.legacyExecutionPort();
   }
-  async legacyCapabilities(groupId: string):Promise<Capabilities> {
-    const caps = await this.legacyExecutionPort().capabilities();
+  /** Agent selection spec §6.4 (C3): every gate asks about the selection it is about to dispatch. */
+  async legacyCapabilities(groupId: string,agent:PartialSelection):Promise<CapabilityViewV1> {
+    const caps = (await this.legacyExecutionPort().resolveAgent(agent)).capabilities;
     assertCapabilities(readGroup(this.store,groupId).budgetMode ?? "strict",caps);
     return caps;
   }
-  capabilities(groupId:string):Promise<Capabilities> { return this.legacyCapabilities(groupId); }
-  async profiledCapabilities(groupId:string,selection:ExecutionProfileSelection):Promise<{profile:FrozenProfile;capabilities:Capabilities}> {
-    const profile=this.executionProfile(selection),observation=await this.options.profileRouter!.probe(profile);
+  capabilities(groupId:string,agent:PartialSelection):Promise<CapabilityViewV1> { return this.legacyCapabilities(groupId,agent); }
+  async profiledCapabilities(groupId:string,selection:ExecutionProfileSelection,agent:AgentSelection):Promise<{profile:FrozenProfile;capabilities:CapabilityViewV1}> {
+    const profile=this.executionProfile(selection),observation=await this.options.profileRouter!.probe(profile,agent);
     const observed=observation.observed,mode=readGroup(this.store,groupId).budgetMode??"strict";
     // Ruling R5: the router turns every probe throw into a failure code, which is right for a
     // genuine probe failure and wrong for "there is no port at all" -- those need different fixes,
     // so the named one is re-raised rather than folded into the capability answer.
     if(observation.probeFailureCode==="control-port-unconfigured")throw new ControlError("control-port-unconfigured");
     if(observation.probeFailureCode!==null||observed.usageObservation==="unavailable"||observed.budgetEnforcement==="unavailable"||observed.handoffControl!=="durable"||observed.handoffExecution===null||(mode==="strict"&&(observed.budgetEnforcement!=="bounded"||observed.requestBoundProof===null||!observed.requestBoundProof.workDimensions.includes("tokens"))))throw new ControlError("control-capability-unsupported");
-    const capabilities=await profile.port.capabilities();assertCapabilities(mode,capabilities);return {profile,capabilities};
+    const capabilities=(await profile.port.resolveAgent(agent)).capabilities;assertCapabilities(mode,capabilities);return {profile,capabilities};
   }
-  private claimWithCapabilities(groupId:string,workItemId:string,capabilities:Capabilities,executionProfile?:ExecutionProfileSelection,handoffProfile?:ExecutionProfileSelection):Claim {
+  private claimWithCapabilities(groupId:string,workItemId:string,capabilities:CapabilityViewV1,executionProfile?:ExecutionProfileSelection,handoffProfile?:ExecutionProfileSelection):Claim {
     return this.write(()=>{
       const group=readGroup(this.store,groupId),work=readWork(this.store,groupId,workItemId);
       if(group.stopped)throw new ControlError("group-stopped");
@@ -99,14 +102,15 @@ export class ControlService {
       return claimWork(this.store,{groupId,workItemId,capabilities,executionProfile,handoffProfile,graphVersion:group.graphVersion,targetVersion:work.targetVersion,commandId:`execute-${workItemId}-${work.targetVersion}-${group.graphVersion}`,expectedRevision:group.revision,by:"control-service"});
     });
   }
-  async claimLegacy(groupId:string,workItemId:string):Promise<Claim>{return this.claimWithCapabilities(groupId,workItemId,await this.legacyCapabilities(groupId));}
+  async claimLegacy(groupId:string,workItemId:string):Promise<Claim>{return this.claimWithCapabilities(groupId,workItemId,await this.legacyCapabilities(groupId,readWork(this.store,groupId,workItemId).agent));}
   claim(groupId:string,workItemId:string):Promise<Claim>{return this.claimLegacy(groupId,workItemId);}
   async claimProfiled(groupId:string,workItemId:string,selection:ExecutionProfileSelection,handoffSelection:ExecutionProfileSelection):Promise<Claim>{
     if(selection.workKind!=="task"||handoffSelection.workKind!=="handoff")throw new ControlError("profile-changed");
-    const [{capabilities}]=await Promise.all([this.profiledCapabilities(groupId,selection),this.profiledCapabilities(groupId,handoffSelection)]);
+    const agent=readWork(this.store,groupId,workItemId).agent;
+    const [{capabilities}]=await Promise.all([this.profiledCapabilities(groupId,selection,agent),this.profiledCapabilities(groupId,handoffSelection,agent)]);
     return this.claimWithCapabilities(groupId,workItemId,capabilities,selection,handoffSelection);
   }
-  private reconcileWithCapabilities(groupId:string,taskId:string,capabilities:Capabilities,executionProfile?:ExecutionProfileSelection,handoffProfile?:ExecutionProfileSelection):ApprovedReconcileBudget {
+  private reconcileWithCapabilities(groupId:string,taskId:string,capabilities:CapabilityViewV1,executionProfile?:ExecutionProfileSelection,handoffProfile?:ExecutionProfileSelection):ApprovedReconcileBudget {
     return this.write(()=>{
       const group=readGroup(this.store,groupId);if(group.stopped)throw new ControlError("group-stopped");
       const workItemId=`reconcile-${taskId}`,existing=this.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=? ORDER BY rowid DESC LIMIT 1").get(groupId,workItemId);let claim:Claim;
@@ -116,25 +120,31 @@ export class ControlService {
         const free=subtract(group.limit,add(group.used,group.reserved)),handoff=componentMin(cap.handoff,free),work=componentMin(cap.work,subtract(free,handoff));
         if(work.tokens===0||work.activeMs===0||work.attempts===0||work.sessions===0)throw new ControlError("group-budget-unavailable");
         const parent=allWork(this.store,groupId).find(item=>item.taskId===taskId&&item.kind==="task");if(!parent)throw new ControlError("work-not-found");
-        const prepared:WorkInput={workItemId,taskId:workItemId,kind:"reconcile",dependsOn:[],contract:{pendingReconciliation:taskId},configHash:parent.configHash,grant:{work,handoff}};
+        const prepared:WorkInput={workItemId,taskId:workItemId,kind:"reconcile",dependsOn:[],contract:{pendingReconciliation:taskId},configHash:parent.configHash,agent:parent.agent,grant:{work,handoff}};
         claim=claimWork(this.store,{groupId,workItemId,capabilities,executionProfile,handoffProfile,graphVersion:group.graphVersion,targetVersion:1,commandId:`reconcile-${taskId}`,expectedRevision:group.revision,by:"control-service"},prepared);
       }
       return {maxAttempts:claim.grant.work.attempts,perAttemptTimeoutMs:claim.grant.work.activeMs,totalRuntimeBudgetMs:claim.grant.work.activeMs,tokenBudget:claim.grant.work.tokens};
     });
   }
-  async reconcileBudgetLegacy(groupId:string,taskId:string):Promise<ApprovedReconcileBudget>{return this.reconcileWithCapabilities(groupId,taskId,await this.legacyCapabilities(groupId));}
+  async reconcileBudgetLegacy(groupId:string,taskId:string):Promise<ApprovedReconcileBudget>{return this.reconcileWithCapabilities(groupId,taskId,await this.legacyCapabilities(groupId,this.parentAgent(groupId,taskId)));}
   reconcileBudget(groupId:string,taskId:string):Promise<ApprovedReconcileBudget>{return this.reconcileBudgetLegacy(groupId,taskId);}
   async reconcileBudgetProfiled(groupId:string,taskId:string,selection:ExecutionProfileSelection,handoffSelection:ExecutionProfileSelection):Promise<ApprovedReconcileBudget>{
     if(selection.workKind!=="task"||handoffSelection.workKind!=="handoff")throw new ControlError("profile-changed");
-    const [{capabilities}]=await Promise.all([this.profiledCapabilities(groupId,selection),this.profiledCapabilities(groupId,handoffSelection)]);
+    const agent=this.parentAgent(groupId,taskId);
+    const [{capabilities}]=await Promise.all([this.profiledCapabilities(groupId,selection,agent),this.profiledCapabilities(groupId,handoffSelection,agent)]);
     return this.reconcileWithCapabilities(groupId,taskId,capabilities,selection,handoffSelection);
   }
-  async startProfiled(selection:ExecutionProfileSelection,input:import("./executionPort.js").StartEnvelope){if(selection.workKind!=="task")throw new ControlError("profile-changed");const {profile}=await this.profiledCapabilities(input.claim.groupId,selection);if(!sameProfile(readRun(this.store,input.claim.runId).executionProfile,selection))throw new ControlError("profile-changed");return startClaim(this.store,profile.port,input,this.admissionGate);}
+  /** A legacy (non-Web) reconciliation runs with its conflicted task's selection, as it ran with its configHash. */
+  private parentAgent(groupId:string,taskId:string):AgentSelection {
+    const parent=allWork(this.store,groupId).find(item=>item.taskId===taskId&&item.kind==="task");if(!parent)throw new ControlError("work-not-found");
+    return parent.agent;
+  }
+  async startProfiled(selection:ExecutionProfileSelection,input:import("./executionPort.js").StartEnvelope){if(selection.workKind!=="task")throw new ControlError("profile-changed");const {profile}=await this.profiledCapabilities(input.claim.groupId,selection,input.claim.agent);if(!sameProfile(readRun(this.store,input.claim.runId).executionProfile,selection))throw new ControlError("profile-changed");return startClaim(this.store,profile.port,input,this.admissionGate);}
   startLegacy(input:import("./executionPort.js").StartEnvelope){return startClaim(this.store,this.legacyExecutionPort(),input,this.admissionGate);}
   async reconcileStartForRun(runId:string){
     const run=readRun(this.store,runId);
     if(run.executionProfile&&run.executionProfile.workKind!=="task")throw new ControlError("profile-changed");
-    const selected=run.executionProfile ? await this.profiledCapabilities(run.groupId,run.executionProfile) : undefined;
+    const selected=run.executionProfile ? await this.profiledCapabilities(run.groupId,run.executionProfile,run.agent) : undefined;
     return reconcileStart(this.store,selected?.profile.port??this.legacyExecutionPort(),runId,this.admissionGate);
   }
   async requestHandoff(groupId:string,runId:string,input:{requestId:string;reason:HandoffReason;deadlineAt:string}) {
@@ -144,7 +154,8 @@ export class ControlService {
     if(!work)throw new ControlError("handoff-work-not-found");
     const binding=run.handoffProfile;
     if(run.executionProfile&&(!binding||binding.workKind!=="handoff"))throw new ControlError("profile-changed");
-    const selected=binding ? await this.profiledCapabilities(groupId,binding) : {profile:undefined,capabilities:await this.legacyCapabilities(groupId)};
+    // Agent selection spec §6.4: handoff has no slot of its own; it is probed with the handed-off run's selection.
+    const selected=binding ? await this.profiledCapabilities(groupId,binding,run.agent) : {profile:undefined,capabilities:await this.legacyCapabilities(groupId,run.agent)};
     const envelope=readEnvelope(this.store,runId),request=handoffRequestSchema.parse({protocol:1 as const,...input,runId,generation:run.generation});
     const id="handoff-request:"+runId,body={workItemId:work.workItemId,request};const old=this.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(id);
     this.write(()=>{
@@ -164,16 +175,16 @@ export class ControlService {
     const rows=this.store.db.prepare("SELECT body FROM runs WHERE group_id=? ORDER BY rowid DESC").all(groupId).map(row=>JSON.parse(String(row.body)) as ReturnType<typeof readRun>);
     const predecessor=rows.find(run=>run.taskId===taskId&&run.state==="settled"&&run.recoverable);if(!predecessor)throw new ControlError("continuation-predecessor-unrecoverable");
     const work=readWork(this.store,groupId,predecessor.workItemId),binding=predecessor.executionProfile,handoffBinding=predecessor.handoffProfile;
-    const selected=binding ? await this.profiledCapabilities(groupId,binding) : {profile:undefined,capabilities:await this.legacyCapabilities(groupId)};
+    const selected=binding ? await this.profiledCapabilities(groupId,binding,predecessor.agent) : {profile:undefined,capabilities:await this.legacyCapabilities(groupId,predecessor.agent)};
     if(binding) {
       if(binding.workKind!=="task"||!handoffBinding||handoffBinding.workKind!=="handoff")throw new ControlError("profile-changed");
-      await this.profiledCapabilities(groupId,handoffBinding);
+      await this.profiledCapabilities(groupId,handoffBinding,predecessor.agent);
     }
     const claim=this.write(()=>claimContinuation(this.store,{groupId,predecessorRunId:predecessor.runId,workItemId:work.workItemId,taskId,graphVersion:group.graphVersion,targetVersion:work.targetVersion,commandId:input.commandId,expectedRevision:input.expectedRevision,by:"human",executionProfile:binding,handoffProfile:handoffBinding}));
     const port=selected.profile?.port??this.legacyExecutionPort();
     if(this.store.db.prepare("SELECT id FROM outbox WHERE id=?").get("start:"+claim.runId))return reconcileStart(this.store,port,claim.runId,this.admissionGate);
     const previous=readEnvelope(this.store,predecessor.runId),sourceDir=join(dirname(previous.work.sourceDir),claim.runId);
     const checkpoint=await exportResumeBundle(this.store,{predecessorRunId:predecessor.runId,newSourceDir:sourceDir},{admit:operation=>this.writeAsync(operation)});
-    return startClaim(this.store,port,{protocol:1,claim,contractHash:hashPayload(work.contract),inputCheckpoint:checkpoint,work:{contract:work.contract,targetRepo:previous.work.targetRepo,base:previous.work.base,sourceDir}},this.admissionGate);
+    return startClaim(this.store,port,{protocol:2,claim,contractHash:hashPayload(work.contract),inputCheckpoint:checkpoint,work:{contract:work.contract,targetRepo:previous.work.targetRepo,base:previous.work.base,sourceDir}},this.admissionGate);
   }
 }
````

`src/control/dispatch.ts`：

````diff
diff --git a/src/control/dispatch.ts b/src/control/dispatch.ts
index 58af84f..7deb33b 100644
--- a/src/control/dispatch.ts
+++ b/src/control/dispatch.ts
@@ -47,9 +47,10 @@ async function send(store:ControlStore,port:ExecutionPort,input:StartEnvelope,ga
 export async function startClaim(store:ControlStore,port:ExecutionPort,input:StartEnvelope,gate?:AdmissionGate):Promise<RunView> {
  input=startEnvelopeSchema.parse(input) as StartEnvelope;
  assertClaimIdentity(store,input.claim);
- if(input.protocol!==1) throw new ControlError("control-protocol-unavailable");
+ if(input.protocol!==2) throw new ControlError("control-protocol-unavailable");
  const group=readGroup(store,input.claim.groupId);
- assertCapabilities(group.budgetMode??"strict",await port.capabilities());
+ // Agent selection spec §6.4 (C3): the gate asks about the claim's own frozen selection, the one ccloop will run.
+ assertCapabilities(group.budgetMode??"strict",(await port.resolveAgent(input.claim.agent)).capabilities);
  const existing=store.db.prepare("SELECT body FROM outbox WHERE id=?").get("start:"+input.claim.runId);
  if(existing) {
   if(hashPayload(JSON.parse(String(existing.body)))!==hashPayload(input)) throw new ControlError("start-envelope-conflict");
@@ -74,7 +75,7 @@ export async function reconcileStart(store:ControlStore,port:ExecutionPort,runId
  if(status.kind==="absent") {
   const group=readGroup(store,input.claim.groupId);
   if(!group.stopped && !store.dispatchBlocked) {
-   assertCapabilities(group.budgetMode??"strict",await port.capabilities());
+   assertCapabilities(group.budgetMode??"strict",(await port.resolveAgent(input.claim.agent)).capabilities);
    return send(store,port,input,gate);
   }
  }
````

`src/control/ownership.ts`：

````diff
diff --git a/src/control/ownership.ts b/src/control/ownership.ts
index e35384f..aa12ebf 100644
--- a/src/control/ownership.ts
+++ b/src/control/ownership.ts
@@ -9,5 +9,7 @@ export function assertClaimIdentity(store:ControlStore,claim:Claim):void {
  for(const key of ["groupId","workItemId","taskId","ownerToken","configHash","commandId","graphVersion","targetVersion"] as const) {
   if(run[key]!==claim[key]) throw new ControlError("run-owner-conflict");
  }
+ // Agent selection spec I1: the frozen selection is part of the claim's identity, beside the configHash that hashes it.
+ if(hashPayload(run.agent)!==hashPayload(claim.agent)) throw new ControlError("run-owner-conflict");
  if(hashPayload(run.grant)!==hashPayload(claim.grant)) throw new ControlError("run-grant-conflict");
 }
````

`src/control/schedulerBridge.ts`：

````diff
diff --git a/src/control/schedulerBridge.ts b/src/control/schedulerBridge.ts
index b36c992..8e88346 100644
--- a/src/control/schedulerBridge.ts
+++ b/src/control/schedulerBridge.ts
@@ -8,7 +8,7 @@ import { git } from "../scheduler/gitExec.js";
 import type { ControlService, ExecutionProfileSelection } from "./service.js";
 import type { Candidate, Claim, ArtifactRef, Identity } from "./types.js";
 import type { ExecutionPort, ExecutionReport, StartEnvelope } from "./executionPort.js";
-import { allWork, readGroup, readWork, saveWork } from "./queries.js";
+import { allWork, readGroup, readWork, saveWork, workAgents } from "./queries.js";
 import { hasObservedUsage, readRun } from "./budget.js";
 import { hashPayload } from "./commands.js";
 import { readEnvelope } from "./dispatch.js";
@@ -22,8 +22,8 @@ import { ControlError } from "./errors.js";
 import { readConfirmedTaskExecution } from "./executionSnapshot.js";
 
 function claimOnly(c:Claim):Claim {
- const {groupId,workItemId,taskId,runId,generation,graphVersion,targetVersion,commandId,configHash,grant,ownerToken}=c;
- return {groupId,workItemId,taskId,runId,generation,graphVersion,targetVersion,commandId,configHash,grant,ownerToken};
+ const {groupId,workItemId,taskId,runId,generation,graphVersion,targetVersion,commandId,configHash,agent,grant,ownerToken}=c;
+ return {groupId,workItemId,taskId,runId,generation,graphVersion,targetVersion,commandId,configHash,agent,grant,ownerToken};
 }
 function identity(c:Identity) {
  const {groupId,workItemId,taskId,runId,generation,graphVersion,targetVersion}=c;
@@ -122,9 +122,13 @@ export function makeControlledExecution(service:ControlService,groupId:string,se
   mode:"controlled",
   preflight:async(round:Round)=>{
    if(selection&&!handoffSelection)throw new ControlError("profile-changed");
-   const port=selection?(await service.profiledCapabilities(groupId,selection)).profile.port:service.legacyExecutionPort();
-   if(handoffSelection)await service.profiledCapabilities(groupId,handoffSelection);
-   if(!selection)await service.legacyCapabilities(groupId);
+   // Agent selection (plan T7): before any claim exists, every frozen selection the round will dispatch is probed.
+   const port=selection?service.executionProfile(selection).port:service.legacyExecutionPort();
+   for(const agent of workAgents(service.store,groupId)){
+    if(selection)await service.profiledCapabilities(groupId,selection,agent);
+    if(handoffSelection)await service.profiledCapabilities(groupId,handoffSelection,agent);
+    if(!selection)await service.legacyCapabilities(groupId,agent);
+   }
    if(!port.readEvidence) throw new ControlError("control-evidence-unavailable");
    const group=readGroup(service.store,groupId);
    if(group.stopped) throw new ControlError("group-stopped");
@@ -154,7 +158,7 @@ export function makeControlledExecution(service:ControlService,groupId:string,se
      current.contract=contract;saveWork(service.store,groupId,current);
     }));
    } else if(!confirmed && hashPayload(contract)!==hashPayload(work.contract)) throw new ControlError("start-contract-conflict");
-   const root=service.write(()=>privateDirectory(plan.runsDir)),input:StartEnvelope={protocol:1,claim,contractHash:hashPayload(contract),inputCheckpoint:null,
+   const root=service.write(()=>privateDirectory(plan.runsDir)),input:StartEnvelope={protocol:2,claim,contractHash:hashPayload(contract),inputCheckpoint:null,
     work:{contract,targetRepo:await realpath(plan.targetRepo),base,sourceDir:join(root,claim.runId)}};
    if(selection)await service.startProfiled(selection,input);else await service.startLegacy(input);
    const report=await collectControlled(service,claim.runId);
````

`src/control/startEnvelope.ts`：

````diff
diff --git a/src/control/startEnvelope.ts b/src/control/startEnvelope.ts
index b4f08ac..e4f23ac 100644
--- a/src/control/startEnvelope.ts
+++ b/src/control/startEnvelope.ts
@@ -2,7 +2,7 @@ import { z } from "zod";
 import { ControlError } from "./errors.js";
 import type { StartEnvelope } from "./executionPort.js";
 import { dispatchEnvelopeSchema, type DispatchEnvelopeV1 } from "./webProtocol.js";
-import { grantSchema, idSchema, safeInteger, startEnvelopeSchema } from "./schema.js";
+import { agentSelectionSchema, grantSchema, idSchema, safeInteger, startEnvelopeSchema } from "./schema.js";
 import type { InputCheckpointV1 } from "./resumeBundle.js";
 
 /**
@@ -25,6 +25,8 @@ const startEnvelopeSourceSchema = z
     targetVersion: safeInteger,
     commandId: idSchema,
     configHash: z.string().min(1),
+    // Agent selection spec §4.6: the run's frozen, complete selection travels in the claim (StartEnvelopeV2).
+    agent: agentSelectionSchema,
     grant: grantSchema,
     ownerToken: idSchema,
   })
@@ -74,7 +76,7 @@ export function toStartEnvelope(
     throw new ControlError("start-envelope-conflict", `identity:${frozen.runId}`);
   }
   const built = {
-    protocol: 1 as const,
+    protocol: 2 as const,
     claim: {
       groupId: claim.groupId,
       workItemId: claim.workItemId,
@@ -85,6 +87,7 @@ export function toStartEnvelope(
       targetVersion: claim.targetVersion,
       commandId: claim.commandId,
       configHash: claim.configHash,
+      agent: claim.agent,
       grant: claim.grant,
       ownerToken: claim.ownerToken,
     },
````

`src/control/continuation.ts`：

````diff
diff --git a/src/control/continuation.ts b/src/control/continuation.ts
index 39c3b5b..9ec9726 100644
--- a/src/control/continuation.ts
+++ b/src/control/continuation.ts
@@ -38,7 +38,7 @@ export function claimContinuation(store:ControlStore,input:ContinuationClaimInpu
   if(dimensions.some(key=>grant.work[key]===0))throw new ControlError("continuation-budget-unavailable");
   const total=add(grant.work,grant.handoff),reserved=add(group.reserved,total);if(!fits(group.used,reserved,group.limit))throw new ControlError("group-budget-unavailable");
   group.reserved=reserved;group.budgetVersion++;group.status="running";saveGroup(store,group);
-  const claim:Claim={groupId,workItemId,taskId,runId:"run-"+randomUUID(),generation:1,graphVersion,targetVersion,commandId:meta.commandId,configHash:work.configHash,grant,ownerToken:randomUUID()};
+  const claim:Claim={groupId,workItemId,taskId,runId:"run-"+randomUUID(),generation:1,graphVersion,targetVersion,commandId:meta.commandId,configHash:work.configHash,agent:work.agent,grant,ownerToken:randomUUID()};
   const run:RunRecord={...claim,...(executionProfile?{executionProfile}:{}),...(handoffProfile?{handoffProfile}:{}),executionId:null,state:"claimed",checkpointId:null,recoverable:false,remaining:structuredClone(grant),cumulative:{work:zero(),handoff:zero()},unknown:{work:true,handoff:true},highWater:0,breaches:[],handoffWorkItemId:null,predecessorRunId};
   store.db.prepare("INSERT INTO runs VALUES (?,?,?,?,1,?)").run(claim.runId,groupId,workItemId,1,JSON.stringify(run));work.status="running";saveWork(store,groupId,work);return claim;
  });
````

`src/control/webDispatch.ts`：

````diff
diff --git a/src/control/webDispatch.ts b/src/control/webDispatch.ts
index 114d7dd..850d1a1 100644
--- a/src/control/webDispatch.ts
+++ b/src/control/webDispatch.ts
@@ -10,6 +10,7 @@ import type { ExecutionProfileRouter, FrozenProfile, ObservedProfile } from "./p
 import type { AdmissionGate } from "./admissionGate.js";
 import type { WakeHandler, WakeHandlers } from "./dispatch.js";
 import type { ControlStore } from "./store.js";
+import type { AgentSelection } from "./agentSelection.js";
 import { claimableContinuations, continuationAlreadyClaimed, continuationWakeBody, type RegisteredContinuation } from "./continuation.js";
 
 export type Phase = "estimate" | "work" | "handoff";
@@ -18,7 +19,7 @@ export interface WebDispatchDeps { store: ControlStore; profileRouter: Execution
 export interface AttemptTuple { runId: string; generation: number; phase: Phase; providerAttemptOrdinal: number }
 export interface DispatchRun {
   runId: string; groupId: string; workItemId: string; taskId: string | null; generation: number;
-  graphVersion: number; targetVersion: number; commandId: string; configHash: string;
+  graphVersion: number; targetVersion: number; commandId: string; configHash: string; agent: AgentSelection;
   grant: { work: unknown; handoff: unknown }; ownerToken: string; state: string; phase: Phase;
   claimOrdinal: number | null; providerAttemptOrdinal: number; remaining: { work: unknown; handoff: unknown };
   cumulative: unknown; unknown: { work: boolean; handoff: boolean }; highWater: number; breaches: unknown[];
@@ -280,7 +281,7 @@ function createStartingRun(
     runId, groupId, workItemId: work.workItemId, taskId: work.taskId, estimateId: null, generation: 1,
     graphVersion: snapshot.graphVersion, targetVersion: work.targetVersion,
     commandId: continuation ? `continue-${groupId}-${continuation.resumeRevision}-${work.workItemId}` : `start-${groupId}-${startRevision}-${work.workItemId}`,
-    configHash: work.configHash, grant, ownerToken, executionId: null, state: "starting", checkpointId: null, recoverable: false,
+    configHash: work.configHash, agent: work.agent, grant, ownerToken, executionId: null, state: "starting", checkpointId: null, recoverable: false,
     remaining: structuredClone(grant), cumulative: { work: zero(), handoff: zero() }, unknown: { work: false, handoff: false },
     highWater: 0, breaches: [], handoffWorkItemId: null, phase: "work", claimOrdinal, providerAttemptOrdinal: 0, failureCode: null,
     continuationIntentId: continuation?.continuationIntentId ?? null,
````

`src/control/queries.ts`：

````diff
diff --git a/src/control/queries.ts b/src/control/queries.ts
index be93025..87ac4a0 100644
--- a/src/control/queries.ts
+++ b/src/control/queries.ts
@@ -1,5 +1,6 @@
 import type { ControlStore } from "./store.js";
 import type { ArtifactRef, Amount, GroupInput, GroupView, RunView, WorkInput } from "./types.js";
+import type { AgentSelection } from "./agentSelection.js";
 import { ControlError } from "./errors.js";
 import { recordProjectionChange } from "./projectionJournal.js";
 import { readCanonicalRecord } from "./snapshot.js";
@@ -54,6 +55,15 @@ export function saveWork(store:ControlStore,groupId:string,work:WorkRecord):void
 export function allWork(store:ControlStore,groupId:string):WorkRecord[] {
   return store.db.prepare("SELECT body FROM work_items WHERE group_id=? ORDER BY id").all(groupId).map(r=>JSON.parse(String(r.body)));
 }
+/**
+ * Agent selection (plan T7): the distinct frozen selections of a legacy group's task work items, in canonical order.
+ * The legacy scheduler's group-level gates run before any claim exists, so they probe each of them.
+ */
+export function workAgents(store:ControlStore,groupId:string):AgentSelection[] {
+ const byBytes=new Map<string,AgentSelection>();
+ for(const work of allWork(store,groupId))if(work.kind==="task")byBytes.set(canonicalBytes(work.agent).toString("utf8"),work.agent);
+ return [...byBytes.keys()].sort().map(key=>byBytes.get(key)!);
+}
 export function getRun(store:ControlStore,id:string):RunView {
   const row=store.db.prepare("SELECT body FROM runs WHERE id=?").get(id);
   if(!row) throw new ControlError("run-not-found");
````

`src/control/stopIntent.ts`：

````diff
diff --git a/src/control/stopIntent.ts b/src/control/stopIntent.ts
index 9c1d0ea..74eb941 100644
--- a/src/control/stopIntent.ts
+++ b/src/control/stopIntent.ts
@@ -16,6 +16,7 @@ import type { Amount, HandoffRequest } from "./types.js";
 import type { ExecutionProfileRouter } from "./profiles.js";
 import type { AdmissionGate } from "./admissionGate.js";
 import type { ControlStore } from "./store.js";
+import type { AgentSelection } from "./agentSelection.js";
 
 export type StopMode = "pause" | "shutdown" | "handoff";
 export type StopState = "paused" | "handoff-pending" | "handoff-partial" | "handoff-unresolved" | "handoff-complete";
@@ -114,6 +115,8 @@ export interface RunBody {
   failureCode: string | null;
   executionProfile: { profileId: string; profileHash: string };
   handoffProfile: { profileId: string; profileHash: string } | null;
+  /** Absent on an estimate run, which has no agent selection (plan T10 gives it the estimator's). */
+  agent?: AgentSelection;
   [key: string]: unknown;
 }
 
@@ -559,7 +562,8 @@ export async function beginHandoffAttempt(deps: StopDeps, requestId: string): Pr
 
     if (prepared.execution === "model-assisted-v1") {
       const profile = profileRouter.resolve("handoff", run.handoffProfile!.profileId, run.handoffProfile!.profileHash);
-      const observed = await profileRouter.probe(profile);
+      // Agent selection spec §6.4: handoff has no slot; it is probed with the handed-off run's frozen selection.
+      const observed = await profileRouter.probe(profile, run.agent);
       const cap: CapabilityViewV1 = observed.observed;
       if (observed.probeFailureCode !== null || cap.handoffControl !== "durable" || cap.handoffExecution !== "model-assisted-v1") {
         const reasonCode = "handoff-capability-unavailable";
````

`src/panel/controlViews.ts`：

````diff
diff --git a/src/panel/controlViews.ts b/src/panel/controlViews.ts
index a314a77..4688692 100644
--- a/src/panel/controlViews.ts
+++ b/src/panel/controlViews.ts
@@ -9,7 +9,7 @@ import { readProjectionChanges, readProjectionState } from "../control/projectio
 import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../control/queries.js";
 import { readCanonicalRecord } from "../control/snapshot.js";
 import type { ControlStore } from "../control/store.js";
-import { amountSchema, artifactSchema, canonicalTimestampSchema, grantSchema, idSchema, safeInteger } from "../control/schema.js";
+import { agentSelectionSchema, amountSchema, artifactSchema, canonicalTimestampSchema, grantSchema, idSchema, safeInteger } from "../control/schema.js";
 import { taskContractSchema } from "../scheduler/planFile.js";
 import {
   allocationViewSchema,
@@ -115,6 +115,8 @@ const persistedRunSchema = z.object({
   targetVersion: safeInteger.positive(),
   commandId: idSchema,
   configHash: hashSchema,
+  // Agent selection spec I1: a work run carries its frozen selection; an estimate run has none (plan T10 gives it one).
+  agent: agentSelectionSchema.optional(),
   grant: grantSchema,
   ownerToken: idSchema,
   executionProfile: executionProfileAuthoritySchema,
````


  跑 Step 4 同一循环 ⇒ Expected 六个文件 rc=0（副本实测：dispatch 9/9、startEnvelope 10/10、profiles 10/10、unconfiguredPort 5/5、capabilitySchema 1/1、profiledService 12/12）。

- [ ] **Step 6: 其余既有判据的机械适配（端口面、`protocol: 2`、候选身份去掉 `agent`、面板端口替身）**

`tests/control/budget.test.ts`：

````diff
diff --git a/tests/control/budget.test.ts b/tests/control/budget.test.ts
index bca5a38..60a75ea 100644
--- a/tests/control/budget.test.ts
+++ b/tests/control/budget.test.ts
@@ -8,7 +8,8 @@ import { recordUsage } from "../../src/control/usage.js";
 import { createGroup,putWork,setGroupLimit,setGroupStopped } from "../../src/control/commands.js";
 import { getGroup } from "../../src/control/queries.js";
 import { openTestStore,seedBudgetCase,amount,caps } from "./fixtures/store.js";
-import type { WorkKind, Capabilities } from "../../src/control/types.js";
+import type { WorkKind } from "../../src/control/types.js";
+import type { CapabilityViewV1 } from "../../src/control/webProtocol.js";
 describe("unified work claims",()=>{
  it("reserves both buckets atomically and replays one immutable run",async()=>{
   const h=await openTestStore();try{
@@ -44,7 +45,7 @@ describe("unified work claims",()=>{
    const s=seedBudgetCase(h.store);
    const legacy = { protocol: 1, durableAccept: true, ownershipIsolation: true,
      evidenceRetention: true, usageObservation: "phase-end",
-     budgetEnforcement: "soft", requestBoundEvidence: null } as unknown as Capabilities;
+     budgetEnforcement: "soft", requestBoundEvidence: null } as unknown as CapabilityViewV1;
    expect(() => claimWork(h.store, { ...s.t1Claim, capabilities: legacy }))
      .toThrow("control-capability-unsupported");
    expect(getGroup(h.store, "g1").reserved.tokens).toBe(10);
````

`tests/control/commands.test.ts`：

````diff
diff --git a/tests/control/commands.test.ts b/tests/control/commands.test.ts
index 830cac6..570d906 100644
--- a/tests/control/commands.test.ts
+++ b/tests/control/commands.test.ts
@@ -1,11 +1,11 @@
 import { describe, it, expect } from "vitest";
 import { createGroup, putWork, setGroupStopped, setGroupLimit } from "../../src/control/commands.js";
 import { getGroup, readVersions } from "../../src/control/queries.js";
-import { openTestStore } from "./fixtures/store.js";
+import { fixtureAgent, openTestStore } from "./fixtures/store.js";
 import type { GroupInput, WorkInput } from "../../src/control/types.js";
 export const group:GroupInput = {groupId:"g1",projectKey:"example/repo",goal:"Ship checked change",successConditions:["checks pass"],limit:{tokens:100,activeMs:10000,attempts:10,sessions:10},reviewReserve:{tokens:10,activeMs:1000,attempts:1,sessions:1},deadlineAt:null};
 const meta = {commandId:"create",expectedRevision:0,by:"human"};
-const work:WorkInput = {workItemId:"T1",taskId:"T1",kind:"task",dependsOn:[],contract:{scope:{allowedPaths:["a"]}},configHash:"config1",grant:{work:{tokens:60,activeMs:100,attempts:1,sessions:1},handoff:{tokens:10,activeMs:10,attempts:0,sessions:0}}};
+const work:WorkInput = {workItemId:"T1",taskId:"T1",kind:"task",dependsOn:[],contract:{scope:{allowedPaths:["a"]}},configHash:"config1",agent:fixtureAgent,grant:{work:{tokens:60,activeMs:100,attempts:1,sessions:1},handoff:{tokens:10,activeMs:10,attempts:0,sessions:0}}};
 describe("control commands", () => {
   it("replays the original result before checking stale revisions, but rejects changed payload and author", async () => {
     const h = await openTestStore(); try {
````

`tests/control/commandLedger.test.ts`：

````diff
diff --git a/tests/control/commandLedger.test.ts b/tests/control/commandLedger.test.ts
index 89a9167..2e864ff 100644
--- a/tests/control/commandLedger.test.ts
+++ b/tests/control/commandLedger.test.ts
@@ -453,7 +453,9 @@ describe("web command ledger", () => {
     }
   });
 
-  it.each((["control-sequence-overflow", "control-peer-timeout", "control-binary-invalid", "control-adapter-config-invalid", "control-peer-exit"] as const)
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the port's path refusal is
+  // control-agents-table-invalid now (agent selection spec §6.6); the five codes still each roll back in both phases.
+  it.each((["control-sequence-overflow", "control-peer-timeout", "control-binary-invalid", "control-agents-table-invalid", "control-peer-exit"] as const)
     .flatMap((code) => (["expand", "apply"] as const).map((phase) => [code, phase] as const)))("rolls explicitly non-durable %s failures back during %s", async (code, phase) => {
     const h = await openTestStore();
     try {
````

`tests/control/errorClassification.test.ts`：

````diff
diff --git a/tests/control/errorClassification.test.ts b/tests/control/errorClassification.test.ts
index 6c025c5..d4a9566 100644
--- a/tests/control/errorClassification.test.ts
+++ b/tests/control/errorClassification.test.ts
@@ -44,7 +44,9 @@ describe("control error classification", () => {
     expect([...v1WebErrorCodes].sort()).toEqual(v1WebErrorCodes);
   });
 
-  it.each(["control-binary-invalid", "control-adapter-config-invalid"])("classifies helper-mediated %s as internal", (code) => {
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the agents table replaced the
+  // adapter config (spec §6.6), so its path refusal is the helper-mediated internal code now.
+  it.each(["control-binary-invalid", "control-agents-table-invalid"])("classifies helper-mediated %s as internal", (code) => {
     expect(Reflect.get(nonDurableControlErrorClassifications, code)).toBe("internal");
     expect(durableCommandErrorStatus(code)).toBeNull();
   });
````

`tests/control/continuation.test.ts`：

````diff
diff --git a/tests/control/continuation.test.ts b/tests/control/continuation.test.ts
index 340d2ed..acdf60b 100644
--- a/tests/control/continuation.test.ts
+++ b/tests/control/continuation.test.ts
@@ -5,7 +5,7 @@ import { commitCandidate } from "../../src/control/checkpoints.js";
 import { getGroup } from "../../src/control/queries.js";
 import { candidateCase } from "./fixtures/candidate.js";
 import { ControlService } from "../../src/control/service.js";
-import { caps } from "./fixtures/store.js";
+import { agentsView, caps, resolvedAs } from "./fixtures/store.js";
 import type { ExecutionPort,StartEnvelope } from "../../src/control/executionPort.js";
 import { recordUsage } from "../../src/control/usage.js";
 
@@ -30,7 +30,7 @@ describe("continuation claims",{timeout:30000},()=>{
   });
   it("exports and binds the verified resume bundle before starting and replays one new run",async()=>{
     const h=await candidateCase();try{await commitCandidate(h.store,h.candidate);let accepted:StartEnvelope|undefined;
-      const port:ExecutionPort={capabilities:async()=>caps,readEvidence:async()=>Buffer.alloc(0),accept:async input=>(accepted=input,{kind:"accepted",executionId:"continued",configHash:input.claim.configHash}),inspect:async input=>({kind:"accepted",executionId:"continued",configHash:input.claim.configHash}),requestHandoff:async(_input,request)=>({kind:"latched",requestId:request.requestId}),collect:async()=>({events:[],candidate:null,terminal:null})};
+      const port:ExecutionPort={resolveAgent:async partial=>resolvedAs(caps,partial),listAgents:async()=>agentsView,readEvidence:async()=>Buffer.alloc(0),accept:async input=>(accepted=input,{kind:"accepted",executionId:"continued",configHash:input.claim.configHash}),inspect:async input=>({kind:"accepted",executionId:"continued",configHash:input.claim.configHash}),requestHandoff:async(_input,request)=>({kind:"latched",requestId:request.requestId}),collect:async()=>({events:[],candidate:null,terminal:null})};
       const service=new ControlService(h.store,port),first=await service.continueTask("g1","T1",{commandId:"continue-service",expectedRevision:3});
       expect(first.runId).not.toBe(h.claim.runId);expect(accepted?.inputCheckpoint).toMatchObject({predecessorRunId:h.claim.runId,checkpointId:"cp1"});expect(accepted?.work.sourceDir).toContain(first.runId);
       const replay=await service.continueTask("g1","T1",{commandId:"continue-service",expectedRevision:3});expect(replay.runId).toBe(first.runId);
````

`tests/control/finalReview.test.ts`：

````diff
diff --git a/tests/control/finalReview.test.ts b/tests/control/finalReview.test.ts
index 0440e75..a6467f1 100644
--- a/tests/control/finalReview.test.ts
+++ b/tests/control/finalReview.test.ts
@@ -5,7 +5,7 @@ import { candidateCase } from "./fixtures/candidate.js";
 import { archiveCase } from "./fixtures/archive.js";
 import { crashCase } from "./fixtures/crashCase.js";
 import { roundPeer } from "./fixtures/roundPeer.js";
-import { caps,amount,openTestStore,seedBudgetCase } from "./fixtures/store.js";
+import { agentsView,caps,amount,openTestStore,resolvedAs,seedBudgetCase } from "./fixtures/store.js";
 import { commitCandidate,readCommittedCheckpoint } from "../../src/control/checkpoints.js";
 import { publishPending } from "../../src/control/projection.js";
 import { readRun,claimWork } from "../../src/control/budget.js";
@@ -39,7 +39,7 @@ describe("final review regressions",{timeout:30000},()=>{
    const handoff=await writeArtifact(h.store,"handoff-observations",Buffer.from(JSON.stringify({protocol:1,identity:{groupId:h.claim.groupId,workItemId:h.claim.workItemId,taskId:h.claim.taskId,runId:h.claim.runId,generation:h.claim.generation,graphVersion:h.claim.graphVersion,targetVersion:h.claim.targetVersion},request:null,runState:{status:"succeeded"},completed:[],unfinished:[],pendingDecisions:[],awaitingHuman:[],validationCommands:[],rawLogs:[],usageHighWater:seq,unresolvedRequestIds:[],artifacts:[]})));
    const a=await archiveRun(h.store,{runId:h.claim.runId,sourceDir:h.sourceDir,repoDir:h.repoDir,stopProof});
    const reserved=getGroup(h.store,"g1").reserved;
-   const {commandId:_commandId,configHash:_configHash,grant:_grant,ownerToken:_ownerToken,...candidateIdentity}=h.claim;
+   const {commandId:_commandId,configHash:_configHash,agent:_agent,grant:_grant,ownerToken:_ownerToken,...candidateIdentity}=h.claim;
    await commitCandidate(h.store,{...candidateIdentity,checkpointId:"observations",usageHighWater:seq,result:"complete",artifacts:[...a.artifacts,source,proofSource,handoff],snapshot:a.snapshot,missing:[],unresolvedRequestIds:[],stopProof,terminalOutcome:"succeeded",handoff});
    expect(getGroup(h.store,"g1").used.tokens).toBe(0);
    if(observed==="both")expect(readRun(h.store,h.claim.runId).state).toBe("settled");
@@ -66,7 +66,7 @@ describe("final review regressions",{timeout:30000},()=>{
   const h=await candidateCase();try{
    await commitCandidate(h.store,h.candidate);const {targetVersion,status,...w}=readWork(h.store,"g1","T1");
    putWork(h.store,"g1",{...w,contract:{updated:true},grant:{work:amount(20,100,1,1),handoff:amount(0,0,0,0)}},{commandId:"update",expectedRevision:3,by:"human"});
-   const service=new ControlService(h.store,{capabilities:async()=>caps} as ExecutionPort);const before=getGroup(h.store,"g1").reserved.tokens;
+   const service=new ControlService(h.store,{resolveAgent:async partial=>resolvedAs(caps,partial),listAgents:async()=>agentsView} as ExecutionPort);const before=getGroup(h.store,"g1").reserved.tokens;
    const c=await service.claim("g1","T1");expect(c.runId).not.toBe(h.claim.runId);expect(c.targetVersion).toBe(2);expect(c.graphVersion).toBe(4);expect(getGroup(h.store,"g1").reserved.tokens).toBe(before+20);
    expect((await service.claim("g1","T1")).runId).toBe(c.runId);expect(getGroup(h.store,"g1").reserved.tokens).toBe(before+20);
   }finally{await h.dispose();}
@@ -84,7 +84,7 @@ describe("final review regressions",{timeout:30000},()=>{
  });
  it("refuses recovery while live service orchestration owns the store",async()=>{
   const h=await openTestStore(),entered=latch(),resume=latch();try{
-   seedBudgetCase(h.store);const service=new ControlService(h.store,{...roundPeer(join(h.root,"peer")),capabilities:async()=>{entered.release();await resume.promise;throw new Error("end-live-probe");}} as ExecutionPort);
+   seedBudgetCase(h.store);const service=new ControlService(h.store,{...roundPeer(join(h.root,"peer")),resolveAgent:async()=>{entered.release();await resume.promise;throw new Error("end-live-probe");}} as ExecutionPort);
    const running=service.run("g1","unused").catch(e=>e.message);await entered.promise;
    await expect(recoverControl(h.store,{inspect:async()=>{throw new Error("unexpected inspect");}} as unknown as ExecutionPort)).rejects.toThrow("control-operation-in-progress");
    resume.release();expect(await running).toBe("end-live-probe");
@@ -101,7 +101,7 @@ describe("final review regressions",{timeout:30000},()=>{
   const h=await openTestStore();try{
    const s=seedBudgetCase(h.store);createGroup(h.store,{groupId:"distinct",projectKey:"project",goal:"goal",successConditions:["okay"],limit:amount(200),reviewReserve:amount(0,0,0,0),deadlineAt:null},{commandId:"create",expectedRevision:0,by:"human"});
    putWork(h.store,"distinct",{...s.w1,workItemId:"WI1"},{commandId:"w1",expectedRevision:1,by:"human"});putWork(h.store,"distinct",{...s.w2,workItemId:"WI2",dependsOn:["WI1"]},{commandId:"w2",expectedRevision:2,by:"human"});
-   const service=new ControlService(h.store,{...roundPeer(join(h.root,"peer")),capabilities:async()=>caps,readEvidence:async()=>Buffer.from("")},{targetRepo:h.root});
+   const service=new ControlService(h.store,{...roundPeer(join(h.root,"peer")),resolveAgent:async partial=>resolvedAs(caps,partial),readEvidence:async()=>Buffer.from("")},{targetRepo:h.root});
    await expect(makeControlledExecution(service,"distinct").preflight({plan:{targetRepo:h.root,tasks:[{taskId:"T1",dependsOn:[]},{taskId:"T2",dependsOn:["T1"]}]},contracts:new Map([["T1",s.w1.contract],["T2",s.w2.contract]])} as never)).resolves.toBeUndefined();
   }finally{await h.dispose();}
  });
````

`tests/control/handoffTransaction.test.ts`：

````diff
diff --git a/tests/control/handoffTransaction.test.ts b/tests/control/handoffTransaction.test.ts
index bb6f020..66771b3 100644
--- a/tests/control/handoffTransaction.test.ts
+++ b/tests/control/handoffTransaction.test.ts
@@ -14,7 +14,7 @@ import { fakePeer } from "./fixtures/peer.js";
 import { openTestStore,seedBudgetCase,amount } from "./fixtures/store.js";
 
 describe("handoff transaction",{timeout:30000},()=>{
-  async function started(h:Awaited<ReturnType<typeof openTestStore>>,s:ReturnType<typeof seedBudgetCase>,parent:ReturnType<typeof claimWork>,peer:ReturnType<typeof fakePeer>){const sourceDir=join(h.root,"runs",parent.runId);await mkdir(sourceDir,{recursive:true});await startClaim(h.store,peer,{protocol:1,claim:parent,contractHash:hashPayload(s.w1.contract),inputCheckpoint:null,work:{contract:s.w1.contract,targetRepo:h.root,base:"HEAD",sourceDir}});}
+  async function started(h:Awaited<ReturnType<typeof openTestStore>>,s:ReturnType<typeof seedBudgetCase>,parent:ReturnType<typeof claimWork>,peer:ReturnType<typeof fakePeer>){const sourceDir=join(h.root,"runs",parent.runId);await mkdir(sourceDir,{recursive:true});await startClaim(h.store,peer,{protocol:2,claim:parent,contractHash:hashPayload(s.w1.contract),inputCheckpoint:null,work:{contract:s.w1.contract,targetRepo:h.root,base:"HEAD",sourceDir}});}
   it("persists one immutable request intent before RPC and retries the same request",async()=>{
     const h=await openTestStore();try{const s=seedBudgetCase(h.store),parent=claimWork(h.store,s.t1Claim);
       const basePeer=fakePeer(join(h.root,"peer"));await started(h,s,parent,basePeer);
@@ -42,7 +42,7 @@ describe("handoff transaction",{timeout:30000},()=>{
     const h=await candidateCase();try{
       const parentWork=readWork(h.store,"g1","T1"),{targetVersion:_targetVersion,status:_status,...workInput}=parentWork;putWork(h.store,"g1",{...workInput,workItemId:"handoff-T1",kind:"handoff",parentRunId:h.claim.runId,grant:{work:amount(0,0,0,0),handoff:parentWork.grant.handoff}},{commandId:"register-proven-handoff",expectedRevision:3,by:"service"});
       const before=getGroup(h.store,"g1").reserved.tokens,raw={...h.candidate,snapshot:null};
-      const port={...fakePeer(join(h.root,"peer")),capabilities:async()=>((await import("./fixtures/store.js")).caps),requestHandoff:async()=>({kind:"complete" as const,requestId:"proven",checkpointId:raw.checkpointId}),collect:async()=>({events:[],candidate:raw,terminal:{outcome:"succeeded" as const,attemptSha:null,sourceDir:h.sourceDir,repoDir:h.repoDir}}),readEvidence:(ref:typeof raw.handoff)=>readArtifact(h.store,ref)};
+      const port={...fakePeer(join(h.root,"peer")),resolveAgent:async()=>{const fixtures=await import("./fixtures/store.js");return fixtures.resolvedAs(fixtures.caps);},requestHandoff:async()=>({kind:"complete" as const,requestId:"proven",checkpointId:raw.checkpointId}),collect:async()=>({events:[],candidate:raw,terminal:{outcome:"succeeded" as const,attemptSha:null,sourceDir:h.sourceDir,repoDir:h.repoDir}}),readEvidence:(ref:typeof raw.handoff)=>readArtifact(h.store,ref)};
       await new ControlService(h.store,port).requestHandoff("g1",h.claim.runId,{requestId:"proven",reason:"context",deadlineAt:"2030-01-01T00:00:00Z"});
       expect(getRun(h.store,h.claim.runId)).toMatchObject({state:"settled",checkpointId:"cp1",recoverable:true});expect(getGroup(h.store,"g1").reserved.tokens).toBeLessThan(before);expect(h.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get("handoff-request:"+h.claim.runId)?.delivered).toBe(1);
     }finally{await h.dispose();}
````

`tests/control/schedulerBridge.test.ts`：

````diff
diff --git a/tests/control/schedulerBridge.test.ts b/tests/control/schedulerBridge.test.ts
index a5bf773..92d4c89 100644
--- a/tests/control/schedulerBridge.test.ts
+++ b/tests/control/schedulerBridge.test.ts
@@ -36,13 +36,13 @@ it("checks execution capabilities before reading or mutating the prepared target
 
 it("reserves reconciliation once from remaining group budget and refuses stopped groups",async()=>{
  const {ControlService}=await import("../../src/control/service.js");
- const {openTestStore,seedBudgetCase,caps,amount}=await import("./fixtures/store.js");
+ const {openTestStore,seedBudgetCase,caps,amount,resolvedAs}=await import("./fixtures/store.js");
  const {claimWork}=await import("../../src/control/budget.js");
  const {getGroup}=await import("../../src/control/queries.js");
  const {setGroupStopped}=await import("../../src/control/commands.js");
  const h=await openTestStore();try{
   const seeded=seedBudgetCase(h.store);claimWork(h.store,seeded.t1Claim);
-  const service=new ControlService(h.store,{capabilities:async()=>caps} as never,{reconcileGrant:{work:amount(7,500,1,1),handoff:amount(2,50,0,0)}});
+  const service=new ControlService(h.store,{resolveAgent:async()=>resolvedAs(caps)} as never,{reconcileGrant:{work:amount(7,500,1,1),handoff:amount(2,50,0,0)}});
   const first=await service.reconcileBudget("g1","T1");
   expect(first.tokenBudget).toBe(7);expect(first.totalRuntimeBudgetMs).toBe(500);
   const reserved=getGroup(h.store,"g1").reserved;
@@ -59,10 +59,10 @@ it("reserves reconciliation once from remaining group budget and refuses stopped
 // shape this test pinned before.
 it("gets capabilities from the peer before a service claim",async()=>{
  const {ControlService}=await import("../../src/control/service.js");
- const {openTestStore,seedBudgetCase,caps}=await import("./fixtures/store.js");
+ const {openTestStore,seedBudgetCase,caps,resolvedAs}=await import("./fixtures/store.js");
  const h=await openTestStore();try{
   seedBudgetCase(h.store);
-  const service=new ControlService(h.store,{capabilities:async()=>({...caps,handoffExecution:null})} as never);
+  const service=new ControlService(h.store,{resolveAgent:async()=>resolvedAs({...caps,handoffExecution:null})} as never);
   await expect(service.claim("g1","T1")).rejects.toThrow("control-capability-unsupported");
   expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
  }finally{await h.dispose();}
@@ -73,7 +73,7 @@ it.each(["success","budget","stopped","crash"])("runs a real conflicting graph t
  const {makeControlledExecution}=await import("../../src/control/schedulerBridge.js");
  const {runPreparedRound,loadRound}=await import("../../src/scheduler/run.js");
  const {seedLyingPlan,showFileAt}=await import("../scheduler/sandbox.js");
- const {openTestStore,amount}=await import("./fixtures/store.js");
+ const {openTestStore,amount,fixtureAgent}=await import("./fixtures/store.js");
  const {roundPeer}=await import("./fixtures/roundPeer.js");
  const {createGroup,putWork}=await import("../../src/control/commands.js");
  const {getGroup,readWork}=await import("../../src/control/queries.js");
@@ -83,7 +83,7 @@ it.each(["success","budget","stopped","crash"])("runs a real conflicting graph t
   const p=await seedLyingPlan(s),loaded=await loadRound(p.planPath);if("rejections" in loaded)throw new Error(JSON.stringify(loaded));
   createGroup(h.store,{groupId:"g",projectKey:"offline/project",goal:"both changes",successConditions:["checks"],limit:amount(100,100000,10,10),reviewReserve:amount(10,100,1,1),deadlineAt:null},{commandId:"g",expectedRevision:0,by:"human"});
   let revision=1;
-  for(const task of loaded.round.plan.tasks)putWork(h.store,"g",{workItemId:task.taskId,taskId:task.taskId,kind:"task",dependsOn:task.dependsOn,contract:loaded.round.contracts.get(task.taskId),configHash:"offline",grant:{work:amount(35,20000,1,1),handoff:amount(5,100,0,0)}},{commandId:task.taskId,expectedRevision:revision++,by:"human"});
+  for(const task of loaded.round.plan.tasks)putWork(h.store,"g",{workItemId:task.taskId,taskId:task.taskId,kind:"task",dependsOn:task.dependsOn,contract:loaded.round.contracts.get(task.taskId),configHash:"offline",agent:fixtureAgent,grant:{work:amount(35,20000,1,1),handoff:amount(5,100,0,0)}},{commandId:task.taskId,expectedRevision:revision++,by:"human"});
   const service=new ControlService(h.store,roundPeer(join(h.root,"peer")),{targetRepo:s.targetRepo,reconcileGrant:{work:amount(mode==="budget"?0:7,500,1,1),handoff:amount(1,50,0,0)}});
   const messages:string[]=[];
   const execution=makeControlledExecution(service,"g");
````

`tests/control/endToEnd.test.ts`：

````diff
diff --git a/tests/control/endToEnd.test.ts b/tests/control/endToEnd.test.ts
index e30e1e9..fa085d2 100644
--- a/tests/control/endToEnd.test.ts
+++ b/tests/control/endToEnd.test.ts
@@ -76,13 +76,13 @@ it("blocks recovery of a missing current checkpoint instead of selecting an olde
 // (handoff latching) that assertCapabilities also happens to check, not a successor to the deleted
 // booleans. The earlier version of this test mutated `handoffControl`, which the
 // `handoffControl!=="durable"` guard clause (budget.ts) also rejects -- so deleting the schema check
-// (`capabilitiesSchema.safeParse`, budget.ts) produced no red here. This version mutates
+// (`capabilitiesSchema.safeParse`, budget.ts; `capabilityViewSchema.safeParse` since agent selection) produced no red here. This version mutates
 // `contextObservation`, a field no guard clause after the schema check reads, so it pins the schema
 // check itself: only `capabilitiesSchema.safeParse` catches a boolean where an enum string is required.
 it("rejects a malformed peer capability answer the guard clauses never read",async()=>{
- const {ControlService}=await import("../../src/control/service.js");const {openTestStore,seedBudgetCase,caps}=await import("./fixtures/store.js");
+ const {ControlService}=await import("../../src/control/service.js");const {openTestStore,seedBudgetCase,caps,resolvedAs}=await import("./fixtures/store.js");
  const h=await openTestStore();try{seedBudgetCase(h.store);
-  const service=new ControlService(h.store,{capabilities:async()=>({...caps,contextObservation:false})} as never);
+  const service=new ControlService(h.store,{resolveAgent:async()=>resolvedAs({...caps,contextObservation:false} as never)} as never);
   await expect(service.claim("g1","T1")).rejects.toThrow("control-capability-unsupported");
   expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
  }finally{await h.dispose();}
````

`tests/control/projectionJournal.test.ts`：

````diff
diff --git a/tests/control/projectionJournal.test.ts b/tests/control/projectionJournal.test.ts
index cb5dc7d..083fb4f 100644
--- a/tests/control/projectionJournal.test.ts
+++ b/tests/control/projectionJournal.test.ts
@@ -103,7 +103,7 @@ describe("projection journal", () => {
 
       const beforeStart = readVersions(h.store, "g1");
       await startClaim(h.store, fakePeer(`${h.root}/accepted-peer`), {
-        protocol: 1,
+        protocol: 2,
         claim,
         contractHash: hashPayload(seeded.w1.contract),
         inputCheckpoint: null,
@@ -123,7 +123,7 @@ describe("projection journal", () => {
       const claim = claimWork(h.store, seeded.t1Claim);
       const before = readVersions(h.store, "g1");
       await expect(startClaim(h.store, fakePeer(`${h.root}/unknown-peer`, "drop"), {
-        protocol: 1,
+        protocol: 2,
         claim,
         contractHash: hashPayload(seeded.w1.contract),
         inputCheckpoint: null,
````

`tests/control/planImport.test.ts`：

````diff
diff --git a/tests/control/planImport.test.ts b/tests/control/planImport.test.ts
index 49437d5..296d515 100644
--- a/tests/control/planImport.test.ts
+++ b/tests/control/planImport.test.ts
@@ -75,7 +75,11 @@ async function setup() {
   // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
   // carries, so the peer's raw answer stays schema-valid and strict-mode-safe.
   const port: ExecutionPort = {
-    capabilities: async () => ({ protocol: 2 as const, ...profile().profile.capabilities }),
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): this port never had a
+    // profile probe (only the retired `capabilities()`), so every router probe of it failed; the probe now asks
+    // listAgents and resolveAgent, and both refuse, which keeps "a real probe failure" what the import is judged against.
+    resolveAgent: async () => { throw new ControlError("control-capability-probe-failed"); },
+    listAgents: async () => { throw new ControlError("control-capability-probe-failed"); },
     readEvidence: async () => Buffer.alloc(0),
     accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
     requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }),
@@ -84,8 +88,8 @@ async function setup() {
   const frozen = resolveProfile(profile(), port);
   const router = createExecutionProfileRouter([frozen]);
   const trustedConfig = createTrustedControlConfig({
-    epoch: "epoch", stateDir: h.store.stateDir, executablePath: binary, adapterConfigPath: adapter,
-    executionPort: "configured" as const,  // Task 4b: a real adapter config is configured here.
+    epoch: "epoch", stateDir: h.store.stateDir, executablePath: binary, agentsTablePath: adapter,
+    executionPort: "configured" as const,  // Task 4b: a real agents table (agent selection spec §6.6) is configured here.
     archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 1_000,
     repositories: [{ repoId: "repo", displayName: "Repo", path: repo }],
     plans: [{ planId: "plan", repoId: "repo", displayName: "Plan", path: planPath }],
````

`tests/panel/controlConfig.test.ts`：

````diff
diff --git a/tests/panel/controlConfig.test.ts b/tests/panel/controlConfig.test.ts
index b7eb1b4..85ff5d4 100644
--- a/tests/panel/controlConfig.test.ts
+++ b/tests/panel/controlConfig.test.ts
@@ -21,10 +21,10 @@ async function setup() {
   const plan = join(plans, "ship.json");
   await writeFile(plan, "{}", { mode: 0o600 });
   const binary = join(root, "ccloop");
-  const adapterConfig = join(root, "adapter.json");
+  const agentsTable = join(root, "agents.json");
   await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
   await chmod(binary, 0o700);
-  await writeFile(adapterConfig, "{}", { mode: 0o600 });
+  await writeFile(agentsTable, "{}", { mode: 0o600 });
 
   const snapshot: ExecutionProfileSnapshotV1 = {
     schema: "orca-execution-profile-snapshot-v1",
@@ -48,23 +48,24 @@ async function setup() {
   // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
   // carries, so the peer's raw answer stays schema-valid.
   const port = {
-    probeProfileCapabilities: async () => ({ ...snapshot.profile.capabilities }),
-    capabilities: async () => ({ protocol: 2 as const, ...snapshot.profile.capabilities }),
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): capabilities protocol 3.
+    resolveAgent: async () => ({ selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" }, configHash: hash("d"), timeoutMs: 1, killGraceMs: 0, capabilities: { ...snapshot.profile.capabilities } }),
+    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
     readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" as const }), inspect: async () => ({ kind: "unknown" as const }),
     requestHandoff: async (_input: never, request: {requestId:string}) => ({ kind: "unknown" as const, requestId: request.requestId }),
     collect: async () => ({ events: [], candidate: null, terminal: null }),
   } as unknown as ExecutionPort;
   const frozen = resolveProfile(snapshot, port);
   const router = createExecutionProfileRouter([frozen]);
-  return { root, repo, plan, binary, adapterConfig, frozen, router };
+  return { root, repo, plan, binary, agentsTable, frozen, router };
 }
 
 describe("trusted panel control config", () => {
   it("resolves only stable repository and plan IDs and never exposes trusted paths", async () => {
     const h = await setup();
     const config = createTrustedControlConfig({
-      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, adapterConfigPath: h.adapterConfig,
-      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
+      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, agentsTablePath: h.agentsTable,
+      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real agents table, so the pair says "configured".
       archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 30_000,
       repositories: [{ repoId: "repo", displayName: "Repo", path: h.repo }],
       plans: [{ planId: "ship", repoId: "repo", displayName: "Ship", path: h.plan }],
@@ -80,7 +81,9 @@ describe("trusted panel control config", () => {
     expect(view.defaults).toEqual({ estimatorProfileId: "estimator", estimatorProfileHash: h.frozen.profileHash, estimateMode: "soft" });
     expect(serialized).not.toContain(h.root);
     expect(serialized).not.toContain("executablePath");
-    expect(serialized).not.toContain("adapterConfigPath");
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the trusted path is the
+    // agents table now (spec §6.6); neither its value nor its field name reaches the view.
+    expect(serialized).not.toContain("agentsTablePath");
   });
 
   it("rejects allowlisted plan escapes and symlinked path components at startup", async () => {
@@ -90,8 +93,8 @@ describe("trusted panel control config", () => {
     const link = join(h.repo, "linked-plan.json");
     await symlink(outside, link);
     const base = {
-      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, adapterConfigPath: h.adapterConfig,
-      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
+      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, agentsTablePath: h.agentsTable,
+      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real agents table, so the pair says "configured".
       archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 30_000,
       repositories: [{ repoId: "repo", displayName: "Repo", path: h.repo }],
       defaultEstimatorProfileId: "estimator", defaultEstimateMode: "soft" as const,
@@ -104,8 +107,8 @@ describe("trusted panel control config", () => {
   it("rejects a plan or ancestor swapped to a symlink after startup", async () => {
     const h = await setup();
     const config = createTrustedControlConfig({
-      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, adapterConfigPath: h.adapterConfig,
-      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
+      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, agentsTablePath: h.agentsTable,
+      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real agents table, so the pair says "configured".
       archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 30_000,
       repositories: [{ repoId: "repo", displayName: "Repo", path: h.repo }],
       plans: [{ planId: "ship", repoId: "repo", displayName: "Ship", path: h.plan }],
@@ -120,8 +123,8 @@ describe("trusted panel control config", () => {
   it("rejects duplicate IDs and invalid trusted executable paths before serving config", async () => {
     const h = await setup();
     const input = {
-      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, adapterConfigPath: h.adapterConfig,
-      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
+      epoch: "epoch-1", stateDir: h.root, executablePath: h.binary, agentsTablePath: h.agentsTable,
+      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real agents table, so the pair says "configured".
       archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 30_000,
       repositories: [{ repoId: "repo", displayName: "Repo", path: h.repo }, { repoId: "repo", displayName: "Again", path: h.repo }],
       plans: [{ planId: "ship", repoId: "repo", displayName: "Ship", path: h.plan }],
````

`tests/panel/controlConfigPort.test.ts`：

````diff
diff --git a/tests/panel/controlConfigPort.test.ts b/tests/panel/controlConfigPort.test.ts
index 220bf1c..d688fb9 100644
--- a/tests/panel/controlConfigPort.test.ts
+++ b/tests/panel/controlConfigPort.test.ts
@@ -44,13 +44,13 @@ async function setup() {
   const plan = join(repo, "ship.json");
   await writeFile(plan, "{}", { mode: 0o600 });
   const binary = join(root, "ccloop");
-  const adapterConfig = join(root, "adapter.json");
+  const agentsTable = join(root, "agents.json");
   await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
   await chmod(binary, 0o700);
-  await writeFile(adapterConfig, "{}", { mode: 0o600 });
+  await writeFile(agentsTable, "{}", { mode: 0o600 });
   const router = (port: ExecutionPort) => createExecutionProfileRouter([resolveProfile(snapshot(), port)]);
   const base = (over: Partial<TrustedControlConfigInput> = {}): TrustedControlConfigInput => ({
-    epoch: "epoch-1", stateDir: root, executablePath: binary, adapterConfigPath: adapterConfig,
+    epoch: "epoch-1", stateDir: root, executablePath: binary, agentsTablePath: agentsTable,
     executionPort: "configured", archiveRoot: root, exportRoot: root, evidenceRoot: root, shutdownGraceMs: 30_000,
     repositories: [{ repoId: "repo", displayName: "Repo", path: repo }],
     plans: [{ planId: "ship", repoId: "repo", displayName: "Ship", path: plan }],
@@ -61,18 +61,19 @@ async function setup() {
   // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
   // carries, so the peer's raw answer stays schema-valid.
   const capablePort = {
-    probeProfileCapabilities: async () => ({ ...snapshot().profile.capabilities }),
-    capabilities: async () => ({ protocol: 2 as const, ...snapshot().profile.capabilities }),
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): capabilities protocol 3.
+    resolveAgent: async () => ({ selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" }, configHash: "d".repeat(64), timeoutMs: 1, killGraceMs: 0, capabilities: { ...snapshot().profile.capabilities } }),
+    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
     readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
     requestHandoff: async () => ({ kind: "unknown" }), collect: async () => ({ events: [], candidate: null, terminal: null }),
   } as unknown as ExecutionPort;
-  return { root, repo, plan, binary, adapterConfig, router, base, capablePort };
+  return { root, repo, plan, binary, agentsTable, router, base, capablePort };
 }
 
 describe("the served config states whether an execution port is configured", () => {
   it("serves \"unconfigured\" when the panel was started without one", async () => {
     const h = await setup();
-    const config = createTrustedControlConfig(h.base({ executionPort: "unconfigured", adapterConfigPath: null }), h.router(createUnconfiguredControlPort()));
+    const config = createTrustedControlConfig(h.base({ executionPort: "unconfigured", agentsTablePath: null }), h.router(createUnconfiguredControlPort()));
     // Parsed by the protocol schema rather than read off the input object: an input that is never
     // copied into the view would pass an assertion made against the input.
     const view = controlConfigSchema.parse(await config.readView());
@@ -90,7 +91,8 @@ describe("the served config states whether an execution port is configured", ()
     // have a port configured -- an implementation that derived the field from probeFailureCode would
     // answer "unconfigured" and this criterion would catch it.
     const h = await setup();
-    const failing = { ...h.capablePort, probeProfileCapabilities: async () => { throw new ControlError("control-capability-probe-failed"); } } as ExecutionPort;
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the failing probe is resolveAgent.
+    const failing = { ...h.capablePort, resolveAgent: async () => { throw new ControlError("control-capability-probe-failed"); } } as ExecutionPort;
     const view = controlConfigSchema.parse(await createTrustedControlConfig(h.base(), h.router(failing)).readView());
     expect(view.profiles[0]!.probeFailureCode).toBe("control-capability-probe-failed");
     expect(view.executionPort).toBe("configured");
@@ -118,17 +120,20 @@ describe("the two pairs cannot disagree", () => {
     try { fn(); return "<built>"; } catch (error) { return error instanceof ControlError ? String(error.detail) : String(error); }
   };
 
-  it("refuses a configured port with no adapter config", async () => {
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the pair is port + agents
+  // table now (spec §6.6), and the refinement is named for it.
+  it("refuses a configured port with no agents table", async () => {
     const h = await setup();
-    expect(detail(() => createTrustedControlConfig(h.base({ executionPort: "configured", adapterConfigPath: null }), h.router(h.capablePort))))
-      .toBe("execution-port-adapter-config-mismatch");
+    expect(detail(() => createTrustedControlConfig(h.base({ executionPort: "configured", agentsTablePath: null }), h.router(h.capablePort))))
+      .toBe("execution-port-agents-table-mismatch");
   });
 
   it("refuses an unconfigured port that still carries one, which is the other direction", async () => {
     // Asserted separately from the case above: one refinement passing says nothing about the other.
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): same pair, renamed refinement.
     const h = await setup();
     expect(detail(() => createTrustedControlConfig(h.base({ executionPort: "unconfigured" }), h.router(createUnconfiguredControlPort()))))
-      .toBe("execution-port-adapter-config-mismatch");
+      .toBe("execution-port-agents-table-mismatch");
   });
 
   it("refuses half an estimator in both directions", async () => {
````

`tests/panel/controlReadApi.test.ts`：

````diff
diff --git a/tests/panel/controlReadApi.test.ts b/tests/panel/controlReadApi.test.ts
index 8f5ab80..8bbbdfd 100644
--- a/tests/panel/controlReadApi.test.ts
+++ b/tests/panel/controlReadApi.test.ts
@@ -95,16 +95,17 @@ async function setup(): Promise<Harness> {
   // answers the v2 vocabulary, spread from the same declared capabilities the profile snapshot
   // carries, so the peer's raw answer stays schema-valid and strict-mode-safe.
   const port: ExecutionPort = {
-    probeProfileCapabilities: async () => snapshot.profile.capabilities,
-    capabilities: async () => ({ protocol: 2 as const, ...snapshot.profile.capabilities }),
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): capabilities protocol 3.
+    resolveAgent: async (partial) => ({ selection: { agent: "codex", model: "fixture-model", contextWindow: "agent-default", ...partial }, configHash: hash("d"), timeoutMs: 1, killGraceMs: 0, capabilities: snapshot.profile.capabilities }),
+    listAgents: async () => ({ installations: [{ id: "codex", kind: "codex", defaults: { model: "fixture-model", contextWindow: "agent-default" as const }, contextOptions: ["agent-default" as const], version: "0.0.0-fixture" }] }),
     readEvidence: async () => Buffer.alloc(0), accept: async () => ({ kind: "unknown" }), inspect: async () => ({ kind: "unknown" }),
     requestHandoff: async (_input, request) => ({ kind: "unknown", requestId: request.requestId }), collect: async () => ({ events: [], candidate: null, terminal: null }),
   };
   const frozen = resolveProfile(snapshot, port);
   const router = createExecutionProfileRouter([frozen], { now: () => new Date("2030-01-01T00:00:00.000Z") });
   const trustedConfig = createTrustedControlConfig({
-    epoch: "epoch-test", stateDir: h.store.stateDir, executablePath: binary, adapterConfigPath: adapter,
-      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real adapter config, so the pair says "configured".
+    epoch: "epoch-test", stateDir: h.store.stateDir, executablePath: binary, agentsTablePath: adapter,
+      executionPort: "configured" as const,  // Task 4b: these fixtures configure a real agents table, so the pair says "configured".
     archiveRoot: h.root, exportRoot: h.root, evidenceRoot: h.root, shutdownGraceMs: 1_000,
     repositories: [{ repoId: "repo", displayName: "Repo", path: repo }],
     plans: [{ planId: "plan", repoId: "repo", displayName: "Plan", path: planPath }],
````


  跑上面每个文件（逐个）⇒ Expected 全部 rc=0。`schedulerBridge.test.ts` 的「runs a real conflicting graph…」四条要找到 ccloop 的 build（`tests/scheduler/sandbox.ts:95` 读 `ORCA_CCLOOP_BIN` 或兄弟目录），在主树里天然满足；副本里靠 `scratchpad/W4/ccloop` 软链到主 ccloop。

- [ ] **Step 7: `ORCA_AGENTS_TABLE`、handoff 宽限、解冲突 run 走 `--agents`（RED → GREEN）**
  先写判据：`driverHandoff.test.ts` 新增「宽限＝run 的 agent 的 killGraceMs＋固定一分钟」、`driverReconcile.test.ts` 新增「以 `--agents <table> --agent-selection <file>` 起解冲突，文件 0600、内容为冻结选择＋configHash」（T7 桥：被冲突 run 自己的；T12 改为组的 reconcile 槽）、`assemblyHandoffGrace.test.ts` 整条改写、`controlOptions`／`controlAssemblyDriver`／web banner 改变量名；替身 `fake-ccloop-run.mjs` 改收新形态、拒 `--adapter`：

`tests/control/driverHandoff.test.ts`：

````diff
diff --git a/tests/control/driverHandoff.test.ts b/tests/control/driverHandoff.test.ts
index 6620bb6..f1b69f5 100644
--- a/tests/control/driverHandoff.test.ts
+++ b/tests/control/driverHandoff.test.ts
@@ -270,6 +270,28 @@ describe("nothing arrives (spec §3 grace, §11 I3)", { timeout: 60_000 }, () =>
   });
 });
 
+describe("the grace is the run's own agent killGraceMs plus the fixed minute (spec §3; agent selection spec §6.6)", { timeout: 60_000 }, () => {
+  it("does not call a request outcome-unknown before the killGraceMs ccloop answers for the run's selection has passed", async () => {
+    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable-silent", killGraceMs: 5_000 }); try {
+      const runId = await t.claim();
+      let now = Date.now();
+      const driver = createExecutionDriver({ ...t.deps, now: () => new Date(now) });
+      await t.until(driver, () => t.body(runId).state === "accepted");
+      const [requestId] = await stop(t);
+      await t.until(driver, () => requestState(t, requestId!) === "collecting");
+      const deadline = Date.parse(readHandoffRequest(t.h.store, "g", requestId!).request.deadlineAt);
+      now = deadline + HANDOFF_EXTRA_GRACE_MS + 1;
+      await driver.round();
+      expect(requestState(t, requestId!)).toBe("collecting");
+      now = deadline + HANDOFF_EXTRA_GRACE_MS + 5_000;
+      await driver.round();
+      expect(requestState(t, requestId!)).toBe("collecting");
+      now = deadline + HANDOFF_EXTRA_GRACE_MS + 5_001;
+      await t.until(driver, () => requestState(t, requestId!) === "outcome-unknown");
+    } finally { await t.h.dispose(); }
+  });
+});
+
 describe("blocked runs under a stop (spec §11 I1, §13.1 C-5, §13.2 I-3; H8)", { timeout: 60_000 }, () => {
   it("closes a run blocked after its execution ended from its collected result, beside a running run", async () => {
     const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { behaviour: (id) => id === "a" ? "exhausted" : "stoppable" }); try {
@@ -386,7 +408,7 @@ describe("a landing whose worktree removal failed after the swap (controller rul
     const t = await driverHarness([{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }],
       { files: (id) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" }) }); try {
       // As tests/control/driverReconcile.test.ts's `twoConflicting`: a reconciliation that succeeds, and a group that can afford it.
-      await writeFile(t.deps.adapterConfigPath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
+      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
       const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
       const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens + 10_000_000 } }));
       if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
````

`tests/control/driverReconcile.test.ts`：

````diff
diff --git a/tests/control/driverReconcile.test.ts b/tests/control/driverReconcile.test.ts
index 53bd297..44022fb 100644
--- a/tests/control/driverReconcile.test.ts
+++ b/tests/control/driverReconcile.test.ts
@@ -30,7 +30,7 @@ async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean,
 
 async function twoConflicting(reconcile: { files: Record<string, string>; status?: string; spent?: number; holdMs?: number }, affordable = true) {
   const t = await driverHarness(conflicting, { files });
-  await writeFile(t.deps.adapterConfigPath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
+  await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
   if (affordable) {
     // Deviation D12: by default the group's reserve (20% of base) is smaller than one task's token
     // budget, so a reconciliation is refused until another run settles. Raise the ceiling explicitly.
@@ -39,7 +39,7 @@ async function twoConflicting(reconcile: { files: Record<string, string>; status
     if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
   }
   const ids = [await t.claim(), await t.claim()];
-  const spawns = () => existsSync(`${t.deps.adapterConfigPath}.runs`) ? readFileSync(`${t.deps.adapterConfigPath}.runs`, "utf8").trim().split("\n") : [];
+  const spawns = () => existsSync(`${t.deps.agentsTablePath}.runs`) ? readFileSync(`${t.deps.agentsTablePath}.runs`, "utf8").trim().split("\n") : [];
   return { ...t, ids, spawns };
 }
 
@@ -64,6 +64,19 @@ describe("reconciling a conflict (spec §5.3)", { timeout: 30_000 }, () => {
     } finally { await t.h.dispose(); }
   });
 
+  it("spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding a frozen selection with its configHash (agent selection spec §4.9)", async () => {
+    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }); try {
+      const driver = t.driver();
+      await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
+      expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
+      const reconciled = t.ids.find((id) => t.body(id).drive.reconcile !== null)!;
+      const selections = readFileSync(`${t.deps.agentsTablePath}.selections`, "utf8").trim().split("\n").map((line) => JSON.parse(line));
+      // Plan T7 bridge: the conflicted run's own frozen selection and configHash (plan T12 moves this to the group's reconcile slot).
+      expect(selections).toEqual([{ selection: { selection: t.body(reconciled).agent, configHash: t.body(reconciled).configHash }, mode: 0o600 }]);
+      expect(t.body(reconciled).agent).toEqual({ agent: "codex", model: "fixture-model", contextWindow: "agent-default" });
+    } finally { await t.h.dispose(); }
+  });
+
   it("books the reconciliation's spend on the group once, and the ledger still conserves", async () => {
     const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" }, spent: 7 }); try {
       const driver = t.driver();
@@ -251,7 +264,7 @@ describe("a person's retry of a run blocked at R (final review I4)", { timeout:
       const runId = t.ids.find((id) => t.body(id).state === "blocked")!;
       expect(t.body(runId).drive.blockedReason).toBe("reconcile-terminal:failed");
       expect(bookings(t)).toHaveLength(1);
-      await writeFile(t.deps.adapterConfigPath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
+      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
       const retried = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
       expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
       await untilDeadline(driver, () => t.ids.every((id) => LANDED.includes(t.body(id).state)));
````

`tests/control/driverReconcileN.test.ts`：

````diff
diff --git a/tests/control/driverReconcileN.test.ts b/tests/control/driverReconcileN.test.ts
index 66f2b2a..21c2f99 100644
--- a/tests/control/driverReconcileN.test.ts
+++ b/tests/control/driverReconcileN.test.ts
@@ -27,13 +27,13 @@ async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean,
 
 async function harness(tasks: readonly WebFixtureTask[], files: (id: string) => Record<string, string>, reconcile: { files: Record<string, string>; holdMs?: number }) {
   const t = await driverHarness(tasks, { files });
-  await writeFile(t.deps.adapterConfigPath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
+  await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, ...reconcile }));
   // Deviation D12: by default the group's reserve (20% of base) is smaller than one task's token budget,
   // so a reconciliation is refused until another run settles. Raise the ceiling explicitly.
   const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
   const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens + 10_000_000 } }));
   if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
-  const spawns = () => existsSync(`${t.deps.adapterConfigPath}.runs`) ? readFileSync(`${t.deps.adapterConfigPath}.runs`, "utf8").trim().split("\n") : [];
+  const spawns = () => existsSync(`${t.deps.agentsTablePath}.runs`) ? readFileSync(`${t.deps.agentsTablePath}.runs`, "utf8").trim().split("\n") : [];
   const bookings = () => (t.h.store.db.prepare("SELECT id FROM outbox WHERE kind='reconcile-usage' ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
   const taskOf = (runId: string): string => t.body(runId).taskId;
   return { ...t, spawns, bookings, taskOf };
````

`tests/control/blockedStaysPut.test.ts`：

````diff
diff --git a/tests/control/blockedStaysPut.test.ts b/tests/control/blockedStaysPut.test.ts
index 2f0c23c..79b7f57 100644
--- a/tests/control/blockedStaysPut.test.ts
+++ b/tests/control/blockedStaysPut.test.ts
@@ -103,7 +103,7 @@ describe("a blocked run keeps the step it was blocked at through a later error (
       expect(t.body(parked)).toMatchObject({ state: "collected", drive: { landedCommit: null } });
       // From D the run tries its landing again; the conflict's reconciliation (scripted to fail, so nothing lands)
       // runs in its own process, so rounds are paced by the clock until the request closes.
-      await writeFile(t.deps.adapterConfigPath, JSON.stringify({ status: "failed", spent: 1, holdMs: 0, files: {} }));
+      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "failed", spent: 1, holdMs: 0, files: {} }));
       const after: Array<[string, string | null]> = [];
       const deadline = Date.now() + 30_000;
       while (Date.now() < deadline && requestState(t, requestOf(t, parked)) === "request-pending") {
````

`tests/control/fixtures/fake-ccloop-run.mjs`：

````diff
diff --git a/tests/control/fixtures/fake-ccloop-run.mjs b/tests/control/fixtures/fake-ccloop-run.mjs
index 115442c..982ec8d 100644
--- a/tests/control/fixtures/fake-ccloop-run.mjs
+++ b/tests/control/fixtures/fake-ccloop-run.mjs
@@ -2,18 +2,30 @@
 // spec §5.3). It does exactly what runTask observes of the real one: it commits the scripted files in
 // the contract's repoPath (runTask's clone of the conflict copy), publishes
 // refs/ccloop/<basename of --run-dir>/attempts/1 there, and writes <run-dir>/loop-state.json.
-// Each invocation appends "<run id> <pid>" to <adapter config>.runs, so a criterion can count spawns.
+// Each invocation appends "<run id> <pid>" to <agents table>.runs, so a criterion can count spawns.
+//
+// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): it is spawned in the
+// `--agents <table> --agent-selection <file>` form (agent selection spec §4.9) and refuses the retired
+// `--adapter` form by name, so a reconciliation that fell back to it would fail rather than pass. The script
+// lives where the table would; each spawn also appends the selection file's bytes and its mode, as one JSON
+// line, to <agents table>.selections.
 import { execFileSync } from "node:child_process";
-import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
+import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
 import { basename, join } from "node:path";
 
 const argv = process.argv.slice(2);
+if (argv.includes("--adapter") || argv.includes("--adapter-config")) {
+  process.stderr.write("fake-ccloop-run: the --adapter form is retired for the driver's reconciliation\n");
+  process.exit(64);
+}
 const flag = (name) => argv[argv.indexOf(name) + 1];
-const configPath = flag("--adapter-config");
+const configPath = flag("--agents");
+const selectionPath = flag("--agent-selection");
 const contract = JSON.parse(readFileSync(flag("--contract"), "utf8"));
 const config = JSON.parse(readFileSync(configPath, "utf8"));
 const runDir = flag("--run-dir");
 appendFileSync(`${configPath}.runs`, `${basename(runDir)} ${process.pid}\n`);
+appendFileSync(`${configPath}.selections`, `${JSON.stringify({ selection: JSON.parse(readFileSync(selectionPath, "utf8")), mode: statSync(selectionPath).mode & 0o777 })}\n`);
 
 function finish() {
   const repo = contract.context.repoPath;
````

`tests/control/fixtures/driverHarness.ts`：

````diff
diff --git a/tests/control/fixtures/driverHarness.ts b/tests/control/fixtures/driverHarness.ts
index 86849a2..e9156b0 100644
--- a/tests/control/fixtures/driverHarness.ts
+++ b/tests/control/fixtures/driverHarness.ts
@@ -22,6 +22,8 @@ export interface HarnessOptions {
   delayAccept?: () => Promise<void>;
   workTokens?: (workItemId: string) => number;
   duringCollect?: () => Promise<void>;
+  /** Agent selection: the killGraceMs the synthetic ccloop answers for every selection. */
+  killGraceMs?: number;
 }
 
 /**
@@ -42,12 +44,12 @@ export async function driverHarness(tasks: readonly WebFixtureTask[], options: H
   const fake = fakeCcloopPort({
     capabilities: snapshot.profile.capabilities, behaviour: options.behaviour ?? (() => "succeed"),
     files: options.files ?? ((id) => ({ [id]: `${id}\n` })), delayAccept: options.delayAccept,
-    workTokens: options.workTokens, duringCollect: options.duringCollect,
+    workTokens: options.workTokens, duringCollect: options.duringCollect, killGraceMs: options.killGraceMs,
   });
   const deps: ExecutionDriverDeps = {
     store: h.store, router: createExecutionProfileRouter([resolveProfile(snapshot, fake.port)]), admissionGate: h.deps.admissionGate,
     roots: controlWorkspaceRoots(h.store.stateDir), resolveRepository: () => repo,
-    ccloopBin: FAKE_CCLOOP_RUN, adapterConfigPath: join(h.root, "reconcile-adapter.json"),
+    ccloopBin: FAKE_CCLOOP_RUN, agentsTablePath: join(h.root, "reconcile-agents.json"),
   };
   const dispatch = { store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate };
   /** A fresh start command and its delivery: one more claimed run. */
````

`tests/panel/assemblyHandoffGrace.test.ts`：

````diff
diff --git a/tests/panel/assemblyHandoffGrace.test.ts b/tests/panel/assemblyHandoffGrace.test.ts
index 140ea93..050228d 100644
--- a/tests/panel/assemblyHandoffGrace.test.ts
+++ b/tests/panel/assemblyHandoffGrace.test.ts
@@ -1,34 +1,34 @@
-import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
-import { tmpdir } from "node:os";
-import { join } from "node:path";
-import { afterEach, describe, expect, it } from "vitest";
-import { HANDOFF_EXTRA_GRACE_MS } from "../../src/control/driverHandoff.js";
-import { handoffGraceMsOf } from "../../src/panel/controlAssembly.js";
+import { describe, expect, it } from "vitest";
+import { HANDOFF_EXTRA_GRACE_MS, handoffGraceMsOf } from "../../src/control/driverHandoff.js";
+import type { ExecutionPort } from "../../src/control/executionPort.js";
+import type { PartialSelection } from "../../src/control/agentSelection.js";
 
 // Handoff delivery spec §3 (controller decision) and §10: a delivered request that yields nothing turns
-// outcome-unknown only past deadline + the adapter's killGraceMs + 60 s. ccloop itself waits killGraceMs
+// outcome-unknown only past deadline + the agent's killGraceMs + 60 s. ccloop itself waits killGraceMs
 // before it kills a phase, so a grace shorter than that would call a stop "unknown" while ccloop is still
 // legitimately finishing it. The wiring into the running driver is measured by handoffE2E.test.ts (G).
-const roots: string[] = [];
-afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
-
-async function config(text: string | null): Promise<string> {
-  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-assembly-grace-")));
-  roots.push(root);
-  const path = join(root, "adapter.json");
-  if (text !== null) await writeFile(path, text, { mode: 0o600 });
-  return path;
-}
+//
+// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the killGraceMs is the one
+// ccloop answers for the run's frozen selection (capabilities protocol 3, spec §6.6) -- Orca no longer reads a
+// config file for it -- and the same floor holds: never shorter than the fixed part, whatever the answer.
+const answering = (killGraceMs: unknown, asked: PartialSelection[] = []): Pick<ExecutionPort, "resolveAgent"> => ({
+  resolveAgent: async (partial) => {
+    asked.push(partial);
+    return { selection: { agent: "codex", model: "m", contextWindow: "agent-default" }, configHash: "c".repeat(64), timeoutMs: 1, killGraceMs: killGraceMs as number, capabilities: {} as never };
+  },
+});
 
-describe("the handoff grace the assembly hands the driver (spec §3)", () => {
-  it("is the adapter's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable", async () => {
+describe("the handoff grace the driver waits (spec §3)", () => {
+  it("is the agent's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable", async () => {
     expect(HANDOFF_EXTRA_GRACE_MS).toBe(60_000);
-    expect(handoffGraceMsOf(await config(JSON.stringify({ command: ["codex"], killGraceMs: 5_000 })))).toBe(65_000);
-    expect(handoffGraceMsOf(await config(JSON.stringify({ killGraceMs: 0 })))).toBe(60_000);
-    // Never shorter than the fixed part, whatever the file says or fails to say.
-    for (const text of [JSON.stringify({}), JSON.stringify({ killGraceMs: -1 }), JSON.stringify({ killGraceMs: 1.5 }),
-      JSON.stringify({ killGraceMs: "5000" }), "null", "not json", null]) {
-      expect(handoffGraceMsOf(await config(text))).toBe(60_000);
+    const asked: PartialSelection[] = [];
+    expect(await handoffGraceMsOf(answering(5_000, asked), { agent: "claude", model: "claude-opus-5-5" })).toBe(65_000);
+    expect(asked).toEqual([{ agent: "claude", model: "claude-opus-5-5" }]);
+    expect(await handoffGraceMsOf(answering(0), { agent: "codex" })).toBe(60_000);
+    // Never shorter than the fixed part, whatever the peer says or fails to say.
+    for (const value of [-1, 1.5, "5000", null, undefined]) {
+      expect(await handoffGraceMsOf(answering(value), { agent: "codex" })).toBe(60_000);
     }
+    expect(await handoffGraceMsOf({ resolveAgent: async () => { throw new Error("offline"); } }, { agent: "codex" })).toBe(60_000);
   });
 });
````

`tests/panel/controlOptions.test.ts`：

````diff
diff --git a/tests/panel/controlOptions.test.ts b/tests/panel/controlOptions.test.ts
index 1b66b97..cdad520 100644
--- a/tests/panel/controlOptions.test.ts
+++ b/tests/panel/controlOptions.test.ts
@@ -163,14 +163,17 @@ describe("resolveControlOptions reports whether an execution port is configured"
     expect(withEnv({}).executionPort).toBe("unconfigured");
   });
 
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the second variable is
+  // ORCA_AGENTS_TABLE (spec §6.6), and the retired ORCA_CCLOOP_ADAPTER_CONFIG configures nothing any more.
   it("needs both variables, not either one", () => {
     expect(withEnv({ ORCA_CCLOOP_BIN: "/bin/ccloop" }).executionPort).toBe("unconfigured");
-    expect(withEnv({ ORCA_CCLOOP_ADAPTER_CONFIG: "/etc/adapter.json" }).executionPort).toBe("unconfigured");
+    expect(withEnv({ ORCA_AGENTS_TABLE: "/etc/agents.json" }).executionPort).toBe("unconfigured");
+    expect(withEnv({ ORCA_CCLOOP_BIN: "/bin/ccloop", ORCA_CCLOOP_ADAPTER_CONFIG: "/etc/adapter.json" }).executionPort).toBe("unconfigured");
   });
 
   it("calls the port configured only when both are set and non-empty", () => {
-    expect(withEnv({ ORCA_CCLOOP_BIN: "/bin/ccloop", ORCA_CCLOOP_ADAPTER_CONFIG: "/etc/adapter.json" }).executionPort).toBe("configured");
-    expect(withEnv({ ORCA_CCLOOP_BIN: "", ORCA_CCLOOP_ADAPTER_CONFIG: "/etc/adapter.json" }).executionPort).toBe("unconfigured");
+    expect(withEnv({ ORCA_CCLOOP_BIN: "/bin/ccloop", ORCA_AGENTS_TABLE: "/etc/agents.json" }).executionPort).toBe("configured");
+    expect(withEnv({ ORCA_CCLOOP_BIN: "", ORCA_AGENTS_TABLE: "/etc/agents.json" }).executionPort).toBe("unconfigured");
   });
 
   it("does not let a missing port become a boot rejection, which is the whole of ruling R5", () => {
````

`tests/panel/controlAssemblyDriver.test.ts`：

````diff
diff --git a/tests/panel/controlAssemblyDriver.test.ts b/tests/panel/controlAssemblyDriver.test.ts
index 61b757d..570c37d 100644
--- a/tests/panel/controlAssemblyDriver.test.ts
+++ b/tests/panel/controlAssemblyDriver.test.ts
@@ -22,9 +22,11 @@ async function assembled(configured: boolean) {
     const binary = join(root, "ccloop");
     await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary);
     await chmod(binary, 0o700);
-    const config = join(root, "adapter.json");
-    await writeFile(config, "{}", { mode: 0o600 });
-    Object.assign(env, { ORCA_CCLOOP_BIN: binary, ORCA_CCLOOP_ADAPTER_CONFIG: config });
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the port's second half is
+    // the agents table (ORCA_AGENTS_TABLE, spec §6.6); any regular file still satisfies construction.
+    const table = join(root, "agents.json");
+    await writeFile(table, "{}", { mode: 0o600 });
+    Object.assign(env, { ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: table });
   }
   const { rejection, ...control } = resolveControlOptions([], env, [{ projectKey: "proj", path: repo }]);
   expect(rejection).toBe(null);
````

`web/tests/controlPortBanner.test.tsx`：

````diff
diff --git a/web/tests/controlPortBanner.test.tsx b/web/tests/controlPortBanner.test.tsx
index 672404b..ec43ece 100644
--- a/web/tests/controlPortBanner.test.tsx
+++ b/web/tests/controlPortBanner.test.tsx
@@ -50,7 +50,10 @@ describe("the panel says when it has no execution port", () => {
     const html = render({ executionPort: "unconfigured" });
     expect(html).toContain("no execution port configured");
     expect(html).toContain("ORCA_CCLOOP_BIN");
-    expect(html).toContain("ORCA_CCLOOP_ADAPTER_CONFIG");
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the second variable is the
+    // agents table now (spec §6.6), and the retired name must not be offered as a fix.
+    expect(html).toContain("ORCA_AGENTS_TABLE");
+    expect(html).not.toContain("ORCA_CCLOOP_ADAPTER_CONFIG");
   });
 
   it("stays quiet when a port is configured, so the notice means something when it appears", () => {
````


  跑 `for f in tests/control/driverHandoff.test.ts tests/control/driverReconcile.test.ts tests/panel/assemblyHandoffGrace.test.ts tests/panel/controlOptions.test.ts; do ./node_modules/.bin/vitest run $f > $S/t7-s7-red-$(basename $f).log 2>&1; echo $f rc=$?; done > $S/t7-s7-red.txt` ⇒ Expected 四个 rc=1（`agentsTablePath` 不存在、`handoffGraceMsOf` 不是 `driverHandoff` 的导出、解冲突仍是 `--adapter` 形态被替身拒）。
  再改实现：

`src/panel/controlOptions.ts`：

````diff
diff --git a/src/panel/controlOptions.ts b/src/panel/controlOptions.ts
index c787383..3398ba2 100644
--- a/src/panel/controlOptions.ts
+++ b/src/panel/controlOptions.ts
@@ -102,9 +102,10 @@ export function resolveControlOptions(
     return index === -1 ? undefined : args[index + 1];
   };
 
-  // Both variables or neither: a binary with no adapter config cannot be driven, and half a
+  // Both variables or neither: a binary with no agents table cannot be driven, and half a
   // configuration presented as a whole one is how a soft adapter gets treated as strict.
-  const executionPort = nonEmpty(env.ORCA_CCLOOP_BIN) && nonEmpty(env.ORCA_CCLOOP_ADAPTER_CONFIG) ? "configured" : "unconfigured";
+  // Agent selection spec §6.6: ORCA_AGENTS_TABLE replaces ORCA_CCLOOP_ADAPTER_CONFIG.
+  const executionPort = nonEmpty(env.ORCA_CCLOOP_BIN) && nonEmpty(env.ORCA_AGENTS_TABLE) ? "configured" : "unconfigured";
 
   const off = (): ControlOptionsResolution => ({ ...controlDisabled(), executionPort, rejection: null });
````

`src/panel/controlConfig.ts`：

````diff
diff --git a/src/panel/controlConfig.ts b/src/panel/controlConfig.ts
index 38dc9d4..d92b801 100644
--- a/src/panel/controlConfig.ts
+++ b/src/panel/controlConfig.ts
@@ -28,8 +28,9 @@ export interface TrustedControlConfigInput {
   /**
    * Null when no execution port is configured (ruling R5). Paired with `executionPort` by a
    * refinement below: the two can no longer disagree, which a free-standing string allowed.
+   * Agent selection spec §6.6: the agents table replaces the single adapter config.
    */
-  adapterConfigPath: string | null;
+  agentsTablePath: string | null;
   executionPort: "configured" | "unconfigured";
   archiveRoot: string;
   exportRoot: string;
@@ -54,7 +55,7 @@ const trustedControlConfigInputSchema = z.object({
   epoch: z.string().min(1),
   stateDir: z.string().min(1),
   executablePath: z.string().min(1),
-  adapterConfigPath: z.string().min(1).nullable(),
+  agentsTablePath: z.string().min(1).nullable(),
   executionPort: z.enum(["configured", "unconfigured"]),
   archiveRoot: z.string().min(1),
   exportRoot: z.string().min(1),
@@ -65,11 +66,11 @@ const trustedControlConfigInputSchema = z.object({
   defaultEstimatorProfileId: idSchema.nullable(),
   defaultEstimateMode: z.enum(["strict", "soft"]).nullable(),
 }).strict().superRefine((value, ctx) => {
-  // The invariant is the pair, not either field: a configured port with no adapter config, and a
+  // The invariant is the pair, not either field: a configured port with no agents table, and a
   // profile with no mode, were both representable before and are the shapes that let a soft
   // adapter be driven as a strict one.
-  if ((value.executionPort === "configured") !== (value.adapterConfigPath !== null)) {
-    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["adapterConfigPath"], message: "execution-port-adapter-config-mismatch" });
+  if ((value.executionPort === "configured") !== (value.agentsTablePath !== null)) {
+    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["agentsTablePath"], message: "execution-port-agents-table-mismatch" });
   }
   if ((value.defaultEstimatorProfileId === null) !== (value.defaultEstimateMode === null)) {
     ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultEstimateMode"], message: "estimator-defaults-incomplete" });
@@ -145,7 +146,7 @@ export function createTrustedControlConfig(
 
   checkedPath(input.stateDir, "directory");
   checkedPath(input.executablePath, "file");
-  if (input.adapterConfigPath !== null) checkedPath(input.adapterConfigPath, "file");
+  if (input.agentsTablePath !== null) checkedPath(input.agentsTablePath, "file");
   checkedPath(input.archiveRoot, "directory");
   checkedPath(input.exportRoot, "directory");
   checkedPath(input.evidenceRoot, "directory");
````

`src/panel/controlAssembly.ts`：

````diff
diff --git a/src/panel/controlAssembly.ts b/src/panel/controlAssembly.ts
index 2341634..bc0e1c1 100644
--- a/src/panel/controlAssembly.ts
+++ b/src/panel/controlAssembly.ts
@@ -8,7 +8,6 @@ import type { ExecutionPort } from "../control/executionPort.js";
 import { deliverSchedulerWakes } from "../control/dispatch.js";
 import { recoverControl } from "../control/recovery.js";
 import { createExecutionDriver, type CrashPoint, type ExecutionDriver } from "../control/executionDriver.js";
-import { HANDOFF_EXTRA_GRACE_MS } from "../control/driverHandoff.js";
 import { controlWorkspaceRoots } from "../control/workspace.js";
 import { createWebWakeHandlers } from "../control/webDispatch.js";
 import { createExecutionProfileRouter, resolveProfile, type ExecutionProfileRouter, type FrozenProfile } from "../control/profiles.js";
@@ -108,21 +107,6 @@ export interface ControlAssemblyInput {
   driverCrash?: (point: CrashPoint) => void;
 }
 
-/**
- * Handoff delivery spec §3 (controller decision): a delivered request that yields nothing is judged
- * outcome-unknown only past its deadline plus the adapter's own killGraceMs plus HANDOFF_EXTRA_GRACE_MS.
- * Read once, here. A config that cannot be read, or whose killGraceMs is not a non-negative safe integer,
- * counts 0: the grace is never shorter than the fixed part, and an unusable config is the port's to refuse.
- */
-export function handoffGraceMsOf(adapterConfigPath: string): number {
-  let killGraceMs = 0;
-  try {
-    const value = (JSON.parse(readFileSync(adapterConfigPath, "utf8")) as { killGraceMs?: unknown } | null)?.killGraceMs;
-    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) killGraceMs = value;
-  } catch { killGraceMs = 0; }
-  return killGraceMs + HANDOFF_EXTRA_GRACE_MS;
-}
-
 /**
  * The execution port, chosen once. There is deliberately no third branch: a missing binary selects
  * the refusing port, never `legacyExecutionPort`, which has no ledger authority and no handoff
@@ -132,8 +116,7 @@ function choosePort(control: ControlOptions, env: NodeJS.ProcessEnv): ExecutionP
   if (control.executionPort === "unconfigured") return createUnconfiguredControlPort();
   return createCcloopExecutionPort({
     binary: env.ORCA_CCLOOP_BIN!,
-    adapter: "codex",
-    adapterConfigPath: env.ORCA_CCLOOP_ADAPTER_CONFIG!,
+    agentsTablePath: env.ORCA_AGENTS_TABLE!,
     timeoutMs: PORT_TIMEOUT_MS,
   });
 }
@@ -189,7 +172,7 @@ export async function assembleControlRuntime(input: ControlAssemblyInput): Promi
     epoch,
     stateDir: store.stateDir,
     executablePath: process.execPath,
-    adapterConfigPath: control.executionPort === "configured" ? env.ORCA_CCLOOP_ADAPTER_CONFIG! : null,
+    agentsTablePath: control.executionPort === "configured" ? env.ORCA_AGENTS_TABLE! : null,
     executionPort: control.executionPort,
     archiveRoot: join(root, ARCHIVE),
     exportRoot: join(root, EXPORT),
@@ -252,9 +235,9 @@ export async function assembleControlRuntime(input: ControlAssemblyInput): Promi
     driver = createExecutionDriver({
       store, router, admissionGate, roots: controlWorkspaceRoots(store.stateDir),
       resolveRepository: (repoId) => config.resolveRepository(repoId),
-      ccloopBin: env.ORCA_CCLOOP_BIN!, adapterConfigPath: env.ORCA_CCLOOP_ADAPTER_CONFIG!,
+      ccloopBin: env.ORCA_CCLOOP_BIN!, agentsTablePath: env.ORCA_AGENTS_TABLE!,
+      // Handoff grace: the run's agent killGraceMs + 60 s, asked of the port per run (driverHandoff.handoffGraceMsOf).
       kickPump: () => { void pump(); }, crash: input.driverCrash,
-      handoffGraceMs: handoffGraceMsOf(env.ORCA_CCLOOP_ADAPTER_CONFIG!),
     });
   }
````

`src/control/executionDriver.ts`：

````diff
diff --git a/src/control/executionDriver.ts b/src/control/executionDriver.ts
index 85c90ca..c85de9b 100644
--- a/src/control/executionDriver.ts
+++ b/src/control/executionDriver.ts
@@ -28,6 +28,7 @@ import type { ExecutionReport } from "./executionPort.js";
 import type { ExecutionProfileRouter } from "./profiles.js";
 import type { ControlStore } from "./store.js";
 import type { Candidate } from "./types.js";
+import type { AgentSelection } from "./agentSelection.js";
 
 /**
  * Execution driver spec §2. Owned by the panel's control assembly next to the wake pump, and only
@@ -54,23 +55,23 @@ export interface ExecutionDriverDeps {
   roots: WorkspaceRoots;
   /** spec §3.1: the trusted path for a repoId, its witness re-validated on every call. */
   resolveRepository(repoId: string): string;
-  /** spec §5.3(6): the binary and codex adapter config a reconciliation `ccloop run` is spawned with. */
+  /** spec §5.3(6): the binary and agents table a reconciliation `ccloop run` is spawned with (agent selection spec §4.9). */
   ccloopBin: string;
-  adapterConfigPath: string;
+  agentsTablePath: string;
   kickPump?: () => void;
   crash?: (point: CrashPoint) => void;
   /** Test seam (spec §5.1): runs between a landing's merge and its compare-and-swap. */
   beforeCas?: () => Promise<void>;
   /** Handoff delivery spec §3: the clock a request's grace is judged by (tests move it). */
   now?: () => Date;
-  /** Handoff delivery spec §3 (controller decision): adapter killGraceMs + 60 s; HANDOFF_EXTRA_GRACE_MS when absent. */
+  /** Test override of the handoff grace; absent, it is the run's agent killGraceMs + 60 s (driverHandoff.handoffGraceMsOf). */
   handoffGraceMs?: number;
 }
 
 export interface DriverRun {
   runId: string; groupId: string; workItemId: string; taskId: string | null;
   generation: number; graphVersion: number; targetVersion: number;
-  state: string; phase: string; configHash: string; executionId: string | null;
+  state: string; phase: string; configHash: string; agent: AgentSelection; executionId: string | null;
   highWater: number; providerAttemptOrdinal: number; continuationIntentId?: string | null;
   executionProfile: { profileId: string; profileHash: string };
   drive?: DriveRecord;
````

`src/control/driverHandoff.ts`：

````diff
diff --git a/src/control/driverHandoff.ts b/src/control/driverHandoff.ts
index 8146d3a..fdccc36 100644
--- a/src/control/driverHandoff.ts
+++ b/src/control/driverHandoff.ts
@@ -15,7 +15,8 @@ import {
   INSPECT_UNKNOWN_LIMIT, advance, archiveAdmission, collectInto, describeError, driverRunIds, groupRepoId, portFor, readDriverRun,
   readStartEnvelope, saveDriverRun, savedReport, stepC, write, type DriverContext, type DriverRun, type ExecutionDriverDeps,
 } from "./executionDriver.js";
-import type { ExecutionReport, ExecutionStatus } from "./executionPort.js";
+import type { ExecutionPort, ExecutionReport, ExecutionStatus } from "./executionPort.js";
+import type { PartialSelection } from "./agentSelection.js";
 import type { ControlStore } from "./store.js";
 import type { Candidate } from "./types.js";
 
@@ -159,7 +160,7 @@ async function deliverAndCollect(deps: ExecutionDriverDeps, run: DriverRun, requ
       delivered = ack.requestId === request.requestId && (ack.kind === "latched" || ack.kind === "complete");
     } catch { delivered = false; }
     deps.crash?.("H-after-deliver");
-    if (!delivered) return settleIfPastGrace(deps, run, request);
+    if (!delivered) return await settleIfPastGrace(deps, run, request);
     return write(deps, () => {
       const current = readHandoffRequest(store, run.groupId, request.requestId).request;
       if (current.state !== "request-pending") return false;
@@ -173,13 +174,46 @@ async function deliverAndCollect(deps: ExecutionDriverDeps, run: DriverRun, requ
     deps.crash?.("H-after-candidate");
     return settleHandoffCheckpoint(deps, run.runId, request.requestId, report);
   }
-  return settleIfPastGrace(deps, run, request) || report.events.length > 0;
+  return (await settleIfPastGrace(deps, run, request)) || report.events.length > 0;
+}
+
+/**
+ * spec §3 (controller decision): a delivered request that yields nothing turns outcome-unknown only past its deadline
+ * plus the agent's own killGraceMs plus HANDOFF_EXTRA_GRACE_MS. ccloop waits killGraceMs before it kills a phase, so
+ * a shorter grace would call a stop unknown while ccloop is still finishing it. The killGraceMs is the one ccloop
+ * answers for the run's frozen selection (agent selection spec §6.6: Orca never parses the agents table); an answer
+ * that cannot be had, or is not a non-negative safe integer, counts 0 -- never shorter than the fixed part.
+ *
+ * Agent selection plan T7 hook: T11 freezes killGraceMs on the work item at confirm and this reads it from there.
+ */
+export async function handoffGraceMsOf(port: Pick<ExecutionPort, "resolveAgent">, agent: PartialSelection): Promise<number> {
+  let killGraceMs = 0;
+  try {
+    const value = (await port.resolveAgent(agent)).killGraceMs;
+    if (Number.isSafeInteger(value) && value >= 0) killGraceMs = value;
+  } catch { killGraceMs = 0; }
+  return killGraceMs + HANDOFF_EXTRA_GRACE_MS;
+}
+
+/** One answer per run for the driver's life: the grace is asked for on every round past the fixed part. */
+const graceByRun = new WeakMap<ExecutionDriverDeps, Map<string, number>>();
+async function graceMsFor(deps: ExecutionDriverDeps, run: DriverRun): Promise<number> {
+  if (deps.handoffGraceMs !== undefined) return deps.handoffGraceMs;
+  const known = graceByRun.get(deps) ?? new Map<string, number>();
+  graceByRun.set(deps, known);
+  const cached = known.get(run.runId);
+  if (cached !== undefined) return cached;
+  const grace = await handoffGraceMsOf(portFor(deps, run), run.agent);
+  known.set(run.runId, grace);
+  return grace;
 }
 
 /** spec §3 grace (controller decision): past deadline + killGraceMs + 60 s with nothing collected. */
-function settleIfPastGrace(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): boolean {
+async function settleIfPastGrace(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): Promise<boolean> {
   if (request.state === "outcome-unknown") return false;
-  if (nowMs(deps) <= Date.parse(request.deadlineAt) + (deps.handoffGraceMs ?? HANDOFF_EXTRA_GRACE_MS)) return false;
+  // The fixed part first: no port call while the grace cannot possibly have elapsed.
+  if (nowMs(deps) <= Date.parse(request.deadlineAt) + HANDOFF_EXTRA_GRACE_MS) return false;
+  if (nowMs(deps) <= Date.parse(request.deadlineAt) + await graceMsFor(deps, run)) return false;
   return write(deps, () => {
     const current = readHandoffRequest(deps.store, run.groupId, request.requestId).request;
     if (current.state === "outcome-unknown" || !ADOPTABLE_STATES.includes(current.state)) return false;
````

`src/control/driverLanding.ts`：

````diff
diff --git a/src/control/driverLanding.ts b/src/control/driverLanding.ts
index a3d5c62..46b6430 100644
--- a/src/control/driverLanding.ts
+++ b/src/control/driverLanding.ts
@@ -282,7 +282,9 @@ export async function stepR(deps: ExecutionDriverDeps, runId: string, context: D
   const plan: PlanFile = { targetRepo: record.copyPath, ccloopBin: deps.ccloopBin, runsDir: record.runsDir, workBranch: `orca/${run.groupId}`, policy: "local-merge", ledgerMode: "out-of-repo", tasks: [] };
   const task: PlanTask = { taskId: record.reconcileRunId, contract: record.contractPath, dependsOn: [] };
   const running = runTask(plan, task, record.conflictCommit, record.reconcileRunId, {
-    adapter: "codex", adapterConfig: deps.adapterConfigPath,
+    // Agent selection spec §4.9. Plan T7 bridge: the conflicted run's own frozen selection and configHash, exactly
+    // what the reconciliation ran with before; plan T12 replaces it with the group's frozen reconcile slot (§6.1).
+    agentsTable: deps.agentsTablePath, agentSelection: { selection: run.agent, configHash: run.configHash },
     // Final review I3: its own process group, output in files inside its runs dir, unref'd -- the panel
     // closing (or a Ctrl-C to its process group) does not end it, and a restarted driver waits on its pid.
     detachedLogDir: workdir,
````

`src/scheduler/ccloopRunner.ts`：

````diff
diff --git a/src/scheduler/ccloopRunner.ts b/src/scheduler/ccloopRunner.ts
index 17740be..586c1f6 100644
--- a/src/scheduler/ccloopRunner.ts
+++ b/src/scheduler/ccloopRunner.ts
@@ -5,6 +5,7 @@ import { basename, join } from "node:path";
 import { promisify } from "node:util";
 import type { TaskGraph } from "./graph.js";
 import type { PlanFile, PlanTask } from "./planFile.js";
+import type { AgentSelection } from "../control/agentSelection.js";
 
 const execFileAsync = promisify(execFile);
 
@@ -45,7 +46,23 @@ export interface TaskRun {
   attemptSha: string | null;
 }
 
-export interface RunTaskOptions {
+interface RunTaskCommonOptions {
+  /**
+   * Execution driver spec §5.3(6): called with the ccloop process id as soon as it is spawned, so a
+   * caller can record it durably and, after its own restart, tell a live reconciliation from a dead one.
+   */
+  onSpawn?: (pid: number) => void;
+  /**
+   * Execution driver final review I3: when set, ccloop is spawned detached (its own process group leader),
+   * with stdout and stderr written to `ccloop.stdout.log` / `ccloop.stderr.log` (created 0600) in this
+   * directory instead of pipes, and unref'd -- so it outlives the process that spawned it, which a restarted
+   * caller then waits on by pid. Unset (`orca run`): attached and piped, exactly as before.
+   */
+  detachedLogDir?: string;
+}
+
+/** `orca run` (the legacy scheduler): `ccloop run --adapter <a> --adapter-config <file>`, unchanged by agent selection. */
+export interface AdapterRunTaskOptions extends RunTaskCommonOptions {
   /**
    * G13 / spec §1.2 rule 6: v1 runs entirely on `scripted` and spends no model
    * money. Passed rather than defaulted so the choice is visible at each call
@@ -59,20 +76,23 @@ export interface RunTaskOptions {
    * is a decision that belongs to the orchestration task, not to this module.
    */
   adapterConfig: string;
-  /**
-   * Execution driver spec §5.3(6): called with the ccloop process id as soon as it is spawned, so a
-   * caller can record it durably and, after its own restart, tell a live reconciliation from a dead one.
-   */
-  onSpawn?: (pid: number) => void;
-  /**
-   * Execution driver final review I3: when set, ccloop is spawned detached (its own process group leader),
-   * with stdout and stderr written to `ccloop.stdout.log` / `ccloop.stderr.log` (created 0600) in this
-   * directory instead of pipes, and unref'd -- so it outlives the process that spawned it, which a restarted
-   * caller then waits on by pid. Unset (`orca run`): attached and piped, exactly as before.
-   */
-  detachedLogDir?: string;
 }
 
+/**
+ * Agent selection spec §4.9 (the driver's reconciliation): `ccloop run --agents <table> --agent-selection <file>`.
+ * The selection file `{selection, configHash}` is written 0600 into the run's own workdir; ccloop materializes the
+ * selection against the table and refuses to run when the hash (or the installed version) no longer matches.
+ */
+export interface AgentsRunTaskOptions extends RunTaskCommonOptions {
+  agentsTable: string;
+  agentSelection: { selection: AgentSelection; configHash: string };
+}
+
+export type RunTaskOptions = AdapterRunTaskOptions | AgentsRunTaskOptions;
+
+/** The selection file's name inside a run's workdir. */
+export const AGENT_SELECTION_FILE = "agent-selection.json";
+
 /**
  * spec §4.3 step 2: every task gets its own clone, and this is where it goes.
  * Exported because the clone outlives runTask — the attempt commit is
@@ -275,16 +295,22 @@ export async function runTask(
   await writeFile(contractPath, JSON.stringify(rewritten, null, 2));
 
   await mkdir(loopDir, { recursive: true });
+  let agentArgs: string[];
+  if ("agentsTable" in options) {
+    const selectionPath = join(workdir, AGENT_SELECTION_FILE);
+    // "wx": the workdir is this run's alone, so an existing file is someone else's and is not overwritten.
+    await writeFile(selectionPath, JSON.stringify(options.agentSelection), { mode: 0o600, flag: "wx" });
+    agentArgs = ["--agents", options.agentsTable, "--agent-selection", selectionPath];
+  } else {
+    agentArgs = ["--adapter", options.adapter, "--adapter-config", options.adapterConfig];
+  }
   const spawned = await spawnCcloop(plan.ccloopBin, [
     "run",
     "--contract",
     contractPath,
     "--run-dir",
     loopDir,
-    "--adapter",
-    options.adapter,
-    "--adapter-config",
-    options.adapterConfig,
+    ...agentArgs,
   ], options.onSpawn, options.detachedLogDir);
 
   const outcome = await readTerminalStatus(loopDir, spawned);
````

`src/cli.ts`：

````diff
diff --git a/src/cli.ts b/src/cli.ts
index 64dee34..c5eba13 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -56,7 +56,7 @@ const USAGE = `usage:
                                  it off. Its state lives under $ORCA_CONTROL_DIR (default
                                  ~/.orca/control/<repo key>); more than one --repo has no key to
                                  name it after, so it needs --control-state-dir. Running work also
-                                 needs ORCA_CCLOOP_BIN + ORCA_CCLOOP_ADAPTER_CONFIG and the two
+                                 needs ORCA_CCLOOP_BIN + ORCA_AGENTS_TABLE and the two
                                  estimator flags -- without them the panel still starts and still
                                  shows recovery, and refuses those commands by name.
   orca compact-reviews [--apply] [--root <dir>] [--repo <key>=<path>]...
````

`web/src/ControlPanel.tsx`：

````diff
diff --git a/web/src/ControlPanel.tsx b/web/src/ControlPanel.tsx
index 1b12182..7544d99 100644
--- a/web/src/ControlPanel.tsx
+++ b/web/src/ControlPanel.tsx
@@ -99,7 +99,7 @@ export function ControlPanel(props: ControlPanelProps): JSX.Element {
       {config.executionPort === "unconfigured" && (
         <p role="alert">
           no execution port configured · this panel serves recovery and evidence, and refuses to start
-          work · set ORCA_CCLOOP_BIN and ORCA_CCLOOP_ADAPTER_CONFIG and restart it
+          work · set ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE and restart it
         </p>
       )}
       {summary.resetRequired && <p role="alert">server reset required · this page must re-read before it trusts any cached view</p>}
````

`scripts/verify-control.mjs`：

````diff
diff --git a/scripts/verify-control.mjs b/scripts/verify-control.mjs
index b5a7ff6..d6438c2 100644
--- a/scripts/verify-control.mjs
+++ b/scripts/verify-control.mjs
@@ -4,14 +4,14 @@ import { realpathSync } from "node:fs";
 const root = fileURLToPath(new URL("../", import.meta.url));
 const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
 const binary = process.env.ORCA_CCLOOP_BIN;
-const config = process.env.ORCA_CCLOOP_ADAPTER_CONFIG;
-if (!binary || !config) {
-  console.error("verify:control requires ORCA_CCLOOP_BIN and ORCA_CCLOOP_ADAPTER_CONFIG");
+const table = process.env.ORCA_AGENTS_TABLE;
+if (!binary || !table) {
+  console.error("verify:control requires ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE");
   process.exit(1);
 }
 try {
   realpathSync(binary);
-  realpathSync(config);
+  realpathSync(table);
 } catch (error) {
   console.error(error);
   process.exit(1);
````

`scripts/live-driver-acceptance.ts`：

````diff
diff --git a/scripts/live-driver-acceptance.ts b/scripts/live-driver-acceptance.ts
index 9975383..e0817d1 100644
--- a/scripts/live-driver-acceptance.ts
+++ b/scripts/live-driver-acceptance.ts
@@ -24,6 +24,7 @@ import { mkdir, realpath, writeFile } from "node:fs/promises";
 import { homedir } from "node:os";
 import { dirname, isAbsolute, join, resolve } from "node:path";
 import { canonicalBytes } from "../src/control/canonicalJson.js";
+import { createCcloopExecutionPort } from "../src/control/ccloopPort.js";
 import { readArchivedPlan, readBudgetProposal } from "../src/control/queries.js";
 import { assembleControlRuntime, type ControlRuntime } from "../src/panel/controlAssembly.js";
 import { controlRepoKey, resolveControlOptions } from "../src/panel/controlOptions.js";
@@ -58,13 +59,15 @@ const g = (cwd: string, ...rest: string[]): string =>
   execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...rest], { cwd, encoding: "utf8" }).trim();
 const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
 
-/** ccloop's canonicalHash (ccloop src/control/protocol.ts): keys sorted by localeCompare, JSON, sha256. */
-function ccloopHash(value: unknown): string {
-  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
-    : item !== null && typeof item === "object"
-      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([l], [r]) => l.localeCompare(r)).map(([k, v]) => [k, canonical(v)]))
-      : item;
-  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
+/**
+ * Agent selection spec §4.2: the version `ccloop agents detect` would record -- the first `\d+.\d+.\d+(-…)?` in the
+ * stdout of `[...command, "--version"]`. The configHash is never computed here: ccloop answers it (spec I3).
+ */
+function versionOf(command: string[]): string {
+  const printed = execFileSync(command[0]!, [...command.slice(1), "--version"], { encoding: "utf8", input: "" });
+  const match = /\d+\.\d+\.\d+(-[\w.]+)?/.exec(printed);
+  if (!match) throw new Error(`no version in ${JSON.stringify(printed)}`);
+  return match[0];
 }
 
 /** Every path under `dir` with its size and mtime, so a touch shows up, not only a new file. */
@@ -96,11 +99,15 @@ const marker = join(root, "codex-marker.json");
 const scriptPath = join(root, "codex-script.json");
 await writeFile(scriptPath, JSON.stringify({ a: { files: { "answer.txt": "42\n" } } }));
 const fakeCodex = resolve(dirname(ccloopBin), "..", "tests", "fixtures", "fake-codex.mjs");
-const adapter = fake
-  ? { command: [process.execPath, fakeCodex, "script", marker, scriptPath], model: "fixture-model", budgetMode: "soft", sandbox: "workspace-write", timeoutMs: 120_000, killGraceMs: 5_000 }
-  : { command: [args.codex!], model: args.model!, budgetMode: "soft", sandbox: "workspace-write", timeoutMs: 120_000, killGraceMs: 5_000 };
-const adapterPath = join(root, "adapter.json");
-await writeFile(adapterPath, JSON.stringify(adapter), { mode: 0o600 });
+// Agent selection spec §4.2, §6.6: one codex installation in an agents table handed over as ORCA_AGENTS_TABLE; the
+// model is a selection field, and the plan's configHash is ccloop's answer for that selection.
+const codexCommand = fake ? [process.execPath, fakeCodex, "script", marker, scriptPath] : [args.codex!];
+const tablePath = join(root, "agents.json");
+await writeFile(tablePath, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: {
+  codex: { kind: "codex", command: codexCommand, version: versionOf(codexCommand), configDir: null, timeoutMs: 120_000, killGraceMs: 5_000, sandbox: "workspace-write", budgetMode: "soft" },
+} }), { mode: 0o600 });
+const resolution = await createCcloopExecutionPort({ binary: ccloopBin, agentsTablePath: tablePath, timeoutMs: 60_000 })
+  .resolveAgent(fake ? { agent: "codex" } : { agent: "codex", model: args.model! });
 
 const check = 'test "$(cat answer.txt)" = 42';
 const contract = {
@@ -115,7 +122,7 @@ const contractPath = join(root, "contract-a.json");
 await writeFile(contractPath, canonicalBytes(contract));
 // The trusted control config requires the plan file inside its repository (controlConfig.ts, control-path-escape).
 const planPath = join(repo, "plan.json");
-await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "live acceptance", successConditions: ["answer.txt holds 42"], tasks: [{ taskId: "a", contract: contractPath, dependsOn: [], targetVersion: 1, configHash: ccloopHash(adapter) }] }));
+await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "live acceptance", successConditions: ["answer.txt holds 42"], tasks: [{ taskId: "a", contract: contractPath, dependsOn: [], targetVersion: 1, configHash: resolution.configHash }] }));
 
 // The shipped ccloop's capability answer; a null context window makes the estimate blocked-capability (spec §11 D1).
 const profilePath = join(root, "profile.json");
@@ -134,7 +141,7 @@ const humanBefore = human();
 
 const repoId = controlRepoKey("live");
 const repos = [{ projectKey: "live", path: repo }];
-const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_CCLOOP_BIN: ccloopBin, ORCA_CCLOOP_ADAPTER_CONFIG: adapterPath };
+const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_CCLOOP_BIN: ccloopBin, ORCA_AGENTS_TABLE: tablePath };
 process.env.ORCA_CORRECTIONS_DIR = env.ORCA_CORRECTIONS_DIR;
 const { rejection, ...control } = resolveControlOptions(["--plan", `plan=${repoId}=${planPath}`, "--profile", profilePath, "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "200"], env, repos);
 if (rejection !== null) throw new Error(rejection);
@@ -149,7 +156,7 @@ const workStatus = (runtime: ControlRuntime): string =>
   JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status;
 
 const checks: Record<string, boolean> = {};
-const summary: Record<string, unknown> = { mode: fake ? "fake" : "live", model: adapter.model, groupTokens, taskTokens, deadlineMs, startedAt: new Date().toISOString(), root };
+const summary: Record<string, unknown> = { mode: fake ? "fake" : "live", model: resolution.selection.model, groupTokens, taskTokens, deadlineMs, startedAt: new Date().toISOString(), root };
 const runtime = await assembleControlRuntime({ control, repos, epoch: "epoch-live-1", env });
 if (runtime === null) throw new Error("the control plane did not assemble");
 const runsRoot = `${runtime.store.stateDir}.runs`;
@@ -158,6 +165,11 @@ try {
   await runtime.recover();
   const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId, planId: "plan" }));
   summary.imported = imported;
+  // Agent selection plan T7 bridge, TEMPORARY -- plan T11 freezes the task's selection at confirm and deletes this:
+  // nothing in the product writes a work item's selection before then, so the one the configHash came from is set.
+  for (const row of runtime.store.db.prepare("SELECT id,body FROM work_items WHERE group_id='g'").all()) {
+    runtime.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), agent: resolution.selection }), String(row.id));
+  }
   // A blocked-capability estimate leaves complex-1m-default allocations (task work 3M tokens, 3 attempts), and
   // confirm derives the contract's tokenBudget/maxAttempts/totalRuntimeBudgetMs from them, overriding the
   // contract's own. So the caps go in here, before confirm, as a human's proposal-edit -- the Web path.
````


  再跑同一循环，外加 `tests/control/driverReconcileN.test.ts`、`tests/control/blockedStaysPut.test.ts`、`tests/panel/controlAssemblyDriver.test.ts`，以及 `(cd web && ../node_modules/.bin/vitest run tests/controlPortBanner.test.tsx > $S/t7-s7-web.log 2>&1; echo rc=$?)` ⇒ Expected 全部 rc=0（副本实测：driverHandoff 29/29、driverReconcile 25/25、driverReconcileN 5/5、blockedStaysPut 4/4、assemblyHandoffGrace 1/1、controlOptions 35/35、controlAssemblyDriver 5/5、web banner 6/6）。

- [ ] **Step 8: 真 ccloop 的三个消费者（ccloopWorld、webCcloopSmoke、协议集成）**

`tests/control/fixtures/ccloopWorld.ts`：

````diff
diff --git a/tests/control/fixtures/ccloopWorld.ts b/tests/control/fixtures/ccloopWorld.ts
index cfb28a8..de856d5 100644
--- a/tests/control/fixtures/ccloopWorld.ts
+++ b/tests/control/fixtures/ccloopWorld.ts
@@ -6,6 +6,7 @@ import { tmpdir } from "node:os";
 import { dirname, join, resolve } from "node:path";
 import { afterAll, afterEach, beforeAll, expect } from "vitest";
 import { canonicalBytes } from "../../../src/control/canonicalJson.js";
+import { createCcloopExecutionPort } from "../../../src/control/ccloopPort.js";
 import type { CrashPoint } from "../../../src/control/executionDriver.js";
 import { readArchivedPlan, readBudgetProposal } from "../../../src/control/queries.js";
 import { assembleControlRuntime, type ControlRuntime } from "../../../src/panel/controlAssembly.js";
@@ -19,6 +20,11 @@ import { profileSnapshot } from "./web.js";
  * rather than copying it (handoff delivery preflight I11). A target repository, a scripted fake codex
  * from the ccloop build ORCA_CCLOOP_BIN points at, a plan, a profile and control options, all under a
  * temporary root; `boot` assembles a control runtime over them.
+ *
+ * Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the fake codex is an
+ * installation in an agents table (`<root>/agents.json`, spec §4.2) handed over as ORCA_AGENTS_TABLE, and every
+ * configHash comes from ccloop's own resolution of a selection against that table (spec I3) -- the local copy of
+ * ccloop's canonical hash this file used to carry is gone.
  */
 export const realBinary = process.env.ORCA_CCLOOP_BIN;
 
@@ -26,13 +32,16 @@ export const g = (cwd: string, ...args: string[]): string =>
   execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
 const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
 
-/** ccloop's canonicalHash (ccloop src/control/protocol.ts:172-192): keys sorted by localeCompare, JSON, sha256. */
-function ccloopHash(value: unknown): string {
-  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
-    : item !== null && typeof item === "object"
-      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonical(nested)]))
-      : item;
-  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
+/**
+ * What `ccloop agents detect` would record as an installation's version: the first `\d+.\d+.\d+(-…)?` in the stdout
+ * of `[...command, "--version"]` (agent selection plan T1's probeVersion rule). The fakes answer `--version` without
+ * logging a call.
+ */
+export function versionOf(command: string[]): string {
+  const printed = execFileSync(command[0]!, [...command.slice(1), "--version"], { encoding: "utf8", input: "" });
+  const match = /\d+\.\d+\.\d+(-[\w.]+)?/.exec(printed);
+  if (!match) throw new Error(`no version in ${JSON.stringify(printed)}`);
+  return match[0];
 }
 
 /** What the shipped ccloop answers (pinned in webCcloopSmoke.test.ts); a null window blocks the estimate (D1). */
@@ -48,7 +57,7 @@ export interface Task { taskId: string; dependsOn?: string[]; targetPaths: strin
  */
 export interface ScriptEntry { files: Record<string, string>; delayMs?: { plan?: number; execute?: number; verify?: number }; usageBeforeDelay?: boolean }
 
-/** The adapter's killGraceMs in every world; handoffE2E's G scenario tells it apart from HANDOFF_EXTRA_GRACE_MS alone. */
+/** The codex installation's killGraceMs in every world; handoffE2E's G scenario tells it apart from HANDOFF_EXTRA_GRACE_MS alone. */
 export const KILL_GRACE_MS = 5_000;
 
 export type World = Awaited<ReturnType<ReturnType<typeof ccloopWorlds>["world"]>>;
@@ -73,9 +82,14 @@ export function ccloopWorlds(options: { rootPrefix: string; epochPrefix: string
     const scriptPath = join(root, "codex-script.json");
     await writeFile(scriptPath, JSON.stringify(script));
     const fakeCodex = resolve(dirname(realBinary!), "..", "tests", "fixtures", "fake-codex.mjs");
-    const adapter = { command: [process.execPath, fakeCodex, "script", marker, scriptPath], model: "fixture-model", budgetMode: "soft", sandbox: "workspace-write", timeoutMs: 120_000, killGraceMs: KILL_GRACE_MS };
-    const adapterPath = join(root, "adapter.json");
-    await writeFile(adapterPath, JSON.stringify(adapter), { mode: 0o600 });
+    const codexCommand = [process.execPath, fakeCodex, "script", marker, scriptPath];
+    const table = join(root, "agents.json");
+    await writeFile(table, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: {
+      codex: { kind: "codex", command: codexCommand, version: versionOf(codexCommand), configDir: null, timeoutMs: 120_000, killGraceMs: KILL_GRACE_MS, sandbox: "workspace-write", budgetMode: "soft" },
+    } }), { mode: 0o600 });
+    // Agent selection plan T7 bridge (T10 drops configHash from the plan, T11 freezes at confirm): the plan still
+    // carries a configHash, and it is ccloop's, for the selection every task runs with here.
+    const resolution = await createCcloopExecutionPort({ binary: realBinary!, agentsTablePath: table, timeoutMs: 60_000 }).resolveAgent({ agent: "codex" });
     const contracts = join(root, "contracts");
     await mkdir(contracts);
     const planTasks = [];
@@ -95,7 +109,7 @@ export function ccloopWorlds(options: { rootPrefix: string; epochPrefix: string
       };
       const path = join(contracts, `${task.taskId}.json`);
       await writeFile(path, canonicalBytes(contract));
-      planTasks.push({ taskId: task.taskId, contract: path, dependsOn: task.dependsOn ?? [], targetVersion: 1, configHash: ccloopHash(adapter) });
+      planTasks.push({ taskId: task.taskId, contract: path, dependsOn: task.dependsOn ?? [], targetVersion: 1, configHash: resolution.configHash });
     }
     const planPath = join(repo, "plan.json");
     await writeFile(planPath, JSON.stringify({ targetRepo: repo, ccloopBin: realBinary, runsDir: join(root, "unused-runs"), workBranch: "orca/unused", policy: "local-merge", ledgerMode: "out-of-repo", goal: "ship", successConditions: ["the files hold the scripted text"], tasks: planTasks }));
@@ -105,7 +119,7 @@ export function ccloopWorlds(options: { rootPrefix: string; epochPrefix: string
     await writeFile(profilePath, JSON.stringify(snapshot));
     const repoId = controlRepoKey("e2e");
     const repos = [{ projectKey: "e2e", path: repo }];
-    const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CCLOOP_BIN: realBinary!, ORCA_CCLOOP_ADAPTER_CONFIG: adapterPath };
+    const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CCLOOP_BIN: realBinary!, ORCA_AGENTS_TABLE: table };
     const { rejection, ...control } = resolveControlOptions(["--plan", `plan=${repoId}=${planPath}`, "--profile", profilePath, "--estimator-profile", "all", "--estimate-mode", "soft", "--control-wake-ms", "50"], env, repos);
     if (rejection !== null) throw new Error(rejection);
     let epoch = 0;
@@ -179,6 +193,13 @@ export const raw = (runtime: ControlRuntime, commandId: string, verb: string, pa
 export async function startGroup(runtime: ControlRuntime, repoId: string, raiseTokens = 0): Promise<void> {
   const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId, planId: "plan" }));
   expect(imported).toMatchObject({ result: { kind: "imported", estimateState: "blocked-capability" } });
+  // Agent selection plan T7 bridge -- plan T11 freezes each task's selection at confirm and deletes this. Until then
+  // nothing in the product writes one; the selection is the one the plan's configHash was resolved from, asked of
+  // the assembled port again.
+  const { selection } = await runtime.port.resolveAgent({ agent: "codex" });
+  for (const row of runtime.store.db.prepare("SELECT id,body FROM work_items WHERE group_id='g'").all()) {
+    runtime.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), agent: selection }), String(row.id));
+  }
   const hash = runtime.router.list()[0]!.profileHash;
   const confirmed = runtime.service.confirm(raw(runtime, "confirm", "confirm", {
     planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion, budgetMode: "soft",
````

`tests/control/webCcloopSmoke.test.ts`：

````diff
diff --git a/tests/control/webCcloopSmoke.test.ts b/tests/control/webCcloopSmoke.test.ts
index 75a37b9..b888324 100644
--- a/tests/control/webCcloopSmoke.test.ts
+++ b/tests/control/webCcloopSmoke.test.ts
@@ -12,6 +12,11 @@
  * What is NOT here, and cannot be: a production process that turns the ledger's
  * `orca-dispatch-envelope-v1` into a ccloop `StartEnvelopeV1` and runs the worker. That translation
  * is performed in this file, so what it proves is the envelope, not a deployed executor.
+ *
+ * Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the wire is envelope
+ * protocol 2 (the claim carries the frozen selection), capabilities protocol 3 asked about one selection, and
+ * `control <method> --agents <table>`. The shipped CLI is given a real agents table whose one installation is the
+ * build's fake codex; its capabilities are still asked, never borrowed from the declared profile.
  */
 import { createHash } from "node:crypto";
 import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
@@ -29,6 +34,8 @@ import { toStartEnvelope } from "../../src/control/startEnvelope.js";
 import type { StartEnvelope } from "../../src/control/executionPort.js";
 import type { ControlStore } from "../../src/control/store.js";
 import { profileSnapshot, webFixture } from "./fixtures/web.js";
+import { versionOf } from "./fixtures/ccloopWorld.js";
+import { dirname } from "node:path";
 
 const realBinary = process.env.ORCA_CCLOOP_BIN;
 const fixtureCli = resolve("tests/control/fixtures/fake-ccloop-control.mjs");
@@ -46,6 +53,16 @@ async function tempRoot(prefix: string): Promise<string> {
 
 const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
 
+/** Agent selection spec §4.2: a real agents table whose one installation, `codex`, is the ccloop build's fake codex. */
+async function realTable(root: string): Promise<string> {
+  const command = [process.execPath, resolve(dirname(realBinary!), "..", "tests", "fixtures", "fake-codex.mjs"), "integration", join(root, "codex-marker.json")];
+  const table = join(root, "agents.json");
+  await writeFile(table, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: {
+    codex: { kind: "codex", command, version: versionOf(command), configDir: null, timeoutMs: 120_000, killGraceMs: 5_000, sandbox: "workspace-write", budgetMode: "soft" },
+  } }), { mode: 0o600 });
+  return table;
+}
+
 /** A confirmed group whose profiles probe exactly as the shipped adapter does. */
 async function confirmedByAdapter(budgetMode: "strict" | "soft", probe: CapabilityViewV1) {
   const f = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
@@ -91,20 +108,21 @@ function loopContract(taskId: string): Record<string, unknown> {
   };
 }
 
-/** A deterministic consumer: the production port speaking V1 to a real child process. */
-async function consumer(adapterConfig: Record<string, unknown> = {}) {
+/** A deterministic consumer: the production port speaking the control protocol to a real child process. */
+async function consumer(knobs: Record<string, unknown> = {}) {
   const root = await tempRoot("orca-web-consumer-");
   const binary = join(root, "ccloop");
   await copyFile(fixtureCli, binary);
   await chmod(binary, 0o700);
   const record = join(root, "record.json");
-  const config = join(root, "adapter.json");
+  // The stand-in reads its knobs from the file passed as the agents table; it is not a real table.
+  const table = join(root, "agents.json");
   const sourceDir = join(root, "run");
   await mkdir(sourceDir, { mode: 0o700 });
-  await writeFile(config, JSON.stringify({ record, ...adapterConfig }), { mode: 0o600 });
-  const port = createCcloopExecutionPort({ binary, adapter: "codex", adapterConfigPath: config, timeoutMs: 10_000 });
+  await writeFile(table, JSON.stringify({ record, ...knobs }), { mode: 0o600 });
+  const port = createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 });
   const started = async () => JSON.parse(await readFile(record, "utf8")) as { argv: string[]; stdin: string };
-  return { root, config, record, sourceDir, port, started, contract: loopContract("a") };
+  return { root, table, record, sourceDir, port, started, contract: loopContract("a") };
 }
 
 /** Import, confirm and claim one task, and hand back what the ledger froze for it. */
@@ -124,23 +142,23 @@ async function claimedWith(mode: "strict" | "soft") {
 describe("the shipped consumer answers for its own capabilities (task 10 step 4)", () => {
   it.skipIf(!realBinary)("claims phase-end usage and soft enforcement, and the ledger opens no strict run on it", async () => {
     const root = await tempRoot("orca-web-real-cap-");
-    const config = join(root, "adapter.json");
-    await writeFile(config, "{}");
-    const port = createCcloopExecutionPort({ binary: await realpath(realBinary!), adapter: "codex", adapterConfigPath: config, timeoutMs: 15_000 });
-    const capabilities = await port.capabilities();
+    const port = createCcloopExecutionPort({ binary: await realpath(realBinary!), agentsTablePath: await realTable(root), timeoutMs: 15_000 });
+    const { capabilities } = await port.resolveAgent({ agent: "codex" });
 
-    // Codex's own words, taken from the binary that would run the work: v2, eight fields, no
+    // Codex's own words, taken from the binary that would run the work: eight fields, no
     // realtime usage, no bounded enforcement, no context observation, and no request-bound proof.
     // Human authorization 2026-09-24, G1 seam A Task 5: this literal moved from the v1 seven-field
     // shape to the v2 eight-field shape ccloop main now answers.
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): capabilities protocol 3
+    // answers the same view inside the codex selection's resolution, untagged.
     expect(capabilities).toEqual({
-      protocol: 2, usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable",
+      usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable",
       handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
     });
 
     // Human authorization 2026-09-24, G1 seam A Task 5: the adapter's own probe answer feeds the
     // router as-is -- nothing here borrows from the declared profile.
-    const strict = await confirmedByAdapter("strict", await port.probeProfileCapabilities!());
+    const strict = await confirmedByAdapter("strict", capabilities);
     try {
       const refused = await strict.service.start(strict.f.command("start", {}));
       expect("error" in refused ? refused.error.code : "applied").toBe("control-capability-unsupported");
@@ -148,7 +166,7 @@ describe("the shipped consumer answers for its own capabilities (task 10 step 4)
       expect(strict.f.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g'").get()!.n).toBe(0);
     } finally { await strict.f.dispose(); }
 
-    const soft = await confirmedByAdapter("soft", await port.probeProfileCapabilities!());
+    const soft = await confirmedByAdapter("soft", capabilities);
     try {
       expect("error" in await soft.service.start(soft.f.command("start", {}))).toBe(false);
       expect((await deliverScheduledStart(soft.deps, "g")).kind).toBe("claimed");
@@ -163,11 +181,11 @@ describe("the shipped consumer answers for its own capabilities (task 10 step 4)
   // ccloop answer that degrades between those two calls is the only way to exercise the second
   // call without the first one catching it first, so this isolates the delivery-time guard.
   it.skipIf(!realBinary)("blocks only at delivery when the observation degrades after a clean schedule", async () => {
+    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the real answer is the
+    // codex selection's resolution against a real agents table; the guard it isolates is unchanged.
     const root = await tempRoot("orca-web-real-delivery-guard-");
-    const config = join(root, "adapter.json");
-    await writeFile(config, "{}");
-    const port = createCcloopExecutionPort({ binary: await realpath(realBinary!), adapter: "codex", adapterConfigPath: config, timeoutMs: 15_000 });
-    const realProbe = await port.probeProfileCapabilities!();
+    const port = createCcloopExecutionPort({ binary: await realpath(realBinary!), agentsTablePath: await realTable(root), timeoutMs: 15_000 });
+    const realProbe = (await port.resolveAgent({ agent: "codex" })).capabilities;
 
     const soft = await confirmedByAdapter("soft", realProbe);
     try {
@@ -183,20 +201,20 @@ describe("the shipped consumer answers for its own capabilities (task 10 step 4)
     } finally { await soft.f.dispose(); }
   });
 
-  it.skipIf(!realBinary)("refuses an envelope that is not V1 and reads a well-formed one as no execution yet", async () => {
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the frozen shape is envelope
+  // protocol 2 now (the claim carries the selection), so protocol 1 is the foreign version that must be refused.
+  it.skipIf(!realBinary)("refuses an envelope that is not V2 and reads a well-formed one as no execution yet", async () => {
     const root = await tempRoot("orca-web-real-env-");
-    const config = join(root, "adapter.json");
-    await writeFile(config, "{}");
     const sourceDir = join(root, "run");
     await mkdir(sourceDir, { mode: 0o700 });
     const bundlePath = join(sourceDir, "input", "bundle");
     await mkdir(bundlePath, { recursive: true, mode: 0o700 });
-    const port = createCcloopExecutionPort({ binary: await realpath(realBinary!), adapter: "codex", adapterConfigPath: config, timeoutMs: 15_000 });
+    const port = createCcloopExecutionPort({ binary: await realpath(realBinary!), agentsTablePath: await realTable(root), timeoutMs: 15_000 });
     const envelope: StartEnvelope = {
-      protocol: 1,
+      protocol: 2,
       claim: {
         groupId: "g", workItemId: "a", taskId: "a", runId: "run-web-smoke", generation: 1, graphVersion: 1, targetVersion: 1,
-        commandId: "start-g-2-a", configHash: sha256("config"),
+        commandId: "start-g-2-a", configHash: sha256("config"), agent: { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" },
         grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } },
         ownerToken: "token",
       },
@@ -206,7 +224,7 @@ describe("the shipped consumer answers for its own capabilities (task 10 step 4)
     };
 
     // Nothing has been accepted for this run, so the shipped consumer parses the envelope and
-    // reports the absence -- parsing it at all is the point: the shape the ledger freezes is V1.
+    // reports the absence -- parsing it at all is the point: the shape the ledger freezes is V2.
     expect(await port.inspect(envelope)).toEqual({ kind: "absent" });
     // A continuation envelope has to be legal too, because that is the one a recovery hands over.
     expect(await port.inspect({
@@ -215,7 +233,7 @@ describe("the shipped consumer answers for its own capabilities (task 10 step 4)
     })).toEqual({ kind: "absent" });
     // A foreign protocol version, an unsafe claim integer, and a bundle that escapes the run
     // directory are each refused before a worker could exist.
-    await expect(port.inspect({ ...envelope, protocol: 2 as 1 })).rejects.toThrow("control-peer-exit:2:control-protocol-unsupported");
+    await expect(port.inspect({ ...envelope, protocol: 1 as 2 })).rejects.toThrow("control-peer-exit:2:control-protocol-unsupported");
     await expect(port.inspect({ ...envelope, claim: { ...envelope.claim, generation: 0 } })).rejects.toThrow("control-peer-exit:2:control-request-invalid");
     await expect(port.inspect({
       ...envelope,
@@ -242,7 +260,8 @@ describe("the frozen dispatch envelope reaches a real process (task 10 step 4)",
       const accepted = await c.port.accept(start);
       expect(accepted).toEqual({ kind: "accepted", executionId: "execution-1", configHash: start.claim.configHash });
       const wire = await c.started();
-      expect(wire.argv).toEqual(["control", "accept", "--adapter", "codex", "--adapter-config", c.config]);
+      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): `--agents <table>` (spec §4.5).
+      expect(wire.argv).toEqual(["control", "accept", "--agents", c.table]);
       // Byte-for-byte: nothing between the ledger and the pipe re-serialises the claim.
       expect(wire.stdin).toBe(JSON.stringify(start));
````

`tests/control/ccloopProtocol.integration.test.ts`：

````diff
diff --git a/tests/control/ccloopProtocol.integration.test.ts b/tests/control/ccloopProtocol.integration.test.ts
index 69711d3..123ef47 100644
--- a/tests/control/ccloopProtocol.integration.test.ts
+++ b/tests/control/ccloopProtocol.integration.test.ts
@@ -14,32 +14,39 @@ import { collectControlled } from "../../src/control/schedulerBridge.js";
 import { ControlService } from "../../src/control/service.js";
 import { openControlStore, type ControlStore } from "../../src/control/store.js";
 import { crashCase } from "./fixtures/crashCase.js";
+import type { AgentSelection } from "../../src/control/agentSelection.js";
 
 const exec = promisify(execFile);
 const binary = process.env.ORCA_CCLOOP_BIN;
-const adapterConfigPath = process.env.ORCA_CCLOOP_ADAPTER_CONFIG;
+// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the port is given an agents
+// table (spec §6.6) and the task's configHash and selection come from ccloop's own resolution of the table's codex
+// installation (spec I3: Orca never hashes a config itself), where this used to hash the adapter config here.
+const agentsTablePath = process.env.ORCA_AGENTS_TABLE;
 const formal = process.env.ORCA_CONTROL_VERIFY === "1";
-if (formal && (!binary || !adapterConfigPath)) throw new Error("formal control verification requires ORCA_CCLOOP_BIN and ORCA_CCLOOP_ADAPTER_CONFIG");
+if (formal && (!binary || !agentsTablePath)) throw new Error("formal control verification requires ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE");
 
 const amount = (tokens:number,activeMs:number,attempts:number,sessions:number)=>({tokens,activeMs,attempts,sessions});
 const sleep = (ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
 
 async function git(repo:string,...args:string[]) {return (await exec("git",["-C",repo,...args],{env:{...process.env,GIT_AUTHOR_NAME:"Control Test",GIT_AUTHOR_EMAIL:"control@example.invalid",GIT_COMMITTER_NAME:"Control Test",GIT_COMMITTER_EMAIL:"control@example.invalid"}})).stdout.trim();}
 
-describe.skipIf(!binary || !adapterConfigPath)("real ccloop protocol",()=>{
- let root:string,target:string,runs:string,store:ControlStore,service:ControlService,configHash:string;
+describe.skipIf(!binary || !agentsTablePath)("real ccloop protocol",()=>{
+ let root:string,target:string,runs:string,store:ControlStore,service:ControlService,configHash:string,agent:AgentSelection;
  beforeAll(async()=>{
   root=await realpath(await mkdtemp(join(tmpdir(),"orca-real-ccloop-")));target=join(root,"target");runs=join(root,"runs");
   await mkdir(target,{mode:0o700});await mkdir(runs,{mode:0o700});await git(target,"init","-q");
   await writeFile(join(target,"answer.txt"),"0\n");await writeFile(join(target,"check.cjs"),'if(require("fs").readFileSync("answer.txt","utf8")!=="42\\n")process.exit(1);\n');
   await git(target,"add",".");await git(target,"commit","-qm","base");
   store=await openControlStore({stateDir:join(root,"state")});
-  const config=JSON.parse(await readFile(adapterConfigPath!,"utf8"));configHash=hashPayload(config);
+  const port=createCcloopExecutionPort({binary:await realpath(binary!),agentsTablePath:await realpath(agentsTablePath!),timeoutMs:15000});
+  const codex=(await port.listAgents()).installations.find(installation=>installation.kind==="codex");
+  if(!codex)throw new Error("the agents table has no codex installation");
+  const resolution=await port.resolveAgent({agent:codex.id});configHash=resolution.configHash;agent=resolution.selection;
   const check=`${process.execPath} check.cjs`;
   const contract={objective:{taskId:"T1",goal:"Set answer.txt to 42",successCondition:"answer is 42",nonGoals:[]},context:{repoPath:target,targetPaths:["answer.txt"],relevantDocs:[],buildTestCommands:[check],constraints:[]},executionPolicy:{autonomyLevel:"L2",maxAttempts:1,perAttemptTimeoutMs:30000,totalRuntimeBudgetMs:120000,tokenBudget:1000,worktreeRequired:true,partialOutcomeRecoveryWindowMs:100},safetyPolicy:{allowlistPaths:["answer.txt"],denylistPaths:[],maxFilesTouched:2,humanGateConditions:[]},verification:{verifierType:"agent",requiredChecks:[check],rejectOn:["failure"],evidenceRequired:[]},escalationAndExit:{escalationTargets:[],pauseOn:[],stopOn:[],terminalStates:["succeeded","blocked_waiting_human","exhausted","cancelled","failed"]}};
   createGroup(store,{groupId:"g1",projectKey:"fixture/repo",goal:"Ship",successConditions:["checks pass"],budgetMode:"soft",limit:amount(5000,300000,20,20),reviewReserve:amount(0,0,0,0),deadlineAt:null},{commandId:"create",expectedRevision:0,by:"test"});
-  putWork(store,"g1",{workItemId:"T1",taskId:"T1",kind:"task",dependsOn:[],contract,configHash,grant:{work:amount(2000,120000,6,3),handoff:amount(200,30000,1,1)}},{commandId:"task",expectedRevision:1,by:"test"});
-  service=new ControlService(store,createCcloopExecutionPort({binary:await realpath(binary!),adapter:"codex",adapterConfigPath:await realpath(adapterConfigPath!),timeoutMs:15000}));
+  putWork(store,"g1",{workItemId:"T1",taskId:"T1",kind:"task",dependsOn:[],contract,configHash,agent,grant:{work:amount(2000,120000,6,3),handoff:amount(200,30000,1,1)}},{commandId:"task",expectedRevision:1,by:"test"});
+  service=new ControlService(store,port);
  },120000);
  afterAll(async()=>{store?.close();if(root&&process.env.ORCA_KEEP_REAL_PROTOCOL_ROOT!=="1")await rm(root,{recursive:true,force:true});else if(root)process.stdout.write(`KEPT_REAL_PROTOCOL_ROOT=${root}\n`);});
 
@@ -49,12 +56,12 @@ describe.skipIf(!binary || !adapterConfigPath)("real ccloop protocol",()=>{
   const claim=await service.claim("g1","T1"),sourceDir=join(runs,claim.runId);await mkdir(sourceDir,{mode:0o700});
   const contract=(JSON.parse(String(store.db.prepare("SELECT body FROM work_items WHERE group_id='g1' AND id='T1'").get()?.body))).contract;
   const base=await git(target,"rev-parse","HEAD");
-  const first=await startClaim(store,service.executionPort(),{protocol:1,claim,contractHash:hashPayload(contract),inputCheckpoint:null,work:{contract,targetRepo:target,base,sourceDir}});
+  const first=await startClaim(store,service.executionPort(),{protocol:2,claim,contractHash:hashPayload(contract),inputCheckpoint:null,work:{contract,targetRepo:target,base,sourceDir}});
   const replay=await service.executionPort().accept(JSON.parse(String(store.db.prepare("SELECT body FROM outbox WHERE id=?").get("start:"+claim.runId)?.body)));
   expect(replay).toMatchObject({kind:"accepted",executionId:first.executionId});
   const report=await completed(claim.runId);expect(report.terminal?.outcome).toBe("succeeded");expect(report.candidate?.result).toBe("complete");expect(Number(store.db.prepare("SELECT count(*) AS n FROM usage_events WHERE run_id=?").get(claim.runId)?.n)).toBeGreaterThan(0);expect(report.candidate?.usageHighWater).toBeGreaterThan(0);const proof=report.candidate!.stopProof!,proofRaw=JSON.parse((await readArtifact(store,proof.source)).toString());expect(proofRaw).toMatchObject({executionId:first.executionId,generation:claim.generation,isolated:true});expect(getRun(store,claim.runId).executionId).toBe(proofRaw.executionId);
   const repoDir=join(sourceDir,"repo");await writeFile(join(repoDir,"dirty.txt"),"preserve me\n");
-  putWork(store,"g1",{workItemId:"handoff-T1",taskId:"T1",kind:"handoff",dependsOn:[],contract:{reason:"continue"},configHash,grant:{work:amount(0,0,0,0),handoff:amount(200,30000,1,1)},parentRunId:claim.runId},{commandId:"handoff-work",expectedRevision:2,by:"test"});
+  putWork(store,"g1",{workItemId:"handoff-T1",taskId:"T1",kind:"handoff",dependsOn:[],contract:{reason:"continue"},configHash,agent,grant:{work:amount(0,0,0,0),handoff:amount(200,30000,1,1)},parentRunId:claim.runId},{commandId:"handoff-work",expectedRevision:2,by:"test"});
   await service.requestHandoff("g1",claim.runId,{requestId:"handoff-1",reason:"context",deadlineAt:new Date(Date.now()+30000).toISOString()});
   expect(getRun(store,claim.runId)).toMatchObject({state:"settled",recoverable:true});
   const next=await service.continueTask("g1","T1",{commandId:"continue-1",expectedRevision:readGroup(store,"g1").revision});expect(next.runId).not.toBe(claim.runId);expect(next.executionId).not.toBe(first.executionId);
@@ -62,7 +69,7 @@ describe.skipIf(!binary || !adapterConfigPath)("real ccloop protocol",()=>{
   expect(nextEnvelope.inputCheckpoint).toMatchObject({predecessorRunId:claim.runId});
   const manifest=JSON.parse(await readFile(join(nextEnvelope.inputCheckpoint.bundlePath,"resume-bundle.json"),"utf8")),snapshotEntry=manifest.artifacts.find((entry:any)=>entry.ref.artifactId===manifest.snapshot.artifactId),snapshot=JSON.parse(await readFile(join(nextEnvelope.inputCheckpoint.bundlePath,snapshotEntry.file),"utf8"));expect(snapshot.tree.some((entry:any)=>entry.path==="dirty.txt")).toBe(true);
   const resumed=await completed(next.runId);expect(resumed.terminal?.outcome).toBe("succeeded");expect(resumed.candidate?.result).toBe("complete");expect(await git(target,"show","refs/ccloop/run/attempts/1:dirty.txt")).toBe("preserve me");expect(await readFile(join(nextEnvelope.work.sourceDir,"repo","dirty.txt"),"utf8")).toBe("preserve me\n");
-  const groupHandoff=JSON.parse((await buildGroupHandoff(store,"g1")).json.toString()),checkpoint=store.db.prepare("SELECT id,hash FROM checkpoints WHERE run_id=?").get(claim.runId),processes={first:JSON.parse(await readFile(join(sourceDir,"control","processes.json"),"utf8")),continuation:JSON.parse(await readFile(join(nextEnvelope.work.sourceDir,"control","processes.json"),"utf8"))};expect(groupHandoff.groupCheckpointId).toMatch(/^[a-f0-9]{64}$/);process.stdout.write(`CONTROL_PROTOCOL_EVIDENCE=${JSON.stringify({root,binary,adapterConfigPath,configHash,first:{runId:claim.runId,executionId:first.executionId,checkpoint},continuation:{runId:next.runId,executionId:next.executionId,candidateCheckpointId:resumed.candidate?.checkpointId},groupCheckpointId:groupHandoff.groupCheckpointId,processes})}\n`);
+  const groupHandoff=JSON.parse((await buildGroupHandoff(store,"g1")).json.toString()),checkpoint=store.db.prepare("SELECT id,hash FROM checkpoints WHERE run_id=?").get(claim.runId),processes={first:JSON.parse(await readFile(join(sourceDir,"control","processes.json"),"utf8")),continuation:JSON.parse(await readFile(join(nextEnvelope.work.sourceDir,"control","processes.json"),"utf8"))};expect(groupHandoff.groupCheckpointId).toMatch(/^[a-f0-9]{64}$/);process.stdout.write(`CONTROL_PROTOCOL_EVIDENCE=${JSON.stringify({root,binary,agentsTablePath,configHash,agent,first:{runId:claim.runId,executionId:first.executionId,checkpoint},continuation:{runId:next.runId,executionId:next.executionId,candidateCheckpointId:resumed.candidate?.checkpointId},groupCheckpointId:groupHandoff.groupCheckpointId,processes})}\n`);
  },120000);
 
  it.each(["after-archive","before-projection"])("recovers the Orca SIGKILL boundary without duplicating checkpoint or D3 Markdown: %s",async point=>{const sample=await crashCase(point,"control-crash-worker.mjs");try{const first=await sample.recover(),path=join(sample.root,"state","exports","groups","g1","handoff.md"),markdown=await readFile(path,"utf8"),checkpoints=Number(sample.store.db.prepare("SELECT count(*) AS n FROM checkpoints").get()?.n);const second=await sample.recover();expect(second.launches).toBe(first.launches);expect(Number(sample.store.db.prepare("SELECT count(*) AS n FROM checkpoints").get()?.n)).toBe(checkpoints);expect(await readFile(path,"utf8")).toBe(markdown);}finally{await sample.dispose();}},30000);
````


  这三处在没有 `ORCA_CCLOOP_BIN` 时 skip（副本实测 skip 数：executionDriverE2E 9、handoffE2E 12、webCcloopSmoke 3＋2 passed、integration 3）。**真跑**要 ccloop T1–T6 已落地的 build：在 ccloop 的 `git clone --local` 副本里 `npm run build`，然后
  `ORCA_CCLOOP_BIN=<副本>/dist/cli.js ./node_modules/.bin/vitest run tests/control/webCcloopSmoke.test.ts > $S/t7-s8-smoke.log 2>&1; echo rc=$?`
  `ORCA_CCLOOP_BIN=<副本>/dist/cli.js ./node_modules/.bin/vitest run tests/control/executionDriverE2E.test.ts > $S/t7-s8-e2e.log 2>&1; echo rc=$?`
  `ORCA_CCLOOP_BIN=<副本>/dist/cli.js ./node_modules/.bin/vitest run tests/control/handoffE2E.test.ts > $S/t7-s8-handoff.log 2>&1; echo rc=$?`
  Expected：三个 rc=0。**本写作席没有跑过**（ccloop 新线尚未存在）；红了先查 M-10 的四条依赖是否与 ccloop 实际一致。`ccloopProtocol.integration.test.ts` 只在 `verify:control`（`ORCA_CCLOOP_BIN`＋`ORCA_AGENTS_TABLE` 都给）下跑。

- [ ] **Step 9: 收口 —— typecheck 与相关文件逐个单跑**
  `./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t7-tsc.log 2>&1; echo rc=$?` ⇒ Expected rc=0（副本实测 rc=0）。
  `(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t7-web-tsc.log 2>&1; echo rc=$?)` ⇒ rc=0（副本实测）。
  `for f in tests/control/*.test.ts tests/panel/*.test.ts; do ./node_modules/.bin/vitest run "$f" --reporter=json --outputFile="$S/t7-final/$(echo $f | tr / _).json" > /dev/null 2>&1; echo "$f rc=$?"; done > $S/t7-final.txt`（先 `mkdir -p $S/t7-final`；面板判据要先 `npm run build --workspace web`）⇒ Expected 每行 rc=0（副本实测：96 个文件全部 rc=0，见 §W4.3）。

- [ ] **Step 10: 变异（每个新分支一条，只在 `git clone --local` 副本里做；还原后 `git diff` 与 `git diff --cached` 字节数为 0）**

| 变异 | 在哪、改成什么 | 跑哪个文件 | 预期红的判据 | 副本实测 |
|---|---|---|---|---|
| M7-1 | `src/control/ccloopPort.ts` `resolveAgent`：删掉回显核对那一行（`selection-not-echoed`） | `tests/control/ccloopPort.test.ts` | does not echo a field | 红（点名判据红）：production ccloop execution port > refuses a resolution that does not echo a field the request gave (spec M5) |
| M7-2 | `ccloopPort.ts` `listAgents`：请求 `{agent:null}` 改成 `{}` | `tests/control/ccloopPort.test.ts` | lists the installations | 红（点名判据红）：production ccloop execution port > lists the installations by asking capabilities with agent null; production ccloop execution port > TEMPORARY (plan T11 deletes it): a probe given no selection asks about the table's first installation, with nothing overridden |
| M7-3 | `ccloopPort.ts` `named()`：不再按原名重抛，原样返回 `control-peer-exit` | `tests/control/ccloopPort.test.ts` | named refusals | 红（点名判据红）：production ccloop execution port > rethrows ccloop's named refusals of a selection or table under their own names, and any other exit as a peer exit (agent selection spec §7) |
| M7-4 | `src/control/profiles.ts` `temporaryProbeSelection`：返回 `{}` 而不是 `{agent: ids[0]}` | `tests/control/ccloopPort.test.ts` | TEMPORARY | 红（点名判据红）：production ccloop execution port > TEMPORARY (plan T11 deletes it): a probe given no selection asks about the table's first installation, with nothing overridden |
| M7-5 | `profiles.ts` `probe`：忽略传入的 `selection`，总走临时路径 | `tests/control/profiles.test.ts` | probes exactly the selection | 红（点名判据红）：trusted execution profiles > probes exactly the selection it is asked about (agent selection spec §6.4) |
| M7-6 | `src/control/ownership.ts`：删掉比对 `agent` 的那一行 | `tests/control/dispatch.test.ts` | names a selection other than | 红（点名判据红）：durable starts > refuses an envelope whose claim names a selection other than the run's frozen one, before anything is sent |
| M7-7 | `src/control/dispatch.ts` `startClaim`：闸门问 `resolveAgent({})` 而不是 `input.claim.agent` | `tests/control/dispatch.test.ts` | own frozen selection | 红（点名判据红）：durable starts > asks the capability gate about the claim's own frozen selection, at start and at a re-send (agent selection spec §6.4) |
| M7-8 | `src/control/startEnvelope.ts`：run 行 schema 删掉 `agent: agentSelectionSchema` | `tests/control/startEnvelope.test.ts` | no frozen selection | 红（点名判据红）：translating a frozen dispatch envelope into a start envelope > copies the claim from the run row and the contract hash from the ledger, field by field; translating a frozen dispatch envelope into a start envelope > drops the run row's own extra columns instead of smuggling them onto the wire; transl |
| M7-9 | `src/control/driverHandoff.ts` `settleIfPastGrace`：删掉按 run 的 killGraceMs 判断的那一行（只剩固定一分钟） | `tests/control/driverHandoff.test.ts` | killGraceMs ccloop answers | 红（点名判据红）：the grace is the run's own agent killGraceMs plus the fixed minute (spec §3; agent selection spec §6.6) > does not call a request outcome-unknown before the killGraceMs ccloop answers for the run's selection has passed |
| M7-10 | `driverHandoff.ts` `handoffGraceMsOf`：去掉「非负安全整数」检查，直接用 ccloop 的值 | `tests/panel/assemblyHandoffGrace.test.ts` | only the fixed extra | 红（点名判据红）：the handoff grace the driver waits (spec §3) > is the agent's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable |
| M7-11 | `src/scheduler/ccloopRunner.ts`：选择文件去掉 `mode: 0o600`（按 umask 建） | `tests/control/driverReconcile.test.ts` | --agent-selection | 红（点名判据红）：reconciling a conflict (spec §5.3) > spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding a frozen selection with its configHash (agent selection spec §4.9) |
| M7-12 | `src/control/driverLanding.ts`：解冲突改回 `adapter: "codex", adapterConfig: …` 旧形态 | `tests/control/driverReconcile.test.ts` | RC1 | 红（点名判据红）：reconciling a conflict (spec §5.3) > RC1: a separate run resolves the conflict and it lands as a merge of the tip and the run's own attempt; reconciling a conflict (spec §5.3) > spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding a frozen sele |
| M7-13 | `src/panel/controlOptions.ts`：`ORCA_CCLOOP_ADAPTER_CONFIG` 也算第二个变量 | `tests/panel/controlOptions.test.ts` | needs both variables | 红（点名判据红）：resolveControlOptions reports whether an execution port is configured > needs both variables, not either one |
| M7-14 | `src/control/webDispatch.ts` run 构造：不拷 `agent: work.agent` | `tests/control/driverReconcile.test.ts` | --agent-selection | 红（点名判据红）：reconciling a conflict (spec §5.3) > RC1: a separate run resolves the conflict and it lands as a merge of the tip and the run's own attempt; reconciling a conflict (spec §5.3) > spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding a frozen sele |
| M7-15 | `src/control/unconfiguredPort.ts`：`resolveAgent` 抛普通 Error 而不是 `control-port-unconfigured` | `tests/control/unconfiguredPort.test.ts` | refuses every method | 红（点名判据红）：the unconfigured execution port > refuses every method it has, not merely the obvious ones; the unconfigured execution port > refuses a second time exactly as it refused the first, holding no state; a claim against an unconfigured port > refuses by the port's own name and writes no run, rather than  |

还原核对（`git diff --stat`，应为空）：git diff --stat after restore: ''

- [ ] **Step 11: 提交**
  `/usr/bin/git add -A src tests web/src web/tests scripts && /usr/bin/git commit -F $S/t7-msg.txt`，`$S/t7-msg.txt`：
  ```
  feat(control): speak envelope v2, capabilities v3 and --agents to ccloop

  The start claim carries the run's frozen agent selection (protocol 2),
  capabilities are asked about one selection (resolveAgent) or the table
  (listAgents), and every ccloop call names an agents table instead of
  one adapter config. ORCA_AGENTS_TABLE replaces ORCA_CCLOOP_ADAPTER_CONFIG.
  The driver's reconciliation run moves to ccloop run --agents with the
  conflicted run's own selection until the group reconcile slot exists.

  Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
  ```
  并在 `progress.md` 按 Global Constraints 逐条列出改写的既有判据全名（即上面红表中标 T7 的各条）。

---

### Task 12: 解冲突 run 用组冻结的 reconcile 选择走 `ccloop run --agents <table> --agent-selection <file>`（旧 `orca run` 保留 `--adapter`）

**依赖**：T7（机制已在 T7 落地，见 M-4：`AgentsRunTaskOptions`、0600 选择文件、`fake-ccloop-run.mjs` 收新形态并拒 `--adapter`）、T11（组记录上的 `reconcileSlot: FrozenSlot | null`，确认时冻结）、ccloop T6。
**Files**:
- Modify: `src/control/driverLanding.ts`（`stepR` 里 `reconcileAffordable` 判断之后、`await rm(workdir…)` 之前加一段；`runTask(...)` 的 `agentSelection` 一行 —— 行号以 T11 落地后现测为准，T7 之后该段在 `stepR` 中部，锚点见 diff）。
- Test: `tests/control/driverReconcile.test.ts`（把 T7 写的桥判据整条改写为「组的 reconcile 槽」；新增一条缺槽即 block）。
- 不改：`src/scheduler/ccloopRunner.ts` 的 `AdapterRunTaskOptions` 分支与 `src/scheduler/run.ts:631` 的调用 —— 旧 `orca run` 仍是 `--adapter <a> --adapter-config <f>`（`tests/scheduler/scenarios/*` 用真 ccloop build 的 `scripted` 适配器钉着它，见 Step 5 的变异 M12-3）。

**Interfaces**
- Consumes：T11 写在组记录上的 `reconcileSlot: FrozenSlot | null`（只读 `.selection` 与 `.configHash`；读组的原始 body，因为 `GroupRecord` 类型不含它）；T7 的 `AgentsRunTaskOptions`。
- Produces：驱动环 blockedReason `reconcile-agent-unfrozen`（R 步；与 `reconcile-budget` 同一种 block，run 留在 `reconciling` 之前的状态由 `blockRun` 统一处理）。

⚠️ 前提：T11 的确认必须给 `driverHarness`（Web 夹具）的组冻结出 reconcile 槽，否则本文件所有走到 R 步的既有判据都会以 `reconcile-agent-unfrozen` block —— 那是 T11 的缺陷，不在这里放宽。写作席的副本里没有 T11，用一个**只在副本里**的替身（`driverHarness` 确认后把一个固定的槽写进组 body）验证了本 Task，替身不属于本计划。

- [ ] **Step 1: 改写判据（RED）**

`tests/control/driverReconcile.test.ts`：

````diff
diff --git a/tests/control/driverReconcile.test.ts b/tests/control/driverReconcile.test.ts
index 44022fb..fb8b0ba 100644
--- a/tests/control/driverReconcile.test.ts
+++ b/tests/control/driverReconcile.test.ts
@@ -64,16 +64,32 @@ describe("reconciling a conflict (spec §5.3)", { timeout: 30_000 }, () => {
     } finally { await t.h.dispose(); }
   });
 
-  it("spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding a frozen selection with its configHash (agent selection spec §4.9)", async () => {
+  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): plan T7 spawned the
+  // reconciliation with the conflicted run's own selection as a bridge; spec §6.1 gives it the group's reconcile slot.
+  it("spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding the group's frozen reconcile selection with its configHash (agent selection spec §4.9, §6.1)", async () => {
     const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }); try {
+      const slot = { selection: { agent: "claude", model: "reconcile-model", contextWindow: 1_000_000 }, configHash: "f".repeat(64) };
+      const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
+      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...group, reconcileSlot: { ...group.reconcileSlot, ...slot } }));
       const driver = t.driver();
       await untilDeadline(driver, () => t.ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
       expect(t.ids.every((id) => LANDED.includes(t.body(id).state))).toBe(true);
-      const reconciled = t.ids.find((id) => t.body(id).drive.reconcile !== null)!;
       const selections = readFileSync(`${t.deps.agentsTablePath}.selections`, "utf8").trim().split("\n").map((line) => JSON.parse(line));
-      // Plan T7 bridge: the conflicted run's own frozen selection and configHash (plan T12 moves this to the group's reconcile slot).
-      expect(selections).toEqual([{ selection: { selection: t.body(reconciled).agent, configHash: t.body(reconciled).configHash }, mode: 0o600 }]);
-      expect(t.body(reconciled).agent).toEqual({ agent: "codex", model: "fixture-model", contextWindow: "agent-default" });
+      expect(selections).toEqual([{ selection: slot, mode: 0o600 }]);
+      // Not the worker's: the conflicted runs were frozen with the fixture's codex selection.
+      expect(t.ids.map((id) => t.body(id).agent.model)).toEqual(["fixture-model", "fixture-model"]);
+    } finally { await t.h.dispose(); }
+  });
+
+  it("blocks a conflict whose group has no frozen reconcile selection, before any reconciliation run (agent selection spec §6.1)", async () => {
+    const t = await twoConflicting({ files: { "shared.txt": "A\nB\n" } }); try {
+      const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
+      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...group, reconcileSlot: null }));
+      const driver = t.driver();
+      await untilDeadline(driver, () => t.ids.some((id) => t.body(id).state === "blocked"));
+      const blocked = t.ids.find((id) => t.body(id).state === "blocked")!;
+      expect(t.body(blocked).drive).toMatchObject({ blockedAt: "R", blockedReason: "reconcile-agent-unfrozen" });
+      expect(t.spawns()).toEqual([]);
     } finally { await t.h.dispose(); }
   });
````


- [ ] **Step 2: 跑，确认红**
  `./node_modules/.bin/vitest run tests/control/driverReconcile.test.ts > $S/t12-red.log 2>&1; echo rc=$?` ⇒ Expected rc=1；两条红：选择文件里是被冲突 run 自己的选择而不是组槽的（`reconcile-model` 不在）、缺槽的组照样起了解冲突（`spawns()` 长度 1、没有 `reconcile-agent-unfrozen`）。

- [ ] **Step 3: 实现**

`src/control/driverLanding.ts`：

````diff
diff --git a/src/control/driverLanding.ts b/src/control/driverLanding.ts
index 46b6430..80417fd 100644
--- a/src/control/driverLanding.ts
+++ b/src/control/driverLanding.ts
@@ -16,6 +16,7 @@ import { QUIET_GIT, compareAndSwap, conflictPathOf, incomingRefOf, landingPathOf
 import type { ReconcileRecord } from "./driveRecord.js";
 import type { ControlStore } from "./store.js";
 import type { PlanFile, PlanTask } from "../scheduler/planFile.js";
+import type { AgentSelection } from "./agentSelection.js";
 
 /**
  * Execution driver spec §5. Nothing here runs in the person's checkout: every merge happens in a
@@ -272,6 +273,10 @@ export async function stepR(deps: ExecutionDriverDeps, runId: string, context: D
   if (action === "collect") return finishReconcile(deps, runId, record, loop, await latestAttemptSha(cloneDirOf(workdir), record.reconcileRunId));
   if (context.stopped || deps.admissionGate?.draining) return false;
   if (!reconcileAffordable(store, run.groupId, record.tokenBudget)) { blockRun(deps, runId, "R", "reconcile-budget"); return true; }
+  // Agent selection spec §6.1, §4.9: a reconciliation runs with the group's reconcile slot, frozen at confirm (plan
+  // T11) -- not with the conflicted run's own selection. A group with no frozen slot is refused before any spawn.
+  const slot = (readGroup(store, run.groupId) as unknown as { reconcileSlot?: { selection: AgentSelection; configHash: string } | null }).reconcileSlot ?? null;
+  if (slot === null) { blockRun(deps, runId, "R", "reconcile-agent-unfrozen"); return true; }
   await rm(workdir, { recursive: true, force: true });
   const setRecord = (patch: Partial<ReconcileRecord>): void => write(deps, () => {
     const current = readDriverRun(store, runId);
@@ -282,9 +287,9 @@ export async function stepR(deps: ExecutionDriverDeps, runId: string, context: D
   const plan: PlanFile = { targetRepo: record.copyPath, ccloopBin: deps.ccloopBin, runsDir: record.runsDir, workBranch: `orca/${run.groupId}`, policy: "local-merge", ledgerMode: "out-of-repo", tasks: [] };
   const task: PlanTask = { taskId: record.reconcileRunId, contract: record.contractPath, dependsOn: [] };
   const running = runTask(plan, task, record.conflictCommit, record.reconcileRunId, {
-    // Agent selection spec §4.9. Plan T7 bridge: the conflicted run's own frozen selection and configHash, exactly
-    // what the reconciliation ran with before; plan T12 replaces it with the group's frozen reconcile slot (§6.1).
-    agentsTable: deps.agentsTablePath, agentSelection: { selection: run.agent, configHash: run.configHash },
+    // Agent selection spec §4.9: ccloop materializes this selection against the table and refuses to run when the
+    // hash or the installed version no longer matches.
+    agentsTable: deps.agentsTablePath, agentSelection: { selection: slot.selection, configHash: slot.configHash },
     // Final review I3: its own process group, output in files inside its runs dir, unref'd -- the panel
     // closing (or a Ctrl-C to its process group) does not end it, and a restarted driver waits on its pid.
     detachedLogDir: workdir,
````


- [ ] **Step 4: 跑到绿**
  `./node_modules/.bin/vitest run tests/control/driverReconcile.test.ts > $S/t12-green.log 2>&1; echo rc=$?`，另逐个跑 `tests/control/driverReconcileN.test.ts`、`tests/control/driverHandoff.test.ts`、`tests/control/blockedStaysPut.test.ts`（都走 R 步）⇒ Expected 全部 rc=0（副本实测，带上述副本替身：driverReconcile 26/26、driverReconcileN 5/5、driverHandoff 29/29、blockedStaysPut 4/4）。
  驱动环 E2E（`executionDriverE2E` 的冲突场景、`handoffE2E` 的三路冲突）在 T16 的混组里断言解冲突 run 的 reconcile 选择出现在 fake 的 `.argv`（spec §9 判据 11）；本 Task 另跑一次现有两个 E2E 文件（命令同 T7 Step 8）⇒ rc=0。

- [ ] **Step 5: 变异（副本里做，还原后 `git diff`／`git diff --cached` 字节数为 0）**

| 变异 | 在哪、改成什么 | 跑哪个文件 | 预期红的判据 | 副本实测 |
|---|---|---|---|---|
| M12-1 | `src/control/driverLanding.ts`：选择文件改回被冲突 run 自己的 `{agent, configHash}` | `tests/control/driverReconcile.test.ts` | group's frozen reconcile selection | 红（点名判据红）：reconciling a conflict (spec §5.3) > spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding the group's frozen reconcile selection with its configHash (agent selection spec §4.9, §6.1) |
| M12-2 | `driverLanding.ts`：删掉 `slot === null` 的 block | `tests/control/driverReconcile.test.ts` | no frozen reconcile selection | 红（点名判据红）：reconciling a conflict (spec §5.3) > blocks a conflict whose group has no frozen reconcile selection, before any reconciliation run (agent selection spec §6.1) |
| M12-3 | `src/scheduler/ccloopRunner.ts` 旧分支：`--adapter … --adapter-config …` 改成 `--agents <adapterConfig>` | `tests/scheduler/scenarios/S1.test.ts` | （任一） | 红（点名判据红）：S1 (spec §10.2: the basic path) > S1: two tasks with disjoint write sets share a layer, both land, and the round exits 0 |

还原核对（`git diff --stat`，应为空）：git diff --stat after restore: ''

- [ ] **Step 6: 提交**
  `feat(driver): run the reconciliation with the group's frozen reconcile selection`（`src/control/driverLanding.ts`、`tests/control/driverReconcile.test.ts`），两行 trailer；在 `progress.md` 记下改写的判据全名：`tests/control/driverReconcile.test.ts > reconciling a conflict (spec §5.3) > spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, …`（T7 新增、T12 改写）。

---

### Task 13: `orca agents init|show`（Rule 17）＋ Web spec 两节 ERRATUM

**依赖**：T7（`createCcloopExecutionPort({binary, agentsTablePath})`、`resolveAgent`／`listAgents`、W6-11 的具名拒绝）；ccloop T2（`ccloop agents detect|validate`）。
**Files**:
- Create: `src/agents/paths.ts`、`src/agents/command.ts`、`tests/agents/command.test.ts`。
- Modify: `src/cli.ts`（import 区 `:23` 之后一行；USAGE 在 `orca chain unlock` 之前插两段；`main` 在 `command === "chain"` 分支之后加一个分支 —— 行号以 T7 落地后现测为准）；`docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`（**只在文件末尾追加**两节，原文一字不动）。

**Interfaces**
- Consumes：T7 的端口；ccloop T2 的 `agents detect` 输出 `{schema:"ccloop-agents-detect-v1", table:{schema:"ccloop-agents-table-v1", …}, candidates}`（本 Task 只核两个 schema 字面量，表内容原样写盘）与 `agents validate <table>`（RC 0 ⇔ 全部 ok；stdout 原样转印，不解析 —— M-8）。
- Produces：`agentsTablePath(env)`、`AGENTS_DIR_MODE`（0o700）、`AGENTS_FILE_MODE`（0o600）、`draftPathOf(table)`（`src/agents/paths.ts`）；`runAgentsCommand(args, env, io)`（`src/agents/command.ts`）；CLI 动词 `orca agents init`、`orca agents show`。

**Rule 17 落点（spec §8）**：写入方只有 `init`；路径 `ORCA_AGENTS_TABLE`（必须绝对路径）或 `~/.orca/agents.json`（`os.homedir()`，调用时读 env）；缺失的每一级目录 `mkdir(0o700)` 后再 `chmod(0o700)`（不从 umask 继承）；新文件 `open(tmp,"wx",0o600)` 后 `fchmod(0o600)`；已存在的目录与文件**不改 mode**；表不存在 ⇒ 临时文件 `link` 成表名（`link` 拒绝已存在的名字 ⇒ 检查之后才冒出来的表也不会被覆盖）再删临时文件；表已存在（含软链、任意类型）⇒ 临时文件 `rename` 成 `<table>.draft.json`（草稿是 Orca 自己的产物，可覆盖；`rename` 替换软链本身、不跟随）并打印 `git diff --no-index` 的输出；临时文件名 `.<basename>.orca-agents-<16 hex>.tmp`，下次 init 开头只删**名字完全匹配且 `lstat` 为普通文件**的，软链与目录不碰。ccloop 侧零写入。

- [ ] **Step 1: 写失败判据** —— `tests/agents/command.test.ts`（整份新建；stand-in ccloop 是临时目录里的 node 脚本，HOME 指向必须保持为空的临时目录）：

`tests/agents/command.test.ts`：

````diff
diff --git a/tests/agents/command.test.ts b/tests/agents/command.test.ts
new file mode 100644
index 0000000..1884fb6
--- /dev/null
+++ b/tests/agents/command.test.ts
@@ -0,0 +1,168 @@
+import { execFile } from "node:child_process";
+import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
+import { tmpdir } from "node:os";
+import { join, resolve } from "node:path";
+import { promisify } from "node:util";
+import { afterEach, describe, expect, it } from "vitest";
+import { runAgentsCommand } from "../../src/agents/command.js";
+import { agentsTablePath } from "../../src/agents/paths.js";
+
+// Agent selection spec §6.7, §8 and CLAUDE.md Rule 17: `orca agents init` is the one writer of the installation
+// table, user data outside any repository. Every criterion points ORCA_AGENTS_TABLE into a temporary directory and
+// HOME at an empty one that must stay empty; the ccloop here is a stand-in answering `agents detect|validate` and
+// `control capabilities` from a script file, so no real agent is probed.
+const roots: string[] = [];
+afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
+
+const TABLE = { schema: "ccloop-agents-table-v1", installations: { claude: { kind: "claude", command: ["/opt/claude"], version: "2.1.282", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000 } } };
+
+async function world(script: Record<string, unknown> = {}) {
+  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-agents-cli-")));
+  roots.push(root);
+  const home = join(root, "home");
+  await mkdir(home);
+  const binary = join(root, "ccloop");
+  const scriptPath = join(root, "script.json");
+  await writeFile(scriptPath, JSON.stringify({ table: TABLE, ...script }));
+  await writeFile(binary, `#!${process.execPath}
+const fs = require("node:fs");
+const script = JSON.parse(fs.readFileSync(${JSON.stringify(scriptPath)}, "utf8"));
+const [a, b, c, d] = process.argv.slice(2);
+if (a === "agents" && b === "detect") { process.stdout.write(script.detect ?? JSON.stringify({ schema: "ccloop-agents-detect-v1", table: script.table, candidates: {} })); process.exit(0); }
+if (a === "agents" && b === "validate") { process.stdout.write(JSON.stringify([{ id: "claude", ok: script.validateOk !== false }]) + "\\n"); process.exit(script.validateOk === false ? 1 : 0); }
+if (a === "control" && b === "capabilities" && c === "--agents") {
+  let stdin = ""; process.stdin.on("data", (x) => { stdin += x; }); process.stdin.on("end", () => {
+    const request = JSON.parse(stdin);
+    if (request.agent === null) process.stdout.write(JSON.stringify({ protocol: 3, installations: [{ id: "claude", kind: "claude", defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1000000], version: "2.1.282" }] }));
+    else if (script.driftFor === request.agent.agent) { process.stderr.write("agent-version-drift\\n"); process.exit(1); }
+    else process.stdout.write(JSON.stringify({ protocol: 3, selection: { model: "claude-opus-5-5", contextWindow: "agent-default", ...request.agent }, configHash: "e".repeat(64), timeoutMs: 1800000, killGraceMs: 5000,
+      capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } }));
+  });
+} else { process.stderr.write("unexpected " + process.argv.slice(2).join(" ") + "\\n"); process.exit(9); }
+`, { mode: 0o700 });
+  const table = join(root, "orca", "nested", "agents.json");
+  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: table };
+  const out: string[] = [], err: string[] = [];
+  const io = { stdout: (text: string) => { out.push(text); }, stderr: (text: string) => { err.push(text); } };
+  const agents = (verb: string, over: NodeJS.ProcessEnv = {}) => runAgentsCommand([verb], { ...env, ...over }, io);
+  return { root, home, binary, table, env, out, err, agents, scriptPath };
+}
+
+const modeOf = async (path: string): Promise<number> => (await lstat(path)).mode & 0o777;
+
+describe("orca agents init (agent selection spec §6.7, §8)", () => {
+  it("writes the detected table where ORCA_AGENTS_TABLE says, creating directories 0700 and the file 0600, and nothing under HOME", async () => {
+    const w = await world();
+    expect(await w.agents("init")).toBe(0);
+    expect(JSON.parse(await readFile(w.table, "utf8"))).toEqual(TABLE);
+    expect(await modeOf(w.table)).toBe(0o600);
+    expect(await modeOf(join(w.root, "orca", "nested"))).toBe(0o700);
+    expect(await modeOf(join(w.root, "orca"))).toBe(0o700);
+    expect(await readdir(join(w.root, "orca", "nested"))).toEqual(["agents.json"]);
+    expect(await readdir(w.home)).toEqual([]);
+    expect(w.out.join("")).toContain(`wrote ${w.table}`);
+  });
+
+  it("defaults to ~/.orca/agents.json, read from the environment it is given", () => {
+    expect(agentsTablePath({ HOME: "/nowhere", ORCA_AGENTS_TABLE: "/x/agents.json" })).toBe("/x/agents.json");
+    expect(agentsTablePath({ ORCA_AGENTS_TABLE: "" }).endsWith(join(".orca", "agents.json"))).toBe(true);
+  });
+
+  it("never overwrites an existing table: the bytes and mode stay, the detection goes to the draft 0600, and the diff is printed", async () => {
+    const w = await world();
+    await mkdir(join(w.root, "orca", "nested"), { recursive: true, mode: 0o755 });
+    await chmod(join(w.root, "orca", "nested"), 0o755);
+    const original = '{ "schema": "ccloop-agents-table-v1", "installations": {} }\n';
+    await writeFile(w.table, original, { mode: 0o644 });
+    await chmod(w.table, 0o644);
+    expect(await w.agents("init")).toBe(0);
+    expect(await readFile(w.table, "utf8")).toBe(original);
+    expect(await modeOf(w.table)).toBe(0o644);
+    expect(await modeOf(join(w.root, "orca", "nested"))).toBe(0o755);
+    expect(JSON.parse(await readFile(`${w.table}.draft.json`, "utf8"))).toEqual(TABLE);
+    expect(await modeOf(`${w.table}.draft.json`)).toBe(0o600);
+    expect(w.out.join("")).toMatch(/^\+.*"claude"/m);
+    expect((await readdir(join(w.root, "orca", "nested"))).sort()).toEqual(["agents.json", "agents.json.draft.json"]);
+  });
+
+  it("treats a table that is a symlink as existing and leaves the file it points at untouched", async () => {
+    const w = await world();
+    await mkdir(join(w.root, "orca", "nested"), { recursive: true });
+    const elsewhere = join(w.root, "elsewhere.json");
+    await writeFile(elsewhere, "not mine\n");
+    await symlink(elsewhere, w.table);
+    expect(await w.agents("init")).toBe(0);
+    expect(await readlink(w.table)).toBe(elsewhere);
+    expect(await readFile(elsewhere, "utf8")).toBe("not mine\n");
+    expect(JSON.parse(await readFile(`${w.table}.draft.json`, "utf8"))).toEqual(TABLE);
+  });
+
+  it("replaces its own earlier draft", async () => {
+    const w = await world();
+    await mkdir(join(w.root, "orca", "nested"), { recursive: true });
+    await writeFile(w.table, "{}\n");
+    await writeFile(`${w.table}.draft.json`, "stale draft\n");
+    expect(await w.agents("init")).toBe(0);
+    expect(JSON.parse(await readFile(`${w.table}.draft.json`, "utf8"))).toEqual(TABLE);
+  });
+
+  it("removes a temporary file an earlier init left, and nothing that merely looks like one", async () => {
+    const w = await world();
+    const dir = join(w.root, "orca", "nested");
+    await mkdir(dir, { recursive: true });
+    const stale = join(dir, ".agents.json.orca-agents-0123456789abcdef.tmp");
+    await writeFile(stale, "left by a crash");
+    const target = join(w.root, "precious.txt");
+    await writeFile(target, "precious\n");
+    const linked = join(dir, ".agents.json.orca-agents-fedcba9876543210.tmp");
+    await symlink(target, linked);
+    const other = join(dir, ".agents.json.orca-agents-short.tmp");
+    await writeFile(other, "not our pattern");
+    expect(await w.agents("init")).toBe(0);
+    await expect(lstat(stale)).rejects.toThrow("ENOENT");
+    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
+    expect(await readFile(target, "utf8")).toBe("precious\n");
+    expect(await readFile(other, "utf8")).toBe("not our pattern");
+  });
+
+  it("gives the modes explicitly, not from the umask", async () => {
+    const w = await world();
+    // A child process, because the umask is per process: 0300 would strip the owner's write and execute bits from
+    // anything created with a mode it did not then set. `node --import tsx` rather than the tsx CLI, whose own IPC
+    // pipe would be created under the same umask.
+    const cli = resolve("src/cli.ts");
+    await promisify(execFile)("/bin/sh", ["-c", `umask 0300; exec "${process.execPath}" --import tsx "${cli}" agents init`], { env: w.env, cwd: resolve(".") });
+    expect(await modeOf(join(w.root, "orca", "nested"))).toBe(0o700);
+    expect(await modeOf(w.table)).toBe(0o600);
+  });
+
+  it("refuses a relative table path, a missing ccloop and a detection it cannot read, writing nothing", async () => {
+    const w = await world({ detect: "not json" });
+    expect(await w.agents("init", { ORCA_AGENTS_TABLE: "relative/agents.json" })).toBe(1);
+    expect(await w.agents("init", { ORCA_CCLOOP_BIN: "" })).toBe(1);
+    expect(await w.agents("init")).toBe(1);
+    await expect(lstat(join(w.root, "orca"))).rejects.toThrow("ENOENT");
+    expect(w.err.join("")).toMatch(/ORCA_AGENTS_TABLE must be an absolute path[\s\S]*ORCA_CCLOOP_BIN[\s\S]*not JSON/);
+  });
+});
+
+describe("orca agents show (agent selection spec §6.7)", () => {
+  it("prints ccloop's validation and what each installation resolves to, and exits 0 when all are accepted", async () => {
+    const w = await world();
+    expect(await w.agents("init")).toBe(0);
+    expect(await w.agents("show")).toBe(0);
+    const printed = w.out.join("");
+    expect(printed).toContain('[{"id":"claude","ok":true}]');
+    expect(printed).toContain(`claude (claude 2.1.282): {"agent":"claude","model":"claude-opus-5-5","contextWindow":"agent-default"} configHash ${"e".repeat(64)}`);
+  });
+
+  it("exits 1 and names the refusal when ccloop refuses an installation or the validation fails", async () => {
+    const drift = await world({ driftFor: "claude" });
+    expect(await drift.agents("init")).toBe(0);
+    expect(await drift.agents("show")).toBe(1);
+    expect(drift.out.join("")).toContain("claude (claude 2.1.282): refused: agent-version-drift");
+    const invalid = await world({ validateOk: false });
+    expect(await invalid.agents("init")).toBe(0);
+    expect(await invalid.agents("show")).toBe(1);
+  });
+});
````


- [ ] **Step 2: 跑，确认红**
  `./node_modules/.bin/vitest run tests/agents/command.test.ts > $S/t13-red.log 2>&1; echo rc=$?` ⇒ Expected rc=1，`Cannot find module '../../src/agents/command.js'`（整文件红）。

- [ ] **Step 3: 实现**

`src/agents/paths.ts`：

````diff
diff --git a/src/agents/paths.ts b/src/agents/paths.ts
new file mode 100644
index 0000000..d955ca6
--- /dev/null
+++ b/src/agents/paths.ts
@@ -0,0 +1,23 @@
+import { homedir } from "node:os";
+import { join } from "node:path";
+
+/**
+ * Agent selection spec §3, §8 and CLAUDE.md Rule 17. The installation table lives outside any repository, in
+ * the user's own data, so the environment variable is not a convenience: every criterion points it at a temporary
+ * directory, and without it a criterion would write into the developer's real ~/.orca.
+ *
+ * ⚠️ os.homedir(), never the literal "~" (node does not expand it), and read from the passed environment at call
+ * time, never at import time -- a module-level constant would freeze the real home in.
+ */
+export function agentsTablePath(env: NodeJS.ProcessEnv = process.env): string {
+  const override = env.ORCA_AGENTS_TABLE;
+  if (override !== undefined && override.length > 0) return override;
+  return join(homedir(), ".orca", "agents.json");
+}
+
+/** Given explicitly, never inherited from the umask; an existing directory or file keeps the mode its owner gave it. */
+export const AGENTS_DIR_MODE = 0o700;
+export const AGENTS_FILE_MODE = 0o600;
+
+/** spec §6.7: an existing table is never overwritten; the new detection goes beside it. */
+export const draftPathOf = (table: string): string => `${table}.draft.json`;
````

`src/agents/command.ts`：

````diff
diff --git a/src/agents/command.ts b/src/agents/command.ts
new file mode 100644
index 0000000..3d459b5
--- /dev/null
+++ b/src/agents/command.ts
@@ -0,0 +1,162 @@
+import { execFile } from "node:child_process";
+import { randomBytes } from "node:crypto";
+import { chmod, link, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
+import { basename, dirname, isAbsolute, join, parse } from "node:path";
+import { createCcloopExecutionPort } from "../control/ccloopPort.js";
+import { AGENTS_DIR_MODE, AGENTS_FILE_MODE, agentsTablePath, draftPathOf } from "./paths.js";
+
+/**
+ * Agent selection spec §6.7 and §8: `orca agents init|show`. The only place Orca writes the installation table,
+ * which is user data outside any repository (Rule 17): the path is ORCA_AGENTS_TABLE or ~/.orca/agents.json, new
+ * directories are 0700 and new files 0600 whatever the umask, an existing directory or file keeps its mode, and an
+ * existing table is never overwritten -- the new detection goes to `<table>.draft.json` with a diff against it.
+ * ccloop writes nothing outside the repository here; it only answers on stdout (spec §4.3).
+ */
+export interface AgentsIo { stdout(text: string): void; stderr(text: string): void }
+
+const USAGE = "usage: orca agents init | orca agents show   (table: $ORCA_AGENTS_TABLE or ~/.orca/agents.json; ccloop: $ORCA_CCLOOP_BIN)\n";
+const MAX_OUTPUT = 16 * 1024 * 1024;
+const PORT_TIMEOUT_MS = 60_000;
+
+class AgentsRefusal extends Error {}
+
+function run(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
+  return new Promise((resolve, reject) => {
+    execFile(binary, args, { encoding: "utf8", env, maxBuffer: MAX_OUTPUT, timeout: PORT_TIMEOUT_MS }, (error, stdout, stderr) => {
+      if (error && typeof (error as { code?: unknown }).code !== "number") return reject(error);
+      resolve({ code: error ? Number((error as { code: number }).code) : 0, stdout: String(stdout), stderr: String(stderr) });
+    });
+  });
+}
+
+function settings(env: NodeJS.ProcessEnv): { table: string; binary: string } {
+  const table = agentsTablePath(env);
+  if (!isAbsolute(table)) throw new AgentsRefusal(`ORCA_AGENTS_TABLE must be an absolute path, got ${JSON.stringify(table)}`);
+  const binary = env.ORCA_CCLOOP_BIN;
+  if (binary === undefined || binary.length === 0 || !isAbsolute(binary)) throw new AgentsRefusal("ORCA_CCLOOP_BIN must name the ccloop binary by an absolute path");
+  return { table, binary };
+}
+
+/** The table `ccloop agents detect` drafted, with its own schema checked; nothing else of the answer is trusted here. */
+async function detectedTable(binary: string, env: NodeJS.ProcessEnv): Promise<unknown> {
+  const detected = await run(binary, ["agents", "detect"], env);
+  if (detected.code !== 0) throw new AgentsRefusal(`ccloop agents detect exited ${detected.code}: ${detected.stderr.trim()}`);
+  let answer: { schema?: unknown; table?: { schema?: unknown } };
+  try { answer = JSON.parse(detected.stdout); } catch { throw new AgentsRefusal("ccloop agents detect printed something that is not JSON"); }
+  if (answer?.schema !== "ccloop-agents-detect-v1" || answer.table?.schema !== "ccloop-agents-table-v1") {
+    throw new AgentsRefusal("ccloop agents detect did not answer ccloop-agents-detect-v1 with a ccloop-agents-table-v1 table");
+  }
+  return answer.table;
+}
+
+/** Every missing ancestor of `dir` is created 0700 and chmod-ed to it, so the umask cannot widen or narrow it. */
+async function ensureDirectory(dir: string): Promise<void> {
+  const missing: string[] = [];
+  for (let cursor = dir; cursor !== parse(cursor).root; cursor = dirname(cursor)) {
+    try { await lstat(cursor); break; } catch (error) {
+      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
+      missing.unshift(cursor);
+    }
+  }
+  for (const path of missing) {
+    await mkdir(path, { mode: AGENTS_DIR_MODE });
+    await chmod(path, AGENTS_DIR_MODE);
+  }
+}
+
+const tempPattern = (table: string): RegExp => new RegExp(`^\\.${basename(table).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.orca-agents-[0-9a-f]{16}\\.tmp$`);
+
+/**
+ * spec §8: a failed init leaves at most one temporary file of its own naming pattern beside the table; the next
+ * init removes those. Only regular files are removed: a symlink or directory bearing the name is not this
+ * program's and is neither followed nor touched.
+ */
+async function removeStaleTemps(table: string): Promise<void> {
+  const dir = dirname(table), pattern = tempPattern(table);
+  for (const name of await readdir(dir)) {
+    if (!pattern.test(name)) continue;
+    const path = join(dir, name);
+    if ((await lstat(path)).isFile()) await unlink(path);
+  }
+}
+
+/** Written whole and 0600 into a fresh temporary file beside the table, so the final step is one atomic name change. */
+async function writeTemp(table: string, bytes: string): Promise<string> {
+  const temp = join(dirname(table), `.${basename(table)}.orca-agents-${randomBytes(8).toString("hex")}.tmp`);
+  const handle = await open(temp, "wx", AGENTS_FILE_MODE);
+  try {
+    await handle.chmod(AGENTS_FILE_MODE);
+    await handle.writeFile(bytes);
+    await handle.sync();
+  } finally { await handle.close(); }
+  return temp;
+}
+
+async function exists(path: string): Promise<boolean> {
+  try { await lstat(path); return true; } catch (error) {
+    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
+    throw error;
+  }
+}
+
+async function init(env: NodeJS.ProcessEnv, io: AgentsIo): Promise<number> {
+  const { table, binary } = settings(env);
+  const bytes = `${JSON.stringify(await detectedTable(binary, env), null, 2)}\n`;
+  await ensureDirectory(dirname(table));
+  await removeStaleTemps(table);
+  const temp = await writeTemp(table, bytes);
+  if (!(await exists(table))) {
+    try {
+      // link, not rename: link refuses an existing name, so a table that appeared since the check is never replaced.
+      await link(temp, table);
+      await unlink(temp);
+      io.stdout(`orca agents: wrote ${table}\n`);
+      return 0;
+    } catch (error) {
+      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
+    }
+  }
+  const draft = draftPathOf(table);
+  // The draft is this program's own output; replacing it is allowed, and rename replaces a symlink, never its target.
+  await rename(temp, draft);
+  io.stdout(`orca agents: ${table} exists and was left unchanged; the new detection is in ${draft}\n`);
+  const diff = await run("git", ["diff", "--no-index", "--no-color", "--", table, draft], env);
+  if (diff.code !== 0 && diff.code !== 1) throw new AgentsRefusal(`git diff failed: ${diff.stderr.trim()}`);
+  io.stdout(diff.code === 0 ? "orca agents: the draft and the table are identical\n" : diff.stdout);
+  return 0;
+}
+
+async function show(env: NodeJS.ProcessEnv, io: AgentsIo): Promise<number> {
+  const { table, binary } = settings(env);
+  const validated = await run(binary, ["agents", "validate", table], env);
+  io.stdout(`ccloop agents validate ${table} (exit ${validated.code}):\n${validated.stdout}`);
+  if (validated.stderr.length > 0) io.stderr(validated.stderr);
+  const port = createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: PORT_TIMEOUT_MS });
+  let failed = validated.code !== 0;
+  let installations;
+  try { installations = (await port.listAgents()).installations; } catch (error) {
+    io.stdout(`ccloop control capabilities refused the table: ${error instanceof Error ? error.message : String(error)}\n`);
+    return 1;
+  }
+  for (const installation of installations) {
+    try {
+      const resolution = await port.resolveAgent({ agent: installation.id });
+      io.stdout(`${installation.id} (${installation.kind} ${installation.version}): ${JSON.stringify(resolution.selection)} configHash ${resolution.configHash}\n`);
+    } catch (error) {
+      failed = true;
+      io.stdout(`${installation.id} (${installation.kind} ${installation.version}): refused: ${error instanceof Error ? error.message : String(error)}\n`);
+    }
+  }
+  return failed ? 1 : 0;
+}
+
+export async function runAgentsCommand(args: string[], env: NodeJS.ProcessEnv, io: AgentsIo): Promise<number> {
+  if (args.length !== 1 || (args[0] !== "init" && args[0] !== "show")) { io.stderr(USAGE); return 1; }
+  try {
+    return args[0] === "init" ? await init(env, io) : await show(env, io);
+  } catch (error) {
+    if (!(error instanceof AgentsRefusal)) throw error;
+    io.stderr(`orca agents: ${error.message}\n`);
+    return 1;
+  }
+}
````

`src/cli.ts`：

````diff
diff --git a/src/cli.ts b/src/cli.ts
index c5eba13..cecdaaa 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -21,6 +21,7 @@ import { CheckpointRejection, describeLevel } from "./checkpoint/schema.js";
 import { writeCheckpoint } from "./checkpoint/write.js";
 import { resumeOutcome } from "./checkpoint/resume.js";
 import { runChainCommand } from "./chain/command.js";
+import { runAgentsCommand } from "./agents/command.js";
 
 const USAGE = `usage:
   orca validate <path...>        validate ledger file(s) or directory (directory scans top-level *.jsonl only)
@@ -96,6 +97,11 @@ const USAGE = `usage:
                                  4 limit or stop request
   orca chain stop --repo <path> [--chain-id <id>]
                                  ask the running chain to stop after its current session ends
+  orca agents init               detect the installed agents (ccloop agents detect) and write the installation table to
+                                 $ORCA_AGENTS_TABLE (default ~/.orca/agents.json; directory 0700, file 0600). An existing
+                                 table is never overwritten: the detection goes to <table>.draft.json and the diff is printed
+  orca agents show               validate the installation table (ccloop agents validate) and print what each installation
+                                 resolves to with no layer overriding it; exit 1 if any entry is refused
   orca chain unlock --repo <path>
                                  after checking its supervisor is gone: remove a chain's lock and record the
                                  chain as stopped (unlocked-by-human)
@@ -557,6 +563,10 @@ export async function main(argv: string[], stdinText?: string): Promise<number>
     return runChainCommand(rest);
   }
 
+  if (command === "agents") {
+    return runAgentsCommand(rest, process.env, { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) });
+  }
+
   if (command === "checkpoint") {
     return runCheckpoint(rest);
   }
````


- [ ] **Step 4: 跑到绿**
  `./node_modules/.bin/vitest run tests/agents/command.test.ts > $S/t13-green.log 2>&1; echo rc=$?` ⇒ Expected rc=0，10 passed（副本实测 10/10）。
  `./node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/t13-tsc.log 2>&1; echo rc=$?` ⇒ rc=0。
  Rule 17 的机械守卫：`tests/setup/relocateUserData.ts` 对真 `~/.orca` 做每文件前后快照比对，本文件跑完不得触发它（上面 rc=0 已含）。

- [ ] **Step 5: 变异（副本里做，还原后 `git diff`／`git diff --cached` 字节数为 0）**

| 变异 | 在哪、改成什么 | 跑哪个文件 | 预期红的判据 | 副本实测 |
|---|---|---|---|---|
| M13-1 | `src/agents/command.ts` `ensureDirectory`：删掉 `chmod(path, 0o700)` | `tests/agents/command.test.ts` | not from the umask | 红（点名判据红）：orca agents init (agent selection spec §6.7, §8) > gives the modes explicitly, not from the umask |
| M13-2 | `command.ts` `writeTemp`：删掉 `handle.chmod(0o600)` | `tests/agents/command.test.ts` | not from the umask | 红（点名判据红）：orca agents init (agent selection spec §6.7, §8) > gives the modes explicitly, not from the umask |
| M13-3 | `command.ts` `removeStaleTemps`：删掉命名模式过滤 | `tests/agents/command.test.ts` | merely looks like one | 红（点名判据红）：orca agents init (agent selection spec §6.7, §8) > never overwrites an existing table: the bytes and mode stay, the detection goes to the draft 0600, and the diff is printed; orca agents init (agent selection spec §6.7, §8) > replaces its own earlier draft; orca agents init (agent selection spec §6. |
| M13-4 | `command.ts` `removeStaleTemps`：不看 `isFile()`，见名就删 | `tests/agents/command.test.ts` | merely looks like one | 红（点名判据红）：orca agents init (agent selection spec §6.7, §8) > removes a temporary file an earlier init left, and nothing that merely looks like one |
| M13-5 | `command.ts` `init`：`link(temp, table)` 改 `rename`（单独，存在检查仍在） | `tests/agents/command.test.ts` | never overwrites | 红（别的判据红）：orca agents init (agent selection spec §6.7, §8) > writes the detected table where ORCA_AGENTS_TABLE says, creating directories 0700 and the file 0600, and nothing under HOME; orca agents init (agent selection spec §6.7, §8) > removes a temporary file an earlier init left, and nothing that merely lo |
| M13-6 | `command.ts` `init`：存在检查改 `if (true)`（单独，`link` 仍在） | `tests/agents/command.test.ts` | never overwrites | 绿： |
| M13-7 | `command.ts` `init`：不调 `removeStaleTemps` | `tests/agents/command.test.ts` | removes a temporary file | 红（点名判据红）：orca agents init (agent selection spec §6.7, §8) > removes a temporary file an earlier init left, and nothing that merely looks like one |
| M13-8 | `command.ts` `settings`：不拒相对路径 | `tests/agents/command.test.ts` | refuses a relative table path | 红（点名判据红）：orca agents init (agent selection spec §6.7, §8) > refuses a relative table path, a missing ccloop and a detection it cannot read, writing nothing |
| M13-9 | `command.ts` `show`：忽略 `validate` 的退出码 | `tests/agents/command.test.ts` | exits 1 and names the refusal | 红（点名判据红）：orca agents show (agent selection spec §6.7) > exits 1 and names the refusal when ccloop refuses an installation or the validation fails |
| M13-10 | `src/agents/paths.ts`：忽略 `ORCA_AGENTS_TABLE` | `tests/agents/command.test.ts` | defaults to ~/.orca/agents.json | 红（点名判据红）：orca agents init (agent selection spec §6.7, §8) > writes the detected table where ORCA_AGENTS_TABLE says, creating directories 0700 and the file 0600, and nothing under HOME; orca agents init (agent selection spec §6.7, §8) > defaults to ~/.orca/agents.json, read from the environment it is given; o |
| M13-56 | `command.ts` `init`：存在检查改 `if (true)` **且** `link` 改 `rename`（两道防覆盖同时拆掉） | `tests/agents/command.test.ts` | never overwrites | 红（点名判据红）：orca agents init (agent selection spec §6.7, §8) > writes the detected table where ORCA_AGENTS_TABLE says, creating directories 0700 and the file 0600, and nothing under HOME; orca agents init (agent selection spec §6.7, §8) > never overwrites an existing table: the bytes and mode stay, the detectio |

还原核对（`git diff --stat`，应为空）：git diff --stat after restore: ''

  判读：M13-5 单独把 `link` 换成 `rename` 时，表不存在那一支 `rename` 之后 `unlink(temp)` 报 ENOENT，别的判据红 —— 红了，但不是因为覆盖；M13-6（只拆存在检查）**绿，是等价变异**：`link` 本身拒绝已存在的名字，表已存在时落到 `EEXIST` 分支照样写草稿，存在检查只省一次 `link` 尝试；两道一起拆（M13-56）必红。实施席把 M13-6 记进 `mutations.md` 为「等价，理由同上」。

- [ ] **Step 6: Web spec 两节 ERRATUM（只追加）** —— 在 `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` 末尾追加（文件现以换行结尾，追加内容以一个空行开始）：

`docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`：

````diff
diff --git a/docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md b/docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md
index 9af747e..026cba7 100644
--- a/docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md
+++ b/docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md
@@ -1690,3 +1690,46 @@ Appended 2026-09-25 by the implementer of Task 7 of the handoff delivery plan, u
    `sha256Canonical(candidate)`), then one transaction inserts the checkpoint row with `result: "partial"`, sets
    `checkpointId`/`recoverable`, parks the remaining commitment as `held`, settles the request `settled-recoverable`, and
    leaves the run `settled-recoverable` with its work `held`. `commitCandidate` is not on that path.
+
+## ERRATUM (agent selection, 2026-09-26) — `ControlPlanV1.tasks[].configHash` and where a task's configuration is frozen
+
+Appended 2026-09-26 by the implementer of Task 13 of the agent selection plan, under controller session `75ec878e`
+(Claude Opus 5.5), in the commit whose subject is `docs(spec): errata for agent selection in the Web control spec`.
+The statements below are superseded by `docs/superpowers/specs/2026-09-26-agent-selection-design.md` (§4.6, §6.2,
+§6.4, §6.6 and §12 I3). The original text above is kept verbatim.
+
+1. **`ControlPlanV1.tasks[].configHash` (section 4.2, the `configHash: string;` line of the `ControlPlanV1` type) no
+   longer exists**, and so it is no longer part of the bytes `planHash` covers. The source plan supplies no config hash
+   any more: the sentence "`configHash` is the validated lower-case hex SHA-256 supplied by the source plan for that
+   task's execution configuration" no longer holds, and a source plan that still carries a `configHash` is refused. A task
+   (or the plan as a whole) may instead name a partial agent selection; which fields, and how the layers merge, is
+   agent selection spec §6.2–§6.3.
+2. **Import no longer writes a task's config hash** ("target and config hashes" in the list of what import writes, section
+   4.2): a draft work item's `configHash` is `null`. The configuration a task runs with is frozen at `confirm`: the
+   resolved selection, its `configHash` (computed by ccloop from the materialized agent configuration and answered by
+   `control capabilities`; Orca never computes it), `timeoutMs`, `killGraceMs` and the capability view are written into
+   each work item and into the execution snapshot (now version 2), bound by the confirm payload's `selectionsHash`.
+3. **The trusted startup configuration (section 3.1, the line "adapter type and adapter configuration;")** is now the
+   ccloop binary plus an agents installation table (`ORCA_AGENTS_TABLE`, default `~/.orca/agents.json`); there is no
+   single adapter configuration. The table stays server-side and trusted: the browser never sends it, a path to it, or
+   any part of an installation record.
+
+## ERRATUM (agent selection, 2026-09-26) — what the browser may send (section 3.1)
+
+Appended 2026-09-26 by the implementer of Task 13 of the agent selection plan, under controller session `75ec878e`
+(Claude Opus 5.5), in the commit whose subject is `docs(spec): errata for agent selection in the Web control spec`.
+This relaxes section 3.1 under `docs/superpowers/specs/2026-09-26-agent-selection-design.md` §6.2 and §12 I14. The
+original text above is kept verbatim.
+
+- Section 3.1 says "The browser may send stable IDs, group commands, and editable numeric policy values." Two new
+  commands, `set-agent-preferences` and `proposal-set-agent`, also let the browser send an **agent selection**: an
+  installation id (a stable id, `idSchema`), a **model name, which is a free string**, and a context window, which is
+  either `"agent-default"` or a positive safe integer the panel offers only from that installation's `contextOptions`.
+  The model string is the relaxation: it is not a stable id and not a number.
+- What bounds it: Orca checks only its shape (1 to 200 characters) and never interprets, concatenates or rewrites it;
+  ccloop's descriptor for the installation's kind is the only judge (`validateSelection`), refusing a model that starts
+  with `-`, contains whitespace or control characters, or is longer than 200 characters, with `agent-selection-invalid`;
+  and ccloop passes it to the agent CLI as one argument of an argv array, never through a shell. A selection that ccloop
+  refuses at confirm refuses the whole confirm (`agent-selection-rejected:<taskId|slot>:<code>`).
+- Everything else in section 3.1 stands: the browser still may not send an executable, an adapter or installation
+  definition, a filesystem root, a repository path, a plan path or an evidence path.
````


  判据（只追加、原文零删改）：
  `/usr/bin/git diff -- docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md > $S/t13-errata.diff; ./node_modules/.bin/tsx src/cli.ts check-append-only < $S/t13-errata.diff > $S/t13-errata-check.log 2>&1; echo rc=$?` ⇒ Expected rc=0 且日志为 `ok: append-only`（副本实测）。变异：在追加的同时把原文 `:622` 的 `configHash: string;` 删掉 ⇒ 同一命令 rc=1。

- [ ] **Step 7: 提交（两笔）**
  1. `feat(cli): orca agents init and show for the installation table` —— `src/agents/`、`tests/agents/`、`src/cli.ts`。
  2. `docs(spec): errata for agent selection in the Web control spec` —— 只含 Web spec 一个文件（ERRATUM 的归属行点名的就是这个主题行）。
  两笔都以 Global Constraints 的两行 trailer 结尾。
