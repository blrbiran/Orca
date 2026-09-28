# 待办批量加固（backlog #3 #6 #7 #11 #12 #13 #14 #15 #16，#4 跳过）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把人 2026-09-29 批准的九个待办（台账 `.superpowers/sdd/2026-09-29-labels-progress-and-backlog/progress.md` §1：「#6、#3（先不做 m6）、#4、#7、#11、#12、#13、#15、#16 => 做」「#14，要你指名判据 => 同意修改判据」）落成代码与判据：每处改动都有一条会被**看见红**的判据；做不成的（要设计、要改未授权的既有判据、测不了）在下面的 Drafter findings 里写明理由后跳过。

**Architecture:** 全是彼此独立的小改动，没有新模块。ccloop 九个 Task（runner 的流解码、观测守卫的判据、子代理流配对、续跑输入进 prompt、描述符维度收紧、`[1m]` 后缀、锁事件去重、零写快照、两条 ERRATUM）先做；Orca 五个 Task（驱动环按组隔离、派活对确认快照、strict 能力闸门、面板显示 handoff 能力、slogan 与验收脚本默认额度）后做；最后一个 Task 是两仓的门和变异总表。

**Tech Stack:** TypeScript（NodeNext ESM）、zod、vitest（两仓）、React 19 ＋ @testing-library/react（Orca `web/`）、Node 22 ESM 脚本（ccloop `scripts/`）。

**Spec:** 无（人裁「不走设计」，每条的形状已在记录里）。出处：
- Orca `docs/handoff/handoff.md` §9.0（#3）、§9.0b（#7、#15）、§9.0c（#4、#13）、§9.1（#11、#15 的 ccloopPort 那条）、§4.0「还挂着的」（#12(a)）；
- ccloop `docs/handoff/handoff.md` §2「仍然挂着的」（#14 的 M3／M4、#11(c)）与文末「🔴 挂着的」（#6、#12(a)）；
- Orca spec `docs/superpowers/specs/2026-09-27-claude-stream-usage-design.md` §3、§4、§8 第 4 条（#6、#12(b)）；
- Orca spec `docs/superpowers/specs/2026-09-26-agent-selection-design.md` §4.9、§12 m-4／m-5／m-6、§13.8 末条（#4、#13）；
- ccloop `.superpowers/sdd/2026-09-23-ls-lock-visibility/progress.md` §12.2（M3／M4 原始登记）；
- Orca `.superpowers/sdd/2026-09-25-handoff-delivery/final-review.md` 的 M4 行（#15）；
- Orca `docs/handoff/goal.md` §10.2 G8（#16 的 slogan）。

> 起草者：Orca 控制器会话 `2724716d` 派出的只读起草子 agent（Claude Opus 5.5），2026-09-29。只读探查，除本文件外未改任何文件。
> 行号一律「measured 2026-09-29, re-measure before use」。观测锚点：Orca 主题行 `docs(spec): fold the code review into the labels and progress design as section 8`（`084f15f`）；ccloop 主题行 `docs(handoff): the Orca line's twentieth version: …`（`b1c383e`）。

---

## Drafter findings（记录与现测不符、或要设计的；控制器可推翻，推翻哪条就补哪个 Task）

| # | 记录说的 | 现测 | 本计划的处置 |
|---|---|---|---|
| **#4** | `ccloop resume`／`sweep` 要支持 `run --agents` 起的 run，resume 用「run 开始时冻结在 run 目录里的选择」 | **run 目录里没有冻结任何选择。** `runWithAgents`（ccloop `src/cli.ts:282-302`）读 `--agent-selection` 文件、物化、比 hash，然后直接 `runLoop(contract, runDir, adapter)`；`runLoop`（`src/controller/runLoop.ts:1088-1122`）只写 `loop-contract.json`／`loop-state.json`／`events.jsonl`／`owner-record.json`。选择文件是 **Orca** 写在解冲突 run 的 workdir 里的（Orca `src/scheduler/ccloopRunner.ts:329-332`，`<workdir>/agent-selection.json`，run 目录是它下面的 `loopDir`）。`sweep` 还是「一个 adapter 管整棵树」（`sweepRuns.ts:183`），按 run 各用各的选择是新语义。 | **SKIP。** 要先定：选择冻结在哪（ccloop 在 `run --agents` 开头往 run 目录写一份？那会碰 `ensureFreshRunDir` 的前置条件与 `ls`／零写判据）、`resume --agents <table>` 的 CLI 形状、`sweep` 遇到不同选择的 run 怎么办。这是设计。**控制器若要按「有问题先按你的建议」直接定**，最小形状建议：`run --agents` 在 `runLoop` 之前把选择文件原字节写成 `<runDir>/agent-selection.json`（0600，`wx`）；`resume --run-dir X --agents T` 读它、物化、比 hash，不等就以 `control-config-hash-mismatch` 退 1；`sweep --agents T` 对每个候选同样处理、各建各的 adapter。但它要先量 `ensureFreshRunDir` 与 `tests/registry/zeroWrite.test.ts` 会不会因多一个文件而红（红了就是改既有判据，未授权）。 |
| **#11(d)** | `webFixture`／`createHarness` 的 `port.capabilities()` ＝ `{protocol:2, ...declared}`，没有独立钩子，`setObserved` 只管探测那条路 | **记录已过期。** agent 选择一轮（plan T11／T14）之后 port 上没有 `capabilities()` 了：探测（Orca `src/control/profiles.ts:163`）和认领（`src/control/dispatch.ts:53`、`:78`）都走 `port.resolveAgent`。`webFixture` 把 `resolveAgent` 作为 `vi.fn` 返回（`tests/control/fixtures/web.ts:62`、`:117`），判据可用 `mockImplementationOnce` 让某一次调用单独变；`createHarness` 有 `resolveAgent` 选项（`tests/panel/fixtures/controlPanel.ts:71`、`:141`）。 | **SKIP，无夹具改动。** 「认领时能力与探测不符」的判据今天就能写（按调用顺序 `mockImplementationOnce`）。登记「记录过期」即可。 |
| **#13(b)** | handoff 宽限在冻结值无效时退回 0；按 fail-closed 应取上限 | 取上限（`killGraceMs` 上限 60 000 ⇒ 宽限 120 000）会让**两条既有判据**红：`tests/panel/assemblyHandoffGrace.test.ts` > `the handoff grace the driver waits (spec §3)` > `is the agent's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable`；`tests/control/agentFreeze.test.ts` > `judges a handoff's grace by the run's frozen killGraceMs plus the fixed extra`（`:351-354`）。另外冻结值已被 `frozenSlotSchema`（`src/control/webProtocol.ts`，`killGraceMs: safeInteger.max(60_000)`）约束，只有库损坏才会无效。 | **SKIP。** 人本轮只授权 #14 改既有判据。要做，请人指名上面两条；改法是 `handoffGraceMsOf` 的回退值由 `0` 改为 `60_000`，两条判据里 `-1, 1.5, "5000", null, undefined, {}` 那几行期望改为 `120_000`。 |
| **#13(d)** | 量「`orca run` 解冲突被信号取消时是否仍发布 attempt ref」 | 量不了现成的：要在 `orca run` 的解冲突 ccloop run 里停在一个可控的时刻。`orca run` 只收 `--adapter scripted|claude`（Orca `src/cli.ts:276`）；`ScriptedAdapter` 没有延时（ccloop `src/runtime/scriptedAdapter.ts`），runner 层替身 `tests/fixtures/fake-claude.mjs` 也没有任何定时器。另外，ccloop `run`（非 sweep）不装信号处理器（`src/cli.ts` 只在 sweep 分支 `registerStopHandlers`），第一下 SIGINT 就按默认处置结束进程。 | **SKIP，登记量法。** 要量得先给 runner 层替身加一个「execute 前睡 N ms」模式（夹具改动），再用 `tests/scheduler/sandbox.ts` 起一个两任务冲突的 `orca run --adapter claude`，在替身 marker 显示解冲突 execute 开始后对 orca 进程组发 SIGINT，事后看解冲突副本里 `git for-each-ref refs/ccloop/` 与 W 的提交。 |
| **#15（Orca 那条）** | Orca `src/control/ccloopPort.ts` 有一条已发布的 ERRATUM 写「The paragraph above」，指错了段落 | **那条 ERRATUM 已不在文件里。** `git log -S'The paragraph above' -- src/control/ccloopPort.ts` 只命中两笔：`67890cf`（加）与 `caaa791`（主题行 `feat(control): speak envelope v2, capabilities v3 and --agents to ccloop`，随整个方法的旧注释块一起删掉）。现文件 `grep -ni erratum` 零命中。 | **SKIP（无处可追加）。** 原文要逐字取回只能 `git show caaa791^:src/control/ccloopPort.ts`。ccloop 那两条照做（Task 1）。 |
| **#14 M3** | 修 M3 要改既有判据（人已授权并要求指名） | 现有判据**没有一条**覆盖「transfer 路径已记一条之后，重读又撞同一把锁」这个组合：`leaseLifecycle.integration.test.ts` 里断言「恰好一条」的几条都各只走一条路（transfer 路径的那条没有 marker，读路径的那条在 transfer 之前就撞锁）。 | **只加不改**（Task 8 新增两条）。人的授权在 M3 上用不到；M4 用到（Task 9 指名）。 |
| **#16** | 只改 `--task-tokens` 默认值 150 000 → 1 000 000 | 只改它会让默认跑法在 confirm 被拒：组默认 `--group-tokens 300000` 小于一个任务的 1 000 000，而 confirm 冻结快照时逐维比总额与组上限（Orca `src/control/executionSnapshot.ts:162`，`group-budget-unavailable`）。 | 连带把 `--group-tokens` 默认值改为 3 000 000（`Ruling:`，见 Task 14），并用 `--fake` 的 single、conflict 两个场景实测默认值能过 confirm。 |
| **#12(a) 旁证** | 只点名了 stderr | `SubprocessClaudeAdapter` 的 **stdout** 也是按块 `chunk.toString()`（ccloop `src/runtime/claude/subprocessClaudeAdapter.ts:60-62`），同一类缺陷，而且坏的是结果 JSON 里的字符串。 | **只登记不修**（ccloop 方法论第 11 条「看见了就报，不要顺手修」）。 |
| **#6** | 四处「删掉没有判据会红」 | 四处都**不是**真冗余：`total !== null` 守卫对应 spec §4「总数不是正安全整数 ⇒ 不写观测」；`observedUsagePath` 对应 spec §3.2(1)「`outcome.json` 记下该路径」；`setEncoding` 对应 ruling 26 修 stdin 时的同一条理由；`catch` 在 spec 里没有定义（spec §8 第 4 条自己写了「spec 没定义路径不可写时该怎么办」）。 | 四条都加判据（Task 3）。`catch` 那条钉的是已发布代码的现行为，记为 `Ruling:`。 |
| **#3** | 失败要「大声」，不许静默吞 | 驱动环现行的记法：能落到 run 上的写进 `drive.blockedReason`／`drive.cleanupError`，落不到 run 上的写一行 `orca-driver: …` 到 stderr（`src/control/executionDriver.ts:787`、`:790`、`:812`）。组级没有持久字段；写 `recovery_blockers(scope='group')` 会挡住该组派活，是另一种语义。 | 组级失败照现行记法写 stderr（`Ruling:`，Task 10）。 |
| **#12(b)** | `message_delta` 配对不看 `parent_tool_use_id`；先确认现语义 | 现语义：`createUsageObserver` 只有一个 `current`，`message_delta` 一律关掉**最近一次** `message_start` 的消息，不看流（ccloop `scripts/claude-stream.mjs:124-140`）。`parent_tool_use_id` 是每条 `stream_event` 的顶层字段、主代理为 `null`（Orca `.superpowers/sdd/2026-09-27-claude-stream-usage/evidence/partial.lines.json` 各行）。子代理流是否真会交错**没量过**（spec §8 第 4 条：探针 n＝1，无子代理）。 | 能从代码与证据定：每条流各配各的（`Ruling:`，Task 4）。子代理的消息照旧各记一条（它们是真花费），只是不再互相覆盖。对今天的流（全是 `null` 或没有该字段）行为不变。 |
| **#15 扫描** | — | 同一句「真 codex 只在阶段末报 usage」也以事实口吻出现在 Orca `docs/handoff/handoff.md:252` 与已发布 spec `docs/superpowers/specs/2026-09-25-handoff-delivery-design.md:294`。 | 不在本计划范围（文档）；Task 1 的全树扫描会把它们列进台账，交控制器决定是否在 handoff 活文档里改、在 spec 里另起更正节。 |

---

## Global Constraints

