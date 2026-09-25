# 计划复审 —— agent 选择（独立复审席）

> 归属：Orca 控制器会话 `75ec878e` 派出的独立复审席（Claude Opus 5.5）。写于 2026-09-26，对照 Orca HEAD `f60d759`、ccloop `f4e49a2`。
> 审的是 `docs/superpowers/plans/2026-09-26-agent-selection.md`（17609 行，`wc -l` 现测）。方法：主席先读头部、§0 和台账，再按接缝派五个只读子席（ccloop W1–W3；W4；W5；W6；spec 覆盖＋安全）。每条 Critical 和大部分 Important，主席都用 `sed -n`／`grep -n`／`stat` 对计划原文或真码复核过。
> 本席只读：没改代码，没动 git，没跑测试。行号均为现测，**计划一改就会移动**。
> 两个子席各自报的「八字段」「七字段」是同一件事：`CapabilityViewV1` 实为 7 个键，见 m1。

## 总判断

- **R7、R8 M-2、R5 W6-8 三条裁定只写在 §0 表里，没有落进正文。**
- **W5（T10/T11）是对着 T7 之前的 HEAD 写的，没有叠在 T7 的终态上。** 按 §0 的顺序 T8→T7→T9→T10→T11 执行，它会撞上 T7 已经改过的文件：符号重复、键重复、夹具被整份覆盖、桥被冲掉。
- **ccloop 侧有一个桩从头到尾没人去换。**
- **Rule 17 已经被实际破过一次**：真实的 `~/.orca` 里现在留着写作期变异造出的文件，见 C1。

---

## Critical

### C1 T13 的判据和变异会写进真实的 `~/.orca`，而且已经写过一次（Rule 17）
- **证据**
  - `src/agents/paths.ts` 的计划代码（L14997–15001）缺省走 `join(homedir(), ".orca", "agents.json")`。`homedir()` 读的是进程自己的 HOME，不是传进来的 `env.HOME`。
  - 判据在进程内调用 `runAgentsCommand([verb], {...env})`（L14847）。所以 L14854 的「nothing under HOME」断言检查的是一个生产代码根本不会碰的目录，永远红不了（Rule 9）。
  - 变异 M13-10「忽略 `ORCA_AGENTS_TABLE`」（L15228／L15243 一带）一跑，就会写进真 HOME。
  - **实测残留**：
    - `stat` 显示 `~/.orca/agents.json` 为 `Sep 26 02:51:24 2026 -rw-------`，`~/.orca/agents.json.draft.json` 为 `02:51:29`。
    - 内容是 T13 判据里的 `TABLE`（`"command":["/opt/claude"]`，`"version":"2.1.282"`）。
    - W4 写作席的 `scratchpad/W4/mut-t13.out` mtime 是 02:51:35。
  - `tests/setup/relocateUserData.ts` 只做事后快照比对，拦不住写入。
- **后果**：人以后真跑 `orca agents init`，只会落草稿、永不覆盖；`orca agents show` 会读到这张假表。
- **修法**
  1. 残留的两个文件删不删，由人决定。本席没动，列进 awaitingHuman。
  2. `agentsTablePath(env)` 的缺省分支改用 `env.HOME`；缺失或是相对路径就拒绝，不再调 `os.homedir()`。
  3. 补一条判据：不给 `ORCA_AGENTS_TABLE`、`HOME` 指向临时目录时，表落在 `<临时 HOME>/.orca/agents.json`，目录 0700、文件 0600。
  4. 在 `relocateUserData.ts`（或 `command.test.ts` 的 `beforeAll`）里给进程级 `HOME` 和 `ORCA_AGENTS_TABLE` 改道。这个文件是既有夹具，改动要按规定记台账。
  5. M13-10 在第 2–4 条落地之前禁止跑。

