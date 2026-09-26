# Agent 选择一轮 · 终审（两仓，整轮视角）

> 归属：终审席 Claude Opus 5.5 (1M context)，控制器会话 `ab5a693c` 派出，2026-09-26。
> 范围：Orca `545f452..a0f58e2`（HEAD 主题行 `docs(sdd): record the agent selection mutation battery and aggregate the mutation ledger`）；ccloop `f4e49a2^..87aef9a`（HEAD 主题行 `docs(handoff): roll the Orca section: T1-T6 of agent selection landed here`）。生产 diff 读的是 `final-orca.diff`、`final-ccloop.diff`；判据按需在主树只读。
> 只读纪律：两仓主树零改动（收尾 `/usr/bin/git status --porcelain` 两仓均为空，输出在 `scratchpad/final/{orca,ccloop}-main-status.txt`）；真 `~/.orca` 两个残留文件只 `stat` 过：`agents.json` mtime 1790362284、`agents.json.draft.json` mtime 1790362289，均 270 B、0600，与台账记录一致。
> 实跑只在 `scratchpad/final/orca`（`git clone --local` 于 `a0f58e2`，node_modules 软链主树）里做，HOME 与四个 XDG 根改道到 `scratchpad/final/home/`；没调真 claude／codex，没跑全量，没派子席。收尾 `ps` 里没有命令行含 `scratchpad/final` 的进程。

## 结论

**Critical 0 ／ Important 2 ／ Minor 8。**

**判定：可以宣布「fake agent 下这一轮做完、门是绿的」。附两个条件：**
(1) §13 D10 的说法经实测是假的（I-1），而 §13 已经发布，必须另起一节写更正。这条修起来很小，建议推送前修掉。
(2) I-2 在付费真 claude 那一轮之前必须由人裁定，并写进 §11／§13。

整轮最承重的一条是「操作者没看到的选择会不会被冻结或派出去」。这条我沿着 预览 → 确认 → 冻结 → 派活／闸门／解冲突／handoff 宽限／续跑 → ccloop accept／`run --agents` 一路追下来，没找到口子：

- 确认时，服务端重新解析，拿自己算出的 `selectionsHash` 与浏览器发来的比对，并在事务内用 `currentPartials` 重核各层。
- 派活时的 envelope `claim.agent` 取自工作项上冻结的值。`readConfirmedTaskExecution` 证明工作项与快照一致；解冲突 run 经 `readConfirmedReconcileSlot` 读。
- ccloop 在 accept 和 `run --agents` 时重新物化，把得到的 hash 与冻结的 hash 比对。
- 闸门只拿冻结选择去问 ccloop。唯一读活偏好的是面板的 profile 展示，这是设计本来就这样定的。

线上契约两边一致：envelope `protocol:2` ＋ `claim.agent`、capabilities `protocol:3` 的两种应答、handoff `protocol:1`、control「具名拒绝退 2／其余退 1」、`run --agents`「拒绝退 1／跑完没成功退 2」，还有码表。波 2 复审逐词核过，我复读了两份 diff，与它的结论一致。

两条 Important 都不会让系统跑错 agent，都是 fail closed。但它们都落在「已在飞的工作能不能回收、能不能接着跑」上：I-1 是删表导致面板起不来，I-2 是 CLI 一升级，已开跑的组就永远卡住。

---

## Important

### I-1 表文件不在时，面板整个起不来：§13 D10「保住 ccloop『删表不挡回收』」在生产装配路径上不成立

- **位置**：
  - `src/panel/controlConfig.ts:151`：`if (input.agentsTablePath !== null) checkedPath(input.agentsTablePath, "file");`。`checkedPath` 在 `:100-101` 对每一段路径做 `lstatSync`，文件不在就 `invalid("path-missing")`，抛 `control-trusted-config-invalid`。
  - 调用方：`src/panel/controlAssembly.ts` 在 `createTrustedControlConfig({... agentsTablePath: env.ORCA_AGENTS_TABLE! ...})` 处无条件调用它。
  - 再上一层：`src/panel/server.ts:180` 在 listen 之前 `await assembleControlRuntime(...)`，外面没有 try。
