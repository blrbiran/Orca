

# 计划正文 W6：T14（面板 API）、T15（面板 UI）、T16（驱动环 E2E）、T17（全套门）

> **归属**：计划写作席 W6（Claude Opus 5.5），Orca 控制器会话 `75ec878e`，2026-09-26。
> **观测锚点**：Orca 主题行 `chore(checkpoint): orca-dev-75ec878e, level 335434 of 1000000 (T1 330000, T2 450000, band 1)`（`545f452`）；
> ccloop 主题行 `docs(handoff): roll the Orca section: C5-C7 and C-3 landed here for the handoff delivery round`（`f4e49a2`）。
> **行号会移动 ⇒ 引用前现测**；下文所有行号都是本席在上面两笔上量的，且 T7–T13 落地后**一定**会移动，实施席按「前后锚点文本」找位置，不按行号。
> 本席**没有**在副本里跑任何东西（brief 允许但不要求；T14–T16 依赖的 T7–T13 还不存在，跑不出有意义的结果）。下文所有「预期红／绿」都是**预言**，不是实测（Rule 12）。
> 下文 `$S` ＝ `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad`。

---

## W6 现量

### W6.1 本席量过、各步依赖的事实

| # | 事实 | 位置（现测） | 测量命令 |
|---|---|---|---|
| 1 | 控制读路由都注册在 `registerControlReadRoutes`，它先调 `registerControlMutationRoutes`（只在有 `service` 时）；兜底 404 在 `app.use("/api/control", …)` | `src/panel/controlApi.ts:74-75`、`:163-171` | `cat -n src/panel/controlApi.ts` |
| 2 | `ControlReadApiDeps = {store, epoch, config, service?}`，**没有 port** | `src/panel/controlApi.ts:18-23` | 同上 |
| 3 | 面板操作者 id 在 `registerControlMutationRoutes` 里就地铸造／读取（`meta.panelOperatorId`，形如 `operator-<uuid>`），读路由拿不到 | `src/panel/controlApi.ts:175-184` | 同上 |
| 4 | 变更路由表是 `{path, verb, target}` 数组 ＋ `switch (command.verb)`；仓库作用域命令的台账键是 `@repository:<repoId>` | `src/panel/controlApi.ts:191-231`、`:239-254`、`:225-229` | 同上 |
| 5 | 装配把 `{store, epoch, config, service}` 交给 `buildApi` 的 `control`；**不传 port**；`ControlRuntime` 自己有 `port` 字段 | `src/panel/server.ts:185`、`src/panel/controlAssembly.ts:79` | `sed -n 183,187p src/panel/server.ts`；`grep -n "port: ExecutionPort" src/panel/controlAssembly.ts` |
| 6 | `ControlAssemblyInput` 已有测试专用注入口 `driverCrash`（「Never set by the CLI」）；port 在 `assembleControlRuntime` 里 `const port = choosePort(control, env);` 选一次 | `src/panel/controlAssembly.ts:102-109`、`:164` | `sed -n 100,116p`、`sed -n 160,166p src/panel/controlAssembly.ts` |
| 7 | 面板 HTTP 判据的夹具：真 Panel、`createHarness().boot(epoch, paths, {capabilities?})`；port 是就地拼的对象（`probeProfileCapabilities`／`capabilities`，T7 会改）；plan 任务行带 `configHash: "c".repeat(64)`（T10 会删） | `tests/panel/fixtures/controlPanel.ts:55-58`、`:116-122`、`:98`、`:148` | `cat -n tests/panel/fixtures/controlPanel.ts` |
| 8 | 仓库作用域的 HTTP 判据形状（读默认值 → 在自身 revision 下设 → 读回 → 过期 revision 409 `revision-conflict`） | `tests/panel/workspaceModeApi.test.ts:10-25` | `cat -n` |
| 9 | 面板 HTTP confirm 的现形状（`handoffAtContextTokens: 800_000`，`profileIds` 全 `all`）；`confirm` 不要求估算已完成 | `tests/panel/controlApi.test.ts:93-103`；`src/control/webService.ts:387-433` | `sed -n 1,120p tests/panel/controlApi.test.ts`；`sed -n 387,452p src/control/webService.ts` |
| 10 | 夹具 profile 的声明窗口 `contextWindowTokens: 1_000_000`；能力交集遇 `null` 得 `null` | `tests/control/fixtures/web.ts:16`；`src/control/profiles.ts:98-101` | `sed -n 10,22p tests/control/fixtures/web.ts`；`sed -n 96,103p src/control/profiles.ts` |
| 11 | `web/` 不能 import `src/`；Web 侧自带镜像类型，平价由 `tests/panel/webParity.test.ts` 从根侧双向编译期检查 ＋ 运行期字段集相等；Web 侧对「只加字段」用可选属性＋在 `controlGroupWebToServer` 里归一（`blockedReason`、`continuable` 先例） | `tests/panel/webParity.test.ts:57-86`、`:119-126` | `cat -n tests/panel/webParity.test.ts` |
| 12 | Web 的 `RepositoryWorkspaceV1` **没有**平价检查（`webParity` 不 import 它） | `web/src/controlTypes.ts:250`；`tests/panel/webParity.test.ts:16-55` | 同上 |
| 13 | Web 组件是纯函数、以 `renderToStaticMarkup`（node 环境）或 `@testing-library/react`＋`// @vitest-environment jsdom` 测；`App` 独占副作用 | `web/tests/workspaceMode.test.tsx:1-5`、`web/tests/handoffResume.test.tsx:1`、`web/src/App.tsx:1-19` | `cat -n`／`head -20` |
| 14 | Web 端草稿走 `control.drafts: Record<string,string>` ＋ `onDraft(key,text)`；键带 groupId 前缀 | `web/src/BudgetEditor.tsx:25-35`、`web/src/controlState.ts:27-40` | `cat -n` |
| 15 | 现有 Web 判据**没有一条**点击「Confirm budget」或断言 confirm 的 payload（只断言按钮文字存在） | `web/tests/controlPanel.test.tsx:178-184` | `grep -n -i "confirm" web/tests/*.tsx web/tests/*.ts` |
| 16 | 调 `ControlGroupView` 的现有判据：`evidenceLink`、`workspaceMode`、`handoffResume`（都只传六个 props） | `web/tests/evidenceLink.test.tsx:104-106`、`web/tests/workspaceMode.test.tsx:30-32`、`web/tests/handoffResume.test.tsx:48` | `grep -rn "ControlGroupView\b" web/src web/tests` |
| 17 | Web 的 vitest 只在 `web/` 下跑（根 `vitest.config.ts` 只 include `tests/**/*.test.ts`）；Web 用根的 `node_modules/.bin/vitest` | `vitest.config.ts:6`；`web/vite.config.ts:16` | `cat vitest.config.ts web/vite.config.ts`；`ls web/node_modules/.bin \| grep -c vitest` ⇒ 0 |
| 18 | 真 ccloop 世界：`ccloopWorlds({rootPrefix, epochPrefix}).world(tasks, script)`，fake codex 取自 `dirname(ORCA_CCLOOP_BIN)/../tests/fixtures/fake-codex.mjs`，marker 在 `<root>/codex-marker.json`，`calls()`／`scripted()` 读 `.calls`／`.tasks`；`boot(driverCrash?)` | `tests/control/fixtures/ccloopWorld.ts:60-142` | `cat -n` |
| 19 | `startGroup` 同步调 `service.confirm`、不带 `selectionsHash`（T11 必改） | `tests/control/fixtures/ccloopWorld.ts:178-196` | 同上 |
| 20 | `raw()` 的 `expectedRevision` 对非 `import-plan`／`set-workspace-mode` 一律读 `groups` 表 `g` 行 ⇒ **group 不存在时对 `set-agent-preferences` 会抛**；`actorId` 恒为 `"human"` | `tests/control/fixtures/ccloopWorld.ts:172-176` | 同上 |
| 21 | ④ 的 E2E 形状：H1（stop 在 execute 中 → parked → 按面板规则 resume → 续跑落地，`HALVES`／`HALVES_CALLS`／`HALVES_SCRIPTED`）、H2（三路并行、两次解冲突、calls `[8,8,3]`）；`inExecute` 靠 `.tasks` 里出现 `execute <id>` | `tests/control/handoffE2E.test.ts:86-101`、`:109-165`、`:198-240` | `cat -n` |
| 22 | `continue-task` 要求 group **未停**；`resume-from-handoff` 接受空 `selections`、会删 stop intent 并清 `stopped` ⇒ 「空 resume 后再 continue-task」是一条合法的独立续跑路径 | `src/control/continuation.ts:202-226`、`:229-251` | `grep -n "export function applyResumeFromHandoff" -A30`、`… applyContinueTask -A40` |
| 23 | `readStartEnvelope(store, run)` 从存储读回发出去的 envelope；ccloop 在 `<drive.sourceDir>/control/` 下落自己的记录（④ 的 G 读过 `accepted.json`） | `src/control/executionDriver.ts:159-162`；`tests/control/handoffE2E.test.ts:331` | `grep -n "export function readStartEnvelope" -A6`；`cat -n` |
| 24 | codex 的 `--model <model>` 紧跟在 `exec` 之后的参数里 | ccloop `src/runtime/codex/runCodexPhase.ts:27` | `sed -n 27,28p` |
| 25 | fake codex 今天把 `args`（`exec` 之后的部分）**覆盖写**进 marker；`script` 模式下它读 stdin 直到 EOF、**不答 `--version`** | ccloop `tests/fixtures/fake-codex.mjs:3-11` | `sed -n 1,60p` |
| 26 | `verify:control` 今天要求 `ORCA_CCLOOP_BIN` 与 `ORCA_CCLOOP_ADAPTER_CONFIG` 都在 | `scripts/verify-control.mjs:6-11` | `sed -n 1,40p` |
| 27 | Orca `verify` 链（`typecheck && test && ledger validate(容 2) && claude-md && hooks-path && verify:control && verify:scheduler && verify:chain && web build && verify:panel && --ws check`） | `package.json` scripts | `cat package.json` |
| 28 | ccloop 门：`typecheck`、`build`（`dist/` 被 gitignore）、`vitest run`、`verify:control`（`scripts/verify-control-protocol.mjs`）、`scripts/check-known-reds.mjs <json>`（13 个全名，按祖先边界比对，未知红 ⇒ RC 1） | ccloop `package.json`；`scripts/check-known-reds.mjs:38-90` | `cat package.json`；`cat -n scripts/check-known-reds.mjs` |
| 29 | 已登记 flake（handoff §三）：`controlShutdown` 的 SIGTERM 一条、`driverRecovery` 一条、`driverLanding` 两条、`handoffE2E` 的 G、`executionDriverE2E`（重负载下 R1 子场景）、`driverSettle` 真 git、Web `controlCommandRecovery` 的 "drops the id when the lookup returns the command's retained result"；判别式＝**单文件重跑绿 ⇒ 不是回归** | `docs/handoff/handoff.md:69-131` | `sed -n 53,131p docs/handoff/handoff.md` |
| 30 | 上一轮机械判定器与门脚本的完整形状（`check-handoff.py`、`gates-handoff.sh`）可直接改写 | `docs/superpowers/plans/2026-09-25-handoff-delivery.md:5360-5510` | `sed -n 5360,5512p` |
| 31 | 错误码要进 `src/control/errors.ts` 的 `durableCommandErrorStatuses` 才会被 `sendMappedControlError` 映射，否则一律 500 `control-internal-error` | `src/panel/controlErrors.ts:60-83`；`src/control/errors.ts:8`、`:83`（`control-protocol-unavailable: 422`） | `sed -n 1,84p src/panel/controlErrors.ts`；`grep -n … src/control/errors.ts` |
| 32 | `idSchema` ＝ `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`，≤200 ⇒ `"human"` 与 `operator-<uuid>` 都合法；`task:a` **不是** id（只作 map 键） | `src/control/schema.ts:3` | `grep -n "idSchema =" -A2 src/control/schema.ts` |