### C2 claude 的 `createAdapter` 桩没有任何一步去换；T6、T5 的 claude 判据都跑不绿
- **桩从哪来**：T1 在 `claude.ts` 里写了 `throw new AgentError("agent-adapter-unavailable", "claude")`（L734），配判据「does not yet build a claude adapter」（L398–399），码表里也列了这个码（L579）。
- **没人去换**：R2（L155）和 W1-10（L243）都说「T3 删」。但 `grep -n 'agent-adapter-unavailable\|does not yet build'` 在 L2839 之后零命中：T3 的 Files（L2908–2915）和各步骤都没碰 `src/agents/claude.ts`。
- **后果**：下面这些都会抛 `agent-adapter-unavailable`：
  - T6「runs the selected installation…」（L4108，经 L4288）；
  - T5 worker 注册判据（L5583–5648）；
  - T5 `claudeEndToEnd`（L6689）。

  于是 T6 Step 6.4 的 11/11、T5 Step 13 的 9/9、Step 16 的 1/1 都达不到。
- **修法**：在 T3 的 3.5.6 之后加一步：
  1. `createAdapter(config)` 改为 `return new ClaudeAgentAdapter(config)`；
  2. 从 `AGENT_ERROR_CODES` 删掉这个码；
  3. registry 判据整条改写为 `toBeInstanceOf(ClaudeAgentAdapter)`，加改写注释；
  4. 加一条变异：改回抛错，要看见红；
  5. 核对：`/usr/bin/grep -rn "agent-adapter-unavailable" src tests > $S/x.txt; echo rc=$?`，期望 rc=1。

### C3 T3 §3.4 把 T1 已经落地的 `extraEnv` 重做一遍，并整份覆盖 T1 的判据文件
- **重复点**：W1-11（L244）把 `extraEnv` 裁给了 T1。T1 Step 1.2 已新建 `tests/runtime/codex/extraEnv.test.ts`（L404–449），Step 1.5 已改 `runCodexPhase`／`codexAdapter`（L475–515）。T3 的 Files（L2912–2915）和 Step 3.4.1（L3460）又写了一遍「新建」。
- **后果**
  - before 锚点对不上；
  - 3.4.2 期望的「2 红 1 绿」不会出现；
  - 整文件新建会冲掉 T1 的判据「sets CODEX_HOME from the installation's configDir through the descriptor's adapter」（L436–447）。这等于删判据，是放宽。
- **修法**：删掉 T3 §3.4（L3458–3553）和 Files 里对应的四项，Produces 标「T1 已产出」。变异 E1–E3（L4026–4028）改成跑 T1 的文件，并按 T1 的判据名写期望。

### C4 R7（W5-M16）没有落进正文：T10 整套仍按「选项 A」写，还放宽了一条受保护判据
Global Constraints 和 §0 只说了「W5 的选项 A 步骤作废」，没有可执行的替代步骤。实施席必须跳过或改写的地方如下：

- **L180**（任务总表 T10 行）：删掉 `estimatorAgent`、「estimator 导入时冻结」里的 plan 层；「删 `configHash`」按 R6 M5 属于 T11，也从这一行拿掉。
- **L7038**（W5-M4 建议栏）：只由 `agent`／`reconcileAgent` 初始化；`ControlPlanV1` 带三个可选字段，不是四个。
- **L7041、L7912、L7928**：`prepareEstimatorSlot` 不再读 plan 源。去掉 deps 里的 `trustedConfig`，函数体改为 `return estimatorSlotFor(deps, command.actorId, {}, profile)`。
- **L7926**：`ControlPlanV1` 去掉 `estimatorAgent`。
- **Step 10.2 判据**
  - L8000：样例删掉 `estimatorAgent`，**另加**一条「带 `estimatorAgent` 的 plan 被拒为 `malformed`」，编码「本轮 plan 没有这个字段」。
  - L8009–8027 整条改写：只解析操作者两层；`agentOverrides` 期望值里不再有 `estimator`。
  - L8113–8120：层改由 `preferences.estimator` 提供，provenance 期望 `operator-estimator`。
- **`planFile.ts`**：L8192、L8250、L8258、L8280 删掉 `estimatorAgent`。
- **`normalizeControlPlan`**：L8433 删除；`planGroupLayer` 的 estimator 分支（L8450）删除。
- **夹具与实参**：L8822 夹具的 `planAgents` 类型去掉 `estimatorAgent`；L8859、L8915、L8951 的 `trustedConfig` 实参去掉。
- **Step 10.14(1)**
  - **L8920–8926 的放宽改写整段跳过。** L8917 替换清单里的 `:190-200` 落在受保护判据体 `planImport.test.ts:186-202` 内，不许动。
  - 替代做法：在 `setup()` 里让 `deps.estimatorObservation` 返回带 `resolution` 的观测，这样类型和运行都能通过。
  - 约束：`estimatorSlotFor` 在调用 `probe` 之前不得插入任何 `await`，否则受保护判据的 `toHaveBeenCalledTimes(1)` 会红。