- **仓库**：ccloop `/Users/biran/code/skills/loop/ccloop`；Orca `/Users/biran/code/skills/loop/Orca`。在控制器指定的分支上落**本地提交**（默认各自的 `main`，排在计划 A `2026-09-29-labels-and-progress.md` 之后顺序执行）；**绝不 push**，不删分支、不删 worktree（两仓 CLAUDE.md 的「四件事」）。
- **提交信息**结尾两行（归属行照实写执行席自己的模型；下面是控制器本会话的）：
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
  ```
- **会话 scratchpad**：`SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad`。
- **证据纪律**：每条验证跑都写成 `… > "$SCRATCH/<name>.txt" 2>&1; echo rc=$?`，再用 Read **整份读回**，并核 vitest 第一行 `RUN` 指向的路径。不许 `| tail`／`| grep`／`| head`（管道吞退出码）。字节、行号、条数引用前现测。
- **TMPDIR**：跑判据前 `export TMPDIR=$(mktemp -d /private/tmp/cl-XXXX)`（短路径的真目录；放在 scratchpad 下太长会让 tsx socket 超过 104 字节，软链会让比路径的判据假红）。另 `export ECC_GATEGUARD=off DISABLE_OMC=1`。
- **主树**只跑本 Task 点名的判据文件（ccloop `./node_modules/.bin/vitest run <files>`；Orca 同；Orca web `cd web && ../node_modules/.bin/vitest run tests/<file>`）与 `npm run typecheck`；**主树不 build、不跑全量**。
- **变异只在 `git clone --local` 副本里做**（两仓 Rule 17／15）。副本一律建在 `$SCRATCH/mut-<task>/` 下；`ln -s <主树>/node_modules <副本>/node_modules`（Orca 另加 `ln -s <主树>/web/node_modules <副本>/web/node_modules`）；副本是**已提交**状态 ⇒ 要测本 Task 未提交的改动，先 `cat <主树文件> > <副本同路径文件>`，再 `cmp` 两者证明逐字节相同，然后才变异。每条变异跑完 `/usr/bin/git -C <副本> checkout -- <文件>` 还原，还原证明用 `rtk proxy /usr/bin/git -C <副本> diff > f; wc -c f` 与 `--cached` 各一次的**字节数**。**副本用完不删**（删要人点头），在台账列出路径。
- **跑门**（Task 15）时 HOME 与四个 XDG 根改道：`export HOME=$SCRATCH/gate-home XDG_CONFIG_HOME=$SCRATCH/gate-xdg/config XDG_DATA_HOME=$SCRATCH/gate-xdg/data XDG_CACHE_HOME=$SCRATCH/gate-xdg/cache XDG_STATE_HOME=$SCRATCH/gate-xdg/state`（先 `mkdir -p` 这些目录）。
- **ccloop clone 跑全量**前必须 `npm run build`（`dist/` 被 gitignore，不 build 会让 `endToEnd.test.ts` 6 条以 `ENOENT … dist/cli.js` 假红）；判红用 `node scripts/check-known-reds.mjs <vitest --reporter=json 输出>`，**RC 0 才算绿**（名单 14 个名字，唯一稳定红是 `tests/control/stopProof.test.ts > quiet execution proof > does not treat leader exit as group quiet and proves only after the full tree is gone`）。
- **Orca clone** 跑全量前必须 `npm run build --workspace web`（不 build 有 14 条 `panel-dist-missing` 假红）；`ORCA_CCLOOP_BIN`＝ccloop clone 的 `dist/cli.js`；`ORCA_AGENTS_TABLE`＝scratchpad 里的夹具表（0600 文件在 0700 目录，`command`＝`[node, <ccloop 副本>/tests/fixtures/fake-codex.mjs, "integration", <marker>]`，`version: "9.9.9-fake"`，**模式必须是 `integration`**）。被当作 `ORCA_CCLOOP_BIN` 的 clone 不许同时拿来做变异。
- **已知负载型 flake**（先单文件重跑、记 `uptime`，负载降下来后绿就不是回归）：Orca `tests/control/driverRecovery.test.ts`、`driverLanding.test.ts` 两条、`handoffE2E.test.ts` 的 G、`executionDriverE2E.test.ts`、`driverSettle.test.ts`、`tests/chain/gateCheck.test.ts` K12／K13、`tests/panel/controlShutdown.test.ts`（143）、`web/tests/controlCommandRecovery.test.tsx` 一条；ccloop `codexWatchdog` 日期 flake、`runLoop.integration.test.ts` 里 `perAttemptTimeoutMs: 20` 的那些（特征「… phase exceeded per-attempt timeout of 20ms」）。
- **既有判据**：ccloop Rule 15 ／ Orca handoff「改既有判据每次要人重新开口」。本轮**只有 #14 获授权**，且只改 Task 9 指名的那几条；其余 Task 一律**只加不改**。实施中点名之外的既有判据红了 ⇒ **停下报控制器**，不要改它。
- **注释**：英文，写「为什么」，写明依据（backlog 编号、handoff 节号、spec 节号）。已发布的注释（`/usr/bin/git ls-remote` ＋ `merge-base --is-ancestor` 说了算）只能**原文逐字保留 ＋ 在注释块末尾追加具名 `*** ERRATUM (…) … ***`**；ERRATUM 里不写计数、不引用会移动的 git 引用。
- **命令习惯**：复制文件用 `cat a > b`（`cp` 带 `-i` 会静默拒绝覆盖）；git 一律 `/usr/bin/git`（rtk 会改写 git）；删除只在人授权后用 `/bin/rm -rf <字面路径>`。
- **文档**散文用中文，代码与代码注释用英文。仓库外零写入（Orca Rule 17）：判据只写 `mkdtemp` 临时目录。
- **孤儿进程**：做完变异跑 `pgrep -fl "ccloop-agents-version|worker.js|fake-claude-cli|stand-in-claude"` 记进台账；杀进程要人授权。
- **台账**：`Ruling:` 行、变异结果、实测数一律追加进 Orca `.superpowers/sdd/2026-09-29-labels-progress-and-backlog/progress.md` §2（只追加，Rule 13）。

## Review Focus（最可能咬人的六条）

1. **Task 10 的隔离不能吞错**：每个被跳过的组、每个没记成失败的 run，都要在 stderr 留下点名的一行；`panel-draining` 与 `DriverCrash` 仍然结束整轮。
2. **Task 11 在任何副作用之前拒**：`agent-unfrozen` 必须在建工作区、导 bundle、清前任之前判；接受路径（续跑、正常 run）一条既有判据都不许红。
3. **Task 8 只去掉第二条事件，不改遏制方式**：run 仍以 `executing` 原地放弃，`loop-state.json` 仍与返回值一致。
4. **Task 9 的 `"."` 条目若让 sweep 那条判据的 `refusedAfterRest` 红**，那是 M4 盲区后面藏着的真写入（例如锁建了又删），**停下报人**，不许放宽。
5. **Task 5 的续跑输入**走契约的 `constraints` 进 prompt：plan 与 execute 两个 prompt 都要带上 unfinished／pendingDecisions／awaitingHuman 的原文；`continuation-input.json` 的字节不变。
6. **ERRATUM（Task 1）**：原注释逐字不动，只在块尾追加；不写计数，不写 HEAD。

---

## File Structure

**ccloop**（`/Users/biran/code/skills/loop/ccloop`）

| 文件 | Task | 动作 |
|---|---|---|
| `src/runtime/codex/protocol.ts` | 1 | 注释块尾追加 ERRATUM（41–49 行那块） |
| `src/runtime/types.ts` | 1 | 注释块尾追加 ERRATUM（142–150 行那块） |
| `scripts/claude-phase-runner.mjs` | 2 | stderr 按流解码（436 行） |
| `src/runtime/claude/subprocessClaudeAdapter.ts` | 2 | stderr 按流解码（64–66 行） |
| `tests/runtime/claude/stderrDecoding.test.ts` | 2 | 新建 |
| `tests/runtime/claude/streamUsageGuards.test.ts` | 3 | 新建（生产代码不动） |
| `scripts/claude-stream.mjs` | 4 | 按 `parent_tool_use_id` 分流配对（124–140 行） |
| `tests/runtime/claude/claudeStreamSubagent.test.ts` | 4 | 新建 |
| `src/control/materialize.ts` | 5 | 续跑输入原文进 `constraints`（146–152 行） |
| `tests/control/materialize.test.ts` | 5 | 只追加一条（describe 末尾，178 行之前）＋ 两行 import |
| `src/control/command.ts` | 6 | 描述符维度收紧（43–51 行） ⚠️ 与计划 A 同文件 |
| `tests/control/requestBoundDimensions.test.ts` | 6 | 新建 |
| `src/agents/claude.ts` | 7 | `validateSelection` 拒 `[1m]` 后缀（48–51 行） |
| `tests/agents/claudeModelSuffix.test.ts` | 7 | 新建 |
| `src/controller/runLoop.ts` | 8 | 同一把锁只记一条 `owner_transfer_contended`（994–995、1786–1793、1806–1813 行） |
| `tests/controller/leaseLifecycle.integration.test.ts` | 8 | 只追加两条（describe 末尾，2359 行之前） |
| `tests/registry/zeroWrite.test.ts` | 9 | **人授权改写**：`snapshotTree` 记根目录；sweep 判据四处键表 |

**Orca**（`/Users/biran/code/skills/loop/Orca`）

| 文件 | Task | 动作 |
|---|---|---|
| `src/control/executionDriver.ts` | 10、11 | `replenishStartWakes`（657–683）、`pass`（755–806）、`stepA2`（220–225） ⚠️ 与计划 A 同文件（A 改 `collectInto`，400–422） |
| `tests/control/driverRoundIsolation.test.ts` | 10 | 新建 |
| `tests/control/dispatchAgentSnapshot.test.ts` | 11 | 新建 |
| `src/control/budget.ts` | 12 | `assertCapabilities` strict 分支（87 行） |
| `tests/control/assertCapabilitiesStrict.test.ts` | 12 | 新建 |
| `web/src/BudgetEditor.tsx` | 13 | 显示 handoff 能力（172 行后、242–244 行后） |
| `web/tests/budgetHandoffCapability.test.tsx` | 13 | 新建 |
| `README.md`、`web/index.html`、`web/src/Shell.tsx`、`package.json`、`scripts/live-driver-acceptance.ts` | 14 | slogan；验收脚本默认额度 ⚠️ README／package.json 与计划 C（ccloop git 依赖）同文件、不同位置 |

**与计划 A（`2026-09-29-labels-and-progress.md`，并行起草中）的重叠**：Orca `src/control/executionDriver.ts`（A 改 `collectInto`；本计划改 `replenishStartWakes`／`pass`／`stepA2`，不同 hunk）；ccloop `src/control/command.ts`（A 若给 `collectionSchema` 加 `progress`，本计划改 `capabilityViewSchema`，不同 hunk）。本计划**不碰** A 点名的 `webProtocol.ts`、`controlViews.ts`、`ccloopPort.ts`、ccloop `collect.ts`、`agentsControl.test.ts`。**按 A → 本计划的顺序执行**，每个 Task 开工前重测行号。与计划 C（`2026-09-29-ccloop-git-dependency.md`）：Orca `README.md`（C 改第 398 行之后，本计划改第 2 行）、Orca `package.json`（C 的依赖行由人亲手加，本计划只加 `description`）。

---

# Part A — ccloop

### Task 1: 两条具名 ERRATUM（#15）

**Files:**
- Modify: `src/runtime/codex/protocol.ts`（注释块 41–49 行；在 48 行与 49 行 ` */` 之间插入）
- Modify: `src/runtime/types.ts`（注释块 142–150 行；在 149 行与 150 行 ` */` 之间插入）

**Interfaces:** 无（只加注释）。

- [ ] **Step 1: 证明两处已发布**

```bash
cd /Users/biran/code/skills/loop/ccloop
/usr/bin/git log --format='%H %s' -S'real codex reports usage only at phase end' -- src/runtime/codex/protocol.ts src/runtime/types.ts > "$SCRATCH/t1-intro.txt" 2>&1; echo rc=$?
/usr/bin/git ls-remote origin refs/heads/main > "$SCRATCH/t1-remote.txt" 2>&1; echo rc=$?
```
读回两份。设引入那一笔为 `I`、远端 sha 为 `R`：
```bash
/usr/bin/git cat-file -e R^{commit} > "$SCRATCH/t1-have.txt" 2>&1; echo rc=$?
/usr/bin/git merge-base --is-ancestor I R > "$SCRATCH/t1-published.txt" 2>&1; echo rc=$?
```
期望 `rc=0`（已发布 ⇒ 只能追加 ERRATUM）。若本地没有 `R` 这个对象（`cat-file` 非 0），同样按已发布处理（保守的一侧），并在台账写明「未能核 ancestry」。

- [ ] **Step 2: 全树扫描（扫描词从被更正的句子机械导出，覆盖中英文）**

```bash
rtk proxy grep -rn -i -e 'only at phase end' -e 'usage only at' -e '阶段末' src scripts tests docs > "$SCRATCH/t1-scan-ccloop.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca
rtk proxy grep -rn -i -e 'only at phase end' -e 'usage only at' -e '阶段末' src scripts tests docs > "$SCRATCH/t1-scan-orca.txt" 2>&1; echo rc=$?
```
读回。期望 ccloop 源码里只有这两处；Orca 的命中（至少 `docs/handoff/handoff.md:252` 与 spec `2026-09-25-handoff-delivery-design.md:294`）**只记进台账，不改**。若 ccloop 源码里还有第三处同句 ⇒ 记台账、报控制器，不顺手改。

- [ ] **Step 3: 追加 ERRATUM**

`src/runtime/codex/protocol.ts`：在 ` * an estimate) and that run's usage stays unknown, keeping it unrecoverable.`（48 行）之后、` */`（49 行）之前插入：

```ts
 *
 * *** ERRATUM (Orca backlog #15, human-authorized 2026-09-29, Orca session 2724716d) -- the sentence above that
 * "real codex reports usage only at phase end" is written as a fact, but it was never measured. The plan it came
 * from (Orca docs/superpowers/plans/2026-09-25-handoff-delivery.md, §0 item (10)) inferred it from reading this
 * source and marked it as a guess, because no events.jsonl from a real codex run was kept in either repository to
 * check it against; Orca's final review of that round names this comment (finding M4 in Orca
 * .superpowers/sdd/2026-09-25-handoff-delivery/final-review.md). Read that sentence as unmeasured. What this function
 * reads, and that it answers null rather than an estimate, is unchanged. ***
```

`src/runtime/types.ts`：在 ` * stays unknown (unrecoverable), not a guessed value.`（149 行）之后、` */`（150 行）之前插入：

```ts
 *
 * *** ERRATUM (Orca backlog #15, human-authorized 2026-09-29, Orca session 2724716d) -- the sentence above that
 * "real codex reports usage only at phase end" is written as a fact, but it was never measured. The plan it came
 * from (Orca docs/superpowers/plans/2026-09-25-handoff-delivery.md, §0 item (10)) inferred it from reading the codex
 * adapter's source and marked it as a guess, because no events.jsonl from a real codex run was kept in either
 * repository to check it against; Orca's final review of that round names this comment (finding M4 in Orca
 * .superpowers/sdd/2026-09-25-handoff-delivery/final-review.md). Read that sentence as unmeasured. What this function
 * answers -- a positive safe integer the adapter observed, otherwise null, never 0 -- is unchanged. ***
```

- [ ] **Step 4: 证明原文逐字未动、只多了这些行**

```bash
cd /Users/biran/code/skills/loop/ccloop
rtk proxy /usr/bin/git diff -U0 -- src/runtime/codex/protocol.ts src/runtime/types.ts > "$SCRATCH/t1-diff.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t1-tsc.txt" 2>&1; echo rc=$?
```
读回 diff：期望只有 `+` 行、**零个 `-` 行**，两个 hunk 各 8 行。typecheck `rc=0`。

- [ ] **Step 5: 提交**

```bash
/usr/bin/git add src/runtime/codex/protocol.ts src/runtime/types.ts
/usr/bin/git commit -F - <<'EOF'
docs(codex): append a named erratum where "usage only at phase end" was written as fact

The two comments state an unmeasured inference from the handoff-delivery plan as a
fact (Orca final review of that round, finding M4). Both are published, so the
original text stays verbatim and the erratum is appended at the end of each block.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 2: stderr 按流解码（#12(a)）

**Files:**
- Modify: `scripts/claude-phase-runner.mjs:436`
- Modify: `src/runtime/claude/subprocessClaudeAdapter.ts:64-66`
- Create: `tests/runtime/claude/stderrDecoding.test.ts`

**Interfaces:** 无对外变化。失败信息的文字不再在块边界上出现 U+FFFD。

- [ ] **Step 1: 写判据** —— `tests/runtime/claude/stderrDecoding.test.ts`：

```ts
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SubprocessClaudeAdapter } from "../../../src/runtime/claude/subprocessClaudeAdapter.js";
import { codexFixture } from "../codex/fixture.js";

// Orca backlog #12(a) (2026-09-29; Orca handoff §4.0 and ccloop handoff "挂着的": the runner's stderr was decoded chunk
// by chunk with toString, the same fault ruling 26 closed on stdin). A failure message is what a person reads to learn
// why a phase died, so a non-ASCII line on claude's stderr must reach it whole even when the pipe delivers it in two
// pieces. The stand-in cuts the line inside its first character and writes the halves 200 ms apart, so the reader
// is handed two chunks.
const runner = fileURLToPath(new URL("../../../scripts/claude-phase-runner.mjs", import.meta.url));
const MESSAGE = "認証に失敗しました";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function splitStderrStandIn(): Promise<{ dir: string; script: string }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "claude-stderr-"))); dirs.push(dir);
  const bytes = Buffer.from(`${MESSAGE}\n`, "utf8");
  // One byte into a three-byte character: neither half decodes on its own.
  const pieces = [bytes.subarray(0, 1), bytes.subarray(1)].map((piece) => piece.toString("base64"));
  const script = join(dir, "stand-in-claude.mjs");
  await writeFile(script, [
    `const pieces = ${JSON.stringify(pieces)};`,
    "for (const piece of pieces) {",
    "  await new Promise((resolve) => process.stderr.write(Buffer.from(piece, 'base64'), resolve));",
    "  await new Promise((resolve) => setTimeout(resolve, 200));",
    "}",
    "process.exitCode = 3;",
  ].join("\n"));
  return { dir, script };
}