- **证据**（副本实跑）：探针 `scratchpad/final/orca/tests/panel/finalProbe.test.ts` 用 `resolveControlOptions` 配出一个 configured 的端口（fake-ccloop-control 当 binary），删掉表文件后调用 `assembleControlRuntime`。
  命令：`HOME=$S/home XDG_*=… ./node_modules/.bin/vitest run tests/panel/finalProbe.test.ts > $S/probeB.log`，rc=1。日志第 7 行：`PROBE-B threw control-trusted-config-invalid:path-missing`。对照组 PROBE-A（表在）装配成功。
- **为什么要紧**：
  - spec §12 I4 与 §4.2 的本意是「表坏了不许挡在飞 run 的回收」。ccloop T5 fix I-1 为此让非 capabilities／accept 的方法对 ENOENT 放行。波 2 I-1 又指出 Orca 端口构造把它抵消了，裁定改成「端口只核形状」，§13 D10 也登记成已保住。但同一次装配里还有第二道存在性检查，就是 trusted config。这道检查是本轮之前 `adapterConfigPath` 就有的，只做了改名、没重新审视。
  - 实际后果：人为了重新生成表把 `~/.orca/agents.json` 挪走或删掉，之后重启面板，**整个面板进程起不来**，连评审／决策面板也一起没了，在飞 run 的 inspect／collect／handoff 一个都做不了。这比波 2 I-1 描述的后果还重。
  - 判据空在哪（Rule 9）：`tests/control/ccloopPortMissingTable.test.ts` 的注释写「the panel builds it once, at assembly. So: … build a NEW port over the same (now missing) path」，量的是端口这一层，没量装配。所以它一直是绿的，但证明不了注释里那句端到端保证。
  - §13 是已发布文本，D10 那一行现在写的是一句假话。
- **建议修法**：
  - 修代码：`controlConfig.ts:151` 改成与 `ccloopPort.ts` 的 `agentsTablePath()` 同义的形状检查：路径必须绝对；东西在的话，必须是 canonical 的普通文件、不是软链；东西不在就放行。存在与否交给 ccloop 的 capabilities／accept 判定。
  - 补判据：把 PROBE-B 转正，断言删表后装配成功、`recover()` 能跑，且 `listAgents` 以 `agents-table-invalid` 被拒。配一条变异：恢复成 `checkedPath(...,"file")` 后这条判据必须红。
  - 按 Rule 13 在 spec 末尾另起 §13.4，写 D10 的更正（原文逐字保留）。

### I-2 安装记录的 `version` 在 `configHash` 里，而开跑后的组没有重新冻结的路径：CLI 升级一次，已开跑组剩下的任务、续跑和解冲突就永远起不来。这件事没有登记

- **位置**：
  - ccloop `src/agents/materialize.ts:50`：`agentConfigHash` 等于整份物化配置的 canonical hash，其中 `installation.version` 也算在内。
  - 同文件 `:82`：观测到的版本与表里的不等，就报 `agent-version-drift`。
  - Orca `src/control/webService.ts:87-90`：`prestart` 在组处于 running／review／done 时拒绝，于是 `proposal-set-agent`、`proposal-edit` 与再次 confirm 都走不通。本轮也没有任何「对已开跑组重新冻结」的动词。
- **证据**：
  - `scratchpad/final/hashprobe.mjs` 用 T16 那份 ccloop build 的 `dist/src/agents/materialize.js` 算了两份配置的 hash，两份只差 `version`（2.1.282 对 2.1.283）。命令 `node hashprobe.mjs $S/impl/ccloop-build > hashprobe.out`，rc=0，输出 `{"h1":"c96de456…","h2":"e17ca998…","equal":false}`。
  - 把两个事实连起来推：
    1. CLI 原地升级之后（真 claude 默认会自动更新），每一次对冻结选择的 capabilities、accept、`run --agents` 都报 `agent-version-drift`。闸门那边会落下组级阻塞 `claim-capability-unavailable`，accept 那边是 `accept-refused:…`，解冲突那边是 `reconcile-refused:agent-version-drift`。
    2. 人把表里的 `version` 改成新版本之后，漂移消失了，但物化出来的 hash 也跟着变了。accept 和 `run --agents` 于是一律报 `control-config-hash-mismatch`。
    3. 组已经开跑，不能重新确认。
    
    结果是这个组里没派出去的任务、handoff 之后的续跑、以后的解冲突，都没有任何出路。recovery-retry 只会把同一个 envelope 再发一遍。