- **L8974** 提交信息去掉 `estimatorAgent`。
- **L8992** 变异 T10-M3 作废。换成「`prepareEstimatorSlot` 经 `resolveTarget` 读源」，期望原样保留的那条受保护判据变红。
- **L9001、L10394** 两份红表：注明这条受保护判据只经 setup 变红，判据本体不改。
- **补缺的判据**：面板组级 estimator 在 reestimate 时生效，要有判据和变异（R7 的正向面）。
- **W6 已核**：T14–T16 和 T13 的 ERRATUM 里都没有 `estimatorAgent`。
- **待确认**：T16 在导入**之前**就设了偏好（L17154 等）。L17088 的 `blocked-capability` 必须是 profile 预检造成的，不能是 `agent-unselected` 造成的。实施时核实。

### C5 R5 W6-8 没有落进 W6 正文：`set-agent-preferences` 的 payload 仍带 `expectedRevision`
- **生产方**：T9 的 schema 是 `z.object({ preferences }).strict()`（L7616），变异 T9-M5（L7894）还专门证明带 `expectedRevision` 会被拒。
- **违规处**
  - L139（骨架共用接口）
  - L15381（W6-8 行，写的是「按骨架原样写」）
  - T14 判据：L15555、L15598、L15605
  - Web 镜像类型：L16009 `SetAgentPreferencesPayloadV1`。它会让 webParity 的双向可赋值检查红。
  - T15 `sendAgentPreferences`：L16825。**生产面板每次保存偏好都会拿到 4xx。**
  - T16 `setPreferences`：L17080（`as never` 把类型错掩盖了）。5 条 E2E 在第一步就抛错。
- **修法**：上面各处的 payload 一律改为 `{ preferences }`，revision 只放在信封的 `expectedRevision`；L139 就地改。

### C6 T10 Step 10.12 整份替换 `tests/control/fixtures/web.ts`（L8791 起），冲掉 T7 的产物
- **被冲掉的东西**
  - T7 导出的 `FIXTURE_AGENT: AgentSelection`（L12157）；
  - T7 的桥（L12179–12184，把选择写进 work item）；
  - 被重新加回的 `probeProfileCapabilities`／`capabilities`（L8832–8834），这两个 T7 已经删了。
- **同名冲突**：T10 Step 10.13 从新文件 `agents.ts` 导入一个同名但类型是 string 的 `FIXTURE_AGENT`（L7946、L8888），而 T7 的 `controlPanel.ts` 从 `web.js` 导入它（L12202）。同一个 port 字面量里还会再插一个 `resolveAgent`（L8901），形成重复键。
- **后果**
  - T10 提交后 tsc 红；
  - T10 到 T11 之间，Web work item 没有 `agent`，claim 会被 `startEnvelopeSchema` 拒；
  - Step 10.15 的邻居判据跑不绿。
- **修法**：夹具改成对 T7 版本的**增量**修改，桥保留到 T11。常量改名，只留一个来源：例如 `agents.ts` 的叫 `FIXTURE_AGENT_ID`，`web.ts` 的完整选择叫 `FIXTURE_SELECTION`。

### C7 T9 提交后 Orca tsc 不通过
- **原因**：T9 给 `commandTargetSchema` 加了 `operator` 目标。但真码有三处在排除 `global`／`repository` 之后直接读 `target.groupId`：
  - `src/control/webService.ts:148-149`
  - `src/control/stopIntent.ts:133-134`
  - `src/control/stopIntent.ts:416-417`（主席已用 `sed -n` 复核）

  operator 分支没有 `groupId`，报 TS2339。T9 的 Files 不含这三处。