describe("stderr decoding across chunks (Orca backlog #12(a))", () => {
  it("the claude phase runner's failure message carries a character claude's stderr split across two chunks", async () => {
    const { dir, script } = await splitStderrStandIn();
    const worktree = join(dir, "worktree");
    await mkdir(worktree);
    const env: NodeJS.ProcessEnv = { ...process.env, CCLOOP_CLAUDE_COMMAND: JSON.stringify([process.execPath, script]), CCLOOP_CLAUDE_EXTRA_ARGS: "[]" };
    delete env.CCLOOP_CLAUDE_OBSERVED_USAGE_PATH;
    const child = spawn(process.execPath, [runner], { cwd: worktree, env, stdio: ["pipe", "pipe", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (bytes: Buffer) => err.push(bytes));
    const code = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
      child.stdin.end(JSON.stringify({ phase: "plan", prompt: "Plan one isolated L2 attempt for task t.", attempt: 1, runDir: dir, worktreePath: worktree }));
    });
    // Decoded here from the whole byte sequence, so this criterion cannot introduce the fault it measures.
    const stderr = Buffer.concat(err).toString("utf8");
    expect(code).toBe(1);
    expect(stderr).toContain(`stderr: ${MESSAGE}`);
    expect(stderr).not.toContain("�");
  }, 20_000);

  it("SubprocessClaudeAdapter's error carries a character its command's stderr split across two chunks", async () => {
    const { script } = await splitStderrStandIn();
    const f = await codexFixture("unused");
    dirs.push(f.dir);
    const error = await new SubprocessClaudeAdapter({ command: [process.execPath, script] }).plan(f.context).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(MESSAGE);
    expect((error as Error).message).not.toContain("�");
  }, 20_000);
});
```

- [ ] **Step 2: 跑，期望两条都 FAIL**

```bash
cd /Users/biran/code/skills/loop/ccloop
./node_modules/.bin/vitest run tests/runtime/claude/stderrDecoding.test.ts > "$SCRATCH/t2-red.txt" 2>&1; echo rc=$?
```
期望 `rc=1`，两条都红在 `not.toContain("�")` 或 `toContain(MESSAGE)`（今天按块 `toString` 会把被切开的字符变成 U+FFFD）。若有一条是绿的 ⇒ 替身没把字符切进两个块，**停下查替身**，不许往下走。

- [ ] **Step 3: 实现**

`scripts/claude-phase-runner.mjs` 436 行，把
```js
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
```
改为
```js
      // Orca backlog #12(a) (2026-09-29): decoded as a stream, like claude's stdout just above and this runner's stdin
      // (ruling 26); a chunk's own toString turned a multi-byte character cut at a chunk boundary into U+FFFD in the
      // failure message.
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
```

`src/runtime/claude/subprocessClaudeAdapter.ts` 64–66 行，把
```ts
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
```
改为
```ts
    // Orca backlog #12(a) (2026-09-29): stderr is decoded as a stream, so a multi-byte character cut across two chunks
    // reaches the error message whole instead of as U+FFFD. (stdout above has the same shape; registered, not changed.)
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
```

- [ ] **Step 4: 跑，期望 PASS；并跑两个相邻判据文件**

```bash
./node_modules/.bin/vitest run tests/runtime/claude/stderrDecoding.test.ts tests/runtime/claude/subprocessClaudeAdapter.test.ts tests/runtime/claude/claudePhaseRunnerFailure.test.ts > "$SCRATCH/t2-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t2-tsc.txt" 2>&1; echo rc=$?
```
期望两个 `rc=0`。

- [ ] **Step 5: 变异（副本 `$SCRATCH/mut-t2`，先 `cat` 两个生产文件与新判据进副本并 `cmp`）**
  - M2-a：runner 那两行还原成 `stderr += chunk.toString();`（删 `setEncoding`）⇒ 必须红：`stderr decoding across chunks (Orca backlog #12(a)) > the claude phase runner's failure message carries a character claude's stderr split across two chunks`，另一条绿。
  - M2-b：adapter 那处删 `setEncoding`、回到 `chunk.toString()` ⇒ 必须红：`… > SubprocessClaudeAdapter's error carries a character its command's stderr split across two chunks`，另一条绿。
  跑法：`./node_modules/.bin/vitest run tests/runtime/claude/stderrDecoding.test.ts > "$SCRATCH/t2-M2a.txt" 2>&1; echo rc=$?`，读回，记红的全名与还原字节数。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add scripts/claude-phase-runner.mjs src/runtime/claude/subprocessClaudeAdapter.ts tests/runtime/claude/stderrDecoding.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(claude): decode claude's stderr as a stream so a failure message keeps a split character whole

Both the phase runner and SubprocessClaudeAdapter decoded each stderr chunk on its own, the
same fault ruling 26 fixed on the runner's stdin: a multi-byte character cut at a chunk
boundary reached the failure message as U+FFFD. The adapter's stdout has the same shape and
is registered, not changed.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 3: stream-usage 四处守卫各一条判据（#6，生产代码不动）

**Files:**
- Create: `tests/runtime/claude/streamUsageGuards.test.ts`

**Interfaces:** 无。

四处与各自点名的删除变异：

| 守卫（现址） | 删除变异 | 必须红的判据 | 依据 |
|---|---|---|---|
| `scripts/claude-phase-runner.mjs:430` `child.stdout.setEncoding("utf8");` | M3-1 删这一行 | `… > decodes claude's stdout as a stream: a character cut across two chunks reaches the answer whole` | ruling 26 同一理由（runner 注释 88–91 行） |
| `:422` 包住 `writeObservation` 的 `try { … } catch (error) { … }` | M3-2 改成裸调用 `writeObservation(observationPath, snapshot);` | `… > keeps a phase claude completed when its observation cannot be written, and says so on stderr` | **`Ruling:`** spec 未定义；钉已发布代码的现行为（观测是尽力而为的证据，丢了它不许丢掉一个已完成的阶段；失败要在 stderr 说出来） |
| `:421` `if (snapshot.total !== null) {` | M3-3 删这个 `if`（保留块内的 try） | `… > writes no observation until something has been counted` | spec §4「总数不是正安全整数 ⇒ 不写观测」 |
| `src/runtime/claude/claudeAgentAdapter.ts:94` `observedUsagePath: join(evidenceDir, OBSERVED_USAGE_FILE),` | M3-4 删这个字段 | `… > names in outcome.json the observation file the runner wrote for the same call` | spec §3.2(1)「`outcome.json` 记下该路径」 |

- [ ] **Step 1: 写判据** —— `tests/runtime/claude/streamUsageGuards.test.ts`：

```ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { MaterializedAgentConfigV1 } from "../../../src/agents/types.js";
import { ClaudeAgentAdapter } from "../../../src/runtime/claude/claudeAgentAdapter.js";
import { codexFixture } from "../codex/fixture.js";

// Orca backlog #6 (2026-09-29; ccloop handoff "挂着的", Orca spec 2026-09-27-claude-stream-usage-design.md §8 item 4):
// four spots of the stream-usage round that no criterion turned red when deleted. One criterion each; the ledger names
// the deletion each one must be seen red under.
const runner = fileURLToPath(new URL("../../../scripts/claude-phase-runner.mjs", import.meta.url));
const fakeCli = fileURLToPath(new URL("../../fixtures/fake-claude-cli.mjs", import.meta.url));
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function world() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "claude-guards-"))); dirs.push(dir);
  const worktree = join(dir, "worktree"), evidence = join(dir, "evidence");
  await mkdir(worktree); await mkdir(evidence);
  return { dir, worktree, evidence, observed: join(evidence, "observed-usage.json") };
}

const line = (event: unknown): Buffer => Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
const result = (summary: string): Buffer => line({ type: "result", structured_output: { summary, primaryTargetPaths: ["a"] }, usage: { input_tokens: 12, output_tokens: 3 } });
const messageStart = (id: string, usage: Record<string, number>): Buffer =>
  line({ type: "stream_event", event: { type: "message_start", message: { id, usage } }, parent_tool_use_id: null });

/** A stand-in `claude` (a script file, so node does not read claude's flags as its own) writing each piece to stdout 200 ms apart. */
async function standIn(dir: string, pieces: Buffer[]): Promise<string> {
  const script = join(dir, "stand-in-claude.mjs");
  await writeFile(script, [
    `const pieces = ${JSON.stringify(pieces.map((piece) => piece.toString("base64")))};`,
    "for (const piece of pieces) {",
    "  await new Promise((resolve) => process.stdout.write(Buffer.from(piece, 'base64'), resolve));",
    "  await new Promise((resolve) => setTimeout(resolve, 200));",
    "}",
  ].join("\n"));
  return script;
}

async function runRunner(w: Awaited<ReturnType<typeof world>>, script: string, observedPath: string | null) {
  const env: NodeJS.ProcessEnv = { ...process.env, CCLOOP_CLAUDE_COMMAND: JSON.stringify([process.execPath, script]), CCLOOP_CLAUDE_EXTRA_ARGS: "[]" };
  if (observedPath === null) delete env.CCLOOP_CLAUDE_OBSERVED_USAGE_PATH; else env.CCLOOP_CLAUDE_OBSERVED_USAGE_PATH = observedPath;
  const child = spawn(process.execPath, [runner], { cwd: w.worktree, env, stdio: ["pipe", "pipe", "pipe"] });
  const out: Buffer[] = [], err: Buffer[] = [];
  child.stdout.on("data", (bytes: Buffer) => out.push(bytes));
  child.stderr.on("data", (bytes: Buffer) => err.push(bytes));
  const code = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
    child.stdin.end(JSON.stringify({ phase: "plan", prompt: "Plan one isolated L2 attempt for task t.", attempt: 1, runDir: w.dir, worktreePath: w.worktree }));
  });
  return { code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") };
}

describe("stream-usage guards that nothing pinned (Orca backlog #6)", () => {
  // Deletion M3-1: `child.stdout.setEncoding("utf8")` in the runner. Without it every chunk is a Buffer and the line
  // splitter concatenates each one into a string on its own, so the cut character becomes U+FFFD in the answer.
  it("decodes claude's stdout as a stream: a character cut across two chunks reaches the answer whole", async () => {
    const w = await world();
    const summary = "寿司を一皿";
    const bytes = result(summary);
    const cut = bytes.indexOf(Buffer.from("寿", "utf8")) + 1;
    const out = await runRunner(w, await standIn(w.dir, [bytes.subarray(0, cut), bytes.subarray(cut)]), null);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout).summary).toBe(summary);
  }, 20_000);

  // Deletion M3-2: the catch around writeObservation. Controller ruling (backlog #6): the observation is best-effort
  // evidence of a lower bound, so a path it cannot be written to must not cost a phase claude completed; the failure is
  // said on stderr. Without the catch, the throw inside the stdout handler is uncaught and would end the runner
  // (predicted; mutation M3-2 in the round's ledger is what measures it).
  it("keeps a phase claude completed when its observation cannot be written, and says so on stderr", async () => {
    const w = await world();
    const script = await standIn(w.dir, [Buffer.concat([messageStart("m1", { input_tokens: 2, output_tokens: 1 }), result("fine")])]);
    const out = await runRunner(w, script, join(w.dir, "no-such-directory", "observed-usage.json"));
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toMatchObject({ summary: "fine", tokenUsage: 15 });
    expect(out.stderr).toContain("claude-runner: observation not written");
  }, 20_000);

  // Deletion M3-3: the `snapshot.total !== null` guard. Spec §4: a total that is not a positive safe integer is not an
  // observation and is not written. The second run is this criterion's non-vacuity: the same stream shape with a
  // counted usage does write the file, so the first run's empty directory is the guard's doing, not a stream the
  // observer never recognised.
  it("writes no observation until something has been counted", async () => {
    const zero = await world();
    const zeroRun = await runRunner(zero, await standIn(zero.dir, [Buffer.concat([messageStart("m0", { input_tokens: 0, output_tokens: 0 }), result("zero")])]), zero.observed);
    expect(zeroRun.code).toBe(0);
    expect(JSON.parse(zeroRun.stdout).summary).toBe("zero");
    expect(existsSync(zero.observed)).toBe(false);
    expect(await readdir(zero.evidence)).toEqual([]);

    const counted = await world();
    const countedRun = await runRunner(counted, await standIn(counted.dir, [Buffer.concat([messageStart("m1", { input_tokens: 2, output_tokens: 1 }), result("counted")])]), counted.observed);
    expect(countedRun.code).toBe(0);
    expect(JSON.parse(await readFile(counted.observed, "utf8"))).toMatchObject({ schema: "ccloop-claude-observed-usage-v1", total: 3 });
  }, 20_000);

  // Deletion M3-4: `observedUsagePath` in the adapter's outcome.json. Spec §3.2(1): the call's evidence says where its
  // observation is, so a reader of the evidence directory can find the number the adapter booked.
  it("names in outcome.json the observation file the runner wrote for the same call", async () => {
    const f = await codexFixture("unused");
    dirs.push(f.dir);
    const config: MaterializedAgentConfigV1 = {
      schema: "ccloop-agent-config-v1",
      kind: "claude",
      installation: { kind: "claude", command: [process.execPath, fakeCli, "ok", join(f.dir, "claude-marker.json")], version: "9.9.9-fake", configDir: null, timeoutMs: 20_000, killGraceMs: 300 },
      selection: { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" },
    };
    await new ClaudeAgentAdapter(config).plan(f.context);
    const root = join(f.context.runDir, "claude", "1", "plan");
    const [call] = await readdir(root);
    const dir = join(root, call!);
    const outcome = JSON.parse(await readFile(join(dir, "outcome.json"), "utf8")) as { observedUsagePath?: unknown };
    expect(outcome.observedUsagePath).toBe(join(dir, "observed-usage.json"));
    // The fake's closed message: 2 + 100 + 1000 + 7 (tests/fixtures/fake-claude-cli.mjs DELTA_USAGE).
    expect(JSON.parse(await readFile(outcome.observedUsagePath as string, "utf8"))).toMatchObject({ schema: "ccloop-claude-observed-usage-v1", total: 1109 });
  }, 20_000);
});
```

- [ ] **Step 2: 跑，期望 PASS（守卫都在）**

```bash
./node_modules/.bin/vitest run tests/runtime/claude/streamUsageGuards.test.ts > "$SCRATCH/t3-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t3-tsc.txt" 2>&1; echo rc=$?
```
期望 `rc=0`、4 条过。

- [ ] **Step 3: 四条删除变异，每条都要看见红（副本 `$SCRATCH/mut-t3`，`cat` 新判据进副本并 `cmp`）**

每条变异单独做、单独跑 `./node_modules/.bin/vitest run tests/runtime/claude/streamUsageGuards.test.ts > "$SCRATCH/t3-M3-<n>.txt" 2>&1; echo rc=$?`，读回，核「红的恰是上表那一条、其余三条绿」，记全名、还原字节数。
- 若某条变异**没有**让对应判据红 ⇒ 那一条判据不成立，**停下报控制器**（不许把它登记成「冗余」了事；要登记冗余，得先有一个证明：两种写法下所有可观测输出逐字节相同的探针，贴进台账）。
- M3-2 若红在「runner 进程退出码」而不是 stderr 文字，照实记（预言是退出码先红）。

- [ ] **Step 4: 提交**

```bash
/usr/bin/git add tests/runtime/claude/streamUsageGuards.test.ts
/usr/bin/git commit -F - <<'EOF'
test(claude): pin the four stream-usage guards that nothing turned red when deleted

setEncoding on claude's stdout, the catch around writing the observation, the guard that
writes no observation without a counted total, and outcome.json's observedUsagePath each
get one criterion, each seen red under the deletion of its own guard.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 4: `message_delta` 按流配对（#12(b)）

**Files:**
- Modify: `scripts/claude-stream.mjs:118-140`（`createUsageObserver`）
- Create: `tests/runtime/claude/claudeStreamSubagent.test.ts`

**Interfaces:** `createUsageObserver()` 签名与 `snapshot()` 的形状不变。语义：`message_delta` 关掉的是**同一条流**（同一个 `parent_tool_use_id`，缺省按 `null`）最近打开的消息。

- [ ] **Step 1: 写判据** —— `tests/runtime/claude/claudeStreamSubagent.test.ts`：

```ts
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script without types
import { createUsageObserver } from "../../../scripts/claude-stream.mjs";

// Orca backlog #12(b) (2026-09-29; Orca spec 2026-09-27-claude-stream-usage-design.md §8 item 4): claude tags every
// stream event with the parent_tool_use_id of the agent that streamed it -- null for the main agent (the spec's §2
// probe lines carry it as a top-level field). A subagent's message may open while the main one is still open; each
// message_delta must close the message its OWN stream opened, or one message is booked with the other's usage and
// the other stays "open" at its opening snapshot.
const MAIN_OPEN = { input_tokens: 2, output_tokens: 1 };
const MAIN_FINAL = { input_tokens: 2, output_tokens: 7 };
const SUB_OPEN = { input_tokens: 40, output_tokens: 1 };
const SUB_FINAL = { input_tokens: 40, output_tokens: 20 };
const event = (parent: string | null, inner: unknown) => ({ type: "stream_event", event: inner, parent_tool_use_id: parent });

describe("claude stream observation across a subagent's stream (Orca backlog #12(b))", () => {
  it("closes each message with the delta from its own stream when a subagent's message interleaves the main one", () => {
    const o = createUsageObserver();
    expect(o.observe(event(null, { type: "message_start", message: { id: "main", usage: MAIN_OPEN } }))).toBe(true);
    expect(o.observe(event("toolu_1", { type: "message_start", message: { id: "sub", usage: SUB_OPEN } }))).toBe(true);
    expect(o.observe(event(null, { type: "message_delta", usage: MAIN_FINAL }))).toBe(true);
    expect(o.observe(event("toolu_1", { type: "message_delta", usage: SUB_FINAL }))).toBe(true);
    expect(o.snapshot()).toEqual({
      total: 9 + 60,
      openMessage: false,
      messages: [{ id: "main", state: "closed", fields: MAIN_FINAL }, { id: "sub", state: "closed", fields: SUB_FINAL }],
    });
  });

  it("does not close a message from a stream that has opened none", () => {
    const o = createUsageObserver();
    o.observe(event(null, { type: "message_start", message: { id: "main", usage: MAIN_OPEN } }));
    expect(o.observe(event("toolu_1", { type: "message_delta", usage: SUB_FINAL }))).toBe(false);
    expect(o.snapshot()).toMatchObject({ total: 3, openMessage: true, messages: [{ id: "main", state: "open", fields: MAIN_OPEN }] });
  });
});
```

- [ ] **Step 2: 跑，期望两条都 FAIL**

```bash
./node_modules/.bin/vitest run tests/runtime/claude/claudeStreamSubagent.test.ts > "$SCRATCH/t4-red.txt" 2>&1; echo rc=$?
```
期望 `rc=1`：第一条今天得到 `total: 63, openMessage: true`（main 停在开头快照，sub 被 main 的 delta 覆盖后又被自己的覆盖）；第二条今天 `observe` 答 `true`（子代理的 delta 关掉了 main）。

- [ ] **Step 3: 实现** —— 把 `scripts/claude-stream.mjs` 的 `createUsageObserver` 整个函数（118–146 行，从 `/**` 注释到函数结束）中**函数体**改为下面这样；原 JSDoc 逐字保留，在它后面追加一段：

```js
/**
 * Spec §2 (claude 2.1.283, measured): input and cache counts are per message and add up across messages; a
 * message_start carries an opening snapshot whose output is low, and the message_delta that follows it carries the
 * message's final usage. So each message counts once, by its latest usage. `assistant` events repeat the
 * message_start usage and are not counted.
 *
 * Orca backlog #12(b) (2026-09-29): "follows it" is per stream. Every stream event names the agent that streamed it
 * in `parent_tool_use_id` (null, or absent, for the main agent; a subagent's Task tool call id otherwise), so the
 * open message is tracked per stream and a message_delta closes only its own stream's. A subagent's messages are
 * still counted, each once: they are spent tokens too.
 */
export function createUsageObserver() {
  const messages = new Map();
  const current = new Map();
  return {
    observe(event) {
      const inner = event && event.type === "stream_event" ? event.event : null;
      if (!inner || typeof inner !== "object") return false;
      const stream = typeof event.parent_tool_use_id === "string" ? event.parent_tool_use_id : null;
      if (inner.type === "message_start" && inner.message && typeof inner.message.id === "string" && inner.message.usage && typeof inner.message.usage === "object") {
        current.set(stream, inner.message.id);
        messages.set(inner.message.id, { id: inner.message.id, state: "open", fields: inner.message.usage });
        return true;
      }
      const open = current.get(stream);
      if (inner.type === "message_delta" && open !== undefined && messages.has(open) && inner.usage && typeof inner.usage === "object") {
        messages.set(open, { id: open, state: "closed", fields: inner.usage });
        return true;
      }
      return false;
    },
    snapshot() {
      const list = [...messages.values()];
      const sum = list.reduce((total, message) => total + messageTotal(message.fields), 0);
      return { total: Number.isSafeInteger(sum) && sum > 0 ? sum : null, messages: list, openMessage: list.some((message) => message.state === "open") };
    },
  };
}
```
（`snapshot()` 与今天逐字相同；只动 `current` 那几行。动手前把现场 118–146 行与上面逐行对一次。）

- [ ] **Step 4: 跑新判据与全部 stream 判据，期望 PASS**

```bash
./node_modules/.bin/vitest run tests/runtime/claude/claudeStreamSubagent.test.ts tests/runtime/claude/claudeStream.test.ts tests/runtime/claude/claudePhaseRunnerStream.test.ts tests/runtime/claude/claudeAgentAdapter.test.ts > "$SCRATCH/t4-green.txt" 2>&1; echo rc=$?
```
期望 `rc=0`。

- [ ] **Step 5: 变异（副本 `$SCRATCH/mut-t4`）**
  - M4-1：`const stream = …` 一行改为 `const stream = null;`（回到单一 `current`）⇒ 两条新判据都红，`claudeStream.test.ts` 全绿。
  - M4-2：`message_delta` 分支里 `current.get(stream)` 改为 `[...current.values()].at(-1)`（取最近打开的，不看流）⇒ 必须红：两条新判据。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add scripts/claude-stream.mjs tests/runtime/claude/claudeStreamSubagent.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(claude): close a streamed message only with a delta from its own agent's stream

The usage observer paired every message_delta with the last message_start, so a subagent's
message opened in between was closed with the main message's usage and the main message
stayed at its opening snapshot. Stream events carry parent_tool_use_id; the open message is
now tracked per stream. Streams with no parent id behave exactly as before.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 5: 续跑输入原文进 plan／execute 的 prompt（#7）

**Files:**
- Modify: `src/control/materialize.ts:146-152`（`CONTINUATION_CONSTRAINT` 与 `prepareContinuationContract`）
- Modify（只追加）: `tests/control/materialize.test.ts`（import 区加两行；describe `committed continuation materialization` 末尾、178 行 `});` 之前加一条）

**Interfaces:** `prepareContinuationContract` 签名不变。续跑契约的 `context.constraints` 从 `[...原有, CONTINUATION_CONSTRAINT]` 变为 `[...原有, CONTINUATION_CONSTRAINT, "Continuation input from the predecessor run: <JSON>"]`，JSON 为 `{unfinished, pendingDecisions, awaitingHuman}` 三个数组。`continuation-input.json` 的字节不变。

**`Ruling:`**（控制器，backlog #7）：claude（两个 adapter）与 codex 的 plan／execute prompt 都由 `src/runtime/claude/prompts.ts` 的 `buildPlannerPrompt`／`buildExecutorPrompt` 从契约生成（`codexAdapter.ts:4` import 同一组），两者都打印 `context.constraints`（`prompts.ts:23`、`:40`）；所以把原文作为一条约束行带进契约，是同时到达三条 prompt 路径的最小改动。`relevantDocs` 仍列文件路径（不动）。verify 的 prompt 不打印约束，本条不管它。

- [ ] **Step 1: 写判据** —— `tests/control/materialize.test.ts`：

import 区（11 行 `import type { RuntimeAdapter } …` 之后）加：
```ts
import { buildExecutorPrompt, buildPlannerPrompt } from "../../src/runtime/claude/prompts.js";
import type { AttemptContext } from "../../src/runtime/types.js";
```

在 describe `committed continuation materialization` 的最后一条之后、178 行 `});` 之前追加：
```ts
  // Orca backlog #7 (2026-09-29; Orca handoff §9.0b): the continuation's own prompts carry the predecessor's unfinished
  // work, pending decisions and what awaits a human -- not only a path in relevantDocs that no prompt prints. Claude and
  // codex both build their plan and execute prompts from the contract through these two builders (codexAdapter.ts
  // imports them), so the builders' output is where this is measured.
  it("puts the continuation input itself into the plan and execute prompts every adapter builds", async () => {
    const h = await buildBundle();
    const contract = {
      objective: { taskId: "resume", goal: "continue", successCondition: "done", nonGoals: [] },
      context: { repoPath: h.targetRepo, targetPaths: ["tracked.txt"], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
      executionPolicy: { partialOutcomeRecoveryWindowMs: 0 },
    } as unknown as LoopContract;
    const prepared = await prepareContinuationContract(contract, h.runDir, h.input);
    const prompts = [buildPlannerPrompt(prepared), buildExecutorPrompt({ contract: prepared, plan: null } as unknown as AttemptContext)];
    for (const [index, prompt] of prompts.entries()) {
      for (const text of ["finish the recovery", "choose validation depth", "approval remains pending"]) {
        expect([index, text, prompt.includes(text)]).toEqual([index, text, true]);
      }
    }
  });
```
（三段原文出自同文件 `buildBundle` 的 manifest，见 128 行那条既有判据的断言。）

- [ ] **Step 2: 跑，期望新判据 FAIL**

```bash
./node_modules/.bin/vitest run tests/control/materialize.test.ts > "$SCRATCH/t5-red.txt" 2>&1; echo rc=$?
```
期望 `rc=1`，唯一红的是新判据，红在 `[0, "finish the recovery", false]`；其余既有判据全绿。

- [ ] **Step 3: 实现** —— `src/control/materialize.ts` 146–152 行改为（`CONTINUATION_CONSTRAINT` 一行逐字不动；函数体里把写文件的对象提成变量、`constraints` 多一行）：

```ts
const CONTINUATION_CONSTRAINT="Treat continuation input fields unfinished, pendingDecisions, and awaitingHuman as required planning inputs.";
// Orca backlog #7 (2026-09-29; Orca handoff §9.0b): the constraint above told the model to treat these fields as inputs
// while no prompt ever showed them -- continuation-input.json was only a path in relevantDocs, which the prompts do
// not print. The fields themselves ride in one more constraint line, which both claude and codex print in their plan
// and execute prompts (src/runtime/claude/prompts.ts).
const CONTINUATION_INPUT_PREFIX="Continuation input from the predecessor run: ";
export async function prepareContinuationContract(contract:LoopContract,runDir:string,input:InputCheckpointV1):Promise<LoopContract>{
 await mkdir(runDir,{recursive:true,mode:0o700});const runStat=await lstat(runDir);if(!runStat.isDirectory()||runStat.isSymbolicLink())fail("control-resume-run-dir-invalid");
 const canonicalRun=await realpath(runDir),canonicalBundle=await realpath(input.bundlePath),inputRoot=await realpath(join(dirname(canonicalRun),"input"));if(!within(inputRoot,canonicalBundle)||canonicalBundle===inputRoot)fail("control-resume-bundle-path-invalid");
 const loaded=await loadBundle(input);await assertUnchanged(input,loaded);const path=join(canonicalRun,"continuation-input.json");
 const continuation={protocol:1,predecessorRunId:input.predecessorRunId,checkpointId:input.checkpointId,checkpointHash:input.checkpointHash,unfinished:loaded.manifest.unfinished,pendingDecisions:loaded.manifest.pendingDecisions,awaitingHuman:loaded.manifest.awaitingHuman};
 await writePrivate(path,Buffer.from(JSON.stringify(continuation)));const copy=structuredClone(contract);copy.context.relevantDocs=[...copy.context.relevantDocs,path];
 copy.context.constraints=[...copy.context.constraints,CONTINUATION_CONSTRAINT,`${CONTINUATION_INPUT_PREFIX}${JSON.stringify({unfinished:continuation.unfinished,pendingDecisions:continuation.pendingDecisions,awaitingHuman:continuation.awaitingHuman})}`];return copy;
}
```
（`JSON.stringify(continuation)` 与今天的对象字面量键序相同 ⇒ `continuation-input.json` 逐字节不变。）

- [ ] **Step 4: 跑，期望 PASS；并跑读续跑 prompt 的相邻判据**

```bash
./node_modules/.bin/vitest run tests/control/materialize.test.ts tests/runtime/claude/fakeClaudeCli.test.ts tests/runtime/codex/fakeCodexDelay.test.ts tests/control/worker.test.ts > "$SCRATCH/t5-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t5-tsc.txt" 2>&1; echo rc=$?
```
期望两个 `rc=0`（两个 fake 仍按 `prompt.includes(CONTINUATION)` 取 `#continuation` 条目，那句没动）。

- [ ] **Step 5: 变异（副本 `$SCRATCH/mut-t5`）**
  - M5-1：删掉 `constraints` 数组里第三个元素（回到 `[...copy.context.constraints,CONTINUATION_CONSTRAINT]`）⇒ 必须红：`committed continuation materialization > puts the continuation input itself into the plan and execute prompts every adapter builds`，其余全绿。
  - M5-2：把第三个元素里的 `pendingDecisions:continuation.pendingDecisions` 删掉 ⇒ 必须红：同一条，红在 `[0, "choose validation depth", false]`。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add src/control/materialize.ts tests/control/materialize.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(control): show a continuation's inherited unfinished work and decisions in its own prompts

continuation-input.json only ever reached relevantDocs, which no prompt prints, while a
constraint told the model to treat its fields as required inputs. The three fields now ride
in one more constraint line, printed by the plan and execute prompts claude and codex share.
The file's bytes are unchanged.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 6: 描述符的维度收紧成 Orca 的形状（#11(c)）

**Files:**
- Modify: `src/control/command.ts:43-51`（`capabilityViewSchema` 的 `requestBoundProof`）⚠️ 与计划 A 同文件，开工前重测行号
- Create: `tests/control/requestBoundDimensions.test.ts`

**Interfaces:** `capabilities` 应答里 `requestBoundProof.workDimensions`／`handoffDimensions` 必须是 `["activeMs","attempts","sessions","tokens"]` 的**严格升序**子集（即排序且去重），与 Orca `src/control/webProtocol.ts` 的 `sortedDimensionsSchema`（`amountDimensionSchema` ＋ `requireSortedUnique`，`compareText` 即 JS `<`）一致；不符 ⇒ `control-response-invalid`（exit 1，不打印）。`src/agents/types.ts` 的 `CapabilityViewV1` 类型不动（`string[]` 仍容纳收紧后的输出）。

**`Ruling:`**：拒收走既有的 `control-response-invalid`（`validateResponse`，`command.ts:209-220`），不新造错误码。

- [ ] **Step 1: 写判据** —— `tests/control/requestBoundDimensions.test.ts`：

```ts
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runControlCommand } from "../../src/control/command.js";
import { FAKE_CODEX, codexInstallation, writeAgentsTable } from "./agentsFixture.js";

// Orca backlog #11(c) (2026-09-29; ccloop handoff §2 "descriptor 维度偏松", Orca handoff §9.1): a request-bound proof
// names its dimensions the way Orca's capabilitiesSchema accepts them -- a sorted, duplicate-free subset of the four
// budget dimensions. Every descriptor answers null today; the day one does not, a misspelt or unsorted dimension is
// refused here, by name, instead of printed for Orca to refuse the whole answer (and with it soft groups too).
async function tablePath(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ccloop-dimensions-")));
  const { path } = await writeAgentsTable({
    codex: await codexInstallation({
      command: [process.execPath, FAKE_CODEX, "integration", join(root, "codex-marker")],
      sandbox: "workspace-write",
      budgetMode: "soft",
      timeoutMs: 1_000,
      killGraceMs: 100,
    }),
  }, root);
  return path;
}

const answer = (workDimensions: string[], handoffDimensions: string[]) => ({
  protocol: 3,
  selection: { agent: "codex", model: "fixture", contextWindow: "agent-default" },
  configHash: "a".repeat(64),
  timeoutMs: 1_000,
  killGraceMs: 0,
  singleCallExecution: null,
  capabilities: {
    usageObservation: "phase-end", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable",
    handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null,
    requestBoundProof: { scheme: "adapter-request-bound-v1", version: "1", workDimensions, handoffDimensions, evidenceKind: "proof" },
  },
});

describe("request-bound proof dimensions (Orca backlog #11(c))", () => {
  it("prints a proof whose dimensions are a sorted, unique subset of the four budget dimensions, and refuses any other", async () => {
    const path = await tablePath();
    const run = (value: unknown) => runControlCommand(["capabilities", "--agents", path], JSON.stringify({ agent: null }), { handle: async () => value });
    const accepted = await run(answer(["activeMs", "tokens"], ["activeMs"]));
    expect(accepted.code).toBe(0);
    expect(JSON.parse(accepted.stdout).capabilities.requestBoundProof.workDimensions).toEqual(["activeMs", "tokens"]);
    expect((await run(answer([], []))).code).toBe(0);
    const refused: Array<[string[], string[]]> = [
      [["token"], []],               // not a budget dimension
      [[], ["wallclock"]],           // not a budget dimension, on the handoff side
      [["tokens", "activeMs"], []],  // unsorted
      [["tokens", "tokens"], []],    // duplicate
    ];
    for (const [work, handoff] of refused) {
      expect([work, handoff, await run(answer(work, handoff))]).toEqual([work, handoff, { code: 1, stdout: "", stderr: "control-response-invalid\n" }]);
    }
  });
});
```

- [ ] **Step 2: 跑，期望 FAIL**

```bash
./node_modules/.bin/vitest run tests/control/requestBoundDimensions.test.ts > "$SCRATCH/t6-red.txt" 2>&1; echo rc=$?
```
期望 `rc=1`，红在第一个被拒样本 `[["token"], [], {code: 0, …}]`（今天 `z.array(z.string())` 照收）。

- [ ] **Step 3: 实现** —— `src/control/command.ts`，在 `const capabilityViewSchema = z`（35 行）之前加：

```ts
// Orca backlog #11(c) (2026-09-29; ccloop handoff §2 "descriptor 维度偏松", Orca handoff §9.1): the shape Orca's
// capabilitiesSchema requires of a request-bound proof's dimensions (Orca src/control/webProtocol.ts,
// sortedDimensionsSchema): a strictly ascending -- so duplicate-free -- subset of the four budget dimensions. An answer
// that breaks it is refused here, as control-response-invalid, rather than printed for Orca to refuse whole.
const requestBoundDimensionsSchema = z
  .array(z.enum(["activeMs", "attempts", "sessions", "tokens"]))
  .refine((values) => values.every((value, index) => index === 0 || values[index - 1]! < value), "dimensions must be sorted and unique");
```
并把 47–48 行
```ts
        workDimensions: z.array(z.string()),
        handoffDimensions: z.array(z.string()),
```
改为
```ts
        workDimensions: requestBoundDimensionsSchema,
        handoffDimensions: requestBoundDimensionsSchema,
```

- [ ] **Step 4: 跑，期望 PASS；typecheck（`satisfies z.ZodType<CapabilityViewV1>` 要仍然成立）**

```bash
./node_modules/.bin/vitest run tests/control/requestBoundDimensions.test.ts tests/control/command.test.ts tests/control/agentsControl.test.ts > "$SCRATCH/t6-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t6-tsc.txt" 2>&1; echo rc=$?
```
期望两个 `rc=0`。若 typecheck 因 `satisfies` 失败 ⇒ 停下报控制器（不改 `CapabilityViewV1`）。

- [ ] **Step 5: 变异（副本 `$SCRATCH/mut-t6`）**
  - M6-1：`z.enum([...])` 改回 `z.string()`（保留 `.refine`）⇒ 必须红：`request-bound proof dimensions (Orca backlog #11(c)) > prints a proof …`，红在 `["token"]` 那一行。
  - M6-2：删掉 `.refine(...)` ⇒ 必须红：同一条，红在 `["tokens","activeMs"]` 那一行。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add src/control/command.ts tests/control/requestBoundDimensions.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(control): hold a request-bound proof's dimensions to the sorted four-value set Orca accepts

workDimensions and handoffDimensions were any strings. They are now a strictly ascending
subset of activeMs, attempts, sessions and tokens, as Orca's capabilitiesSchema requires, so
a wrong one is refused here instead of making Orca refuse the whole answer.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 7: claude 的 model 自带 `[1m]` 后缀一律拒（#13(a)）

**Files:**
- Modify: `src/agents/claude.ts`（import 4–10 行加 `AgentError`；`validateSelection` 48–51 行）
- Create: `tests/agents/claudeModelSuffix.test.ts`

**Interfaces:** `claudeDescriptor.validateSelection` 对 model 以 `[1m]` 结尾（不分大小写）抛 `AgentError("agent-context-unsupported", …)`。它经 `materialize.ts:93`、`:128` 覆盖 `capabilities`（解析）与 `accept`；Orca 侧已把 `agent-context-unsupported` 当具名拒绝（`src/control/ccloopPort.ts` `NAMED_REFUSALS`），在预览／确认时以 `agent-selection-rejected:<task|slot>:agent-context-unsupported` 露出。

**`Ruling:`**（控制器，backlog #13(a)，fail-closed）：**拒，不改写**（不把 `x[1m]` 规整成 `model x ＋ contextWindow 1M`）；码用 `agent-context-unsupported`（它绕的是上下文档位），不分大小写。

- [ ] **Step 1: 写判据** —— `tests/agents/claudeModelSuffix.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { claudeDescriptor } from "../../src/agents/claude.js";
import { AgentError } from "../../src/agents/types.js";

// Orca backlog #13(a) (2026-09-29; Orca agent selection spec §12 m-5, Orca handoff §9.0c): the claude CLI reads a
// `[1m]` model suffix as the 1M window, which is how claudeModelArgument spells contextWindow 1_000_000. A model that
// carries the suffix itself would get the 1M window under "agent-default" -- while capabilities answer
// contextWindowTokens null, so Orca's context tier never sees it -- or be sent as `[1m][1m]`. Refused, whatever
// contextWindow says.
const refusal = (model: string, contextWindow: "agent-default" | 1_000_000): string | null => {
  try {
    claudeDescriptor.validateSelection({ agent: "claude", model, contextWindow });
    return null;
  } catch (error) {
    return error instanceof AgentError ? error.code : `not an AgentError: ${String(error)}`;
  }
};

describe("claude model suffix (Orca backlog #13(a))", () => {
  it("accepts a plain model under either window and refuses one that carries the [1m] suffix itself", () => {
    expect(refusal("claude-opus-5-5", "agent-default")).toBeNull();
    expect(refusal("claude-opus-5-5", 1_000_000)).toBeNull();
    for (const model of ["claude-opus-5-5[1m]", "opus[1m]", "claude-opus-5-5[1M]"]) {
      for (const contextWindow of ["agent-default", 1_000_000] as const) {
        expect([model, contextWindow, refusal(model, contextWindow)]).toEqual([model, contextWindow, "agent-context-unsupported"]);
      }
    }
  });
});
```

- [ ] **Step 2: 跑，期望 FAIL**

```bash
./node_modules/.bin/vitest run tests/agents/claudeModelSuffix.test.ts > "$SCRATCH/t7-red.txt" 2>&1; echo rc=$?
```
期望 `rc=1`，红在 `["claude-opus-5-5[1m]", "agent-default", null]`。

- [ ] **Step 3: 实现** —— `src/agents/claude.ts`：import 块改为

```ts
import {
  AgentError,
  assertContextOption,
  assertModel,
  commonSearchDirs,
  type AgentSelectionV1,
  type ContextWindow,
} from "./types.js";
```
`validateSelection` 改为

```ts
  validateSelection(selection) {
    assertModel(selection.model);
    assertContextOption(CONTEXT_OPTIONS, selection);
    // Orca backlog #13(a) (2026-09-29; Orca agent selection spec §12 m-5): the CLI reads a `[1m]` model suffix as the
    // 1M window (claudeModelArgument above), so a model that already carries one would get 1M under "agent-default"
    // -- with capabilities answering contextWindowTokens null -- or be sent as `[1m][1m]`. Refused, never rewritten:
    // the window is chosen by contextWindow alone.
    if (/\[1m\]$/i.test(selection.model)) {
      throw new AgentError("agent-context-unsupported", `model ${JSON.stringify(selection.model)} carries the [1m] suffix; choose contextWindow ${ONE_MILLION} instead`);
    }
  },
```

- [ ] **Step 4: 跑，期望 PASS；并跑选择相关的既有判据**

```bash
./node_modules/.bin/vitest run tests/agents/claudeModelSuffix.test.ts tests/agents/materialize.test.ts tests/agents/registry.test.ts tests/runtime/claude/claudeAgentAdapter.test.ts tests/control/agentsControl.test.ts > "$SCRATCH/t7-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t7-tsc.txt" 2>&1; echo rc=$?
```
期望两个 `rc=0`（既有判据里没有带 `[1m]` 的 model 字面量：动手前 `rtk proxy grep -rn '\[1m\]"' tests > "$SCRATCH/t7-scan.txt"` 现测一次；若有，**停下报控制器**）。

- [ ] **Step 5: 变异（副本 `$SCRATCH/mut-t7`）**
  - M7-1：删掉整个 `if (/\[1m\]$/i…) { … }` ⇒ 必须红：`claude model suffix (Orca backlog #13(a)) > accepts a plain model …`，红在 `claude-opus-5-5[1m]`。
  - M7-2：正则去掉 `i` 标志 ⇒ 必须红：同一条，红在 `claude-opus-5-5[1M]`。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add src/agents/claude.ts tests/agents/claudeModelSuffix.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(agents): refuse a claude model that carries the [1m] context suffix itself

The claude CLI reads a [1m] suffix as the 1M window, so such a model got 1M under
contextWindow "agent-default" while capabilities answered no window at all, bypassing the
context tier. It is refused as agent-context-unsupported, never rewritten.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 8: 同一把锁只记一条 `owner_transfer_contended`（#14 M3，只加不改）

**Files:**
- Modify: `src/controller/runLoop.ts`（`persistBoundaryAnalysis` 的 transfer catch 里的重读 994–995 行；外层 catch 的两个分支 1786–1793、1806–1813 行；模块级加一个 `WeakSet`）
- Modify（只追加）: `tests/controller/leaseLifecycle.integration.test.ts`（describe `lease heartbeat lifecycle` 末尾、2359 行 `});` 之前）

**Interfaces:** 事件语义：transfer 路径已为一把锁（`Unattributable` 或 `LivenessUndetermined`）记下 `owner_transfer_contended`（detail 以 `owner transfer abandoned:` 开头）之后，同一次 `persistBoundaryAnalysis` 的重读又撞上锁、错误逃到 attempt 的外层 catch 时，外层**照旧遏制**（写 `loop-state`、原地返回 `executing`），但**不再追加第二条**。其余路径的事件一条不变。

**`Ruling:`**（控制器，#14 M3）：一次放弃记一条，保留**先发生的那条**（transfer 路径的 `owner transfer abandoned: …`，它已带 `String(error)` 与 `ccloop unlock` 出口）；用模块级 `WeakSet` 给「已记过」的错误对象打标，外层据此跳过 `appendEvent`；两个同形分支（unattributable、liveness-undetermined）一起修。**既有判据不改**（见 Drafter findings）。

- [ ] **Step 1: 写判据** —— 在 `tests/controller/leaseLifecycle.integration.test.ts` 末尾 `});`（2359 行）之前追加：

```ts
  // M3 (ls lock visibility progress §12.2; Orca backlog #14, human-authorized 2026-09-29, Orca session 2724716d): a
  // transfer abandoned to a lock records `owner_transfer_contended` once, on the transfer path. When the re-read that
  // follows finds a staged transaction and meets the SAME lock during recovery, that error escapes to the attempt's
  // outer catch, which contains it as before but must not record the one lock a second time. The mock stages what a
  // rival mid-transfer leaves on disk -- the transaction marker and its lock -- exactly when this process's own
  // transfer is refused, so the first ownership read (before the transfer) found neither.
  it.each([
    {
      name: "liveness-undetermined",
      lock: (pid: number) => JSON.stringify({ holderProcessInstanceId: `pid:${pid}`, acquiredAt: "2026-09-23T00:00:00.000Z" }),
      refuseKill: true,
      error: (actual: typeof import("../../src/persistence/fileStore.js")) => new actual.OwnerTransferLockLivenessUndeterminedError(
        "liveness of the owner-transfer lock holder cannot be determined (EPERM); this lock may or may not clear on its own -- inspect it with: ccloop unlock",
      ),
    },
    {
      name: "unattributable",
      lock: () => "not-json\n",
      refuseKill: false,
      error: (actual: typeof import("../../src/persistence/fileStore.js")) => new actual.OwnerTransferLockUnattributableError(
        "owner-transfer lock cannot be attributed to any process; it will not clear on its own -- inspect it with: ccloop unlock",
      ),
    },
  ])("records one contention when the re-read after an abandoned transfer meets the same $name lock", async ({ lock, refuseKill, error }) => {
    const repoPath = await createRepo();
    const runDir = await mkdtemp(join(tmpdir(), "ccloop-run-"));
    const baseContract = createContract(repoPath);
    const contract: LoopContract = { ...baseContract, executionPolicy: { ...baseContract.executionPolicy, perAttemptTimeoutMs: 200 } };
    const heldPid = process.pid;
    const killSpy = refuseKill
      ? vi.spyOn(process, "kill").mockImplementation((pid: number) => {
          if (pid === heldPid) {
            const errno = new Error("operation not permitted") as NodeJS.ErrnoException;
            errno.code = "EPERM";
            throw errno;
          }
          return true;
        })
      : null;

    vi.resetModules();
    vi.doMock("../../src/persistence/fileStore.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/persistence/fileStore.js")>("../../src/persistence/fileStore.js");
      return {
        ...actual,
        writeOwnerTransferArtifacts: async () => {
          await writeFile(
            join(runDir, ".owner-transfer.transaction.json"),
            JSON.stringify({ version: 1, stagedAt: "2026-07-23T00:00:00.000Z", finalizeOrder: ["owner-transfer.json", "owner-record.json"] }, null, 2),
          );
          await writeFile(join(runDir, ".owner-transfer.lock"), lock(heldPid));
          throw error(actual);
        },
      };
    });

    try {
      const { runLoop: observedRunLoop } = await import("../../src/controller/runLoop.js");
      const adapter: RuntimeAdapter = {
        async plan() {
          return { summary: "change src/index.ts", primaryTargetPaths: ["src/index.ts"] };
        },
        async execute(context) {
          await writeFile(join(runDir, "owner-record.json"), JSON.stringify({
            runId: "task-1",
            logicalSessionId: "task-1:lost",
            currentOwnerEpoch: 1,
            currentProcessInstanceId: buildProcessInstanceId(),
            lastAffirmedAt: "2026-07-23T00:00:00.000Z",
            ownerStatus: "lost",
            supersededByEpoch: null,
          }, null, 2));
          await waitForAbort(context.abortSignal);
          return null;
        },
        async verify() {
          throw new Error("verify should not run");
        },
      };

      const finalState = await observedRunLoop(contract, runDir, adapter as never);

      const contended = (await readEvents(runDir)).filter((event) => event.type === "owner_transfer_contended");
      expect(contended.map((event) => event.detail.split(":")[0])).toEqual(["owner transfer abandoned"]);
      // Still contained, still in place: the outer branch returned the attempt as it stood and persisted it.
      expect(finalState.status).toBe("executing");
      const persisted = JSON.parse(await readFile(join(runDir, "loop-state.json"), "utf8")) as RunState;
      expect(persisted.status).toBe(finalState.status);
    } finally {
      vi.doUnmock("../../src/persistence/fileStore.js");
      vi.resetModules();
      killSpy?.mockRestore();
    }
  });
```

- [ ] **Step 2: 跑，期望两行都 FAIL（且红在「两条」）**

```bash
cd /Users/biran/code/skills/loop/ccloop
./node_modules/.bin/vitest run tests/controller/leaseLifecycle.integration.test.ts -t "records one contention" > "$SCRATCH/t8-red.txt" 2>&1; echo rc=$?
```
期望 `rc=1`，两行都红在 `["owner transfer abandoned", "owner transfer recovery blocked"]`。
⚠️ 若红的形状不是这个（例如只有一条、或 status 不是 `executing`）⇒ M3 的到达路径与登记不同，**停下报控制器**，不要去改实现来凑。

- [ ] **Step 3: 实现** —— `src/controller/runLoop.ts`：

(a) 在 `async function persistBoundaryAnalysis(`（822 行）之前加：

```ts
/**
 * M3 (ls lock visibility progress §12.2; Orca backlog #14, human-authorized 2026-09-29, Orca session 2724716d): lock
 * errors the transfer path below has already recorded as `owner_transfer_contended`. When the re-read after that
 * abandonment meets the same lock during recovery, its error escapes to the attempt's outer catch, which still
 * contains it exactly as before but does not record the one lock twice.
 */
const recordedContentions = new WeakSet<object>();
```

(b) transfer catch 里的重读（994–995 行）
```ts
          await heartbeat.assertHeld();
          ownerRecord = await readOwnerRecord(runDir);
```
改为
```ts
          await heartbeat.assertHeld();
          try {
            ownerRecord = await readOwnerRecord(runDir);
          } catch (reReadError) {
            // M3: the branches above have just recorded this lock; the same lock blocking the re-read is not a second one.
            const contended = error instanceof OwnerTransferLockBusyError || error instanceof OwnerTransferLockUnattributableError || error instanceof OwnerTransferLockLivenessUndeterminedError;
            if (contended && (reReadError instanceof OwnerTransferLockUnattributableError || reReadError instanceof OwnerTransferLockLivenessUndeterminedError)) {
              recordedContentions.add(reReadError);
            }
            throw reReadError;
          }
```

(c) 外层 catch 的两个分支，只把 `appendEvent` 包进 `if`，注释原样保留：
```ts
      if (error instanceof OwnerTransferLockUnattributableError) {
        if (!recordedContentions.has(error)) {
          await appendEvent(runDir, {
            type: "owner_transfer_contended",
            at: new Date().toISOString(),
            detail: `owner transfer recovery blocked: ${String(error)}`,
          });
        }
        await writeOwnedRunState(runDir, state);
        return state;
      }
```
```ts
      if (error instanceof OwnerTransferLockLivenessUndeterminedError) {
        if (!recordedContentions.has(error)) {
          await appendEvent(runDir, {
            type: "owner_transfer_contended",
            at: new Date().toISOString(),
            detail: `owner transfer recovery blocked: ${String(error)}`,
          });
        }
        await writeOwnedRunState(runDir, state);
        return state;
      }
```
（两个分支上方的既有注释与 ERRATUM 逐字不动；动手前核 1786–1813 行现场。）

- [ ] **Step 4: 跑整个文件与相邻文件，期望 PASS**

```bash
./node_modules/.bin/vitest run tests/controller/leaseLifecycle.integration.test.ts tests/controller/resumeLoop.integration.test.ts tests/persistence/fileStore.test.ts > "$SCRATCH/t8-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t8-tsc.txt" 2>&1; echo rc=$?
```
期望两个 `rc=0`；尤其「abandons the attempt in place when the ownership read hits an unattributable／undetermined-liveness transfer lock…」「contains an unattributable／undetermined-liveness transfer lock…」四条仍各恰好一条事件。

- [ ] **Step 5: 变异（副本 `$SCRATCH/mut-t8`）**
  - M8-1：外层 liveness-undetermined 分支去掉 `if (!recordedContentions.has(error))` 的包裹（无条件 append）⇒ 必须红：`lease heartbeat lifecycle > records one contention when the re-read after an abandoned transfer meets the same liveness-undetermined lock`，unattributable 那行绿。
  - M8-2：外层 unattributable 分支同样去掉包裹 ⇒ 必须红：`… same unattributable lock`，另一行绿。
  - M8-3：删掉 (b) 里的 `recordedContentions.add(reReadError);` ⇒ 两行都红。
  - M8-4：外层两个分支都改成**永不** append（`if (false)`）⇒ 必须红：既有的「abandons the attempt in place when the ownership read hits an unattributable transfer lock…」与「…undetermined-liveness…」两条（它们要求读路径那一条事件）。这一条证明新标记没有把读路径自己的那一条吃掉。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add src/controller/runLoop.ts tests/controller/leaseLifecycle.integration.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(runLoop): record one owner_transfer_contended when the re-read meets the lock that abandoned the transfer

With a staged transaction on disk, the re-read after an abandoned transfer met the same lock
during recovery and its error escaped to the outer catch, which recorded the one lock a
second time (M3, ls lock visibility §12.2). The outer catch still contains it in place; it
now skips the event for an error the transfer path already recorded.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 9: 零写快照记下扫描根自身（#14 M4，人授权改写既有判据）

**Files:**
- Modify（**人授权改写**）: `tests/registry/zeroWrite.test.ts`（`snapshotTree` 39–40 行；sweep 判据的 514、515、570、583 行）

**被改的既有判据（人裁：台账 §1「#14，要你指名判据 => 同意修改判据」；Rule 15 (a) 指名如下）：**

| # | 判据全名 | 怎么改 | 放宽了吗 |
|---|---|---|---|
| 1 | `tests/registry/zeroWrite.test.ts > zero-write proof against a real filesystem (spec §7.1, §12.1) > is load-bearing: readOwnerRecord itself mutates the recovery fixture (brief step 1)` | 只经 helper：快照多记一个 `"."` 条目；断言文字不动 | 否（快照严格更敏感；`not.toEqual` 只会更容易成立，但该条要证的是「fixture 真的触发恢复」，下两行的具名文件断言不变） |
| 2 | `… > zero-write proof against a real filesystem (spec §7.1, §12.1) > scans a realistic tree with defaultScanDeps and writes nothing, including on the recovery path` | 只经 helper | 否（更严） |
| 3 | `… > sweep write surface > appends exactly resume_requested and resume_denied to a gate-refused run and leaves the non-eligible run byte-identical` | helper ＋ 四处键表断言各在期望里加 `"."` | 否（键表因 helper 多一项而同步；`refusedAfterRest`／`nonEligibleAfter` 的等式从此覆盖 run 目录自身的 mtime） |
| 4 | `… > ls's real read path writes nothing, including while probing owner-transfer.lock (Task 10) > leaves the whole tree byte-for-byte identical across main(["ls", root])` | 只经 helper | 否（更严） |

每处改动旁写明它现在编码什么、依据哪条人裁（Rule 15 (c)）。

**Interfaces:** `snapshotTree(root)` 的返回多一个键 `"."`：`{ size: -1, mtimeMs: <root 的 lstat mtimeMs>, sha256: "directory" }`（与子目录条目同形）。

- [ ] **Step 1: 先量盲区（改之前，副本 `$SCRATCH/mut-t9-before`，内容＝本 Task 开工时的 HEAD）**

在副本的 `src/sweep/sweepRuns.ts` 里：12 行之前加 `import { utimes } from "node:fs/promises";`；174 行 `for (const path of lockedRowPaths) {` 的循环体第一行加 `await utimes(path, new Date(0), new Date(0));`（每个 run 目录只动自身 mtime，不写任何条目）。跑：
```bash
./node_modules/.bin/vitest run tests/registry/zeroWrite.test.ts > "$SCRATCH/t9-blind.txt" 2>&1; echo rc=$?
```
期望 `rc=0`（**全绿** ＝ 盲区存在）。若已经红 ⇒ 登记与现状不符，停下报控制器。

- [ ] **Step 2: 改写 helper** —— `tests/registry/zeroWrite.test.ts` 39–40 行
```ts
async function snapshotTree(root: string): Promise<Record<string, FileSnapshot>> {
  const snapshot: Record<string, FileSnapshot> = {};
```
改为
```ts
async function snapshotTree(root: string): Promise<Record<string, FileSnapshot>> {
  // Rewritten for M4 (ls lock visibility progress §12.2; Orca backlog #14, human-authorized 2026-09-29, Orca session
  // 2724716d, criteria named in Orca docs/superpowers/plans/2026-09-29-backlog-hardening.md Task 9): the scan root is a
  // directory too. Its own mtime moves when something creates and removes an entry directly under it -- a lock taken
  // and released, say -- and nothing else here recorded that. It is kept under "." beside every path below it, in the
  // same shape the Task 10 directory entries use.
  const snapshot: Record<string, FileSnapshot> = {
    ".": { size: -1, mtimeMs: (await lstat(root)).mtimeMs, sha256: "directory" },
  };
```

- [ ] **Step 3: 改写判据 3 的四处键表**

514–515 行
```ts
      expect(Object.keys(refusedBefore).sort()).toEqual(seededFiles);
      expect(Object.keys(nonEligibleBefore).sort()).toEqual(seededFiles);
```
改为
```ts
      // Rewritten for M4 (Orca backlog #14, human-authorized 2026-09-29): snapshotTree now records the run directory
      // itself as "."; the six seeded files are unchanged.
      expect(Object.keys(refusedBefore).sort()).toEqual([".", ...seededFiles]);
      expect(Object.keys(nonEligibleBefore).sort()).toEqual([".", ...seededFiles]);
```
570 行
```ts
      expect(Object.keys(refusedAfterRest).sort()).toEqual(seededFiles.filter((f) => f !== "events.jsonl"));
```
改为
```ts
      // Rewritten for M4 (Orca backlog #14, human-authorized 2026-09-29): "." is the refused run directory itself, so the
      // equality below now also says no entry was created and removed directly under it (no lock taken and released).
      expect(Object.keys(refusedAfterRest).sort()).toEqual([".", ...seededFiles.filter((f) => f !== "events.jsonl")]);
```
583 行
```ts
      expect(Object.keys(nonEligibleAfter).sort()).toEqual(seededFiles);
```
改为
```ts
      // Rewritten for M4 (Orca backlog #14, human-authorized 2026-09-29): as above, "." is the directory itself.
      expect(Object.keys(nonEligibleAfter).sort()).toEqual([".", ...seededFiles]);
```

- [ ] **Step 4: 跑，期望 PASS**

```bash
./node_modules/.bin/vitest run tests/registry/zeroWrite.test.ts > "$SCRATCH/t9-green.txt" 2>&1; echo rc=$?
```
期望 `rc=0`，4 个 describe 全绿。
⚠️ **若判据 3 红在 `refusedAfterRest` 的 `"."`**：那说明 sweep 在被拒的 run 目录里建过又删过条目（M4 盲区后面藏着的真写入），**停下报人**，不许放宽、不许把 `"."` 剔出等式。

- [ ] **Step 5: 变异（副本 `$SCRATCH/mut-t9`，`cat` 改后的判据文件进副本并 `cmp`）**
  - M9-1：Step 1 的 `utimes` 变异 ⇒ 必须红：`sweep write surface > appends exactly resume_requested and resume_denied to a gate-refused run and leaves the non-eligible run byte-identical`（红在 `refusedAfterRest` 或 `nonEligibleAfter` 的 `"."` 的 `mtimeMs`）。
  - M9-2：在 M9-1 之上，再删掉 helper 里的 `".": { … }` 条目（`snapshot` 回到 `{}`，四处键表改动留着）⇒ 期望红在键表断言（`[".", …]` 对不上）——这证明键表断言与 helper 绑定；再把四处键表也还原成改写前 ⇒ 期望**全绿**（回到盲区），证明是 `"."` 条目在承重。
  - M9-3（`ls` 路径）：在 `src/unlock/lockRows.ts` 的 `attachLockInspections` 里对扫描根自身 `utimes`——**不做**：判据 4 的快照根是 `tempRoot`，扫描根 `scan-root` 是它下面的子目录，早已被 Task 10 的目录条目覆盖；本条只登记「判据 4 经 helper 变严，但它没有新的可达写入要打」。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add tests/registry/zeroWrite.test.ts
/usr/bin/git commit -F - <<'EOF'
test(registry): let the zero-write snapshot see its scan root's own mtime

snapshotTree recorded every path below its root but never the root, so a probe that created
and removed an entry directly in a run directory stayed invisible (M4, ls lock visibility
§12.2). The root is now recorded as "." and the sweep criterion's key lists follow; the four
criteria that use the helper are named in the Orca plan's Task 9 under the human's
authorization of 2026-09-29.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

# Part B — Orca

> Part B 开工前：计划 A 已落地；重测本 Part 引的每一个行号（`src/control/executionDriver.ts` 会被 A 改动）。

### Task 10: 驱动环一组出错不拖垮整轮（#3，不含 m6）

**Files:**
- Modify: `src/control/executionDriver.ts`（`replenishStartWakes` 657–683 行；`pass` 的逐 run catch 767–801 行）⚠️ 与计划 A 同文件
- Create: `tests/control/driverRoundIsolation.test.ts`

**Interfaces:** `replenishStartWakes(deps): string[]` 签名不变。行为：
- 某个组在布置 start wake 时抛错（行读不出、查询抛错）⇒ 跳过该组，**其余组照常布置**；每个被跳过的组在 stderr 写一行 `orca-driver: group <groupId>: <describeError>`。
- 某个 run 的步骤出错、而**记录这次失败**（`readDriverRun`／`blockRun`／settled 的 `cleanupError` 写入）又出错 ⇒ stderr 写一行 `orca-driver: <runId>: <原错误>; recording it failed: <记录错误>`，**本轮继续下一个 run**。
- `panel-draining` 仍结束整轮（与今天相同）；`DriverCrash` 仍向上抛。

**`Ruling:`**（控制器，#3）：组级失败的记法是 stderr 那一行（驱动环对「落不到 run 上」的失败一贯如此，`executionDriver.ts:787`、`:790`、`:812`）；不新增持久字段、不写 `recovery_blockers`（后者会挡住该组派活，是另一种语义）。

- [ ] **Step 1: 写判据** —— `tests/control/driverRoundIsolation.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdmissionGate } from "../../src/control/admissionGate.js";
import { createExecutionDriver } from "../../src/control/executionDriver.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// Orca backlog #3 (2026-09-29; Orca handoff §9.0 挂账 "replenishStartWakes 或 blockRun 抛错会中止整轮（所有组）"):
// one group's failure no longer stops every other group's work in the same round, and it is still named on stderr --
// the driver's record for a failure it cannot pin on a run (executionDriver.ts, the `orca-driver:` lines).
const lines: string[] = [];
afterEach(() => { vi.restoreAllMocks(); lines.splice(0); });
const captureStderr = () => vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write);

describe("a round goes on past one group's failure (backlog #3)", () => {
  it("arms the next start wake for a healthy group while another group's row cannot be read, and names that group", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      const runId = await t.claim();
      // A group row that sorts before `g` and does not parse. Before this fix its JSON.parse threw out of the one
      // transaction replenishStartWakes runs, and the whole round -- every group's wake and every run -- with it.
      t.h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('a-broken',0,0,'{')").run();
      captureStderr();
      await t.driver().round();
      expect(t.h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind='start' AND delivered=0").all()).toEqual([{ id: "drive:g:1" }]);
      expect(t.body(runId).state).toBe("start-pending");
      expect(lines.filter((line) => line.startsWith("orca-driver: group a-broken: "))).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("names a run whose failure it could not record, and still moves the next run in the same round", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      const a = await t.claim();
      const b = await t.claim();
      await t.until(t.driver(), () => t.body(a).state === "accepted" && t.body(b).state === "accepted");
      const [first, second] = [a, b].sort();
      // `first` fails at C, and the write that would block it for that fails too: the admission gate refuses exactly
      // the next entry after the collect error, which is blockRun's. Before this fix the second error left the loop,
      // so `second` -- visited after `first` -- was not collected in this round.
      let armed = false;
      const port: ExecutionPort = {
        ...t.fake.port,
        async collect(input, afterSeq) {
          if (input.claim.runId === first) { armed = true; throw new Error("collect-boom"); }
          return t.fake.port.collect(input, afterSeq);
        },
      };
      const gate = t.h.deps.admissionGate;
      const faulty: AdmissionGate = {
        get draining() { return gate.draining; },
        beginDrain: () => gate.beginDrain(),
        enter: () => {
          if (armed) { armed = false; throw new Error("gate-boom"); }
          return gate.enter();
        },
      };
      captureStderr();
      await createExecutionDriver({ ...t.deps, admissionGate: faulty, router: createExecutionProfileRouter([resolveProfile(profileSnapshot(), port)]) }).round();
      expect(t.body(second).state).toBe("collected");
      expect(t.body(first).state).toBe("accepted");
      expect(lines).toContain(`orca-driver: ${first}: collect-boom; recording it failed: gate-boom\n`);
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: 跑，期望两条都 FAIL**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/driverRoundIsolation.test.ts > "$SCRATCH/t10-red.txt" 2>&1; echo rc=$?
```
期望 `rc=1`：第一条红在 wake 列表为空（整轮在 replenish 就结束了）；第二条红在 `second` 仍是 `accepted`。若第一条红在 `drive:g:1` 以外的 id ⇒ 读回 `scheduler_wakes` 现场再判，不要改期望凑。

- [ ] **Step 3: 实现 replenish** —— `replenishStartWakes`（657–683 行）整体改为：

```ts
export function replenishStartWakes(deps: Pick<ExecutionDriverDeps, "store" | "admissionGate">): string[] {
  const { store } = deps;
  if (store.dispatchBlocked) return [];
  const failed: string[] = [];
  const armedIds = write(deps, () => {
    const armed: string[] = [];
    for (const row of store.db.prepare("SELECT id,body FROM groups ORDER BY id").all()) {
      const groupId = String(row.id);
      // Backlog #3 (Orca handoff §9.0 挂账): a group whose wake cannot be armed -- a row that does not parse, a query
      // that throws -- is skipped and named on stderr below, like every failure the driver cannot pin on a run. It no
      // longer takes every other group's wake, and the whole round, down with it. Each group writes at most one row,
      // last, so a group that failed wrote nothing.
      try {
        const group = JSON.parse(String(row.body)) as { planHash?: string; status: string; stopped: boolean };
        if (group.planHash === undefined || group.stopped || !DISPATCHABLE_GROUP_STATES.has(group.status)) continue;
        if (store.db.prepare("SELECT group_id FROM stop_intents WHERE group_id=?").get(groupId)) continue;
        if (store.db.prepare("SELECT id FROM recovery_blockers WHERE group_id=? AND scope='group'").get(groupId)) continue;
        if (store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id=? AND kind IN ('start','no-start','resume') AND delivered=0").get(groupId)) continue;
        const last = store.db.prepare("SELECT body FROM scheduler_wakes WHERE group_id=? AND kind='start' ORDER BY rowid DESC LIMIT 1").get(groupId);
        if (!last || nextClaimableTask(store, groupId) === null) continue;
        const body = JSON.parse(String(last.body)) as { startRevision: number; executionSnapshotHash?: string };
        const ordinal = Number(store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes WHERE group_id=? AND id LIKE ?").get(groupId, `drive:${groupId}:%`)!.n) + 1;
        const wakeId = `drive:${groupId}:${ordinal}`;
        store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'start',?,0)").run(wakeId, groupId, canonicalBytes({
          groupId, startRevision: body.startRevision, ...(body.executionSnapshotHash === undefined ? {} : { executionSnapshotHash: body.executionSnapshotHash }),
        }).toString("utf8"));
        armed.push(wakeId);
      } catch (error) {
        failed.push(`${groupId}: ${describeError(error)}`);
      }
    }
    return armed;
  });
  for (const line of failed) process.stderr.write(`orca-driver: group ${line}\n`);
  return armedIds;
}
```
（循环体除了包进 `try` 与原先 `const group = …` 那行移进 `try`，逐字不变；动手前与现场 661–679 行逐行对一次。）

- [ ] **Step 4: 实现 per-run** —— `pass` 里逐 run 的 `catch (error) { … }`（767–801 行）改为：

```ts
      } catch (error) {
        if (error instanceof DriverCrash) throw error;
        // A draining panel refuses every write; the round ends and no run is blamed for it.
        if (error instanceof ControlError && error.code === "panel-draining") return progressed;
        // Backlog #3 (Orca handoff §9.0 挂账): recording this run's failure can fail too -- a write the store refuses,
        // a row that no longer reads. That second failure is this run's alone: it is named on stderr with both errors,
        // and the round goes on to the next run instead of ending for every group.
        try {
          const run = readDriverRun(deps.store, runId);
          // A settled run stays settled: whatever failed here is the settle step's own cleanup work,
          // never a reason to reopen it as blocked at an earlier step (controller ruling P7,
          // 2026-09-25). Record the failure on the run and leave it for the next round to retry --
          // re-checked inside the write since another write may have landed while this step was
          // in flight (the deferred note from Task 4's review: never write after an await without
          // re-reading state first).
          if (run.state === "settled") {
            write(deps, () => {
              const current = readDriverRun(deps.store, runId);
              if (current.state === "settled" && current.drive !== undefined && !current.drive.cleanedUp) {
                current.drive = { ...current.drive, cleanupError: describeError(error) };
                saveDriverRun(deps.store, current);
              }
            });
            process.stderr.write(`orca-driver: ${runId}: ${describeError(error)}\n`);
            continue;
          }
          if (run.drive === undefined) { process.stderr.write(`orca-driver: ${runId}: ${describeError(error)}\n`); continue; }
          // Final fix wave (FR-C2, controller ruling 2026-09-25): a run that is already blocked stays blocked where it
          // was. `blockedAt` decides which branch closes it under a stop (spec §13.2 I-3) and where a retry resumes it,
          // so a later error on it (a transient collect failure, an H-settle that threw) never moves it -- `stepOf`
          // would name "E" for every blocked run. The original reason is kept as the prefix; the new error follows it.
          if (run.state === "blocked" && run.drive.blockedAt !== null) {
            blockRun(deps, runId, run.drive.blockedAt, laterError(run.drive.blockedReason, describeError(error)));
          } else {
            blockRun(deps, runId, stepOf(run), describeError(error));
          }
          progressed = true;
        } catch (recordError) {
          if (recordError instanceof DriverCrash) throw recordError;
          if (recordError instanceof ControlError && recordError.code === "panel-draining") return progressed;
          process.stderr.write(`orca-driver: ${runId}: ${describeError(error)}; recording it failed: ${describeError(recordError)}\n`);
        }
      }
```
（`try` 里面的每一行、每一段注释都与现场 776–800 行逐字相同，只是缩进多两格；动手前逐行对。）

- [ ] **Step 5: 跑新判据与全部驱动环判据，期望 PASS**

```bash
./node_modules/.bin/vitest run tests/control/driverRoundIsolation.test.ts tests/control/executionDriver.test.ts tests/control/driverLanding.test.ts tests/control/driverSettle.test.ts tests/control/driverHandoff.test.ts tests/control/handoffGuards.test.ts tests/control/driverReconcile.test.ts > "$SCRATCH/t10-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t10-tsc.txt" 2>&1; echo rc=$?
```
期望两个 `rc=0`（`driverLanding`／`driverSettle` 若红，先按 Global Constraints 的 flake 规则单文件重跑）。

- [ ] **Step 6: 变异（副本 `$SCRATCH/mut-t10`，`cat` 两个文件进副本并 `cmp`）**
  - M10-1：replenish 去掉 `try … catch`（回到一处抛错中止整个事务）⇒ 必须红：`a round goes on past one group's failure (backlog #3) > arms the next start wake for a healthy group …`，另一条绿。
  - M10-2：replenish 保留 `try`，把 `catch` 体改成空（不 push 到 `failed`）⇒ 必须红：同一条，红在 stderr 那一行（证明「不许静默吞」被判据守着）。
  - M10-3：per-run 去掉外层 `try … catch (recordError)` ⇒ 必须红：`… > names a run whose failure it could not record, and still moves the next run in the same round`，红在 `second` 仍是 `accepted`。
  - M10-4：per-run 的 `catch (recordError)` 体里删掉 `process.stderr.write(...)` ⇒ 必须红：同一条，红在 `lines` 不含那一行。

- [ ] **Step 7: 提交**

```bash
/usr/bin/git add src/control/executionDriver.ts tests/control/driverRoundIsolation.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(control): keep one group's failure from ending the driver's round for every group

A group whose start wake could not be armed threw out of replenishStartWakes' single
transaction, and a run whose failure could not be recorded threw out of the per-run loop;
either ended the round for every group. Both are now skipped and named on stderr as the
driver names every failure it cannot pin on a run. A draining panel and a crash hook still
end the round.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 11: A2 只派确认快照冻结的那个选择（#13(c)）

**Files:**
- Modify: `src/control/executionDriver.ts`（`stepA2`，223 行 `if (run.state !== "start-pending" …) return false;` 之后）⚠️ 与计划 A 同文件
- Create: `tests/control/dispatchAgentSnapshot.test.ts`

**Interfaces:** 工作 run 的 run 行 `agent` 或 `configHash` 与确认快照为该任务冻结的（`readConfirmedTaskExecution(...).agent`）不一致 ⇒ 在 A2、任何工作区／bundle／清理之前 `blockRun(A2, "agent-unfrozen")`。`readConfirmedTaskExecution` 自身已核「work item 对快照」（`executionSnapshot.ts:302-304`），本条补的是「run 行对快照」这一环（spec §12 m-4）。

**`Ruling:`**（控制器，#13(c)，fail-closed）：**拦，不修**（不拿快照值覆盖 run 行再派）；原因码 `agent-unfrozen`（与 R 的 `reconcile-agent-unfrozen` 同族）；只比 `agent` 与 `configHash`（claim 实际带出去的两项，`startEnvelope.ts` `frozenClaim`）。估算 run（`stepA2Estimate`）不在本条范围，登记。

- [ ] **Step 1: 写判据** —— `tests/control/dispatchAgentSnapshot.test.ts`：

```ts
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { driverHarness } from "./fixtures/driverHarness.js";

// Orca backlog #13(c) (2026-09-29; agent selection spec §12 m-4, Orca handoff §9.0c): a work run dispatches the
// selection the confirmed snapshot froze for its task -- the claim ccloop receives is built from the run row
// (startEnvelope.ts frozenClaim), so a row that moved away from the snapshot would dispatch an unconfirmed agent or
// config. Only a damaged store gets there; it is blocked by name at A2, before any workspace or accept.
describe("A2 dispatches only the confirmed selection (backlog #13(c))", () => {
  it.each([
    { field: "configHash", tamper: (body: Record<string, unknown>) => { body.configHash = "f".repeat(64); } },
    { field: "agent", tamper: (body: Record<string, unknown>) => { body.agent = { ...(body.agent as Record<string, unknown>), model: "not-the-confirmed-model" }; } },
  ])("blocks a run whose $field no longer matches the snapshot, before any workspace or accept", async ({ tamper }) => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const body = t.body(runId);
      tamper(body);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
      await t.until(t.driver(), () => ["blocked", "accepted", "collected", "landed", "settled"].includes(t.body(runId).state));
      expect(t.body(runId)).toMatchObject({ state: "blocked", drive: { blockedAt: "A2", blockedReason: "agent-unfrozen", prepared: false } });
      expect(existsSync(t.body(runId).drive.workspacePath)).toBe(false);
      expect(t.fake.calls.accept).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });
});
```

- [ ] **Step 2: 跑，期望两行都 FAIL**

```bash
./node_modules/.bin/vitest run tests/control/dispatchAgentSnapshot.test.ts > "$SCRATCH/t11-red.txt" 2>&1; echo rc=$?
```
期望 `rc=1`，两行都红在 `state: "accepted"`（今天照派，假 ccloop 回显 claim 的 hash）。

- [ ] **Step 3: 实现** —— `stepA2`，在 `if (run.state !== "start-pending" || run.drive === undefined || run.drive.prepared || run.taskId === null) return false;` 之后插入：

```ts
  // Backlog #13(c) (agent selection spec §12 m-4, Orca handoff §9.0c): the claim ccloop receives is built from this run
  // row (startEnvelope.ts frozenClaim), so the row must still carry the selection the confirmed snapshot froze for the
  // task -- readConfirmedTaskExecution has already proved the work item agrees with the snapshot. Checked before any
  // workspace, bundle or predecessor cleanup, so a refusal leaves nothing behind; as R does for the reconcile slot, a
  // row that moved away is blocked by name, never dispatched and never silently repaired.
  const frozenAgent = readConfirmedTaskExecution(store, run.groupId, run.taskId).agent;
  if (run.configHash !== frozenAgent.configHash || sha256Canonical(run.agent) !== sha256Canonical(frozenAgent.agent)) {
    blockRun(deps, runId, "A2", "agent-unfrozen");
    return true;
  }