### W6.2 与骨架／spec 对不上、或骨架没定的（**不静默偏离；逐条给建议，控制器裁**）

| # | 问题 | 本席需要什么（计划正文按「建议」一栏写） | 谁的 Task |
|---|---|---|---|
| W6-1 | 🔴 **预览与确认必须是同一个解析函数**，骨架没给名字。预览算一遍 `selectionsHash`、confirm 再算一遍：两处实现只要差一点（去重键、槽位键、排序），就会把每次确认都拒成 `agent-selection-changed`，或放过不该放的。 | T11 导出（建议 `src/control/agentFreeze.ts`）：<br>`export interface SlotResolution { key: string; slot: "worker" \| "reconcile"; taskId: string \| null; outcome: { kind: "resolved"; frozen: FrozenSlot } \| { kind: "rejected"; code: string } }`<br>`export interface GroupSelectionResolution { proposalVersion: number; groupOverrides: GroupAgentOverrides; taskOverrides: Record<string, PartialSelection \| null>; slots: SlotResolution[] /* sorted by key */; selectionsHash: string \| null /* null iff any rejected */ }`<br>`export function resolveGroupSelections(deps: { store: ControlStore; port: Pick<ExecutionPort, "resolveAgent"> }, groupId: string, operatorId: string): Promise<GroupSelectionResolution>`<br>confirm 在事务外调它、事务内重核；T14 的预览只调它。 | T11（产）、T14（消费） |
| W6-2 | 槽位键字面量没定（`selectionsHash(slots: Record<string, FrozenSlot>)` 的键）。用裸 `taskId` 与 `"reconcile"` 会撞名（一个叫 `reconcile` 的任务）。 | 键 ＝ `task:<taskId>` 与 `reconcile`（`:` 不在 `idSchema` 字符集里，撞不了）。`agent-selection-rejected:<taskId\|slot>:<码>` 的中段仍按 spec 用 `taskId` 或 `reconcile`。 | T8／T11 |
| W6-3 | 偏好读函数没名字；无行时的默认值没定。 | `readAgentPreferences(store: ControlStore, operatorId: string): { revision: number; preferences: OperatorPreferences }`；无行 ⇒ `{ revision: 0, preferences: { perAgent: {} } }`（仿 `readWorkspaceSetting`）。 | T9 |
| W6-4 | 命令台账 `operator` scope 的键没定；面板路由要用它查回命令结果。 | 键 ＝ `@operator:<operatorId>`（仿 `@repository:<repoId>`）。 | T9 |
| W6-5 | service 方法名没定；confirm 改异步。 | `WebControlService.setAgentPreferences(command)`、`proposalSetAgent(command)`（都可 `await`）；`confirm` 变 `async`。 | T9、T10、T11 |
| W6-6 | 两个新动词的 result kind 没定。 | `set-agent-preferences` ⇒ `{ kind: "agent-preferences-set", operatorId, revision }`；`proposal-set-agent` ⇒ **复用** `{ kind: "proposal-edited", proposalVersion }`（它就是推进 `proposalVersion` 的提案编辑）。`commandSuccessSchema` 的 `projectionless` 要把 `set-agent-preferences` 算进去（`projectionSeq: null`，仿 `set-workspace-mode`）。 | T9、T10 |
| W6-7 | zod 名字骨架没列。T14 的三个视图 schema 要引用它们。 | `src/control/webProtocol.ts` 导出：`contextWindowSchema`、`agentSelectionSchema`、`partialSelectionSchema`、`provenanceSourceSchema`（**`z.enum`**，T14 的平价判据读 `.options`）、`selectionProvenanceSchema`、`operatorPreferencesSchema`、`groupAgentOverridesSchema`、`frozenSlotSchema`、`setAgentPreferencesPayloadSchema`、`proposalSetAgentPayloadSchema`；类型 `SetAgentPreferencesPayload`、`ProposalSetAgentPayload`。谁先落谁定义，只定义一次。 | T8–T11 |
| W6-8 | `set-agent-preferences` 的 payload 里有 `expectedRevision`，与命令信封自己的 `expectedRevision` 重复（台账核的是信封那一个）。两个值不等时语义未定。 | **建议删掉 payload 里的那一个**。本计划按骨架原样写（两处都带、取同一值），控制器若删，T14／T15／T16 各删一处（下文都在 `setPreferences`／`sendAgentPreferences` 里）。 | T9 |
| W6-9 | 确认后面板要显示冻结值，`WorkItemViewV1` 需要 `agent`／`agentProvenance`，且 `configHash` 确认前为 `null`。骨架把 `controlViews 以快照为权威` 归 T11。 | T11 在 `workItemViewSchema` 加 `agent: agentSelectionSchema.nullable()`、`agentProvenance: selectionProvenanceSchema.nullable()`，`configHash: hashSchema.nullable()`；T14 只做 Web 镜像（可选属性＋`webParity` 归一）。 | T11（产）、T14 |
| W6-10 | 面板读路由拿不到 port（现量 2、5）。 | T14 给 `ControlReadApiDeps` 加 `port?: Pick<ExecutionPort, "listAgents" \| "resolveAgent">`，`server.ts:185` 传 `port: control.port`。 | T14 |
| W6-11 | `resolveAgent` 失败的形状没定；预览要显示「ccloop 的错误码」。 | 端口把 ccloop 的具名拒绝抛成 `new ControlError(<ccloop 码>)`（`agent-installation-missing`／`agent-context-unsupported`／`agent-selection-invalid`／`agent-version-drift`／`agents-table-invalid`）；`resolveGroupSelections` 把 `error.code` 放进 `outcome.code`；Orca 自己的 `agent-unselected` 同样进 `code`。 | T7、T11 |
| W6-12 | 上面这些码要能被面板映射（现量 31）。 | T7 把六个 agent 码登记进 `durableCommandErrorStatuses`，状态 422（仿 `control-protocol-unavailable`）；`agent-selection-changed` 由 T11 登记（建议 409）。 | T7、T11 |
| W6-13 | 🔴 **fake codex 不答 `--version`**（现量 25）。表里任何 codex 行在 accept／capabilities 的版本核对下都会 `agent-version-drift`（或挂 10 s 超时）——混组 E2E 与 `ccloopWorld` 都造不出来。 | T3：fake codex 在 argv 含 `--version` 时（先于读 stdin）打印一行版本串并退 0，**不**写 `.calls`／`.tasks`／`.argv`。fake claude CLI 同。 | T3 |
| W6-14 | 表里的 `version` 要等于 ccloop `probeVersion` 的结果，但 `probeVersion` 取整行还是正则取段没定；E2E 要自己写表。 | 建议 `probeVersion` ＝ 对 `command --version` 的 stdout 取第一个 `/\d+\.\d+\.\d+(-[\w.]+)?/` 匹配（cc-switch 同款，spec §1.7），无匹配 ⇒ `null`。T16 按这个规则算表里的 `version`；T1 若定成别的，T16 的 `versionOf` 跟着改一行。 | T1、T16 |
| W6-15 | `ccloopWorld` 在 T7 之后的形状本席看不到。 | T16 假定 T7 之后：`world()` 在 `<root>/agents.json`（0600）写一张含 `codex` 行（fake codex，`script <marker> <scriptPath>`）的表，赋给变量 `table`，env 用 `ORCA_AGENTS_TABLE`；plan 任务行不再有 `configHash`。T16 Step 1 在其上**只加**：`claude` 行、任务 `agent`、`argv()`、`boot` 的 `wrapPort`。T7 若另起了名字，T16 Step 1 跟着 T7 的名字改锚点，不改语义。 | T7、T16 |
| W6-16 | confirm 读**哪个操作者**的偏好没定。面板里 `actorId` ＝ `panelOperatorId`；服务层判据里 `raw()` 的 `actorId` 是 `"human"`。 | confirm（与 `resolveGroupSelections`）读 `command.actorId` 那位操作者的偏好。 | T11 |
| W6-17 | T4 改停机证明后，`check-known-reds` 名单里的 `stopProof` 那条稳定红可能转绿或改名。 | 名单只作「失败 ⊆ 名单」，转绿不影响；**改名**会让它变成未知红 ⇒ T4 若改了那条的 describe／it 文字，同一笔提交里同步改名单（ccloop 自己的规则：名单改动要在 progress 里记）。 | T4、T17 |
| W6-18 | `verify-control.mjs` 仍要 `ORCA_CCLOOP_ADAPTER_CONFIG`（现量 26）；`web/src/ControlPanel.tsx:102` 的未配置提示仍写 `ORCA_CCLOOP_ADAPTER_CONFIG`。 | 都在 spec §5.1 的 T7 清单里；T17 的 env 只导出 `ORCA_CCLOOP_BIN` 与 `ORCA_AGENTS_TABLE`。T15 不碰那行提示。 | T7 |
| W6-19 | 面板夹具（现量 7）的 port 桩、plan 的 `configHash`、`WebControlService` 的 deps（异步 confirm 要 port）都会先被 T7／T10／T11 改。 | T14 Step 1 在它们之上**只加** `BootOptions.agents`／`resolveAgent`、`listAgents`／`resolveAgent` 两个方法、`control.port`；并要求 T11 让 service 的 deps 用**同一个** `port` 对象。 | T7、T10、T11、T14 |
| W6-20 | `proposal-set-agent` 清除的是「面板那一层」，但 `GroupAgentOverrides` 是「面板与 plan 顶层合并后」的组层（骨架）——预览里看不出哪部分来自 plan。 | 本轮不拆（UI 的「Clear」只标「清掉面板覆盖」）；登记给 T10：如要在面板上区分 plan 值与面板值，另加字段。 | T10（登记） |

### W6.3 本席四个 Task 会打红的既有判据

- **T14**：`tests/panel/webParity.test.ts` 的编译期半边函数 `controlGroupWebToServer`（不是 `it`，但它是该文件判据的一半）—— 改写，见 T14 Step 6。**不放宽**：Web 侧新加的两个可选字段在这里归一成 `null` 后仍双向检查。
- **T15**：无。新 props 全部可选（现量 16 的三个文件零改动，D7 零改写原则）；现有判据不点 Confirm（现量 15）。
- **T16**：无（新文件；`ccloopWorld.ts` 只加）。
- **T17**：无（不改判据）。
- ⚠️ 别的 Task 会打红、但 T14／T15 的判据**依赖它们先改好**的：`tests/panel/controlApi.test.ts` 里 confirm 的 payload 缺 `selectionsHash`（T11）；`tests/panel/fixtures/controlPanel.ts:98` 的 `configHash`（T10）；`:116-122` 的 port 桩（T7）。

---