- **修法**：三处都加 `|| target.kind === "operator"`，或改成正向判断 `target.kind !== "group"`。把它们列进 T9 Files，在 Step 9.9 的 tsc 里验证。

### C8 T14 的面板夹具与 T10 Step 10.13 冲突，T14 的 7 条判据跑不绿，还会带红既有面板判据
- **T10 已经做了的**（L8887–8905）：固定 `PANEL_OPERATOR`，boot 时 `seedPreferences({defaultAgent: FIXTURE_AGENT})`，port 上已有 `resolveAgent`／`listAgents`（只认 `fixture-agent`／`fixture-other`）。
- **T14 Step 1 又加的**（L15469–15518）：
  - 第二对同名键：TS1117；
  - 本地 `export fixtureResolveAgent`：与导入的同名符号冲突；
  - 只认 claude/codex 的替身。
- **后果**
  - L15595 断言初始 `revision:0, perAgent:{}`，L15636 断言 `agent-unselected`。夹具已经预置了偏好，这两条必红。
  - 替身把预置的 `fixture-agent` 解析成 `agent-installation-missing`，走 import/confirm 的既有面板判据会被连带打红。
- **修法**
  - `BootOptions` 加 `agents?`、`resolveAgent?`、`seedPreferences?: false`；
  - port 那两行改为按选项回落到 T10 的版本；
  - T14 的替身改名，例如 `claudeCodexResolveAgent`，由 T14 的判据显式传入。

---

## Important

### I1 R8 M-2（删净「T7 bridge」）在 T11 里既没有删除步骤，也没有核对；而且判据的窗口本身就不成立
- **现状**：T11 正文（L9008–10472）一次也没出现 bridge。
- **现存的桥**：`grep -n 'T7 bridge'` 在 T7 代码里命中 6 处：
  - L12179 `web.ts`
  - L13371 `driverReconcile.test.ts`
  - L13936 `src/control/driverLanding.ts`
  - L14203 `live-driver-acceptance.ts`
  - L14290 `ccloopWorld.ts`
  - L14318 `ccloopWorld.ts`

  其中 L13371 和 L13936 由 **T12** 删（L14688、L14746），所以「T11 后在 `tests scripts` 零命中」不可能成立。另外 L13936 在 `src/` 下，R8 的 grep 范围根本扫不到它。
- **修法**
  - T11 加一步，逐锚点删除 L12179、L14203、L14290–14292（连同已无用的 `const resolution`）、L14318–14322；
  - T11 的核对：只剩 driverReconcile 和 driverLanding 两处；
  - T12 之后：`/usr/bin/grep -rn "T7 bridge" src tests scripts > $S/bridge.txt; echo rc=$?`，期望 rc=1。
  - §0 R8 的「三处」改为「6 处，T11 删 4 处、T12 删 2 处」。

### I2 T11 其余 before/after 同样对着 T7 之前的 HEAD 写（R8 M-5、M-6、M-7 与 R6 M2 的收尾）
- **M-5**：T7 已在 `driverHandoff.ts` 导出 `async handoffGraceMsOf(port, agent)`，并加了 `graceByRun` 缓存（L13889–13916），`controlAssembly` 里的旧函数也已删除（L13757、L13796）。T11 Step 11.12（L9885–9902）却写成「新增同步 `handoffGraceMsOf(run)`」，还要去删 `controlAssembly :111-124`、`:257`，这些在 T7 之后已不存在。结果是重复导出。
  - 修法：改写成对 T7 形态的替换——换掉函数体，删掉 WeakMap，调用点改读冻结值。`assemblyHandoffGrace.test.ts` 整文件替换（L10141）以 T7 版本为 before。
- **M-6／R6 M2**：T11 Step 11.6（L9510）只删「T10 保留的 `probeProfileCapabilities` 分支」，没点名删：
  - T7 的 `temporaryProbeSelection`（L11438）；
  - 那条 TEMPORARY 判据 `ccloopPort.test.ts > … > TEMPORARY (plan T11 deletes it): …`（L10905）。

  选择参数改成必填后，这条判据 tsc 过不去。
  - 修法：显式删除这两处，登记为「按计划删除的临时判据」；核对 `grep -rn "temporaryProbeSelection\|TEMPORARY (plan T11" src tests`，期望零命中。