- **为什么要紧**：
  - 这不会跑错 agent，所以不是 Critical；全程 fail closed。
  - 但它是真 claude 上线后第一个必然会踩的坑：自动更新一般以天为周期，一个组的活往往跨天。
  - spec §12 C6 选择用 `--version` 比对，是为了抓「原地升级不改表」这种情况。当时没讨论的是它与「版本进哈希」、「开跑后不能重新冻结」三者叠在一起的后果：spec §11、§13 都没有这一条。fake 轮里表是自己写的、版本不会动，所以判据看不到这个问题。
- **建议**（要人裁，下面三选一或组合）：
  - (a) 物化配置的 hash 不再包含 `version`，版本只由漂移检查负责。代价是「同一个 configHash」不再绑定二进制版本。
  - (b) 给 running 组加一个「重新冻结某个槽位」的命令动词，走 preview／`selectionsHash` 那一套，只作用于还没开跑的工作项和解冲突槽。
  - (c) 至少先在 §11 与 §13 登记这个限制，并在付费真 claude 那一轮之前关掉 claude 的自动更新（例如设 `DISABLE_AUTOUPDATER` 一类环境变量），写进那一轮的前置条件。

---

## Minor

### m-1 §13 漏登记的契约与偏离（波 1／波 4 明确要求 T17 登记的）
- 波 4 M-6：面板新增三个读路由 `GET /api/control/agents`、`/operator/agent-preferences`、`/groups/:g/agent-preview`；预览的线上形状，含逐槽 `resolved|rejected|unavailable`、`selectionsHash: string|null`；组视图新增字段 `agents.reconcile`；新 schema 名 `orca-agents-view-v1`、`orca-agent-preferences-v1`。测量：`grep -n "agent-preview\|/api/control/agents" docs/superpowers/specs/2026-09-26-agent-selection-design.md` 零命中。
- 波 4 M-5：`GET /agents` 的具名拒绝会把 ccloop stderr 的 detail 原样透给浏览器。
- 波 4 M-2：D6 只写了「登记其时间窗」，没写这个时间窗具体是什么（偏好 revision 变了，旧预览仍能确认，冻结下来的来源层可能和屏幕上显示的不同）。
- capabilities 表级视图比 spec §4.6 多一个 `version` 字段（来自计划骨架，spec 里没有）。
- 波 1 M-5：`configDir: null` 的含义是继承 worker 所在环境，不进哈希。所以同一个 configHash 可能在不同账户下跑。
- 波 3 M-7：确认之后、开跑之前，改组级 estimator 层也会把提案打回可编辑，并清掉全部冻结字段。
- 注册只读路由时就会 mint `panelOperatorId`：`ensurePanelOperatorId` 在路由注册时写 `meta`。
- 建议：并进 I-1 的那一节 §13.4，一次补齐。

### m-2 D11 的描述不完整：探不到版本，在闸门路径上会变成持久的组级阻塞，不是「unknown 可重试」
`src/control/webDispatch.ts:201` 的流程是：probe 失败 ⇒ `probeFailureCode` ⇒ 判为 degraded ⇒ 插入 `recovery_blockers` 的 `claim-capability-unavailable`。插入之后，`dispatch.ts:91` 的 `groupClaimBlocked` 会让以后的 wake 一律 deferred，直到人 recovery-retry。D11 写的「control 退 1 ⇒ Orca 视为 unknown 可重试，由 `INSPECT_UNKNOWN_LIMIT` 兜底」只对 accept 路径成立。机器负载高、`--version` 超过 10 s 时，这就是一次要人介入的阻塞。仍然是 fail closed。建议在 §13 更正 D11 的措辞。

### m-3 `versionOf` 用 `execFileSync` 且不设超时（波 5 m-2）：评估生产影响
面板、驱动环和 `orca agents` 都不调用它。生产代码探版本走的是 ccloop 的 `probeVersion`，它有 10 s 超时，超时后 SIGKILL。有这个问题的两处：
- `tests/control/fixtures/ccloopWorld.ts:42`（只在测试里）；
- `scripts/live-driver-acceptance.ts:66`，这是人手动跑的验收脚本，live 模式下会对**真 codex** 同步跑 `--version`。挂住时 vitest 的超时打断不了它，只能 Ctrl-C。

结论：对常驻 daemon 没有影响。建议两处都加 `timeout: 10_000`，并把 §13.3 的登记补上「验收脚本同样有这个问题」。