```
（`readConfirmedTaskExecution` 与 `sha256Canonical` 已在文件头 import。）

- [ ] **Step 4: 跑新判据与驱动环、续跑、并行判据，期望 PASS**

```bash
./node_modules/.bin/vitest run tests/control/dispatchAgentSnapshot.test.ts tests/control/executionDriver.test.ts tests/control/driverHandoff.test.ts tests/control/driverSettle.test.ts tests/control/configHashPerTask.test.ts tests/control/webContinuation.test.ts > "$SCRATCH/t11-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t11-tsc.txt" 2>&1; echo rc=$?
```
期望两个 `rc=0`。⚠️ 若某条续跑判据红在 `agent-unfrozen` ⇒ 续跑 run 的 run 行本来就与快照不同（设计如此），**停下报控制器**，不要放宽比较。

- [ ] **Step 5: 变异（副本 `$SCRATCH/mut-t11`）**
  - M11-1：删掉整个新 `if` ⇒ 必须红：两行 `A2 dispatches only the confirmed selection (backlog #13(c)) > blocks a run whose … no longer matches the snapshot …`。
  - M11-2：条件只留 `run.configHash !== frozenAgent.configHash` ⇒ 必须红：只有 `agent` 那一行。
  - M11-3：把整段挪到 `await ensureWorkspace(...)` 之后 ⇒ 必须红：两行都红在 `existsSync(workspacePath)`（证明「在副作用之前」有判据）。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add src/control/executionDriver.ts tests/control/dispatchAgentSnapshot.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(control): dispatch a work run only with the selection its confirmation froze

The start claim is built from the run row, which was never compared with the confirmed
snapshot (agent selection spec §12 m-4); the reconcile run already is. A row whose agent or
configHash moved away is now blocked at A2 as agent-unfrozen, before any workspace, bundle
or predecessor cleanup.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 12: `assertCapabilities` 的 strict 分支也要求 tokens 被约束（#11(a)）

**Files:**
- Modify: `src/control/budget.ts:87`
- Create: `tests/control/assertCapabilitiesStrict.test.ts`

**Interfaces:** strict 下 `requestBoundProof.workDimensions` 不含 `"tokens"` ⇒ `control-capability-unsupported`，与 `probeBlocksDispatch`（`webDispatch.ts:61`）、`profiledCapabilities`（`service.ts:92`）、估算闸门（`estimator.ts:78`、`:116`）同一口径。soft 不受影响。

- [ ] **Step 1: 写判据** —— `tests/control/assertCapabilitiesStrict.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { assertCapabilities } from "../../src/control/budget.js";
import { ControlError } from "../../src/control/errors.js";
import { profileSnapshot } from "./fixtures/web.js";

// Orca backlog #11(a) (2026-09-29; Orca handoff §9.1): strict mode means the token budget is bounded, and every other
// strict gate (webDispatch.ts probeBlocksDispatch, service.ts profiledCapabilities, estimator.ts) already requires the
// request-bound proof to bound "tokens". The claim-time assertion must not be the one gate a proof bounding only other
// dimensions gets through.
const code = (action: () => void): string | null => {
  try { action(); return null; } catch (error) { return error instanceof ControlError ? error.code : `not a ControlError: ${String(error)}`; }
};

describe("assertCapabilities under strict (backlog #11(a))", () => {
  it("refuses a strict claim whose request-bound proof does not bound tokens, and only under strict", () => {
    const bounded = profileSnapshot().profile.capabilities;
    // Non-vacuity: the fixture passes strict as it is, so the refusal below is about the dimensions alone.
    expect(bounded.requestBoundProof?.workDimensions).toEqual(["tokens"]);
    expect(code(() => assertCapabilities("strict", bounded))).toBeNull();
    const withoutTokens = { ...bounded, requestBoundProof: { ...bounded.requestBoundProof!, workDimensions: ["activeMs"] as ["activeMs"] } };
    expect(code(() => assertCapabilities("strict", withoutTokens))).toBe("control-capability-unsupported");
    expect(code(() => assertCapabilities("soft", withoutTokens))).toBeNull();
  });
});
```

- [ ] **Step 2: 跑，期望 FAIL**

```bash
./node_modules/.bin/vitest run tests/control/assertCapabilitiesStrict.test.ts > "$SCRATCH/t12-red.txt" 2>&1; echo rc=$?
```
期望 `rc=1`，红在 strict ＋ `withoutTokens` 得到 `null`。

- [ ] **Step 3: 实现** —— `src/control/budget.ts` 87 行
```ts
  if(mode==="strict" && (c.budgetEnforcement!=="bounded" || c.requestBoundProof===null)) throw new ControlError("control-capability-unsupported");
```
改为
```ts
  // Backlog #11(a) (Orca handoff §9.1): strict needs the proof to bound tokens, as probeBlocksDispatch, profiledCapabilities and the estimator's gate already require.
  if(mode==="strict" && (c.budgetEnforcement!=="bounded" || c.requestBoundProof===null || !c.requestBoundProof.workDimensions.includes("tokens"))) throw new ControlError("control-capability-unsupported");
```

- [ ] **Step 4: 跑，期望 PASS**

```bash
./node_modules/.bin/vitest run tests/control/assertCapabilitiesStrict.test.ts tests/control/budget.test.ts tests/control/endToEnd.test.ts tests/control/estimateSingleCallGate.test.ts > "$SCRATCH/t12-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t12-tsc.txt" 2>&1; echo rc=$?
```
期望两个 `rc=0`。

- [ ] **Step 5: 变异（副本 `$SCRATCH/mut-t12`）**
  - M12-1：删掉新加的 `|| !c.requestBoundProof.workDimensions.includes("tokens")` ⇒ 必须红：`assertCapabilities under strict (backlog #11(a)) > refuses a strict claim …`。
  - M12-2：把新条件挪出 `mode==="strict" && (…)` 之外（soft 也拒）⇒ 必须红：同一条，红在 soft 那一行。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add src/control/budget.ts tests/control/assertCapabilitiesStrict.test.ts
/usr/bin/git commit -F - <<'EOF'
fix(control): require a strict claim's request-bound proof to bound tokens

assertCapabilities' strict branch accepted any non-null proof, while the probe, the profile
gate and the estimator's gate all require workDimensions to include tokens. It now refuses
the same proofs they do; soft groups are unaffected.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 13: 预算编辑器点名挡住派活的 handoff 能力（#11(b)）

**Files:**
- Modify: `web/src/BudgetEditor.tsx`（172 行 `const contextUnavailable …` 之后；242–244 行 `contextUnavailable` 那段 JSX 之后）
- Create: `web/tests/budgetHandoffCapability.test.tsx`

**Interfaces:** 对 `config.profiles` 里**可接 task 或 handoff 工作**、且 `observed.handoffControl !== "durable"` 或 `observed.handoffExecution === null` 的每个 profile，多渲染一行 `role="note"`：
`profile <id>: handoff control <x> · handoff execution <y|none> · work bound to it is not dispatched (claim-capability-unavailable)`。其余渲染逐字节不变（`budgetSuggestions.test.tsx` 的 `toBe(today)` 用的是 `durable`＋`mechanical-in-run-v1` 的夹具，不受影响）。

**`Ruling:`**：文案用英文（面板现有文案都是英文）；只列可接 task／handoff 的 profile（只做估算的 profile 的 handoff 能力不挡任何派活）。

- [ ] **Step 1: 写判据** —— `web/tests/budgetHandoffCapability.test.tsx`：

```tsx
// @vitest-environment jsdom
/**
 * Backlog #11(b) (2026-09-29; Orca handoff §9.1): handoffControl and handoffExecution decide whether work bound to a
 * profile can be dispatched at all (webDispatch.ts probeBlocksDispatch, budget.ts assertCapabilities), yet a refused
 * dispatch showed only claim-capability-unavailable. The editor names the two values for every profile they refuse.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor } from "../src/BudgetEditor.js";
import type { Amount, CapabilityViewV1, ControlConfigV1, GroupViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const PLAN = "a".repeat(64);
const DURABLE: CapabilityViewV1 = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "realtime", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null };
const config = (observed: CapabilityViewV1, allowedWorkKinds: ControlConfigV1["profiles"][number]["allowedWorkKinds"] = ["task", "budget-estimate", "handoff", "goal-review"]): ControlConfigV1 => ({
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds, contextTokenizer: null, workMaxOutputTokens: 1000, declared: observed, observed, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
});
const view: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(90_000), used: amount(0), committedRemaining: amount(3_300), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
  ],
  workItems: [{ taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [] }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
};
const text = (c: ControlConfigV1): string => {
  const shown = render(<BudgetEditor view={view} config={c} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.textContent ?? "";
  cleanup();
  return shown;
};

afterEach(cleanup);

describe("the budget editor names handoff capabilities that refuse dispatch (backlog #11(b))", () => {
  it("names each task or handoff profile whose handoff control or execution refuses dispatch, and nothing otherwise", () => {
    expect(text(config(DURABLE))).not.toContain("handoff control");
    expect(text(config({ ...DURABLE, handoffControl: "phase-end" }))).toContain(
      "profile all: handoff control phase-end · handoff execution mechanical-in-run-v1 · work bound to it is not dispatched (claim-capability-unavailable)",
    );
    expect(text(config({ ...DURABLE, handoffExecution: null }))).toContain(
      "profile all: handoff control durable · handoff execution none · work bound to it is not dispatched (claim-capability-unavailable)",
    );
    // An estimator-only profile carries no task or handoff work, so its handoff capabilities refuse nothing.
    expect(text(config({ ...DURABLE, handoffControl: "unavailable" }, ["budget-estimate"]))).not.toContain("handoff control");
  });
});
```
（`GroupViewV1` 夹具照抄 `web/tests/budgetSuggestions.test.tsx` 的 `view()`，去掉 estimate 与 goal-review／reserve 两行分配；若 `tsc` 报缺字段，以 `controlTypes.ts` 现场为准补齐，**不改断言**。）

- [ ] **Step 2: 跑，期望 FAIL**

```bash
cd /Users/biran/code/skills/loop/Orca/web
../node_modules/.bin/vitest run tests/budgetHandoffCapability.test.tsx > "$SCRATCH/t13-red.txt" 2>&1; echo rc=$?
cd ..
```
期望 `rc=1`，红在 `phase-end` 那一行（今天什么都不显示）。

- [ ] **Step 3: 实现** —— `web/src/BudgetEditor.tsx`：172 行之后加

```tsx
  // Backlog #11(b) (Orca handoff §9.1): handoffControl "durable" and a handoffExecution are what dispatch requires of a
  // task or handoff profile (webDispatch.ts probeBlocksDispatch, budget.ts assertCapabilities); a group bound to one
  // that lacks them is refused as claim-capability-unavailable and nothing more, so the two values are named here.
  const handoffBlocked = config.profiles.filter((profile) =>
    (profile.allowedWorkKinds.includes("task") || profile.allowedWorkKinds.includes("handoff"))
    && (profile.observed.handoffControl !== "durable" || profile.observed.handoffExecution === null));
```
在 242–244 行
```tsx
      {contextUnavailable && (
        <p role="note">context observation unavailable · the context watermark cannot hand off automatically</p>
      )}
```
之后加

```tsx
      {handoffBlocked.map((profile) => (
        <p role="note" key={`handoff-capability:${profile.profileId}`}>
          profile {profile.profileId}: handoff control {profile.observed.handoffControl} · handoff execution {profile.observed.handoffExecution ?? "none"} · work bound to it is not dispatched (claim-capability-unavailable)
        </p>
      ))}
```

- [ ] **Step 4: 跑，期望 PASS；web tsc 与相邻判据**

```bash
cd /Users/biran/code/skills/loop/Orca/web
../node_modules/.bin/vitest run tests/budgetHandoffCapability.test.tsx tests/budgetSuggestions.test.tsx tests/confirmSelection.test.tsx tests/controlPanel.test.tsx > "$SCRATCH/t13-green.txt" 2>&1; echo rc=$?
../node_modules/.bin/tsc --noEmit -p tsconfig.json > "$SCRATCH/t13-tsc.txt" 2>&1; echo rc=$?
cd ..
```
期望两个 `rc=0`（`budgetSuggestions` 的 `toBe(today)` 仍绿）。

- [ ] **Step 5: 变异（副本 `$SCRATCH/mut-t13`，Orca clone 要 `ln -s` 两处 `node_modules`）**
  - M13-1：删掉 `{handoffBlocked.map(...)}` 整段 ⇒ 必须红：`the budget editor names handoff capabilities that refuse dispatch (backlog #11(b)) > names each …`，红在 `phase-end`。
  - M13-2：过滤条件删掉 `|| profile.observed.handoffExecution === null` ⇒ 必须红：同一条，红在 `handoff execution none`。
  - M13-3：删掉 `allowedWorkKinds` 那半个条件 ⇒ 必须红：同一条，红在只做估算的 profile。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add web/src/BudgetEditor.tsx web/tests/budgetHandoffCapability.test.tsx
/usr/bin/git commit -F - <<'EOF'
feat(web): name the handoff capabilities that keep a profile's work from being dispatched

handoffControl and handoffExecution decide whether task and handoff work is dispatched at all,
but a refused dispatch surfaced only as claim-capability-unavailable. The budget editor now
names both values for every task or handoff profile they refuse.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 14: slogan 与验收脚本的默认额度（#16）

**Files:**
- Modify: `README.md`（1 行 `# Orca` 之后）⚠️ 计划 C 改同文件第 398 行之后
- Modify: `web/index.html:6`（`<title>`）
- Modify: `web/src/Shell.tsx:61`（brand）
- Modify: `package.json`（2–3 行之后加 `description`）⚠️ 计划 C 的依赖行由人亲手加
- Modify: `scripts/live-driver-acceptance.ts:19`、`:90`、`:91`

**Interfaces:** 无代码接口变化。slogan 逐字为 `Leave it to Orca — every idea, made real.`（goal.md §10.2 G8；破折号是 U+2014）。

**`Ruling:`**（控制器，#16）：
- `Shell.tsx` 的 brand 不加可见文字（侧栏窄），只加 `title` 提示；
- `web/index.html` 的标题改为 `Orca — every idea, made real.`（去掉 "Leave it to"，浏览器标签页短）——若控制器要整句，改成整句即可；
- 验收脚本 `--task-tokens` 默认 150 000 → 1 000 000（handoff §4.0 第 72 行「实际工作设到 1,000,000 以上」），**连带** `--group-tokens` 默认 300 000 → 3 000 000（见 Drafter findings：否则 confirm 以 `group-budget-unavailable` 拒）。

- [ ] **Step 1: 写成功判据（命令，退出码说话）** —— 存为 `$SCRATCH/t14-check.mjs`：

```js
import { readFileSync } from "node:fs";
const root = "/Users/biran/code/skills/loop/Orca";
const slogan = "Leave it to Orca — every idea, made real.";
const read = (path) => readFileSync(`${root}/${path}`, "utf8");
const failures = [];
const readme = read("README.md").split("\n");
if (readme[0] !== "# Orca" || readme[2] !== `_${slogan}_`) failures.push("README.md line 3");
if (!read("web/index.html").includes("<title>Orca — every idea, made real.</title>")) failures.push("web/index.html title");
if (!read("web/src/Shell.tsx").includes(`<div className="brand" title="${slogan}">`)) failures.push("Shell.tsx brand");
if (JSON.parse(read("package.json")).description !== slogan) failures.push("package.json description");
const script = read("scripts/live-driver-acceptance.ts");
if (!script.includes('Number(args["task-tokens"] ?? 1_000_000)')) failures.push("--task-tokens default");
if (!script.includes('Number(args["group-tokens"] ?? 3_000_000)')) failures.push("--group-tokens default");
if (!script.includes("[--group-tokens 3000000] [--task-tokens 1000000]")) failures.push("usage line");
console.log(failures.length === 0 ? "ok" : `missing: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
```
```bash
node "$SCRATCH/t14-check.mjs" > "$SCRATCH/t14-red.txt" 2>&1; echo rc=$?
```
期望 `rc=1`（七项全缺）。

- [ ] **Step 2: 改**
  - `README.md`：在 1 行 `# Orca` 之后插入一个空行和一行 `_Leave it to Orca — every idea, made real._`（原第 2 行的空行保留在它之后）⇒ 前四行为 `# Orca`、空行、`_Leave it to Orca — every idea, made real._`、空行。
  - `web/index.html:6`：`<title>Orca panel</title>` → `<title>Orca — every idea, made real.</title>`。
  - `web/src/Shell.tsx:61`：`<div className="brand"><span className="brand-dot" />Orca</div>` → `<div className="brand" title="Leave it to Orca — every idea, made real."><span className="brand-dot" />Orca</div>`。
  - `package.json`：`"version": "0.1.0",` 之后加一行 `"description": "Leave it to Orca — every idea, made real.",`。
  - `scripts/live-driver-acceptance.ts`：19 行 `[--group-tokens 300000] [--task-tokens 150000]` → `[--group-tokens 3000000] [--task-tokens 1000000]`；90 行 `?? 300_000` → `?? 3_000_000`；91 行 `?? 150_000` → `?? 1_000_000`；并在 90 行上方加一行注释：
    ```ts
    // Backlog #16 (2026-09-29; Orca handoff §4.0): real work needs a task grant of 1,000,000 tokens or more, cumulative
    // over every phase, attempt and continuation; the group default grows with it so the default proposal still fits.
    ```

- [ ] **Step 3: 跑判据与相邻检查**

```bash
node "$SCRATCH/t14-check.mjs" > "$SCRATCH/t14-green.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t14-tsc.txt" 2>&1; echo rc=$?
cd web && ../node_modules/.bin/vitest run tests/shell.test.tsx tests/App.test.tsx > "$SCRATCH/t14-web.txt" 2>&1; echo rc=$?; cd ..
node -e 'JSON.parse(require("fs").readFileSync("package.json","utf8"))' > "$SCRATCH/t14-json.txt" 2>&1; echo rc=$?
```
期望四个 `rc=0`。

- [ ] **Step 4: 用 fake 实测默认额度能过 confirm（免费，不调真 agent）** —— 需要 ccloop clone 的 build（Task 15 Step 1 建的那份，或此处先建 `$SCRATCH/gate-ccloop` 并 `npm run build`）：

```bash
cd /Users/biran/code/skills/loop/Orca
node_modules/.bin/tsx scripts/live-driver-acceptance.ts --ccloop-bin "$SCRATCH/gate-ccloop/dist/cli.js" --output "$SCRATCH/t14-lda-single" --fake > "$SCRATCH/t14-lda-single.txt" 2>&1; echo rc=$?
node_modules/.bin/tsx scripts/live-driver-acceptance.ts --ccloop-bin "$SCRATCH/gate-ccloop/dist/cli.js" --output "$SCRATCH/t14-lda-conflict" --fake --scenario conflict > "$SCRATCH/t14-lda-conflict.txt" 2>&1; echo rc=$?
```
期望两个 `rc=0`，读回各自的 summary（`groupTokens: 3000000`、`taskTokens: 1000000`）。若 conflict 仍以 `group-budget-unavailable` 被拒 ⇒ 照实记台账、报控制器（不继续调默认值）。

- [ ] **Step 5: 变异**（把 `$SCRATCH/t14-check.mjs` 当判据）：在副本 `$SCRATCH/mut-t14` 里逐项还原七处中的任一处 ⇒ `t14-check.mjs`（`root` 改指副本）`rc=1` 且 `missing:` 恰好点名那一项；另把 group 默认值单独还原成 `300_000` 再跑 Step 4 的 single ⇒ 期望以 `confirm refused: … group-budget-unavailable` 失败（证明连带改动是必要的）。

- [ ] **Step 6: 提交**

```bash
/usr/bin/git add README.md web/index.html web/src/Shell.tsx package.json scripts/live-driver-acceptance.ts
/usr/bin/git commit -F - <<'EOF'
docs: carry the slogan, and default the acceptance script to a real task grant

"Leave it to Orca — every idea, made real." (goal.md G8) goes under the README title, into the
panel's title and brand tooltip, and into package.json. The live acceptance script now
defaults to a 1,000,000-token task grant, as real work needs, and to a 3,000,000-token group
so the default proposal still fits at confirmation.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

---

### Task 15（控制器）: 两仓的门、变异总表重跑、台账

**Files:** 只写台账 `.superpowers/sdd/2026-09-29-labels-progress-and-backlog/progress.md`（追加）与三份 handoff（按 memory「交接的两种形态」）。

- [ ] **Step 1: ccloop 门（新 clone，内容＝Task 9 那一笔）**

```bash
export TMPDIR=$(mktemp -d /private/tmp/cl-XXXX) ECC_GATEGUARD=off DISABLE_OMC=1
mkdir -p "$SCRATCH/gate-home" "$SCRATCH/gate-xdg/config" "$SCRATCH/gate-xdg/data" "$SCRATCH/gate-xdg/cache" "$SCRATCH/gate-xdg/state"
/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop "$SCRATCH/gate-ccloop" > "$SCRATCH/t15-c-clone.txt" 2>&1; echo rc=$?
ln -s /Users/biran/code/skills/loop/ccloop/node_modules "$SCRATCH/gate-ccloop/node_modules"
cd "$SCRATCH/gate-ccloop"
npm run build > "$SCRATCH/t15-c-build.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t15-c-tsc.txt" 2>&1; echo rc=$?
HOME="$SCRATCH/gate-home" XDG_CONFIG_HOME="$SCRATCH/gate-xdg/config" XDG_DATA_HOME="$SCRATCH/gate-xdg/data" XDG_CACHE_HOME="$SCRATCH/gate-xdg/cache" XDG_STATE_HOME="$SCRATCH/gate-xdg/state" \
  ./node_modules/.bin/vitest run --reporter=json --outputFile="$SCRATCH/t15-c-vitest.json" > "$SCRATCH/t15-c-vitest.txt" 2>&1; echo rc=$?
node scripts/check-known-reds.mjs "$SCRATCH/t15-c-vitest.json" > "$SCRATCH/t15-c-reds.txt" 2>&1; echo rc=$?
```
判绿：build／typecheck `rc=0`，`check-known-reds` **`rc=0`**。条数只抄工具报数（基线 1066 条；本计划新增 ccloop 判据 2＋4＋2＋1＋1＋1＋2 ＝ 13 条，预言值 1079，以实测为准）。**这份 clone 从此只当 `ORCA_CCLOOP_BIN`，不做变异。**

- [ ] **Step 2: Orca 门（新 clone，内容＝Task 14 那一笔）**

```bash
/usr/bin/git clone --local /Users/biran/code/skills/loop/Orca "$SCRATCH/gate-orca" > "$SCRATCH/t15-o-clone.txt" 2>&1; echo rc=$?
ln -s /Users/biran/code/skills/loop/Orca/node_modules "$SCRATCH/gate-orca/node_modules"
ln -s /Users/biran/code/skills/loop/Orca/web/node_modules "$SCRATCH/gate-orca/web/node_modules"
cd "$SCRATCH/gate-orca"
npm run build --workspace web > "$SCRATCH/t15-o-web-build.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t15-o-tsc.txt" 2>&1; echo rc=$?
stat -f '%m %z %N' ~/.orca ~/.orca/* > "$SCRATCH/t15-orca-before.txt" 2>&1; echo rc=$?
HOME="$SCRATCH/gate-home" XDG_CONFIG_HOME="$SCRATCH/gate-xdg/config" XDG_DATA_HOME="$SCRATCH/gate-xdg/data" XDG_CACHE_HOME="$SCRATCH/gate-xdg/cache" XDG_STATE_HOME="$SCRATCH/gate-xdg/state" \
ORCA_CCLOOP_BIN="$SCRATCH/gate-ccloop/dist/cli.js" ORCA_AGENTS_TABLE="<scratchpad 里的夹具表，fake codex integration>" \
  ./node_modules/.bin/vitest run --reporter=json --outputFile="$SCRATCH/t15-o-vitest.json" > "$SCRATCH/t15-o-vitest.txt" 2>&1; echo rc=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json && ../node_modules/.bin/vitest run) > "$SCRATCH/t15-o-web.txt" 2>&1; echo rc=$?
npm run verify:panel > "$SCRATCH/t15-o-panel.txt" 2>&1; echo rc=$?
stat -f '%m %z %N' ~/.orca ~/.orca/* > "$SCRATCH/t15-orca-after.txt" 2>&1; echo rc=$?
cmp "$SCRATCH/t15-orca-before.txt" "$SCRATCH/t15-orca-after.txt" > "$SCRATCH/t15-orca-cmp.txt" 2>&1; echo rc=$?
```
（夹具表路径照 Orca handoff §三：0600 文件、0700 目录、`command`＝`[node, $SCRATCH/gate-ccloop/tests/fixtures/fake-codex.mjs, "integration", <marker>]`、`version: "9.9.9-fake"`；先建好再跑。）
判绿：全量 `rc=0`、0 pending（失败只许是 Global Constraints 里登记的 flake，且单文件重跑绿、记 `uptime`）；web、`verify:panel` `rc=0`；真 `~/.orca` 前后 `cmp` `rc=0`。基线 230 文件／2087 条，本计划新增 Orca 判据 2＋2＋1＋1 ＝ 6 条（`tests/**`）与 web 1 条，预言值 2093／web 150，以实测为准（计划 A 也会加判据，报数时分开列）。

- [ ] **Step 3: 变异总表重跑**（Rule 17「代码改了以后，之前跑过的变异要重跑」）：在 `$SCRATCH/mut-final-ccloop`、`$SCRATCH/mut-final-orca`（内容＝两仓最终那一笔）上把 M2-a … M14 逐条重跑一次，填表：`变异 | 文件 | 预言红 | 实际红（全名） | 还原 diff 字节数（working／cached）`。任一条与预言不符 ⇒ 照实记，不改预言。
- [ ] **Step 4: `pgrep -fl "ccloop-agents-version|worker.js|fake-claude-cli|stand-in-claude" > "$SCRATCH/t15-orphans.txt"`**，结果记台账（杀进程要人授权）。
- [ ] **Step 5: 台账**：追加本计划的全部 `Ruling:` 行（Task 3、5、6、7、8、10、11、13、14 各条，与 Drafter findings 的四个 SKIP），Task 9 的「人授权改写」四条全名，所有 `$SCRATCH/mut-*` 与 `gate-*` 副本路径（删不删归人）。
- [ ] **Step 6: handoff**：Orca／ccloop 两份 handoff 就地更新 §9.0、§9.0b、§9.0c、§9.1 与 ccloop「挂着的」对应条目（删过程、留结论，Rule 13 的三个条件）；新登记：#4、#11(d)、#13(b)、#13(d)、ccloopPort ERRATUM 已随代码删除、SubprocessClaudeAdapter stdout 同形缺陷、Task 1 扫描出的 Orca 文档里的同一句。

---

## Self-Review

1. **覆盖**：#3 → Task 10；#6 → Task 3；#7 → Task 5；#11(a)(b)(c) → Task 12、13、6，(d) → SKIP；#12(a)(b) → Task 2、4；#13(a)(c) → Task 7、11，(b)(d) → SKIP；#14 M3／M4 → Task 8、9；#15 → Task 1（ccloop 两处），Orca 那处 SKIP；#16 → Task 14；#4 → SKIP。每个 SKIP 都在 Drafter findings 里给了现测证据和「要做需要什么」。
2. **每个分支都有自己的删除变异**：Task 2（M2-a／b 各一处）、Task 3（四处各一）、Task 4（M4-1／2）、Task 5（M5-1／2）、Task 6（enum 与 refine 分开）、Task 7（整段与大小写）、Task 8（两个外层分支、打标、以及「读路径那一条仍在」）、Task 9（盲区先量、后量、再证 `"."` 承重）、Task 10（两处隔离各自的「不吞」变异）、Task 11（整段、只比一项、挪到副作用之后）、Task 12（条件与 strict 作用域）、Task 13（三个条件）、Task 14（七处与连带默认值）。
3. **「排在被测调用之前、读回自己写的值」的断言**：扫过。Task 12 的 `workDimensions` 断言排在被测调用之前，但它读的是夹具的出厂值（非空性检查），不是判据自己刚写的值；Task 3 第三条的第二次 run 是非空性对照，断言都在被测 run 之后。
4. **既有判据**：只有 Task 9 改（四条，已指名）；其余全是新文件或只追加。Task 5、8 往既有文件追加 `it`，没有碰任何既有 `it` 的文字。可能被波及、要停下报人的点已在各 Task 写明（Task 7 的 `[1m]` 字面量扫描、Task 9 的 `"."` 红、Task 11 的续跑）。
5. **与计划 A 的冲突面**：只在 `executionDriver.ts` 与 ccloop `command.ts`，都是不同 hunk；已要求 A 先落、本计划每个 Task 开工重测行号。与计划 C：Orca `README.md`、`package.json` 不同位置。
6. **没有占位**：每个判据、每处实现都给了真代码；唯一留给执行时现场决定的是 Task 15 的夹具表路径（Orca handoff §三有建法，门跑之前现建），以及 Task 13 夹具若因 `controlTypes.ts` 字段增减而要补字段（只补字段、不改断言）。
7. **不确定、已标出的预言**：Task 8 Step 2 的「红成两条」依赖对 M3 到达路径的读码推断（mock 在自家 transfer 被拒时落下 marker 与锁）；Task 9 的 sweep 判据在 `"."` 上是否本来就稳定，都要实测，不符即停。