- **M-7**：T7 已为 legacy 路径写了终态 `workAgents`／`parentAgent`（L12267–12535，L12304–12326）。T11 Step 11.11（L9761–9832）按旧代码重写 `service.ts`／`schedulerBridge.ts`／`dispatch.ts:77`，新造 `groupAgents`／`workAgent`／`taskAgent`。这是 Rule 7 说的混合。
  - 修法：删掉 T11 这一段，改用 T7 的名字。
- **T10 Step 10.6**：用的仍是 T7 已删掉的 `probeProfileCapabilities`。
  - 修法：只把 T7 的 `selection?: AgentSelection` 放宽为 `PartialSelection`，并给两个分支都加上 `resolution`。
- **重复键**
  - T10 Step 10.10 往 `persistedRunSchema` 加 `agent`，T7 已在 L12712–12713 加过。
  - T8 往 `errors.ts` 加 `agent-unselected`／`agent-selection-invalid`（L7201–7202），T7 的 diff（L11269–11276）又加一遍，TS1117。
- **系统性修法**：让 W5 写作席按 T7 终态重出 T10/T11 的 diff。W5 静态预测的 251 条红表，实施前要按 T7 之后的树重新实跑。

### I3 R6 M9 的 fail-closed 状态：T11 建了但没有判据，T15 又叠加一遍，变异会空
- **T11 这边**：Step 11.14 加了 `|| !props.selectionsHash`，payload 里有 `selectionsHash: props.selectionsHash!`（L9991、L9993，L10005–10013 一带），但没有任何 web 判据或变异证明它生效。
- **T15 这边**：Step 7（L16712–16736）按旧 HEAD 又加一次 prop 和 payload 键，造成重复键 TS1117。T15-M7（L16895）只删掉 T15 自己那一行，T11 那一行还在，判据照绿，变异存活。
- **修法**
  - T11 补一条 web 判据：没有 `selectionsHash` 时点确认不调用 `onCommand`，并配一条删掉该条件的变异；
  - T15 Step 7 写成「替换 T11 那一行」，把 fail-closed 升级为 `disabled`；
  - 加 grep 判据：`selectionsHash:` 在 `BudgetEditor.tsx` 里恰好 1 次，且 `W5-M9` 临时注释已消失。

### I4 T14 Step 8 重复了 T9/T10/T11 已写好的 Web 镜像和 webParity 改写；§0「T14→T15 间 web tsc 红」的前提不成立
- **已有的**
  - T9 Step 9.7（L7819–7834）：operator 目标、动词、结果；
  - T10（L8789）：`proposal-set-agent`；
  - T11 Step 11.14（L9949–9975）：`selectionsHash`、`ProvenanceSourceV1`，已改写 `controlGroupWebToServer`。
- **T14 又做一遍**：L15955–15967、L15977、L16036–16053，会造成 TS2300 或重复属性；L16118 的 `REWRITTEN` 行与 T11 重复。L16082 预言「只在 BudgetEditor 缺 `selectionsHash` 处红」也不对，T11 已经在 L9993 发送了它。
- **修法**
  - T14 只加它自己的新类型；
  - 删掉 L16036–16053 和 L16118；
  - 期望改为 web tsc rc=0；
  - §0 L148 的相邻约束可以保留，但理由要改。

### I5 T16 对 T7 的 `ccloopWorld.ts` 形状假设错了两处
- **重复声明**：T7 已经 `export function versionOf`（L14261），T16 Step 1(c) 在 L16959 又声明一次，ESM 下是重复声明错误。
- **类型不符**：T7 的 `table` 是路径字符串（L14286–14289），T16 (e) 却写 `table.installations.claude = …`（L16978）。
- **修法**：T16 删掉 (c)；T7 把表对象抽成 `const agentsTable` 并导出，T16 往它上面加 claude 条目后再写文件。
- **附带**：T11 引用的 `WORLD_AGENT`（L10032、L10038）T7 并不导出，实际 id 是字面量 `"codex"`。T11 Step 11.15 调用的 `raw(..., target)` 用了第 5 个参数，但当前 `raw` 签名不接受。