### m-4 派活用的是 run 行里的 `agent`／`configHash`，没有与快照比对（与解冲突那条路径不对称）
`src/control/executionDriver.ts:239` 用 `run.agent` 构造 envelope。前一行 `readConfirmedTaskExecution` 只证明工作项与快照一致，没证明 run 行与快照一致。解冲突那边的组记录在波 3 I-2 已经改成经快照核对。只有存储被篡改或损坏时才会出问题，ccloop 仍会核「选择与 hash 自洽」。建议 `toStartEnvelope` 之前加一条断言：`canonical(run.{agent,configHash}) === canonical(confirmed.agent.{agent,configHash})`，不等就 `recovery-blocked`。

### m-5 model 带 `[1m]` 后缀可以绕过上下文档位（波 1 M-2，一直 deferred，没登记）
ccloop `src/agents/claude.ts:32` 的 `validateSelection` 放行 `opus[1m]`：
- `{model:"opus[1m]", contextWindow:"agent-default"}`：实际跑的是 1M，但能力视图报 `contextWindowTokens:null`，哈希里记的也是 agent-default。
- 配上 `1_000_000`：拼出来是 `opus[1m][1m]`，要等 run 真正跑起来才在 CLI 那里失败，此时确认和预算预留都已经发生了。

另外，claude 的 `1_000_000 ⇔ [1m]` 映射只经过「二进制里有这个字符串」的核对，没有观测过真窗口；spec §4.1 自己也这样说。建议在 `validateSelection` 里拒绝以 `[1m]` 结尾的 model。

### m-6 `handoffGraceMsOf` 在冻结值无效时退回 0，方向不保守
`src/control/driverHandoff.ts:187-190`。Web run 必然带着冻结的 `killGraceMs`（`frozenWorkAgent` 在建 run 时校验过），所以只有存储损坏才会走到这一支。但 ccloop 实际施加的等待最长可达 60 000 ms。宽限算短了，会在 ccloop 还在收尾时把 handoff 判成 outcome-unknown。建议退回 60 000（上限），波 2 m-5 也这样建议过。

### m-7 两份 handoff 里有已过期的说法，控制器收尾更新时要改掉
- Orca `docs/handoff/handoff.md:142`：写着「全量门、T16 的混组 E2E、终审都没做」。这些现在都做了。但「不许说 claude 可用」这句必须保留。
- ccloop `docs/handoff/handoff.md:427`：写着 runCodexPhase 那条疑似 flake「T17 判定前不要加进已知红名单」。T17 门席发现它早就在 `check-known-reds.mjs` 名单里（台账 §8）。

整轮的代码注释、commit 和 spec §13 里，我没找到超出「fake 下成立、门绿」的说法（`grep -i "real claude|verified|proven"` 于两份 diff，命中全是来源标注和校验相关的词）。门的表述也诚实：ccloop verify:control 与 Orca test／chain 的 RC 1，都经 `check-known-reds`／判定器机械放行，台账 §8／§9 写得清楚。

### m-8 真 CLI 的 `--version` 探测会不会写配置目录，没量过（Rule 17，付费轮的前置条件）
本轮起，detect、validate、capabilities、accept、`run --agents` 都会对表里的真 CLI 跑 `--version`；`orca agents init`／`show` 也会在人自己的机器上触发它。spec §8 写的是「ccloop 零仓库外写入」，这个说法只覆盖 ccloop 自己，不覆盖被它调起的 claude 或 codex。另外 `probeVersion` 不设 `CLAUDE_CONFIG_DIR`／`CODEX_HOME`，与 worker 实际运行的环境不同（波 1 M-5）。建议付费轮开始前，在改道的 HOME 下对真 CLI 跑一次 `--version`，量一下有没有写入，写进那一轮的 Rule 17 登记。

---

## 逐项核对（派发的 6 个问题）

1. **没看到的选择会不会被冻结或派出**：不会（见结论）。补充几条：
   - 预览模式下，瞬时失败的槽记为 `unavailable`，此时 hash 为 null，不能确认。
   - `agent-selection-rejected` 与 `agent-selection-changed` 都会让预览作废。
   - 选择只有由 ccloop 回显了请求字段才被接受：`ccloopPort.ts` 的 echo 核对，加上 `descriptorProvenance`。
   - 崩溃恢复（`reconcileStart`）重发的是存储里的 envelope。
   - 解冲突 run 在 Orca 重启后如果重新 spawn，用的还是快照里的 reconcile 槽。
   - 唯一的残余是 m-4（存储损坏的情形）。