### I6 T12 的断言值与 T11 之后的夹具不一致
- L14693 断言 `["fixture-model","fixture-model"]`。但 T11 之后确认走的是 web 夹具的 `fixtureResolveAgent`，冻结出来的 model 是 `FIXTURE_DEFAULT_MODEL = "fixture-default-model"`（L7948）。W4 是在 T11 替身上验的（L14658），所以没看到这个差异。
- **修法**：断言从冻结的 `reconcileSlot.selection` 读值后做比对，并同时断言它与 worker 的冻结值不同。不要写死字面量。
- **顺带**：T12 在 L14731 直接 cast 读组 body，没用 T11 为它产出的 `readConfirmedReconcileSlot`（L9034）。

### I7 `fake-ccloop-control.mjs` 的错误面与真 T5 不一致
- **主要不一致**：替身对具名拒绝退 1（L10958 一带）；真 T5 对 `AgentError`／`ControlProtocolError` 退 2，stderr 为 `<code>[: <detail>]`（L6259–6268，D-W3-2 L4387）。L10922 一带的 `peerErrorCode` 判据字面量 `"1:agent-version-drift:…"` 教的是错的退出码，而驱动环只对 `2:` 阻塞。
- **其他偏差**
  - 坏 argv：替身退 2，真的退 1；
  - 坏 envelope：码名不同；
  - `capabilities {}`：替身接受，真 T5 拒为 `control-request-invalid`（L4998）。
- **修法**：替身按真 T5 的退出码和码名改；判据字面量改为 `"2:agent-version-drift: …"`。

### I8 T17 判定器覆盖不到 T1–T13 改写过的既有判据，也不知道这些 Task 新增的判据文件
- **格式不匹配**：`- REWRITTEN:` 行只在 T14（L16118）和 T17（L17420）出现。Global Constraints（L24）要求的台账格式是「文件 ＞ describe ＞ it」，`check-agents.py` 的正则（L17474）匹配不到。W3 的 45 条、W4 的 147 条、W5 的改写全都没有被机械检查。
- **数量没登记**：`EXPECTED` 只列了 W6 的 5 个文件（L17442–17443），「controller adds it here」没有对应的步骤。
- **修法**
  - 控制器把 `REWRITTEN` 行格式写进 Global Constraints，从 T1 起各 Task 照写；
  - T17 Step 1 之前加一步，把 T1–T13 的新判据文件和条数（例如 `agentFreeze.test.ts` 14 条，L10171）写进 `EXPECTED`。

### I9 主树 build 和变异复原命令的风险（Rule 15 主树禁令）
- **主树 build**：T5 Step 16（L6765）和 Step 18（L6848，`verify:control` 内部会 build）在 ccloop 主树 `npm run build`，T3 的 3.5.5（L3984）和 T4 的 4.9（L2828–2832）都明确只在副本里 build。T5 改的是线上协议，主树 `dist/` 一旦重建，所有指向它的 Orca 进程都会换线。
  - 修法：改在 `git clone --local` 副本里 build，或者写明依据并列进检查点。
- **`$C` 复用**：W1–W3 规定 `C=` ccloop 主树（L202、L2921、L4422）；W5 在 L7332 设 `C=$S/mut-t8`，然后在 L7334 要求在**另开的命令**里 `cd $C && git checkout -- src`，L7886 的 `C=$S/mut-t9` 同理。shell 状态不跨调用保留，实施席按前面分部的约定重设 `C`，就会在 ccloop 主树上执行 `checkout -- src`。
  - 修法：一律写字面路径 `/usr/bin/git -C "$S/mut-t8" checkout -- src`。
- **门验的 build**：T17（L17524）在主树 build，但 Orca 的 E2E 经 `t16-env.sh` 指向的是 T16 副本的 build。
  - 修法：gates 里断言那份 build 的 HEAD 等于 ccloop `main` 的 HEAD，不等就重新 clone 并 build。

### I10 T6／T9 另写了一份选择 schema（Rule 7）
- **T6**：`selectionFileSchema`（L4261–4268）自己写 `agent`/`model`，没用 T1 导出的 `agentSelectionSchema`（L595–597）。约束不同，同一个非法 id 在两条路上会得到不同的码。
- **T5**：`command.ts` 本地又定义了一份 `contextWindowSchema`（L6050–6053）。
- **T9**：在 `webProtocol.ts` 重写一份（L7554–7560），而 T7 已在 `schema.ts` 定义过（L11015–11017）。
- **修法**
  - T6 用 `agentSelectionSchema`；
  - T5 从 `./protocol.js` import；
  - T9 用 `export { … } from "./schema.js"`，同时把 T14 Step 0 的检查（L15438）改为接受再导出，否则依赖检查会假红。

### I11 1M 的拼写有两处（W1-8 没有落实）
- `ClaudeAgentAdapter` 自己拼 `${model}[1m]`（L3829），`ONE_MILLION` 也定义了两份（L3793、L696）。W1-8 定的唯一拼写处是 `claudeModelArgument`（L703）。
- **修法**：adapter 调 `claudeModelArgument(config.selection)`；变异 M1m（L4015）改为针对 `claude.ts`。

### I12 裁定过的偏离没有登记回本 spec，也没有列进报人清单
- **现状**：T13 Step 6（L15250–15308）只给 **Web spec** 追加了 ERRATUM。本 spec 没有任何一个 Task 追加「实施期更正」。
- **应当登记的偏离**
  - R7（estimator 缺 plan 层，spec §6.1／§6.3）；
  - R6 M4（整层替换，spec §6.2 写的是逐字段合并；L7038 自称「登记 §11」，但没有步骤）；
  - R8 M-8（`show` 不读 store，spec §6.7）；
  - W5-M12（闸门按组粒度阻塞）；
  - W5-M15（确认时的上下文阈值仍用 profile 的声明值；台账里没有这条裁定）。
- **报人清单**：T17 的 `awaitingHuman`（L17609）只列了 push、merge、删分支或 worktree。
- **修法**：在 T13 或 T17 加一步，给本 spec 末尾追加「§13 实施期更正」。按 Rule 13 只追加，原文逐字不动，用 append-only 判据核对。把 R7、W5-M15 和 C1 的残留文件列进报人清单。

### I13 spec §10 要求的每波复审和终审在计划里没有步骤
- `grep '终审\|每波'` 零命中。
- **修法**：在 §0 的执行顺序里，每一波的末个 Task 之后插一步复审，T17 之后插终审。

### I14 一条判据被隐式删除
- `tests/control/profiles.test.ts > trusted execution profiles > keeps Codex phase-end and soft` 在 T11 红表里（L10420），但 T11 只给了机械规则「删 adapter 字段」。照做之后这条判据只能删掉或反转，属于没有登记的放宽。
- **修法**：改写为「v2 快照带 `adapter:"codex"` 被拒」；或者作为 spec §6.5 的删除项登记，并报人。

---

## Minor

- **m1** 骨架 L62 的注释「the eight fields」有误：`CapabilityViewV1` 是 7 个键（D-W3-6，L4393；T1 L539–553）。T7 按 7 键解析，已核一致。建议就地改。
- **m2 空判据**（Rule 9 推论 2）
  - T7 `startEnvelope` 判据 L11625–11626 读回的是测试自己写进去的 `agent`，永远不会红，建议删掉这一行；
  - T15 判据 7 `toContain("frozen at confirmation")`（L16350）：`BudgetEditor.tsx` 本来就会渲染这段文字，应限定在 `section[aria-label="Agent selection"]` 里查；
  - T11 之后 driverHarness 的 `killGraceMs: 5_000`（L13499）与冻结值（L7950）相同，判据分不出读的是哪一个，改成非 5000 的值。