2. **fail closed**：没发现回落到默认 agent 或 model 的路径。缺冻结值的地方要么问 ccloop `{}`，由 ccloop 以 `agent-unselected` 拒绝；要么直接 `recovery-blocked`。挡住回收的有两处：I-1（装配层）与 I-2（升级后）。ccloop 侧「只有 capabilities／accept 读表」成立（`command.ts` 的 `parseCommand` 只调 `assertAgentsTablePath`）。
3. **Rule 17**：本轮生产代码新增的 HOME 读取只有 `src/agents/paths.ts`，它用的是传入的 `env.HOME`，缺失或非绝对就拒绝，不回落到 `os.homedir()`。CLI 入口传的是真 `process.env`，这是设计如此。ccloop `agents detect` 的 `homedir()` 只读、不写。真 `~/.orca` 没被碰过（见头部的 stat）。未决的只有 m-8。
4. **进程卫生**：
   - `ClaudeAgentAdapter`：detached 起进程，按 `-pgid` 发 SIGTERM，`killGraceMs` 之后 SIGKILL；`finish` 总会再对整个组补一次 SIGKILL；先注册、后写 stdin。与 codex 的实现同形，没发现问题。
   - `probeVersion`：有超时，超时后 SIGKILL。它只杀直接子进程；真 CLI 是 `env node` 直接 exec 起来的，这样够用。
   - 阻塞的组不会每个 tick 都重新探一次：`groupClaimBlocked` 让它 deferred。
   - 一次预览或确认，拉起的进程数是 D×(ccloop＋`--version`)，有上界。
   - `versionOf` 见 m-3。
5. **D1–D11 与 §13.3**：
   - D10 是 bug（I-1）。
   - D11 的描述不完整（m-2）。
   - 其余都是可接受的偏离：D1、D2、D3、D4（fail closed）、D5、D6（值不会变，只有来源标签可能变）、D7（`~/.orca/control` 现为空目录，也没有 orca 或 ccloop 进程在跑，没有需要迁移的在飞数据）、D8、D9。
   - §13.3 的四条登记属实。
   - 漏登记的见 m-1、m-5。I-2 整条都没登记。
6. **说法的诚实度**：见 m-7。

---

## 人要审的 Ruling 中你认为有风险的

1. **波 2 I-1 Ruling（§13 D10）**：修法没做全。它只改了端口构造，装配层还有一道存在性检查，D10 里「保住」的说法是假的。见 I-1。建议推回：本轮补上修复、判据和 §13 更正。
2. **§12 C6「跑 `--version` 比对」（spec 阶段的控制器裁定）叠加 Task 0／R1**：这条裁定本身没问题，但它与「version 进 hash」、「开跑后不能重新冻结」叠在一起，就成了 I-2，而当时没人看过这个叠加。建议人在付费轮之前从 I-2 的 (a)／(b)／(c) 中选一个。
3. **波 2 I-3 Ruling（D11）**：方向对，探不到版本不该算作具名漂移。但它的依据「Orca 视为 unknown 可重试」只在 accept 路径上成立，在闸门路径上变成了要人介入的持久阻塞（m-2）。不需要推翻，改一下措辞即可。
4. **波 5 Ruling（m-1：旧路径不补判据）**：「生产不可达」的判断成立。但复审提的结构判据（「只有这四个文件可以 import `readAgentPreferences`」）只要几行，能把这条不变量的看守从「靠人记得」变成机械检查。我倾向于补上，不硬推。
5. **Task 0 Ruling「codex 描述默认值 `gpt-6-sol`」**：codex 0.155.1 的二进制里只有 `gpt-6-astra`／`gpt-6-pro` 这两个字面量。`gpt-6-sol` 的依据是人自己的 `~/.codex/config.toml`，而且 codex 会把 model 字符串原样传给服务端。在人自己的机器上成立；换一台机器，出厂默认值可能不是一个有效的 model。风险低，只提醒一句。

其余 Ruling 我认为风险可以接受，不推回：R7／W5-M16、R6 M4、无迁移、T15 改成手动 Re-read、T17 那 28 条助手级 REWRITTEN 不做机械检查、新码 `reconcile-refused`、不再派 spec 二次复审。