- **m3** T5 `claudeEndToEnd` 在 L6754 过滤掉 `--version`。按 R1，fake 不为 `--version` 写 `.argv`，这个过滤会掩盖回归。建议删掉过滤，直接断言恰好 3 行。
- **m4** W3 附表 #6（L6929）写的是 `toEqual`，实际代码（L5879）是 `toMatch(/^agents-table-invalid(: .*)?\n$/)`。附表按代码改。
- **m5** T6 用普通 `Error` 抛 `agent-selection-file-invalid`／`control-config-hash-mismatch`（L4280–4286），而这两个码在 `AGENT_ERROR_CODES` 里。zod 的 detail 可能跨多行（L1023、L1029、L1377、L4283），Orca 取码时只能取「首个 `:` 之前」。三个 CLI 的退出码语义也不一致：`run` 的 2 表示 run 未成功，`control` 的 2 表示具名拒绝。建议统一，或登记为有意为之。
- **m6 缺独占判据或变异的分支**
  - ClaudeAgentAdapter 的 `timeout = min(installation.timeoutMs, budget)` 的预算那一支（L3851）；
  - `request.json` 不记录 env（L3651）；
  - `observedTokens: null`；
  - I4 的 handoff 和 read-evidence（L5500 只覆盖 inspect 和 collect）；
  - `sweep` 拒绝 `--agents`（L4098 只测了 `resume`）；
  - T10 `run-estimate-agent`（L8999，只有副本里的临时判据）；
  - T11 的 `readConfirmedReconcileSlot` 不等则拒、`execution-snapshot-agents`、`sameFrozen`、`reopenProposal` 清冻结字段、`agents.length===0 ⇒ group-graph-conflict`。
- **m7** spec §8 要求 HOME 和四个 XDG 根改道并断言零写入，计划里 `XDG` 零命中；T2 的 detect/validate 也没有零写入断言。
- **m8** 变异 D12、D13（L2344–2356）一旦生效，会对本机真 `claude`／`codex` 跑 `--version`。不收费，但会读真实 HOME 的候选目录。建议这两条也注入 probe，或把 PATH 指向一个空目录。
- **m9** `git add -A <目录>`（L8971、L10176、L14630）会把别的 agent 的未提交文件一起带走（Rule 13）。改成逐文件 add，并先把 `git status --porcelain` 重定向到文件读回。
- **m10** `git diff | wc -c`（L7334、L16098、L17586）的管道会吞掉退出码（Rule 14）。改为先写文件，再 `wc -c < f`。
- **m11** T17（L17577）允许把门脚本放后台，但没写变异电池要等 `summary.txt` 出现 DONE 才能开始，可能与全量套件并发。补上这个等待条件。
- **m12**
  - T7 Step 9 的单跑（L14605）没有 `env -u ORCA_CCLOOP_BIN`；
  - T16 Step 4 用 `mkdir(root)`（L17340），重跑会失败；
  - `check-known-reds` 没有核对名单里的全名在测试源码中是否仍然存在；
  - ERRATUM 的归属行写死了模型名（L15266、L15289）；
  - flake 名单不含 `agentSelectionE2E`，这是有意还是遗漏，要写明。

---

## 核过、没有问题的接缝

- **capabilities v3**：T5 的两种应答（L6076–6103、L6181–6204）与 T7 的解析（L11160–11162）一致。
- **错误解码**：T7 的 `peerErrorCode`（L11166–11172）能正确解析真 T5 的 `2:<code>: <detail>`。
- **envelope v2 的 `claim.agent`、`--agents` 的位置、选择文件**：T5/T7 与 T6/T12 一致（L4261–4271 对 L14016–14022；0600＋`wx`）。
- **R4 schema 搬迁**：定义在 T1 `types.ts`（L591–600），T5 挪进 `protocol.ts`（L4933–4942），`types.ts` 改为 re-export（L5127）。T3、T6 不直接 import 这些 schema，不会断。
- **R1、R3**：都已落地（L1295、L1307、L2039、L2603、L2615、L3075–3078、L3227）。
- **`selectionsHash`**：预览（T14 L15821）与确认走同一个 `resolveGroupSelections`（T11 L9447–9483）。槽位键是 `task:<id>` 和 `reconcile`，estimator 不参与；和 T8 的 `selectionsHash`（L7307–7315）一致。
- **T16 的 `.argv` 断言**：与 T3 一致。F1 从正面观察到了冻结值（与改动后的 `claude-poisoned` 不同）。
- **安全方面**：没有 push、merge、删分支的步骤；没有付费 claude 调用；全量套件串行执行；除 I9 外，变异都在副本里做。
- **既有判据改写抽查**：T5 的 command.test、W4 约 15 条，均未发现放宽。唯一问题是 I14。
