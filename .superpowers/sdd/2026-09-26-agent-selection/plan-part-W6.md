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

## Task 14：面板 API —— agents 视图、操作者偏好读写、提案的逐槽解析预览、`proposal-set-agent`

**依赖**：T7（`listAgents`／`resolveAgent`、agent 错误码登记）、T8（`selectionsHash`、类型）、T9（偏好表、`readAgentPreferences`、`set-agent-preferences`、`@operator:` 键）、T10（`proposal-set-agent`）、T11（`resolveGroupSelections`、异步 confirm、`workItemViewSchema` 的 agent 字段）。开工前逐项核（Step 0）。

**Files:**
- Modify: `src/control/webProtocol.ts`（文件尾，现 `:1219-1223` 的 `repositoryWorkspaceSchema` 之后）—— 三个视图 schema ＋ 类型
- Modify: `src/panel/controlViews.ts`（import 区 `:1-35`；文件尾 `:712` 之后）—— `readSelectionPreview`
- Modify: `src/panel/controlApi.ts`（`:1-16` import、`:18-23` deps、`:124-131` 之后加读路由、`:175-184` 抽函数、`:191-231` 路由表、`:239-254` switch）
- Modify: `src/panel/server.ts:185`
- Modify: `tests/panel/fixtures/controlPanel.ts`（`:55-58` BootOptions、`:116-122` port 桩、`:148` control deps；文件尾加两个导出）
- Modify: `tests/panel/webParity.test.ts`（import 区、`:71-86` 加一条 `it`、`:124-126` 改写、文件尾检查表）
- Modify: `web/src/controlTypes.ts`（W6-9 的 Web 镜像与全部新类型；T15 用）
- Test（新）: `tests/panel/agentSelectionApi.test.ts` —— **7 条**

**Interfaces:**
- Consumes：`ExecutionPort.listAgents(): Promise<AgentsView>`、`ExecutionPort.resolveAgent(partial)`、`AgentsView`（T7，`src/control/executionPort.ts`）；`selectionsHash`、`PartialSelection`、`AgentResolution`、`FrozenSlot`、`GroupAgentOverrides`、`OperatorPreferences`（T8，`src/control/agentSelection.ts`）；`readAgentPreferences`（W6-3）；`resolveGroupSelections`（W6-1）；W6-7 的 zod 名；`service.setAgentPreferences`／`proposalSetAgent`（W6-5）。
- Produces：HTTP `GET /api/control/agents` ⇒ `AgentsViewV1`；`GET /api/control/operator/agent-preferences` ⇒ `AgentPreferencesViewV1`；`POST /api/control/operator/agent-preferences`（动词 `set-agent-preferences`）；`GET /api/control/groups/:groupId/agent-preview` ⇒ `AgentSelectionPreviewV1`；`POST /api/control/groups/:groupId/proposal/agent`（动词 `proposal-set-agent`）。`webProtocol.ts`：`agentsViewSchema`、`agentPreferencesViewSchema`、`agentSelectionPreviewSchema` 及同名 `…V1` 类型。`controlViews.ts`：`readSelectionPreview(store, port, operatorId, groupId)`。`controlApi.ts`：`ensurePanelOperatorId(store)`。

- [ ] **Step 0：核依赖都在（按内容，不按提交号）**

```bash
cd /Users/biran/code/skills/loop/Orca
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad
python3 - > "$S/t14-deps.log" 2>&1 <<'EOF'
import re
read = lambda p: open(p).read()
port = read("src/control/executionPort.ts"); sel = read("src/control/agentSelection.ts"); wp = read("src/control/webProtocol.ts")
svc = read("src/control/webService.ts")
checks = {
  "listAgents": "listAgents(" in port, "resolveAgent": "resolveAgent(" in port, "AgentsView": "AgentsView" in port,
  "selectionsHash": "export function selectionsHash" in sel,
  "resolveGroupSelections": any("export async function resolveGroupSelections" in read(f"src/control/{n}") for n in __import__("os").listdir("src/control") if n.endswith(".ts")),
  "readAgentPreferences": any("export function readAgentPreferences" in read(f"src/control/{n}") for n in __import__("os").listdir("src/control") if n.endswith(".ts")),
  "zod-names": all(f"export const {n}" in wp for n in ["contextWindowSchema","partialSelectionSchema","provenanceSourceSchema","operatorPreferencesSchema","groupAgentOverridesSchema","frozenSlotSchema"]),
  "verbs": '"set-agent-preferences"' in wp and '"proposal-set-agent"' in wp,
  "service": "setAgentPreferences(" in svc and "proposalSetAgent(" in svc and "async confirm(" in svc,
  "workItem-agent": re.search(r"workItemViewSchema[\s\S]{0,800}agentProvenance", wp) is not None,
}
for k, v in checks.items(): print(k, v)
EOF
echo "RC=$?" >> "$S/t14-deps.log"; cat "$S/t14-deps.log"
```

Expected：每行 `True`，RC 0。任何 `False` ⇒ **停下报控制器**（W6-1／3／5／7／9 未落），不许在本 Task 里补别人的产物。

- [ ] **Step 1：夹具只加（`tests/panel/fixtures/controlPanel.ts`）**

在 import 区（现 `:15-30`，T7／T11 之后行号会变）加：

```ts
import { ControlError } from "../../../src/control/errors.js";
import type { AgentResolution, PartialSelection } from "../../../src/control/agentSelection.js";
import type { AgentsView } from "../../../src/control/executionPort.js";
```

`BootOptions`（现 `:55-58`）在 `capabilities?` 之后加：

```ts
  /** Agent selection spec §6.8 (T14): the installation table view the port answers; DEFAULT_AGENTS when absent. */
  agents?: AgentsView;
  /** What the port answers for one partial selection; fixtureResolveAgent when absent. */
  resolveAgent?: (partial: PartialSelection) => Promise<AgentResolution>;
```

port 桩对象（现 `:116-122`，T7 会改成它自己的形状）里，**在 T7 留下的方法之后**加两行：

```ts
        listAgents: async () => options.agents ?? DEFAULT_AGENTS,
        resolveAgent: options.resolveAgent ?? fixtureResolveAgent,
```

`buildApi` 的 `control`（现 `:148`）改为：

```ts
        control: { store, epoch, config: trustedConfig, service, port },
```

（`port` 就是上面那个对象；W6-19：T11 必须让 `WebControlService` 的 deps 拿**同一个** `port`。）

文件尾加：

```ts
/** Two installations, sorted by id -- the shape ccloop's capabilities v3 answers with `{agent: null}`. */
export const DEFAULT_AGENTS: AgentsView = {
  installations: [
    { id: "claude", kind: "claude", defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1_000_000], version: "2.1.282" },
    { id: "codex", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "0.155.1" },
  ],
};

/**
 * A stand-in for ccloop's capabilities v3 with a selection, reduced to what the panel can observe: an unknown
 * installation and a context the kind cannot express are refused by their ccloop codes, missing fields are
 * filled from the installation's defaults, and a field the request gave is echoed as given (spec §4.6, M5).
 * The capabilities are the fixture profile's declared ones -- the ccloop rule for `contextWindowTokens` is
 * ccloop's to test, not the panel's.
 */
export async function fixtureResolveAgent(partial: PartialSelection): Promise<AgentResolution> {
  const installation = DEFAULT_AGENTS.installations.find((row) => row.id === partial.agent);
  if (!installation) throw new ControlError("agent-installation-missing");
  const selection = {
    agent: installation.id,
    model: partial.model ?? installation.defaults.model,
    contextWindow: partial.contextWindow ?? installation.defaults.contextWindow,
  };
  if (!installation.contextOptions.includes(selection.contextWindow)) throw new ControlError("agent-context-unsupported");
  return {
    selection,
    configHash: sha256Canonical({ kind: installation.kind, selection }),
    timeoutMs: 120_000,
    killGraceMs: 5_000,
    capabilities: { ...profileSnapshot().profile.capabilities },
  };
}
```

- [ ] **Step 2：写失败判据 `tests/panel/agentSelectionApi.test.ts`（7 条）**

```ts
/**
 * Agent selection spec §6.8 (T14): the three reads and two commands the panel's agent UI stands on, over a
 * real Panel. The preview is the confirm's own resolution (W6-1), so the pair that matters most is "a confirm
 * carrying the preview's selectionsHash is accepted" / "one the preferences have moved under is refused" -- a
 * preview computed a second way would fail one of the two.
 */
import { afterAll, describe, expect, it } from "vitest";
import { selectionsHash } from "../../src/control/agentSelection.js";
import {
  agentPreferencesViewSchema,
  agentSelectionPreviewSchema,
  agentsViewSchema,
  commandSuccessSchema,
  controlConfigSchema,
} from "../../src/control/webProtocol.js";
import { DEFAULT_AGENTS, GROUP, command, createHarness, get, json, revision, view, type Panel } from "./fixtures/controlPanel.js";

const h = createHarness();
afterAll(async () => { await h.dispose(); });

const PREFS = "/api/control/operator/agent-preferences";

async function preview(panel: Panel) {
  const response = await get(panel, `/api/control/groups/${GROUP}/agent-preview`);
  const body = await json(response);
  if (!response.ok) throw new Error(`preview refused (${response.status}): ${JSON.stringify(body)}`);
  return agentSelectionPreviewSchema.parse(body);
}

async function setPreferences(panel: Panel, commandId: string, preferences: Record<string, unknown>) {
  const current = agentPreferencesViewSchema.parse(await json(await get(panel, PREFS)));
  return command(panel, PREFS, { commandId, expectedRevision: current.revision, payload: { expectedRevision: current.revision, preferences } });
}

async function importPlan(panel: Panel): Promise<void> {
  const imported = await command(panel, "/api/control/groups/import-plan", {
    commandId: "agents-import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" },
  });
  expect(imported.status).toBe(201);
}

async function confirm(panel: Panel, commandId: string, hash: string) {
  const config = controlConfigSchema.parse(await json(await get(panel, "/api/control/config")));
  const current = await view(panel);
  const profileHash = config.profiles[0]!.profileHash;
  return command(panel, `/api/control/groups/${GROUP}/confirm`, {
    commandId, expectedRevision: current.summary.commandRevision,
    payload: {
      planHash: current.plan.planHash, proposalVersion: current.proposal.proposalVersion, budgetMode: "soft",
      profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
      profileHashes: { estimator: profileHash, worker: profileHash, handoff: profileHash, goalReview: profileHash },
      contextPolicy: { handoffAtContextTokens: 800_000 }, selectionsHash: hash,
    },
  });
}

const resolvedFrozen = (slots: Array<{ key: string; outcome: { kind: string } }>) =>
  Object.fromEntries(slots.map((slot) => [slot.key, (slot.outcome as { kind: "resolved"; frozen: never }).frozen]));

describe("agent selection over a real panel (agent selection spec §6.8)", () => {
  it("serves the installation table view from the port, sorted by id, and only with the panel token", async () => {
    const panel = await h.boot("epoch-agents-view", await h.workspace(), { agents: { installations: [...DEFAULT_AGENTS.installations].reverse() } });
    const answer = agentsViewSchema.parse(await json(await get(panel, "/api/control/agents")));
    expect(answer).toEqual({ schema: "orca-agents-view-v1", installations: DEFAULT_AGENTS.installations });
    expect((await get(panel, "/api/control/agents", "")).status).toBe(401);
    await panel.close();
  });

  it("reads the operator's preferences at revision 0, sets them under that revision, reads them back, and refuses a stale revision by name", async () => {
    const panel = await h.boot("epoch-agents-prefs", await h.workspace());
    const initial = agentPreferencesViewSchema.parse(await json(await get(panel, PREFS)));
    expect(initial).toMatchObject({ schema: "orca-agent-preferences-v1", revision: 0, preferences: { perAgent: {} } });
    expect(initial.operatorId).toMatch(/^operator-[0-9a-f-]{36}$/);
    const preferences = { defaultAgent: "claude", perAgent: { claude: { contextWindow: 1_000_000 } }, reconcile: { agent: "codex" } };
    const set = await command(panel, PREFS, { commandId: "prefs-1", expectedRevision: 0, payload: { expectedRevision: 0, preferences } });
    expect(set.status).toBe(200);
    expect(commandSuccessSchema.parse(set.body)).toMatchObject({
      verb: "set-agent-preferences", actorId: initial.operatorId, target: { kind: "operator", operatorId: initial.operatorId },
      projectionSeq: null, result: { kind: "agent-preferences-set", operatorId: initial.operatorId, revision: 1 },
    });
    expect(agentPreferencesViewSchema.parse(await json(await get(panel, PREFS)))).toEqual({ ...initial, revision: 1, preferences });
    const stale = await command(panel, PREFS, { commandId: "prefs-2", expectedRevision: 0, payload: { expectedRevision: 0, preferences: { perAgent: {} } } });
    expect(stale.status).toBe(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe("revision-conflict");
    await panel.close();
  });

  it("previews every task's worker slot and the reconcile slot with the layer each field came from, and a confirm carrying that selectionsHash is accepted", async () => {
    const panel = await h.boot("epoch-agents-preview", await h.workspace());
    expect((await setPreferences(panel, "prefs-a", { defaultAgent: "claude", perAgent: {} })).status).toBe(200);
    await importPlan(panel);
    const answer = await preview(panel);
    const claude = { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" };
    expect(answer.slots.map((slot) => [slot.key, slot.slot, slot.taskId])).toEqual([["reconcile", "reconcile", null], ["task:a", "worker", "a"]]);
    for (const slot of answer.slots) {
      expect(slot.outcome).toMatchObject({
        kind: "resolved",
        frozen: { selection: claude, partial: { agent: "claude" }, provenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" } },
      });
    }
    expect(answer.proposalVersion).toBe((await view(panel)).proposal.proposalVersion);
    expect(answer.selectionsHash).toBe(selectionsHash(resolvedFrozen(answer.slots)));
    const confirmed = await confirm(panel, "agents-confirm", answer.selectionsHash!);
    expect(confirmed.status).toBe(200);
    expect(commandSuccessSchema.parse(confirmed.body).result).toMatchObject({ kind: "confirmed" });
    await panel.close();
  });

  it("names a slot it cannot resolve by its code and answers no selectionsHash -- before any default agent, and for a context the agent cannot express", async () => {
    const panel = await h.boot("epoch-agents-rejected", await h.workspace());
    await importPlan(panel);
    const unselected = await preview(panel);
    expect(unselected.slots.map((slot) => slot.outcome)).toEqual([
      { kind: "rejected", code: "agent-unselected" }, { kind: "rejected", code: "agent-unselected" },
    ]);
    expect(unselected.selectionsHash).toBeNull();
    expect((await setPreferences(panel, "prefs-r", { defaultAgent: "codex", perAgent: { codex: { contextWindow: 1_000_000 } } })).status).toBe(200);
    const unsupported = await preview(panel);
    expect(unsupported.slots.map((slot) => slot.outcome)).toEqual([
      { kind: "rejected", code: "agent-context-unsupported" }, { kind: "rejected", code: "agent-context-unsupported" },
    ]);
    expect(unsupported.selectionsHash).toBeNull();
    await panel.close();
  });

  it("a proposal-set-agent on one task moves proposalVersion, and that task alone now takes its agent from the task layer", async () => {
    const panel = await h.boot("epoch-agents-task", await h.workspace());
    expect((await setPreferences(panel, "prefs-t", { defaultAgent: "claude", perAgent: {} })).status).toBe(200);
    await importPlan(panel);
    const before = await view(panel);
    expect((await preview(panel)).taskOverrides).toEqual({ a: null });
    const set = await command(panel, `/api/control/groups/${GROUP}/proposal/agent`, {
      commandId: "agent-task-a", expectedRevision: await revision(panel),
      payload: { baseProposalVersion: before.proposal.proposalVersion, scope: { kind: "task", taskId: "a" }, partial: { agent: "codex" } },
    });
    expect(set.status).toBe(200);
    expect(commandSuccessSchema.parse(set.body)).toMatchObject({
      verb: "proposal-set-agent", result: { kind: "proposal-edited", proposalVersion: before.proposal.proposalVersion + 1 },
    });
    const after = await preview(panel);
    expect(after.proposalVersion).toBe(before.proposal.proposalVersion + 1);
    expect(after.taskOverrides).toEqual({ a: { agent: "codex" } });
    expect(after.slots.find((slot) => slot.key === "task:a")!.outcome).toMatchObject({
      kind: "resolved", frozen: { selection: { agent: "codex", model: "gpt-6-sol" }, provenance: { agent: "task", model: "descriptor" } },
    });
    expect(after.slots.find((slot) => slot.key === "reconcile")!.outcome).toMatchObject({
      kind: "resolved", frozen: { selection: { agent: "claude" }, provenance: { agent: "operator" } },
    });
    await panel.close();
  });

  it("refuses a confirm whose selectionsHash the operator's preferences have moved under since the preview, and accepts the new preview's", async () => {
    const panel = await h.boot("epoch-agents-changed", await h.workspace());
    expect((await setPreferences(panel, "prefs-c1", { defaultAgent: "claude", perAgent: {} })).status).toBe(200);
    await importPlan(panel);
    const seen = await preview(panel);
    // Preferences do not move proposalVersion (spec §6.4 step 3): only the hash can tell the confirm they moved.
    expect((await setPreferences(panel, "prefs-c2", { defaultAgent: "claude", perAgent: { claude: { model: "claude-fable-5" } } })).status).toBe(200);
    const fresh = await preview(panel);
    expect(fresh.proposalVersion).toBe(seen.proposalVersion);
    expect(fresh.selectionsHash).not.toBe(seen.selectionsHash);
    const stale = await confirm(panel, "agents-confirm-stale", seen.selectionsHash!);
    // W6-12: the status is T11's registration (409 suggested); the code is the spec's (§7).
    expect(stale.status).toBe(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe("agent-selection-changed");
    const accepted = await confirm(panel, "agents-confirm-fresh", fresh.selectionsHash!);
    expect(accepted.status).toBe(200);
    await panel.close();
  });

  it("the preview schema refuses a selectionsHash beside a rejected slot, and a slot key that does not name its task", () => {
    const rejected = {
      schema: "orca-agent-selection-preview-v1", groupId: "g", proposalVersion: 1, groupOverrides: {}, taskOverrides: { a: null },
      slots: [{ key: "task:a", slot: "worker", taskId: "a", outcome: { kind: "rejected", code: "agent-unselected" } }], selectionsHash: null,
    };
    // The unmutated document passes, so each refusal below is the property's own.
    expect(agentSelectionPreviewSchema.safeParse(rejected).success).toBe(true);
    expect(agentSelectionPreviewSchema.safeParse({ ...rejected, selectionsHash: "a".repeat(64) }).success).toBe(false);
    expect(agentSelectionPreviewSchema.safeParse({ ...rejected, slots: [{ ...rejected.slots[0], key: "task:b" }] }).success).toBe(false);
  });
});
```

- [ ] **Step 3：跑，看它红**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/panel/agentSelectionApi.test.ts > "$S/t14-red.log" 2>&1; echo "rc=$?" >> "$S/t14-red.log"; cat "$S/t14-red.log"
```

Expected：`rc=1`；收集期就失败：`agentsViewSchema`／`agentPreferencesViewSchema`／`agentSelectionPreviewSchema` 不是 `webProtocol.ts` 的导出（`SyntaxError: … does not provide an export named …` 或 7 条全部 `TypeError: Cannot read properties of undefined (reading 'parse')`）。**若任何一条是绿的** ⇒ 停下，该条在 RED 阶段就绿，照 Global Constraints 先在副本里打删分支变异看见红再继续。

- [ ] **Step 4：`src/control/webProtocol.ts` 文件尾加三个视图 schema**

锚点：文件最后两行

```ts
export type RepositoryWorkspaceV1 = z.infer<typeof repositoryWorkspaceSchema>;
export type SetWorkspaceModePayload = z.infer<typeof setWorkspaceModePayloadSchema>;
```

之后追加：

```ts

// Agent selection spec §6.8 (T14): the three reads the panel's agent UI is built on. The component schemas
// (contextWindowSchema, partialSelectionSchema, operatorPreferencesSchema, groupAgentOverridesSchema,
// frozenSlotSchema) are T8-T11's; these only compose them into what one GET answers.
export const agentsViewSchema = z
  .object({
    schema: z.literal("orca-agents-view-v1"),
    installations: z.array(
      z
        .object({
          id: idSchema,
          kind: nonemptyString,
          defaults: z.object({ model: nonemptyString, contextWindow: contextWindowSchema }).strict(),
          contextOptions: z.array(contextWindowSchema).min(1),
          version: nonemptyString,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => requireSortedUnique(value.installations, (entry) => entry.id, ctx, ["installations"]));

export const agentPreferencesViewSchema = z
  .object({ schema: z.literal("orca-agent-preferences-v1"), operatorId: nonemptyString, revision: safeInteger, preferences: operatorPreferencesSchema })
  .strict();

const slotOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resolved"), frozen: frozenSlotSchema }).strict(),
  z.object({ kind: z.literal("rejected"), code: nonemptyString }).strict(),
]);

/**
 * W6-1/W6-2: the confirm's own resolution, as the panel shows it. A slot's key is `task:<taskId>` or
 * `reconcile`; the hash exists exactly when every slot resolved, because a confirm can only bind to a
 * resolution it could freeze whole (spec §6.4 step 2).
 */
export const agentSelectionPreviewSchema = z
  .object({
    schema: z.literal("orca-agent-selection-preview-v1"),
    groupId: idSchema,
    proposalVersion: positiveSafeInteger,
    groupOverrides: groupAgentOverridesSchema,
    taskOverrides: z.record(idSchema, partialSelectionSchema.nullable()),
    slots: z.array(
      z.object({ key: nonemptyString, slot: z.enum(["worker", "reconcile"]), taskId: idSchema.nullable(), outcome: slotOutcomeSchema }).strict(),
    ),
    selectionsHash: hashSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireSortedUnique(value.slots, (entry) => entry.key, ctx, ["slots"]);
    value.slots.forEach((entry, index) => {
      if ((entry.slot === "worker") !== (entry.taskId !== null)) issue(ctx, ["slots", index, "taskId"], "slot-task-mismatch");
      if (entry.key !== (entry.taskId === null ? "reconcile" : `task:${entry.taskId}`)) issue(ctx, ["slots", index, "key"], "slot-key-mismatch");
    });
    const rejected = value.slots.some((entry) => entry.outcome.kind === "rejected");
    if (rejected !== (value.selectionsHash === null)) issue(ctx, ["selectionsHash"], "selections-hash-rejection-mismatch");
  });

export type AgentsViewV1 = z.infer<typeof agentsViewSchema>;
export type AgentPreferencesViewV1 = z.infer<typeof agentPreferencesViewSchema>;
export type AgentSelectionPreviewV1 = z.infer<typeof agentSelectionPreviewSchema>;
```

（`contextWindowSchema` 等若是在本文件更**后面**定义的，把这一段挪到它们之后——`const` 的暂时性死区会在模块加载时抛 `ReferenceError`。）

- [ ] **Step 5：`src/panel/controlViews.ts` 加 `readSelectionPreview`**

import 区：把 `:14-35` 的 `from "../control/webProtocol.js"` 那一组里加 `agentSelectionPreviewSchema,` 与 `type AgentSelectionPreviewV1,`；并在 `:13` 之后加：

```ts
import { resolveGroupSelections } from "../control/agentFreeze.js";
import type { ExecutionPort } from "../control/executionPort.js";
```

（`agentFreeze.js` 是 W6-1 建议的文件名；T11 若放在别处，改这一行。）

文件尾（现 `:712` 的 `}` 之后）追加：

```ts

/**
 * Agent selection spec §6.8 (T14): the preview the panel binds its confirm to. It is the confirm's own
 * resolution (W6-1), not a second implementation -- a hash computed two ways would refuse every confirm as
 * agent-selection-changed, or accept one it should not.
 */
export async function readSelectionPreview(
  store: ControlStore,
  port: Pick<ExecutionPort, "resolveAgent">,
  operatorId: string,
  groupId: string,
): Promise<AgentSelectionPreviewV1> {
  groupBody(store, groupId);
  const resolved = await resolveGroupSelections({ store, port }, groupId, operatorId);
  const parsed = agentSelectionPreviewSchema.safeParse({ schema: "orca-agent-selection-preview-v1", groupId, ...resolved });
  if (!parsed.success) return blocked(`agent-preview:${parsed.error.issues[0]?.path.join(".")}:${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
```

- [ ] **Step 6：`src/panel/controlApi.ts`**

(a) import：`:10` 的那一行 `from "../control/webProtocol.js"` 里加 `agentPreferencesViewSchema, agentsViewSchema,`；`:16` 改为

```ts
import { readControlGroup, readControlRecovery, readControlSummary, readRunEvidence, readSelectionPreview } from "./controlViews.js";
```

并在 `:11` 之后加：

```ts
import { readAgentPreferences } from "../control/agentPreferences.js";
import type { ExecutionPort } from "../control/executionPort.js";
```

（`agentPreferences.js` 按 T9 的实际文件名改。）

(b) deps（`:18-23`）改为：

```ts
export interface ControlReadApiDeps {
  store: ControlStore;
  epoch: string;
  config: Pick<TrustedControlConfig, "readView">;
  service?: WebControlService;
  /** Agent selection spec §6.8 (W6-10): the reads that ask ccloop about agents. Absent, those routes 404. */
  port?: Pick<ExecutionPort, "listAgents" | "resolveAgent">;
}
```

(c) 把 `:175-184` 的就地铸造抽成导出函数（放在 `registerControlReadRoutes` 之前）：

```ts
/** The one operator this panel acts as (meta.panelOperatorId): minted on first use, then read. */
export function ensurePanelOperatorId(store: ControlStore): string {
  return store.transaction(() => {
    const prior = store.db.prepare("SELECT value FROM meta WHERE key='panelOperatorId'").get();
    if (prior) {
      if (!/^operator-[0-9a-f-]{36}$/.test(String(prior.value))) throw new ControlError("recovery-blocked");
      return String(prior.value);
    }
    const value = `operator-${randomUUID()}`;
    store.db.prepare("INSERT INTO meta(key,value) VALUES ('panelOperatorId',?)").run(value);
    return value;
  });
}
```

`registerControlMutationRoutes` 里原 `:175-184` 整块替换为：

```ts
  const actorId = ensurePanelOperatorId(store);
```

(d) 读路由：在 `repositories/:repoId/workspace` 那条（`:124-131`）之后、`runs/:runId/evidence`（`:133`）之前插入：

```ts
  // Agent selection spec §6.8 (T14). Only a panel that can command can preview a confirm, so these need the
  // service as well as the port; the operator is the one the mutation routes act as.
  if (deps.service && deps.port) {
    const port = deps.port;
    const operatorId = ensurePanelOperatorId(deps.store);
    app.get("/api/control/agents", asyncRoute(async (_req, res) => {
      try {
        const view = await port.listAgents();
        const installations = [...view.installations].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
        res.json(agentsViewSchema.parse({ schema: "orca-agents-view-v1", installations }));
      } catch (error) { sendMappedControlError(res, error); }
    }));
    app.get("/api/control/operator/agent-preferences", (_req, res) => {
      try {
        res.json(agentPreferencesViewSchema.parse({ schema: "orca-agent-preferences-v1", operatorId, ...readAgentPreferences(deps.store, operatorId) }));
      } catch (error) { sendMappedControlError(res, error); }
    });
    app.get("/api/control/groups/:groupId/agent-preview", asyncRoute(async (req, res) => {
      const groupId = String(req.params.groupId);
      try { res.json(await readSelectionPreview(deps.store, port, operatorId, groupId)); }
      catch (error) {
        if (error instanceof ControlError && error.code === "group-not-found") {
          sendControlError(res, 404, error.code, "No control group was found.");
          return;
        }
        sendMappedControlError(res, error, readErrorContext(deps.store, groupId));
      }
    }));
  }
```

(e) 变更路由表（`:191-231`）在 `set-workspace-mode` 那一项之后、`];` 之前加两项：

```ts
    {
      path: "/api/control/operator/agent-preferences",
      verb: "set-agent-preferences",
      // W6-4: the ledger key is the operator scope's, so the retained result is looked up under it.
      target: () => ({ groupId: `@operator:${actorId}`, target: { kind: "operator", operatorId: actorId } }),
    },
    { path: "/api/control/groups/:groupId/proposal/agent", verb: "proposal-set-agent", target: fromParams },
```

(f) switch（`:239-254`）在 `case "set-workspace-mode"` 之后加：

```ts
        case "set-agent-preferences": await service.setAgentPreferences(command); break;
        case "proposal-set-agent": await service.proposalSetAgent(command); break;
```

(g) `src/panel/server.ts:185` 改为：

```ts
    ...(control === null ? {} : { control: { store: control.store, epoch, config: control.config, service: control.service, port: control.port } }),
```

- [ ] **Step 7：跑到绿**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/panel/agentSelectionApi.test.ts > "$S/t14-green.log" 2>&1; echo "rc=$?" >> "$S/t14-green.log"; cat "$S/t14-green.log"
npm run typecheck > "$S/t14-typecheck.log" 2>&1; echo "rc=$?" >> "$S/t14-typecheck.log"; cat "$S/t14-typecheck.log"
```

Expected：`7 passed`、`rc=0`；typecheck `rc=0`。

- [ ] **Step 8：Web 镜像（`web/src/controlTypes.ts`）＋ 平价判据**

`web/src/controlTypes.ts`：

锚点 `WorkItemViewV1`（现 `:74-85`）里 `configHash: string;` 改为 `configHash: string | null;`，并在 `lineageRunIds: string[];` 之后加：

```ts
  /** Agent selection spec §6.4 (W6-9): what confirm froze. Optional here only so the literal fixtures of older criteria need no edit. */
  agent?: AgentSelectionV1 | null;
  agentProvenance?: SelectionProvenanceV1 | null;
```

`ConfirmPayloadV1`（现 `:201-208`）在 `contextPolicy` 之后加 `selectionsHash: string;`。

`CommandTargetV1`（现 `:180-185`）加一支 `| { kind: "operator"; operatorId: string }`。

`CommandSuccessV1.verb`（现 `:228`）加 `| "set-agent-preferences" | "proposal-set-agent"`；`result` 联合（现 `:234-247`）加一支 `| { kind: "agent-preferences-set"; operatorId: string; revision: number }`。

文件尾追加：

```ts

// Agent selection spec §6.8 (T14): mirrors of src/control/webProtocol.ts, checked both ways in tests/panel/webParity.test.ts.
export type ContextWindowV1 = "agent-default" | number;
export type AgentSelectionV1 = { agent: string; model: string; contextWindow: ContextWindowV1 };
export type PartialSelectionV1 = { agent?: string; model?: string; contextWindow?: ContextWindowV1 };
export type ProvenanceSourceV1 =
  | "operator" | "operator-estimator" | "operator-reconcile" | "group" | "group-estimator" | "group-reconcile" | "task"
  | "operator-agent" | "descriptor";
export const WEB_PROVENANCE_SOURCES: readonly ProvenanceSourceV1[] = [
  "operator", "operator-estimator", "operator-reconcile", "group", "group-estimator", "group-reconcile", "task", "operator-agent", "descriptor",
];
export type SelectionProvenanceV1 = { agent: ProvenanceSourceV1; model: ProvenanceSourceV1; contextWindow: ProvenanceSourceV1 };
export type AgentSlotV1 = "worker" | "estimator" | "reconcile";
export type GroupAgentOverridesV1 = { worker?: PartialSelectionV1; estimator?: PartialSelectionV1; reconcile?: PartialSelectionV1 };
export type OperatorPreferencesV1 = {
  defaultAgent?: string;
  perAgent: Record<string, { model?: string; contextWindow?: ContextWindowV1 }>;
  estimator?: PartialSelectionV1;
  reconcile?: PartialSelectionV1;
};
export type AgentInstallationV1 = { id: string; kind: string; defaults: { model: string; contextWindow: ContextWindowV1 }; contextOptions: ContextWindowV1[]; version: string };
export type AgentsViewV1 = { schema: "orca-agents-view-v1"; installations: AgentInstallationV1[] };
export type AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1"; operatorId: string; revision: number; preferences: OperatorPreferencesV1 };
export type FrozenSlotV1 = {
  selection: AgentSelectionV1; configHash: string; timeoutMs: number; killGraceMs: number; capabilities: CapabilityViewV1;
  partial: PartialSelectionV1; provenance: SelectionProvenanceV1;
};
export type SlotOutcomeV1 = { kind: "resolved"; frozen: FrozenSlotV1 } | { kind: "rejected"; code: string };
export type AgentSelectionPreviewV1 = {
  schema: "orca-agent-selection-preview-v1";
  groupId: string;
  proposalVersion: number;
  groupOverrides: GroupAgentOverridesV1;
  taskOverrides: Record<string, PartialSelectionV1 | null>;
  slots: Array<{ key: string; slot: "worker" | "reconcile"; taskId: string | null; outcome: SlotOutcomeV1 }>;
  selectionsHash: string | null;
};
export type SetAgentPreferencesPayloadV1 = { expectedRevision: number; preferences: OperatorPreferencesV1 };
export type ProposalSetAgentPayloadV1 = {
  baseProposalVersion: number;
  scope: { kind: "group"; slot: AgentSlotV1 } | { kind: "task"; taskId: string };
  partial: PartialSelectionV1 | null;
};
```

`tests/panel/webParity.test.ts`：

import 区——server 组（`:16-35`）加 `AgentPreferencesViewV1 as ServerAgentPreferencesViewV1, AgentSelectionPreviewV1 as ServerAgentSelectionPreviewV1, AgentsViewV1 as ServerAgentsViewV1, ProposalSetAgentPayload as ServerProposalSetAgentPayload, SetAgentPreferencesPayload as ServerSetAgentPreferencesPayload,`；web 组（`:36-55`）加 `AgentPreferencesViewV1 as WebAgentPreferencesViewV1, AgentSelectionPreviewV1 as WebAgentSelectionPreviewV1, AgentsViewV1 as WebAgentsViewV1, ProposalSetAgentPayloadV1 as WebProposalSetAgentPayloadV1, SetAgentPreferencesPayloadV1 as WebSetAgentPreferencesPayloadV1,`；再加两行：

```ts
import { provenanceSourceSchema } from "../../src/control/webProtocol.js";
import { WEB_PROVENANCE_SOURCES } from "../../web/src/controlTypes.js";
```

`describe` 里（`:85` 的 `});` 之前）加一条：

```ts
  // Agent selection spec §6.8 (T14): the panel labels each field with the layer it came from; a source the
  // server can send and the page does not know is a field labelled with nothing.
  it("WEB_PROVENANCE_SOURCES is the same SET as the server's provenance sources", () => {
    expect([...WEB_PROVENANCE_SOURCES].sort()).toEqual([...provenanceSourceSchema.options].sort());
  });
```

`:119-126` 的 `controlGroupWebToServer` 整条改写为：

```ts
// Execution driver spec §7.4: `blockedReason` is optional on the Web side only so the existing
// literal run fixtures in evidenceLink/controlPanel/controlCommandRecovery need no edit (D7's
// zero-rewrite principle); normalize it here so the rest of the shape still gets checked both ways.
// Handoff delivery (human ruling 2026-09-25, spec §12: this slice may rewrite criteria; ruling 88 (b)(c)): `continuable` is
// optional on the Web side for the same reason as `blockedReason`, and an absent flag reads as "not continuable".
// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the work item's frozen `agent`
// and `agentProvenance` are optional on the Web side for the same reason, and absent reads as "not frozen" (null);
// every other field of the group view is still checked in both directions.
function controlGroupWebToServer(x: WebGroupViewV1): ServerGroupViewV1 {
  return {
    ...x,
    runs: x.runs.map((run) => ({ ...run, blockedReason: run.blockedReason ?? null, continuable: run.continuable ?? false })),
    workItems: x.workItems.map((item) => ({ ...item, agent: item.agent ?? null, agentProvenance: item.agentProvenance ?? null })),
  };
}
```

`:160` 之后加：

```ts
function agentsViewServerToWeb(x: ServerAgentsViewV1): WebAgentsViewV1 { return x; }
function agentsViewWebToServer(x: WebAgentsViewV1): ServerAgentsViewV1 { return x; }
function agentPreferencesServerToWeb(x: ServerAgentPreferencesViewV1): WebAgentPreferencesViewV1 { return x; }
function agentPreferencesWebToServer(x: WebAgentPreferencesViewV1): ServerAgentPreferencesViewV1 { return x; }
function agentPreviewServerToWeb(x: ServerAgentSelectionPreviewV1): WebAgentSelectionPreviewV1 { return x; }
function agentPreviewWebToServer(x: WebAgentSelectionPreviewV1): ServerAgentSelectionPreviewV1 { return x; }
function setAgentPreferencesServerToWeb(x: ServerSetAgentPreferencesPayload): WebSetAgentPreferencesPayloadV1 { return x; }
function setAgentPreferencesWebToServer(x: WebSetAgentPreferencesPayloadV1): ServerSetAgentPreferencesPayload { return x; }
function proposalSetAgentServerToWeb(x: ServerProposalSetAgentPayload): WebProposalSetAgentPayloadV1 { return x; }
function proposalSetAgentWebToServer(x: WebProposalSetAgentPayloadV1): ServerProposalSetAgentPayload { return x; }
```

并把这十个名字追加进 `__webParityAssignabilityChecks__`（`:209` 的 `recoveryRetryWebToServer,` 之后）。

跑：

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/panel/webParity.test.ts > "$S/t14-parity.log" 2>&1; echo "rc=$?" >> "$S/t14-parity.log"
npm run typecheck >> "$S/t14-parity.log" 2>&1; echo "typecheck rc=$?" >> "$S/t14-parity.log"
( cd web && npx tsc --noEmit -p tsconfig.json ) >> "$S/t14-parity.log" 2>&1; echo "web tsc rc=$?" >> "$S/t14-parity.log"; cat "$S/t14-parity.log"
```

Expected：webParity `4 passed`、`rc=0`；typecheck `rc=0`；web tsc：**`rc≠0`** 且只报 `web/src/BudgetEditor.tsx` 的 confirm payload 缺 `selectionsHash`（T15 Step 5 修；本 Task 的提交不含 web 组件改动，所以 T14 与 T15 的提交之间 `npm run --ws check` 是红的——**两笔必须相邻落，中间不跑全套门**）。若报别的错 ⇒ 镜像与服务端不一致，按服务端改镜像。

- [ ] **Step 9：变异（`git clone --local` 副本，软链 `node_modules` 与 `web/node_modules`；每条：`shasum -a 256` 前值 → python 整行锚点替换、命中数 == 1 → 后值（相等当场停）→ 跑期望红的文件 → `cat` 原文件还原 → `shasum` 等于前值）**

| 编号 | 改哪 | 怎么改 | 期望红 |
|---|---|---|---|
| T14-M1 | `controlApi.ts` GET agents | `res.json(agentsViewSchema.parse({ schema: "orca-agents-view-v1", installations }))` → `…installations: [] }))` | agentSelectionApi 第 1 条 |
| T14-M2 | 同上 | 删掉 `.sort(...)`（保留 `[...view.installations]`） | 第 1 条（schema 的排序检查抛，500） |
| T14-M3 | `set-agent-preferences` 路由 target | `` `@operator:${actorId}` `` → `` `@repository:${actorId}` `` | 第 2 条（结果查不回 ⇒ 500 `control-command-result-invalid`） |
| T14-M4 | `readSelectionPreview` | `{ schema: …, groupId, ...resolved }` → `{ schema: …, groupId, ...resolved, selectionsHash: resolved.selectionsHash === null ? null : "0".repeat(64) }` | 第 3 条（`toBe(selectionsHash(...))` 与 confirm 的 200 都红）、第 6 条 |
| T14-M5 | `agentSelectionPreviewSchema` | 删 `if (rejected !== (value.selectionsHash === null)) …` 一行 | 第 7 条 |
| T14-M6 | 同上 | 删 `if (entry.key !== …) …` 一行 | 第 7 条 |
| T14-M7 | 变更路由表 | 删 `proposal/agent` 那一项 | 第 5 条（404 `route-not-found`） |
| T14-M8 | `webParity` | `WEB_PROVENANCE_SOURCES` 删 `"descriptor"` | webParity 新增那条 |
| T14-M9 | `server.ts:185` | 删 `, port: control.port` | **预言不红**（面板夹具自己接 port；装配路径无 HTTP 判据）⇒ 登记「该分支无独占判据」报控制器；可选补法：`tests/panel/controlMount.test.ts` 加一条「挂载后 `GET /api/control/agents` 不是 404」（不在本计划内，控制器裁） |

还原证明：副本 `/usr/bin/git diff | wc -c` 与 `/usr/bin/git diff --cached | wc -c` 都是 0。结果逐条（前后 sha256 全 64 位、红在哪几条、RC、是否与预言一致）记进 `mutations.md`。

- [ ] **Step 10：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add src/control/webProtocol.ts src/panel/controlViews.ts src/panel/controlApi.ts src/panel/server.ts tests/panel/fixtures/controlPanel.ts tests/panel/agentSelectionApi.test.ts tests/panel/webParity.test.ts web/src/controlTypes.ts
/usr/bin/git diff --cached --stat > "$S/t14-stat.log"; cat "$S/t14-stat.log"
/usr/bin/git commit -F "$S/t14-msg.txt"
```

`$S/t14-msg.txt`：

```
feat(panel): serve the agents view, operator preferences and the confirm's selection preview

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

台账 `progress.md` 追加：`- REWRITTEN: orca:tests/panel/webParity.test.ts > (compile-time half) controlGroupWebToServer`（T17 判定器按这个格式读，见 T17 Step 1）。

---

## Task 15：面板 UI —— 设置页「Agents」、提案视图的组级／逐任务选择与来源标注、确认带 `selectionsHash`

**依赖**：T14。

**Files:**
- Create: `web/src/AgentFields.tsx`（三件套控件与纯函数）
- Create: `web/src/AgentSettings.tsx`（设置页）
- Create: `web/src/AgentSelectionEditor.tsx`（提案视图的选择编辑）
- Modify: `web/src/BudgetEditor.tsx`（props `:85-91`；`submitConfirm` `:123-146`；Confirm 按钮 `:234`）
- Modify: `web/src/ControlGroupView.tsx`（import `:10-15`；props `:31-38`；`:64` 的 `<BudgetEditor …/>`）
- Modify: `web/src/ControlPanel.tsx`（import `:11-17`；props `:19-35`；`:108-109` 之间；`:121-128`）
- Modify: `web/src/controlApi.ts`（import `:13-33`；`:91` 之后三个读函数；`ControlAction` `:172-182`；`controlCommandPath` `:185-213`）
- Modify: `web/src/App.tsx`（import `:39-60`；state `:113-115` 之后；`:219-226` 之后；effects `:238-247` 之后；`ControlPanel` props `:345-362`）
- Test（新）: `web/tests/agentSettings.test.tsx` —— **4 条**；`web/tests/agentSelectionEditor.test.tsx` —— **8 条**

**Interfaces:**
- Consumes（T14）：`AgentsViewV1`、`AgentPreferencesViewV1`、`AgentSelectionPreviewV1`、`OperatorPreferencesV1`、`PartialSelectionV1`、`ProposalSetAgentPayloadV1`、`ContextWindowV1`、`AgentSlotV1`、`WorkItemViewV1.agent`／`agentProvenance`；路由见 T14 Produces。
- Produces：`SelectionFields`、`partialFromFields`、`contextLabel`、`parseContext`（`AgentFields.tsx`）；`AgentSettings`、`preferencesFromDrafts`；`AgentSelectionEditor`、`selectionsHashFor`、`agentDraftPrefix`；`ControlAction` 的 `proposal-set-agent` 一支；`fetchAgentsView`／`fetchAgentPreferences`／`fetchAgentPreview`／`AGENT_PREFERENCES_PATH`。

- [ ] **Step 1：写失败判据 `web/tests/agentSettings.test.tsx`（4 条）**

```tsx
// @vitest-environment jsdom
/**
 * Agent selection spec §6.8 (T15): the operator's defaults page. The context is a dropdown over what the
 * chosen agent can express -- never a free box -- and what is sent is exactly what the drafts describe, under
 * the revision the page read.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSettings, preferencesFromDrafts } from "../src/AgentSettings.js";
import type { AgentPreferencesViewV1, AgentsViewV1 } from "../src/controlTypes.js";

afterEach(() => cleanup());

const agents: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [
    { id: "claude", kind: "claude", defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1_000_000], version: "2.1.282" },
    { id: "codex", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "0.155.1" },
  ],
};
const preferences: AgentPreferencesViewV1 = {
  schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 4,
  preferences: { defaultAgent: "claude", perAgent: { claude: { model: "claude-fable-5" } } },
};

describe("the Agents settings page (agent selection spec §6.8)", () => {
  it("lists every installation from the table view with its version and its defaults", () => {
    const html = renderToStaticMarkup(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    for (const text of ["claude", "2.1.282", "claude-opus-5-5", "codex", "0.155.1", "gpt-6-sol", "preferences revision 4"]) expect(html).toContain(text);
  });

  it("offers each agent's context as a dropdown over that agent's own options, and no free text box for any context", () => {
    const { container } = render(<AgentSettings agents={agents} preferences={preferences} drafts={{}} onDraft={vi.fn()} onSave={vi.fn()} />);
    const options = (name: string): string[] => [...container.querySelectorAll(`select[name="${name}"] option`)].map((option) => (option as HTMLOptionElement).value);
    expect(options("agents:per:claude:context")).toEqual(["", "agent-default", "1000000"]);
    expect(options("agents:per:codex:context")).toEqual(["", "agent-default"]);
    // The estimator slot names no agent of its own, so it offers what the default agent (claude) can express.
    expect(options("agents:estimator:context")).toEqual(["", "agent-default", "1000000"]);
    expect(container.querySelectorAll('select[name$=":context"]')).toHaveLength(4);
    expect(container.querySelectorAll('input[name$=":context"]')).toHaveLength(0);
  });

  it("sends the preferences the drafts describe, under the revision the page was read at", () => {
    const onSave = vi.fn();
    render(<AgentSettings agents={agents} preferences={preferences} onDraft={vi.fn()} onSave={onSave} drafts={{
      "agents:default-agent": "codex", "agents:per:claude:context": "1000000",
      "agents:reconcile:agent": "claude", "agents:reconcile:model": "claude-opus-5-5",
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save agent preferences" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      defaultAgent: "codex",
      perAgent: { claude: { model: "claude-fable-5", contextWindow: 1_000_000 } },
      reconcile: { agent: "claude", model: "claude-opus-5-5" },
    }, 4);
  });

  it("leaves a field unset when its box is emptied, and drops a context the agent cannot express, rather than sending either", () => {
    expect(preferencesFromDrafts(agents, preferences, {
      "agents:per:claude:model": "", "agents:default-agent": "", "agents:per:codex:context": "1000000",
    })).toEqual({ perAgent: {} });
  });
});
```

- [ ] **Step 2：写失败判据 `web/tests/agentSelectionEditor.test.tsx`（8 条）**

```tsx
// @vitest-environment jsdom
/**
 * Agent selection spec §6.4/§6.8 (T15): the proposal view's agent editing. Every resolved field says which
 * layer it came from; a slot ccloop refused is red with ccloop's code; the confirm carries the hash of the
 * resolution on screen, and only for the proposal version that resolution was made for.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { controlCommandPath } from "../src/controlApi.js";
import type { AgentSelectionPreviewV1, AgentsViewV1, Amount, ControlConfigV1, FrozenSlotV1, GroupViewV1, SelectionProvenanceV1, AgentSelectionV1 } from "../src/controlTypes.js";

afterEach(() => cleanup());

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-26T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const agents: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [
    { id: "claude", kind: "claude", defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" }, contextOptions: ["agent-default", 1_000_000], version: "2.1.282" },
    { id: "codex", kind: "codex", defaults: { model: "gpt-6-sol", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "0.155.1" },
  ],
};
const claude: AgentSelectionV1 = { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" };
const frozen = (selection: AgentSelectionV1, provenance: SelectionProvenanceV1): FrozenSlotV1 => ({
  selection, configHash: "e".repeat(64), timeoutMs: 120_000, killGraceMs: 5_000, capabilities: capability, partial: { agent: selection.agent }, provenance,
});
const HASH = "f".repeat(64);
const resolvedPreview = (over: Partial<AgentSelectionPreviewV1> = {}): AgentSelectionPreviewV1 => ({
  schema: "orca-agent-selection-preview-v1", groupId: "g", proposalVersion: 3, groupOverrides: {}, taskOverrides: { a: null, b: { agent: "codex" } },
  slots: [
    { key: "reconcile", slot: "reconcile", taskId: null, outcome: { kind: "resolved", frozen: frozen(claude, { agent: "operator", model: "descriptor", contextWindow: "descriptor" }) } },
    { key: "task:a", slot: "worker", taskId: "a", outcome: { kind: "resolved", frozen: frozen(claude, { agent: "operator", model: "operator-agent", contextWindow: "descriptor" }) } },
    { key: "task:b", slot: "worker", taskId: "b", outcome: { kind: "resolved", frozen: frozen({ agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" }, { agent: "task", model: "descriptor", contextWindow: "descriptor" }) } },
  ],
  selectionsHash: HASH, ...over,
});
const rejectedPreview = (): AgentSelectionPreviewV1 => {
  const base = resolvedPreview({ taskOverrides: { a: null, b: { agent: "codex", contextWindow: 1_000_000 } } });
  return { ...base, slots: [base.slots[0]!, base.slots[1]!, { key: "task:b", slot: "worker", taskId: "b", outcome: { kind: "rejected", code: "agent-context-unsupported" } }], selectionsHash: null };
};
const workItem = (taskId: string, over: Partial<GroupViewV1["workItems"][number]> = {}): GroupViewV1["workItems"][number] => ({
  taskId, status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null,
  currentRunId: null, pendingRunId: null, lineageRunIds: [], ...over,
});
const view = (over: Partial<GroupViewV1> = {}): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "draft", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "editable", proposalVersion: 3, planHash: "a".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(9_000_000), used: amount(0), committedRemaining: amount(0), explicitUnallocatedReserve: amount(9_000_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems: [workItem("a"), workItem("b")], estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
  ...over,
});
const renderView = (props: { view?: GroupViewV1; preview?: AgentSelectionPreviewV1 | null; drafts?: Record<string, string>; onCommand?: ReturnType<typeof vi.fn> }) =>
  render(<ControlGroupView view={props.view ?? view()} config={config} uncertain={[]} drafts={props.drafts ?? {}} onDraft={vi.fn()} onCommand={props.onCommand ?? vi.fn()} agents={agents} preview={props.preview === undefined ? resolvedPreview() : props.preview} />);
const row = (container: HTMLElement, key: string): HTMLElement => container.querySelector(`tr[data-slot="${key}"]`) as HTMLElement;

describe("agent selection in the proposal view (agent selection spec §6.8)", () => {
  it("shows each task's resolved agent, model and context with the layer each came from", () => {
    const { container } = renderView({});
    const a = row(container, "task:a").textContent!;
    expect(a).toContain("claude from operator");
    expect(a).toContain("claude-opus-5-5 from operator-agent");
    expect(a).toContain("agent default from descriptor");
    expect(row(container, "task:b").textContent).toContain("codex from task");
    expect(row(container, "reconcile").textContent).toContain("claude from operator");
  });

  it("shows a slot ccloop refused in red with ccloop's code, and offers no confirm", () => {
    const { container } = renderView({ preview: rejectedPreview() });
    const cell = row(container, "task:b").querySelector('[role="alert"]') as HTMLElement;
    expect(cell.textContent).toContain("agent-context-unsupported");
    expect(cell.style.color).toBe("red");
    expect((screen.getByRole("button", { name: "Confirm budget" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends proposal-set-agent for a task and for a group slot, bound to the revision and proposal version on screen", () => {
    const onCommand = vi.fn();
    renderView({ onCommand, drafts: {
      "g:agent:task:a:agent": "codex",
      "g:agent:group:reconcile:agent": "codex", "g:agent:group:reconcile:model": "gpt-6-sol",
    } });
    fireEvent.click(screen.getByRole("button", { name: "Set agent for task a" }));
    fireEvent.click(screen.getByRole("button", { name: "Set group reconcile agent" }));
    expect(onCommand.mock.calls.map(([action]) => action)).toEqual([
      { verb: "proposal-set-agent", groupId: "g", expectedRevision: 6, payload: { baseProposalVersion: 3, scope: { kind: "task", taskId: "a" }, partial: { agent: "codex" } } },
      { verb: "proposal-set-agent", groupId: "g", expectedRevision: 6, payload: { baseProposalVersion: 3, scope: { kind: "group", slot: "reconcile" }, partial: { agent: "codex", model: "gpt-6-sol" } } },
    ]);
  });

  it("clears a task's own layer with a null partial, not an empty one", () => {
    const onCommand = vi.fn();
    renderView({ onCommand });
    fireEvent.click(screen.getByRole("button", { name: "Clear agent for task b" }));
    expect(onCommand).toHaveBeenCalledWith({ verb: "proposal-set-agent", groupId: "g", expectedRevision: 6, payload: { baseProposalVersion: 3, scope: { kind: "task", taskId: "b" }, partial: null } });
    expect((screen.getByRole("button", { name: "Clear agent for task a" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("confirms with the selectionsHash of the resolution on screen", () => {
    const onCommand = vi.fn();
    renderView({ onCommand });
    fireEvent.click(screen.getByRole("button", { name: "Confirm budget" }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toMatchObject({ verb: "confirm", groupId: "g", payload: { proposalVersion: 3, selectionsHash: HASH } });
  });

  it("does not confirm on a resolution made for another proposal version, and says it is re-reading", () => {
    const onCommand = vi.fn();
    const { container } = renderView({ onCommand, preview: resolvedPreview({ proposalVersion: 2 }) });
    const button = screen.getByRole("button", { name: "Confirm budget" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onCommand).not.toHaveBeenCalled();
    expect(container.textContent).toContain("for proposal v2");
  });

  it("shows a confirmed group's frozen selection from its work items, and no editing", () => {
    const { container } = renderView({
      preview: resolvedPreview({ proposalVersion: 2 }),
      view: view({
        summary: { groupId: "g", state: "ready", commandRevision: 7, projectionSeq: 5, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
        proposal: { state: "confirmed", proposalVersion: 3, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
          estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
          handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
        workItems: [
          workItem("a", { status: "ready", configHash: "d".repeat(64), agent: { agent: "codex", model: "gpt-6-luna", contextWindow: "agent-default" }, agentProvenance: { agent: "task", model: "task", contextWindow: "descriptor" } }),
          workItem("b", { status: "ready", configHash: "d".repeat(64), agent: claude, agentProvenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" } }),
        ],
      }),
    });
    expect(container.textContent).toContain("frozen at confirmation");
    expect(row(container, "task:a").textContent).toContain("gpt-6-luna from task");
    expect(screen.queryByRole("button", { name: /Set agent for task/ })).toBeNull();
  });

  it("routes proposal-set-agent to the group's proposal/agent path", () => {
    expect(controlCommandPath({ verb: "proposal-set-agent", groupId: "g", expectedRevision: 1, payload: { baseProposalVersion: 1, scope: { kind: "task", taskId: "a" }, partial: null } }))
      .toBe("/api/control/groups/g/proposal/agent");
  });
});
```

- [ ] **Step 3：跑，看它红**

```bash
cd /Users/biran/code/skills/loop/Orca/web
../node_modules/.bin/vitest run tests/agentSettings.test.tsx tests/agentSelectionEditor.test.tsx > "$S/t15-red.log" 2>&1; echo "rc=$?" >> "$S/t15-red.log"; cat "$S/t15-red.log"
```

Expected：`rc=1`；两个文件都在收集期失败（`../src/AgentSettings.js`、`../src/AgentFields.js` 不存在；`ControlGroupView` 不认 `agents`／`preview` 是类型层面的，vitest 不做类型检查，所以红点是模块解析失败）。

- [ ] **Step 4：`web/src/AgentFields.tsx`（新）**

```tsx
/**
 * Agent selection spec §6.8 (T15): one layer's partial selection as three controls. The model is a free string
 * the panel never rewrites (ccloop validates it, §4.1); the context is a select over the options the effective
 * agent can express and nothing else -- there is no box to type a window into.
 */
import type { JSX } from "react";
import type { AgentInstallationV1, AgentsViewV1, ContextWindowV1, PartialSelectionV1 } from "./controlTypes.js";

export const contextLabel = (value: ContextWindowV1): string => (value === "agent-default" ? "agent default" : `${value} tokens`);
export const contextValue = (value: ContextWindowV1 | undefined): string => (value === undefined ? "" : String(value));

/** A select value back to a context; "" (inherit) and anything that is not a context read as unset. */
export function parseContext(text: string): ContextWindowV1 | undefined {
  if (text === "agent-default") return "agent-default";
  return /^[1-9][0-9]*$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : undefined;
}

/** An emptied box is "not set at this layer"; any other text is sent exactly as typed. */
export const textOrUndefined = (text: string): string | undefined => (text.trim() === "" ? undefined : text);

export function installationOf(agents: AgentsViewV1, id: string | undefined): AgentInstallationV1 | undefined {
  return id === undefined ? undefined : agents.installations.find((row) => row.id === id);
}

/**
 * The partial the drafts describe for one layer. A context the effective agent cannot express is dropped
 * rather than sent: the select never offers it, so it can only be a draft left over from another agent.
 */
export function partialFromFields(
  agents: AgentsViewV1,
  prefix: string,
  current: PartialSelectionV1 | undefined,
  drafts: Record<string, string>,
  inheritedAgent: string | undefined,
): PartialSelectionV1 {
  const pick = (field: string, fallback: string): string => drafts[`${prefix}:${field}`] ?? fallback;
  const agent = textOrUndefined(pick("agent", current?.agent ?? ""));
  const model = textOrUndefined(pick("model", current?.model ?? ""));
  const parsed = parseContext(pick("context", contextValue(current?.contextWindow)));
  const options = installationOf(agents, agent ?? inheritedAgent)?.contextOptions ?? [];
  const contextWindow = parsed !== undefined && options.includes(parsed) ? parsed : undefined;
  return {
    ...(agent === undefined ? {} : { agent }),
    ...(model === undefined ? {} : { model }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
  };
}

export interface SelectionFieldsProps {
  agents: AgentsViewV1;
  /** Draft key prefix; each control's `name` is `<prefix>:agent|model|context`. */
  prefix: string;
  label: string;
  current: PartialSelectionV1 | undefined;
  /** The agent whose options the context offers when this layer names none. */
  inheritedAgent: string | undefined;
  /** A per-agent row: the agent is fixed and not offered. */
  fixedAgent?: string;
  readOnly?: boolean;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
}

export function SelectionFields(props: SelectionFieldsProps): JSX.Element {
  const { agents, prefix, drafts, onDraft } = props;
  const draft = (field: string, fallback: string): string => drafts[`${prefix}:${field}`] ?? fallback;
  const agentText = props.fixedAgent ?? draft("agent", props.current?.agent ?? "");
  const effective = installationOf(agents, agentText === "" ? props.inheritedAgent : agentText);
  return (
    <fieldset aria-label={props.label}>
      <legend>{props.label}</legend>
      {props.fixedAgent === undefined && (
        <label>
          agent
          <select name={`${prefix}:agent`} value={agentText} disabled={props.readOnly} onChange={(event) => onDraft(`${prefix}:agent`, event.target.value)}>
            <option value="">inherit</option>
            {agents.installations.map((row) => <option key={row.id} value={row.id}>{row.id} ({row.kind} {row.version})</option>)}
          </select>
        </label>
      )}
      <label>
        model
        <input
          name={`${prefix}:model`}
          value={draft("model", props.current?.model ?? "")}
          placeholder={effective?.defaults.model ?? ""}
          readOnly={props.readOnly}
          onChange={(event) => onDraft(`${prefix}:model`, event.target.value)}
        />
      </label>
      <label>
        context
        <select
          name={`${prefix}:context`}
          value={draft("context", contextValue(props.current?.contextWindow))}
          disabled={props.readOnly}
          onChange={(event) => onDraft(`${prefix}:context`, event.target.value)}
        >
          <option value="">inherit</option>
          {(effective?.contextOptions ?? []).map((option) => <option key={String(option)} value={String(option)}>{contextLabel(option)}</option>)}
        </select>
      </label>
    </fieldset>
  );
}
```

- [ ] **Step 5：`web/src/AgentSettings.tsx`（新）**

```tsx
/**
 * Agent selection spec §6.8 (T15): the "Agents" settings page. It lists the installation table exactly as the
 * server read it from ccloop and edits this operator's defaults -- the default agent, each agent's model and
 * context, and the estimator and reconcile slots -- as one set-agent-preferences under the revision it read.
 */
import type { JSX } from "react";
import { SelectionFields, contextLabel, installationOf, partialFromFields, textOrUndefined } from "./AgentFields.js";
import type { AgentPreferencesViewV1, AgentsViewV1, OperatorPreferencesV1 } from "./controlTypes.js";

const DEFAULT_AGENT_KEY = "agents:default-agent";

export function preferencesFromDrafts(agents: AgentsViewV1, view: AgentPreferencesViewV1, drafts: Record<string, string>): OperatorPreferencesV1 {
  const prefs = view.preferences;
  const defaultAgent = textOrUndefined(drafts[DEFAULT_AGENT_KEY] ?? prefs.defaultAgent ?? "");
  const perAgent: OperatorPreferencesV1["perAgent"] = {};
  // An agent the table no longer lists keeps what the operator set for it; this page cannot edit it.
  for (const [id, entry] of Object.entries(prefs.perAgent)) if (installationOf(agents, id) === undefined) perAgent[id] = entry;
  for (const row of agents.installations) {
    const { model, contextWindow } = partialFromFields(agents, `agents:per:${row.id}`, prefs.perAgent[row.id], drafts, row.id);
    const entry = { ...(model === undefined ? {} : { model }), ...(contextWindow === undefined ? {} : { contextWindow }) };
    if (Object.keys(entry).length > 0) perAgent[row.id] = entry;
  }
  const slot = (name: "estimator" | "reconcile") => {
    const partial = partialFromFields(agents, `agents:${name}`, prefs[name], drafts, defaultAgent);
    return Object.keys(partial).length === 0 ? undefined : partial;
  };
  const estimator = slot("estimator");
  const reconcile = slot("reconcile");
  return {
    ...(defaultAgent === undefined ? {} : { defaultAgent }),
    perAgent,
    ...(estimator === undefined ? {} : { estimator }),
    ...(reconcile === undefined ? {} : { reconcile }),
  };
}

export interface AgentSettingsProps {
  agents: AgentsViewV1;
  preferences: AgentPreferencesViewV1;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onSave: (preferences: OperatorPreferencesV1, expectedRevision: number) => void;
}

export function AgentSettings(props: AgentSettingsProps): JSX.Element {
  const { agents, preferences, drafts, onDraft } = props;
  const defaultText = drafts[DEFAULT_AGENT_KEY] ?? preferences.preferences.defaultAgent ?? "";
  const defaultAgent = textOrUndefined(defaultText);
  return (
    <section aria-label="Agents settings">
      <h3>Agents</h3>
      <p>
        Operator {preferences.operatorId} · preferences revision {preferences.revision}. A change reaches groups confirmed after it; a
        confirmed group keeps the selection it froze.
      </p>
      {agents.installations.length === 0 && <p role="note">The installation table lists no agent. Run orca agents init and restart the panel.</p>}
      <table>
        <thead>
          <tr><th>installation</th><th>kind</th><th>version</th><th>default model</th><th>default context</th></tr>
        </thead>
        <tbody>
          {agents.installations.map((row) => (
            <tr key={row.id}>
              <td>{row.id}</td><td>{row.kind}</td><td>{row.version}</td><td>{row.defaults.model}</td><td>{contextLabel(row.defaults.contextWindow)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label>
        Default agent
        <select name={DEFAULT_AGENT_KEY} value={defaultText} onChange={(event) => onDraft(DEFAULT_AGENT_KEY, event.target.value)}>
          <option value="">none (every group has to choose one)</option>
          {agents.installations.map((row) => <option key={row.id} value={row.id}>{row.id}</option>)}
        </select>
      </label>
      {agents.installations.map((row) => (
        <SelectionFields
          key={row.id} agents={agents} prefix={`agents:per:${row.id}`} label={`${row.id} defaults`} fixedAgent={row.id}
          current={preferences.preferences.perAgent[row.id]} inheritedAgent={row.id} drafts={drafts} onDraft={onDraft}
        />
      ))}
      <SelectionFields agents={agents} prefix="agents:estimator" label="Estimator slot" current={preferences.preferences.estimator} inheritedAgent={defaultAgent} drafts={drafts} onDraft={onDraft} />
      <SelectionFields agents={agents} prefix="agents:reconcile" label="Reconcile slot" current={preferences.preferences.reconcile} inheritedAgent={defaultAgent} drafts={drafts} onDraft={onDraft} />
      <button type="button" onClick={() => props.onSave(preferencesFromDrafts(agents, preferences, drafts), preferences.revision)}>Save agent preferences</button>
    </section>
  );
}
```

- [ ] **Step 6：`web/src/AgentSelectionEditor.tsx`（新）**

```tsx
/**
 * Agent selection spec §6.8 (T15): the proposal view's agent editing. Group slots and each task's own layer are
 * edited as proposal-set-agent commands under the proposal version on screen; each slot shows what the server
 * resolved and, per field, which layer it came from. A slot ccloop refused is red with ccloop's code. Nothing
 * here resolves, merges or hashes anything -- the preview is the server's (T14).
 */
import type { JSX } from "react";
import type { ControlAction } from "./controlApi.js";
import { SelectionFields, contextLabel, partialFromFields } from "./AgentFields.js";
import type {
  AgentSelectionPreviewV1, AgentSelectionV1, AgentSlotV1, AgentsViewV1, GroupViewV1, PartialSelectionV1, SelectionProvenanceV1,
} from "./controlTypes.js";

type Scope = { kind: "group"; slot: AgentSlotV1 } | { kind: "task"; taskId: string };

export const agentDraftPrefix = (groupId: string, scope: Scope): string =>
  scope.kind === "group" ? `${groupId}:agent:group:${scope.slot}` : `${groupId}:agent:task:${scope.taskId}`;

/** The hash a confirm may carry: only a resolution of this group, at this proposal version, that resolved whole. */
export function selectionsHashFor(view: GroupViewV1, preview: AgentSelectionPreviewV1 | null | undefined): string | null {
  if (!preview || view.proposal.state !== "editable") return null;
  if (preview.groupId !== view.summary.groupId || preview.proposalVersion !== view.proposal.proposalVersion) return null;
  return preview.selectionsHash;
}

function SelectionCells(props: { selection: AgentSelectionV1; provenance: SelectionProvenanceV1 }): JSX.Element {
  const { selection, provenance } = props;
  return (
    <>
      <td>{selection.agent} <small>from {provenance.agent}</small></td>
      <td>{selection.model} <small>from {provenance.model}</small></td>
      <td>{contextLabel(selection.contextWindow)} <small>from {provenance.contextWindow}</small></td>
    </>
  );
}

export interface AgentSelectionEditorProps {
  view: GroupViewV1;
  agents: AgentsViewV1 | null;
  preview: AgentSelectionPreviewV1 | null;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
}

export function AgentSelectionEditor(props: AgentSelectionEditorProps): JSX.Element {
  const { view, agents, preview, drafts, onDraft, onCommand } = props;
  const groupId = view.summary.groupId;

  if (view.proposal.state === "confirmed") {
    return (
      <section aria-label="Agent selection">
        <h3>Agents (frozen at confirmation)</h3>
        <table>
          <thead><tr><th>task</th><th>agent</th><th>model</th><th>context</th></tr></thead>
          <tbody>
            {view.workItems.map((item) => (
              <tr key={item.taskId} data-slot={`task:${item.taskId}`}>
                <td>{item.taskId}</td>
                {item.agent && item.agentProvenance ? <SelectionCells selection={item.agent} provenance={item.agentProvenance} /> : <td colSpan={3}>not recorded</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  if (agents === null || preview === null) {
    return <section aria-label="Agent selection"><h3>Agents</h3><p role="status">Resolving agent selections…</p></section>;
  }

  const stale = preview.proposalVersion !== view.proposal.proposalVersion;
  const send = (scope: Scope, partial: PartialSelectionV1 | null): void => {
    onCommand({
      verb: "proposal-set-agent", groupId, expectedRevision: view.summary.commandRevision,
      payload: { baseProposalVersion: view.proposal.proposalVersion, scope, partial },
    });
  };
  const resolvedAgent = (key: string): string | undefined => {
    const entry = preview.slots.find((slot) => slot.key === key);
    return entry?.outcome.kind === "resolved" ? entry.outcome.frozen.selection.agent : undefined;
  };
  const firstWorker = preview.slots.find((slot) => slot.slot === "worker")?.key;

  return (
    <section aria-label="Agent selection">
      <h3>Agents · proposal v{view.proposal.proposalVersion}</h3>
      {stale && <p role="status">The resolution shown is for proposal v{preview.proposalVersion}; re-reading. Confirm waits for it.</p>}
      {preview.selectionsHash === null && <p role="alert">A selection below cannot be resolved; confirm is refused until it is changed.</p>}
      {(["worker", "estimator", "reconcile"] as const).map((slot) => {
        const scope: Scope = { kind: "group", slot };
        const prefix = agentDraftPrefix(groupId, scope);
        const inherited = slot === "reconcile" ? resolvedAgent("reconcile") : firstWorker === undefined ? undefined : resolvedAgent(firstWorker);
        const partial = partialFromFields(agents, prefix, preview.groupOverrides[slot], drafts, inherited);
        return (
          <div key={slot}>
            <SelectionFields agents={agents} prefix={prefix} label={`Group ${slot}`} current={preview.groupOverrides[slot]} inheritedAgent={inherited} drafts={drafts} onDraft={onDraft} />
            <button type="button" disabled={Object.keys(partial).length === 0} onClick={() => send(scope, partial)}>Set group {slot} agent</button>
            <button type="button" disabled={preview.groupOverrides[slot] === undefined} onClick={() => send(scope, null)}>Clear group {slot} agent</button>
          </div>
        );
      })}
      <table>
        <thead><tr><th>slot</th><th>agent</th><th>model</th><th>context</th><th>this task's own layer</th></tr></thead>
        <tbody>
          {preview.slots.map((entry) => {
            const taskId = entry.taskId;
            const own = taskId === null ? undefined : preview.taskOverrides[taskId] ?? undefined;
            const scope: Scope | null = taskId === null ? null : { kind: "task", taskId };
            const prefix = scope === null ? "" : agentDraftPrefix(groupId, scope);
            const partial = scope === null ? {} : partialFromFields(agents, prefix, own, drafts, resolvedAgent(entry.key));
            return (
              <tr key={entry.key} data-slot={entry.key}>
                <td>{taskId ?? "reconcile"}</td>
                {entry.outcome.kind === "resolved"
                  ? <SelectionCells selection={entry.outcome.frozen.selection} provenance={entry.outcome.frozen.provenance} />
                  : <td colSpan={3} role="alert" data-rejected="true" style={{ color: "red" }}>rejected · {entry.outcome.code}</td>}
                <td>
                  {scope !== null && (
                    <>
                      <SelectionFields agents={agents} prefix={prefix} label={`Task ${taskId}`} current={own} inheritedAgent={resolvedAgent(entry.key)} drafts={drafts} onDraft={onDraft} />
                      <button type="button" disabled={Object.keys(partial).length === 0} onClick={() => send(scope, partial)}>Set agent for task {taskId}</button>
                      <button type="button" disabled={own === undefined} onClick={() => send(scope, null)}>Clear agent for task {taskId}</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 7：接线**

`web/src/BudgetEditor.tsx`：

`BudgetEditorProps`（`:85-91`）在 `onCommand` 之后加：

```ts
  /** Agent selection spec §6.4: the hash of the agent resolution on screen; without one, confirm is not offered. */
  selectionsHash?: string | null;
```

`submitConfirm`（`:123-146`）首行 `if (confirmBlocked) return;` 改为

```ts
    if (confirmBlocked || !props.selectionsHash) return;
```

payload 里 `contextPolicy: …,`（`:143`）之后加一行 `selectionsHash: props.selectionsHash,`。

`:234` 的 Confirm 按钮改为：

```tsx
      {editable && !props.selectionsHash && <p role="note">Confirm waits for this proposal version's agent selections to resolve.</p>}
      <button type="button" disabled={!props.selectionsHash} onClick={submitConfirm}>Confirm budget</button>
```

`web/src/ControlGroupView.tsx`：import 区加

```ts
import { AgentSelectionEditor, selectionsHashFor } from "./AgentSelectionEditor.js";
import type { AgentSelectionPreviewV1, AgentsViewV1 } from "./controlTypes.js";
```

`ControlGroupViewProps`（`:31-38`）在 `onCommand` 之后加：

```ts
  /** Agent selection spec §6.8: absent on a page that never read the installation table (and in older criteria). */
  agents?: AgentsViewV1 | null;
  preview?: AgentSelectionPreviewV1 | null;
```

`:64` 改为：

```tsx
      <BudgetEditor view={view} config={config} drafts={drafts} onDraft={onDraft} onCommand={onCommand} selectionsHash={selectionsHashFor(view, props.preview)} />
      {props.agents !== undefined && (
        <AgentSelectionEditor view={view} agents={props.agents} preview={props.preview ?? null} drafts={drafts} onDraft={onDraft} onCommand={onCommand} />
      )}
```

`web/src/controlApi.ts`：import 区加 `AgentPreferencesViewV1, AgentSelectionPreviewV1, AgentsViewV1, ProposalSetAgentPayloadV1,`；`:91` 之后加：

```ts
/** Agent selection spec §6.8: the installation table, as ccloop answered it through the panel. */
export const fetchAgentsView = (): Promise<AgentsViewV1> => controlGet<AgentsViewV1>("/api/control/agents");
export const AGENT_PREFERENCES_PATH = "/api/control/operator/agent-preferences";
/** This panel operator's defaults and the revision they are at. */
export const fetchAgentPreferences = (): Promise<AgentPreferencesViewV1> => controlGet<AgentPreferencesViewV1>(AGENT_PREFERENCES_PATH);
/** The confirm's own resolution of a group's agent slots, for the proposal version the server holds now. */
export const fetchAgentPreview = (groupId: string): Promise<AgentSelectionPreviewV1> =>
  controlGet<AgentSelectionPreviewV1>(`/api/control/groups/${segment(groupId)}/agent-preview`);
```

`ControlAction`（`:172-182`）在 `proposal-edit` 那一支之后加 `| { verb: "proposal-set-agent"; groupId: string; expectedRevision: number; payload: ProposalSetAgentPayloadV1 }`；`controlCommandPath`（`:190-191` 之后）加：

```ts
    case "proposal-set-agent":
      return `${group}/proposal/agent`;
```

`web/src/ControlPanel.tsx`：import 加 `import { AgentSettings } from "./AgentSettings.js";` 与类型 `AgentPreferencesViewV1, AgentSelectionPreviewV1, AgentsViewV1, OperatorPreferencesV1`；`ControlPanelProps`（`:19-35`）末尾加：

```ts
  /** Agent selection spec §6.8: the installation table and this operator's defaults, once read. */
  agents?: AgentsViewV1 | null;
  preferences?: AgentPreferencesViewV1 | null;
  previews?: Record<string, AgentSelectionPreviewV1>;
  onAgentPreferences?: (preferences: OperatorPreferencesV1, expectedRevision: number) => void;
```

`:109`（`WorkspaceModeSelector` 那行）之后加：

```tsx
      {props.agents && props.preferences && props.onAgentPreferences && (
        <AgentSettings agents={props.agents} preferences={props.preferences} drafts={drafts} onDraft={props.onDraft} onSave={props.onAgentPreferences} />
      )}
```

`:121-128` 的 `<ControlGroupView … />` 加两个 props：

```tsx
          agents={props.agents}
          preview={props.previews?.[view.summary.groupId] ?? null}
```

`web/src/App.tsx`：import 区（`:39-55`）加 `AGENT_PREFERENCES_PATH, fetchAgentPreferences, fetchAgentPreview, fetchAgentsView,`；`:60` 的类型 import 加 `AgentPreferencesViewV1, AgentSelectionPreviewV1, AgentsViewV1, OperatorPreferencesV1`。`:115` 之后加：

```ts
  /** Agent selection spec §6.8: the installation table and this operator's defaults; null until read, or when the port refuses. */
  const [agents, setAgents] = useState<AgentsViewV1 | null>(null);
  const [agentPreferences, setAgentPreferences] = useState<AgentPreferencesViewV1 | null>(null);
  /** The server's resolution per open group; a new proposal version or new preferences re-read it. */
  const [previews, setPreviews] = useState<Record<string, AgentSelectionPreviewV1>>({});
```

`sendWorkspaceMode`（`:219-226`）之后加：

```ts
  /** Name the operator's new defaults under the revision they were read at; whatever the server says is read back. */
  const sendAgentPreferences = async (preferences: OperatorPreferencesV1, expectedRevision: number): Promise<void> => {
    if (agentPreferences === null) return;
    const scope = `@operator:${agentPreferences.operatorId}`;
    const answer = await sendControlCommand(AGENT_PREFERENCES_PATH, { commandId: nextCommandId(), expectedRevision, payload: { expectedRevision, preferences } });
    if (answer.kind === "uncertain") dispatchControl({ type: "refusal", groupId: scope, value: answer.refusal });
    else if (answer.status >= 400) dispatchControl({ type: "refusal", groupId: scope, value: refusalFromAnswer(answer) });
    try { setAgentPreferences(await fetchAgentPreferences()); } catch { /* the refusal above already says why */ }
  };
```

`:247` 的 effect 之后加：

```ts
  // Agent selection spec §6.8: an unconfigured port has no installation table to read.
  useEffect(() => {
    if (controlConfig?.executionPort !== "configured") return;
    void (async () => {
      try {
        setAgents(await fetchAgentsView());
        setAgentPreferences(await fetchAgentPreferences());
      } catch (err) {
        dispatchControl({ type: "refusal", groupId: null, value: controlFailureFrom(err) });
      }
    })();
  }, [controlConfig]);

  // The preview is re-read whenever what it depends on moved: the open group, its proposal version, the preferences.
  const openGroup = selectedGroup === null ? undefined : control.canonical[selectedGroup];
  const previewKey = openGroup === undefined || openGroup.proposal.state !== "editable"
    ? null
    : `${openGroup.summary.groupId}\0${openGroup.proposal.proposalVersion}\0${agentPreferences?.revision ?? -1}`;
  useEffect(() => {
    if (previewKey === null || openGroup === undefined || agents === null) return;
    const groupId = openGroup.summary.groupId;
    void fetchAgentPreview(groupId).then(
      (value) => setPreviews((prior) => ({ ...prior, [groupId]: value })),
      (err) => dispatchControl({ type: "refusal", groupId, value: controlFailureFrom(err) }),
    );
  }, [previewKey, agents]);
```

`ControlPanel` 的 props（`:361` 的 `onWorkspaceMode=…` 之后）加：

```tsx
          agents={agents}
          preferences={agentPreferences}
          previews={previews}
          onAgentPreferences={(preferences, revision) => { void sendAgentPreferences(preferences, revision); }}
```

- [ ] **Step 8：跑到绿，并跑整个 web 套件与 web 类型检查**

```bash
cd /Users/biran/code/skills/loop/Orca/web
../node_modules/.bin/vitest run tests/agentSettings.test.tsx tests/agentSelectionEditor.test.tsx > "$S/t15-green.log" 2>&1; echo "rc=$?" >> "$S/t15-green.log"
../node_modules/.bin/vitest run > "$S/t15-web-all.log" 2>&1; echo "rc=$?" >> "$S/t15-web-all.log"
npx tsc --noEmit -p tsconfig.json > "$S/t15-web-tsc.log" 2>&1; echo "rc=$?" >> "$S/t15-web-tsc.log"
cat "$S/t15-green.log" "$S/t15-web-all.log" "$S/t15-web-tsc.log"
cd .. && npm run build --workspace web > "$S/t15-web-build.log" 2>&1; echo "rc=$?" >> "$S/t15-web-build.log"; cat "$S/t15-web-build.log"
```

Expected：两个新文件 `12 passed`、rc 0；web 全套 rc 0（现量 16 的三个文件零改动仍绿；若 `controlCommandRecovery` 的已登记 flake 红，单文件重跑）；web tsc rc 0；web build rc 0。

- [ ] **Step 9：变异（副本；做法同 T14 Step 9）**

| 编号 | 改哪 | 怎么改 | 期望红 |
|---|---|---|---|
| T15-M1 | `AgentFields.tsx` context 控件 | `<select name={`${prefix}:context`}` 整个元素换成 `<input name={`${prefix}:context`} value={draft("context", contextValue(props.current?.contextWindow))} onChange={(event) => onDraft(`${prefix}:context`, event.target.value)} />` | agentSettings 第 2 条 |
| T15-M2 | `AgentFields.tsx` | `{(effective?.contextOptions ?? []).map(` → `{(agents.installations[0]?.contextOptions ?? []).map(` | agentSettings 第 2 条（codex 那一行多出 `1000000`） |
| T15-M3 | `partialFromFields` | `const contextWindow = parsed !== undefined && options.includes(parsed) ? parsed : undefined;` → `const contextWindow = parsed;` | agentSettings 第 4 条 |
| T15-M4 | `textOrUndefined` | `(text.trim() === "" ? undefined : text)` → `text` | agentSettings 第 4 条（`defaultAgent: ""`、`model: ""` 被送出） |
| T15-M5 | `AgentSettings` onSave | `preferences.revision)` → `0)` | agentSettings 第 3 条 |
| T15-M6 | `AgentSelectionEditor` 拒绝格 | 删 `role="alert"` 与 `style={{ color: "red" }}` | editor 第 2 条 |
| T15-M7 | `BudgetEditor.submitConfirm` | 删 `selectionsHash: props.selectionsHash,` 一行 | editor 第 5 条 |
| T15-M8 | `selectionsHashFor` | 删 `\|\| preview.proposalVersion !== view.proposal.proposalVersion` | editor 第 6 条 |
| T15-M9 | editor 的 task Clear | `send(scope, null)`（task 那一处）→ `send(scope, {})` | editor 第 4 条 |
| T15-M10 | editor 确认后分支 | 删 `if (view.proposal.state === "confirmed") { … }` 整块 | editor 第 7 条 |
| T15-M11 | `controlCommandPath` | `` `${group}/proposal/agent` `` → `` `${group}/proposal/edit` `` | editor 第 8 条 |
| T15-M12 | `SelectionCells` | 删三处 `<small>from …</small>` 中的 model 那一处 | editor 第 1 条 |
| T15-M13 | `App.tsx` 预览 effect | `previewKey` 去掉 `${agentPreferences?.revision ?? -1}` 一段 | **预言不红**（`App` 无判据，现量 13：副作用只在 `App`）⇒ 登记「无独占判据」；它编码的是「偏好改了预览要重读」，漏了的后果由服务端 `agent-selection-changed` 兜住（T14 第 6 条） |

- [ ] **Step 10：提交（紧跟 T14 的提交，中间不插别的提交——T14 Step 8 说明了为什么）**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add web/src/AgentFields.tsx web/src/AgentSettings.tsx web/src/AgentSelectionEditor.tsx web/src/BudgetEditor.tsx web/src/ControlGroupView.tsx web/src/ControlPanel.tsx web/src/controlApi.ts web/src/App.tsx web/tests/agentSettings.test.tsx web/tests/agentSelectionEditor.test.tsx
/usr/bin/git diff --cached --stat > "$S/t15-stat.log"; cat "$S/t15-stat.log"
/usr/bin/git commit -F "$S/t15-msg.txt"
```

`$S/t15-msg.txt`：

```
feat(web): edit agent defaults and a proposal's agents, and confirm on the resolution shown

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

---

## Task 16：驱动环 E2E —— fake claude＋fake codex 混组、确认后改默认值仍用冻结值、fake claude 下的 handoff／续跑／三路冲突

**依赖**：T3（fake claude CLI、`.argv`、W6-13 的 `--version`）、T5（control 走 `--agents`）、T6（`ccloop run --agents`）、T7（`ccloopWorld` 的表形状，W6-15）、T11（冻结、闸门用冻结选择、异步 confirm）、T12（解冲突 run 用 reconcile 选择）、T14（`readSelectionPreview`）。

**Files:**
- Modify: `tests/control/fixtures/ccloopWorld.ts`（只加：`Task.agent`、`WorldOptions.claudeScript`、表里的 `claude` 行、`argv()`／`callsOf()`／`scriptedOf()`、`boot(driverCrash?, wrapPort?)`；锚点见 Step 1）
- Modify: `src/panel/controlAssembly.ts`（`ControlAssemblyInput` `:102-109` 加 `wrapPort`；`:164`）
- Test（新）: `tests/control/agentSelectionE2E.test.ts` —— **5 条**（`describe.skipIf(!realBinary)`；门里一律带 env 跑，**0 skipped 才算过**，T17 判定器按条数查）

**Interfaces:**
- Consumes：`readSelectionPreview`（T14）；`service.setAgentPreferences`、`service.confirm`（异步）、`service.resumeFromHandoff`、`service.continueTask`、`service.handoffStop`；`readStartEnvelope`、`readDriverRun`；ccloop `<sourceDir>/control/config.json`（`MaterializedAgentConfigV1`，spec §4.6）；fake CLI 的 `<marker>.argv`（每次调用一行 JSON 数组）、`.calls`、`.tasks`。
- Produces：`ControlAssemblyInput.wrapPort?: (port: ExecutionPort) => ExecutionPort`（测试专用，CLI 永不设置）。

**诚实的表述（写进文件头）**：fake claude CLI 与 fake codex、soft 组、estimator `blocked-capability` 下，选择从确认冻结一路到达两种 CLI 的 argv，含解冲突 run；确认后改操作者默认值不影响已确认组的 envelope、ccloop 物化配置、argv 与闸门探测；④ 的 handoff、续跑（两条路径）与三路冲突在 fake claude 下各一次。**不是**「真 claude 可用」——真 claude 付费跑本轮不做（spec §11）。

- [ ] **Step 1：`ccloopWorld.ts` 只加（锚点以 T7 落地后的文本为准，W6-15）**

(a) import 区加：

```ts
import type { PartialSelection } from "../../../src/control/agentSelection.js";
import type { ExecutionPort } from "../../../src/control/executionPort.js";
```

(b) `export interface Task { … }`（现 `:44`）的字段末尾加 `agent?: PartialSelection;`（plan 文件任务层，T10 的 `agent` 字段）。

(c) `ScriptEntry` 之后加：

```ts
/** Agent selection (T16): a world may also carry the CLI-level fake claude, with its own marker and script. */
export interface WorldOptions { claudeScript?: Record<string, ScriptEntry> }

/**
 * The version ccloop's probeVersion reads from `<command> --version` (W6-14: the first x.y.z[-tag] in its
 * stdout). The table must carry exactly this, or accept refuses as agent-version-drift.
 */
function versionOf(command: string[]): string {
  const out = execFileSync(command[0]!, [...command.slice(1), "--version"], { encoding: "utf8", timeout: 10_000 });
  const match = /\d+\.\d+\.\d+(-[\w.]+)?/.exec(out);
  if (!match) throw new Error(`no version in ${JSON.stringify(out)}`);
  return match[0];
}
```

(d) `async function world(tasks: Task[], script: Record<string, ScriptEntry>)` 签名改为 `async function world(tasks: Task[], script: Record<string, ScriptEntry>, options: WorldOptions = {})`。

(e) 在 T7 写出表文件**之前**（T7 的 `table` 变量已建好、`writeFile(<table path>, …)` 之前）插入：

```ts
    const claudeMarker = join(root, "claude-marker.json");
    if (options.claudeScript !== undefined) {
      const claudeScriptPath = join(root, "claude-script.json");
      await writeFile(claudeScriptPath, JSON.stringify(options.claudeScript));
      const fakeClaude = resolve(dirname(realBinary!), "..", "tests", "fixtures", "fake-claude-cli.mjs");
      const command = [process.execPath, fakeClaude, "script", claudeMarker, claudeScriptPath];
      table.installations.claude = { kind: "claude", command, version: versionOf(command), configDir: null, timeoutMs: 120_000, killGraceMs: KILL_GRACE_MS };
    }
```

(f) plan 任务行（现 `:98` 的 `planTasks.push({…})`，T7／T10 删掉 `configHash` 之后）在对象末尾加 `...(task.agent === undefined ? {} : { agent: task.agent })`。

(g) (d) 给 `world` 加了形参 `options`，会遮住外层 `ccloopWorlds(options: {rootPrefix, epochPrefix})` 的同名参数 ⇒ **把外层参数改名为 `worldsOptions`**，并改它在本文件里的两处引用（现 `:64` 的 `options.rootPrefix`、`:116` 的 `options.epochPrefix`）。然后 `boot` 改为：

```ts
    const boot = async (driverCrash?: (point: CrashPoint) => void, wrapPort?: (port: ExecutionPort) => ExecutionPort): Promise<ControlRuntime> => {
      const runtime = await assembleControlRuntime({ control, repos, epoch: `${worldsOptions.epochPrefix}${++epoch}`, env, driverCrash, wrapPort });
```

（其余行不动。F1 的 `recording` 用对象展开包 port：前提是 T7 的 `createCcloopExecutionPort` 返回的方法不依赖 `this`——今天 `ccloopPort.ts` 是对象字面量；T7 若改成 class，`recording` 改为 `Object.assign(Object.create(Object.getPrototypeOf(port)), port, { resolveAgent })`。）

(h) `calls`／`scripted` 之后加：

```ts
    const markerOf = (kind: "claude" | "codex"): string => (kind === "claude" ? claudeMarker : marker);
    /** Agent selection (T16): one JSON array per CLI invocation (ccloop T3's `<marker>.argv`), `--version` probes excluded. */
    const argv = (kind: "claude" | "codex"): string[][] =>
      lines(`${markerOf(kind)}.argv`).map((line) => JSON.parse(line) as string[]).filter((args) => !args.includes("--version"));
    const callsOf = (kind: "claude" | "codex"): string[] => lines(`${markerOf(kind)}.calls`);
    const scriptedOf = (kind: "claude" | "codex"): string[] => lines(`${markerOf(kind)}.tasks`);
```

并把 `argv, callsOf, scriptedOf` 加进 `return { … }`。

- [ ] **Step 2：`src/panel/controlAssembly.ts` 加测试专用注入口**

`ControlAssemblyInput`（`:102-109`）在 `driverCrash?` 之后加：

```ts
  /**
   * Test-only (agent selection spec §9 criterion 8): wraps the chosen port so a criterion can record which
   * selection each gate asked ccloop about. Never set by the CLI.
   */
  wrapPort?: (port: ExecutionPort) => ExecutionPort;
```

`:164` `const port = choosePort(control, env);` 改为：

```ts
  const chosen = choosePort(control, env);
  const port = input.wrapPort ? input.wrapPort(chosen) : chosen;
```

- [ ] **Step 3：写判据 `tests/control/agentSelectionE2E.test.ts`（5 条）**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { AgentSelection, FrozenSlot, OperatorPreferences, PartialSelection } from "../../src/control/agentSelection.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { readDriverRun, readStartEnvelope } from "../../src/control/executionDriver.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { readStopIntent } from "../../src/control/stopIntent.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup, readSelectionPreview } from "../../src/panel/controlViews.js";
import { ccloopWorlds, noBlocked, raw, realBinary, until, workRuns, type RunRow, type ScriptEntry, type Task, type World } from "./fixtures/ccloopWorld.js";

/**
 * Agent selection spec §9 criteria 8 and 11 against the real ccloop build (ORCA_CCLOOP_BIN, which must contain
 * ccloop T1-T6: the agents table, envelope v2, capabilities v3, the ClaudeAgentAdapter, the CLI-level fake claude
 * with `.argv`, fake codex's `.argv` and `--version`, and `ccloop run --agents`). Everything is relocated under a
 * temporary root. The honest claim: with the CLI-level fake claude and fake codex, a soft group and an estimator
 * that is blocked-capability, the selection frozen at confirm reaches each CLI's argv -- the reconcile run's
 * included -- and a later change of the operator's default reaches nothing the confirmed group dispatches; and
 * ④'s handoff, continuation (both paths) and three-way conflict run once each under fake claude. Real claude
 * is not claimed (spec §11: its paid run is the next round's).
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-agents-e2e-", epochPrefix: "epoch-agents-e2e-" });
afterAll(removeRoots);

/** raw()'s actorId (ccloopWorld.ts): the operator whose preferences confirm reads (W6-16). */
const OPERATOR = "human";
let seq = 0;

const modelOf = (args: string[]): string | null => {
  const index = args.indexOf("--model");
  return index < 0 ? null : args[index + 1] ?? null;
};
const tally = (values: Array<string | null>): Record<string, number> =>
  values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [String(value)]: (counts[String(value)] ?? 0) + 1 }), {});
const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;
const runsOf = (runtime: ControlRuntime, taskId: string): RunRow[] => workRuns(runtime).filter((run) => run.task === taskId);
const settledAll = (runtime: ControlRuntime, taskIds: string[]): boolean =>
  taskIds.every((id) => workStatus(runtime, id) === "done") && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true);
const claimAgent = (runtime: ControlRuntime, run: RunRow): unknown =>
  (readStartEnvelope(runtime.store, run.body as never) as unknown as { claim: { agent: unknown } }).claim.agent;
/** ccloop's own record of the configuration it materialized at accept (spec §4.6) -- not Orca's store. */
const materialized = (run: RunRow): { selection: unknown } =>
  JSON.parse(readFileSync(join(run.body.drive.sourceDir, "control", "config.json"), "utf8")) as { selection: unknown };

/** set-agent-preferences through the service, under the operator row's own revision (0 while none exists). */
async function setPreferences(runtime: ControlRuntime, preferences: OperatorPreferences): Promise<void> {
  const row = runtime.store.db.prepare("SELECT revision FROM agent_preferences WHERE operator_id=?").get(OPERATOR);
  const revision = row === undefined ? 0 : Number(row.revision);
  const answer = await runtime.service.setAgentPreferences({
    schema: "orca-raw-command-v1", commandId: `prefs-${++seq}`, actorId: OPERATOR, verb: "set-agent-preferences",
    target: { kind: "operator", operatorId: OPERATOR }, expectedRevision: revision, payload: { expectedRevision: revision, preferences },
  } as never);
  if ("error" in answer) throw new Error(`set-agent-preferences refused: ${JSON.stringify(answer)}`);
}

/** Import, preview as the panel would (T14), confirm soft on that preview's hash; answers what each slot froze. */
async function confirmAgentGroup(runtime: ControlRuntime, repoId: string): Promise<Record<string, FrozenSlot>> {
  const imported = await runtime.service.importPlan(raw(runtime, `import-${++seq}`, "import-plan", { groupId: "g", repoId, planId: "plan" }));
  expect(imported).toMatchObject({ result: { kind: "imported", estimateState: "blocked-capability" } });
  const preview = await readSelectionPreview(runtime.store, runtime.port, OPERATOR, "g");
  if (preview.selectionsHash === null) throw new Error(`preview rejected: ${JSON.stringify(preview.slots)}`);
  const hash = runtime.router.list()[0]!.profileHash;
  const confirmed = await runtime.service.confirm(raw(runtime, `confirm-${++seq}`, "confirm", {
    planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: preview.proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: null }, selectionsHash: preview.selectionsHash,
  }));
  expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
  return Object.fromEntries(preview.slots.map((slot) => [slot.key, (slot.outcome as { kind: "resolved"; frozen: FrozenSlot }).frozen]));
}

/** Optionally widen the token ceiling (execution driver deviation D12), then start. */
async function startConfirmed(runtime: ControlRuntime, raiseTokens = 0): Promise<void> {
  if (raiseTokens > 0) {
    const limit = readControlGroup(runtime.store, runtime.epoch, "g").ledger.groupLimit;
    const raised = runtime.service.setLimit(raw(runtime, `raise-${++seq}`, "set-limit", { limit: { ...limit, tokens: limit.tokens + raiseTokens } }));
    expect("error" in raised ? raised.error : "raised").toBe("raised");
  }
  const started = await runtime.service.start(raw(runtime, `start-${++seq}`, "start", {}));
  expect("error" in started ? started.error : "started").toBe("started");
}

async function handoffStop(runtime: ControlRuntime): Promise<string[]> {
  const stopped = await runtime.service.handoffStop(raw(runtime, `stop-${++seq}`, "handoff-stop", {}));
  if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(stopped)}`);
  return stopped.result.requestIds;
}

/** The panel's rule (web/src/ControlGroupView.tsx `continuableRuns`) applied to the server's read model. */
function panelSelections(runtime: ControlRuntime): Array<{ taskId: string; predecessorRunId: string; checkpointId: string }> {
  const view = readControlGroup(runtime.store, runtime.epoch, "g");
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.continuable !== true) return [];
    const checkpoint = view.checkpoints.find((candidate) => candidate.runId === run.runId && candidate.state !== "unknown");
    return checkpoint ? [{ taskId: run.taskId, predecessorRunId: run.runId, checkpointId: checkpoint.checkpointId }] : [];
  });
}

const requestState = (runtime: ControlRuntime, requestId: string): string =>
  String(runtime.store.db.prepare("SELECT state FROM handoff_requests WHERE id=?").get(requestId)!.state);

async function inExecute(w: World, runtime: ControlRuntime, taskIds: string[]): Promise<void> {
  await until(() => { noBlocked(runtime); return taskIds.every((id) => w.scriptedOf("claude").includes(`execute ${id}`)); }, 120_000, `${taskIds.join(",")} to enter execute`, 20);
}

/** ④'s one-task halves (handoffE2E.test.ts HALVES), under fake claude. */
const HALVES: Record<string, ScriptEntry> = { a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 6_000 } }, "a#continuation": { files: { "a2.txt": "A2\n" } } };
const HALVES_TASKS: Task[] = [{ taskId: "a", targetPaths: ["a1.txt", "a2.txt"] }];
const HALVES_SCRIPTED = ["plan a", "execute a", "plan a#continuation", "execute a#continuation", "verify a"];
const CLAUDE: AgentSelection = { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" };

describe.skipIf(!realBinary)("agent selection against real ccloop (spec §9 criteria 8 and 11)", { timeout: 420_000 }, () => {
  relocateHome("orca-agents-e2e-home-");

  it("M1: a mixed group runs claude and codex side by side, and the model each slot froze -- the reconcile run's included -- reaches its CLI", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["shared.txt"] },
      { taskId: "b", targetPaths: ["shared.txt"], agent: { agent: "codex" } },
      { taskId: "c", targetPaths: ["c.txt"], verifierType: "command", agent: { contextWindow: 1_000_000 } },
    ], {
      b: { files: { "shared.txt": "B\n" } },
      "reconcile-a-b": { files: { "shared.txt": "A\nB\n" } }, "reconcile-b-a": { files: { "shared.txt": "A\nB\n" } },
    }, { claudeScript: { a: { files: { "shared.txt": "A\n" } }, c: { files: { "c.txt": "C\n" } } } });
    const runtime = await w.boot(); try {
      await setPreferences(runtime, { defaultAgent: "claude", perAgent: { claude: { model: "claude-opus-5-5" } }, reconcile: { agent: "codex", model: "gpt-6-reconcile" } });
      const frozen = await confirmAgentGroup(runtime, w.repoId);
      expect(frozen["task:a"]!.selection).toEqual(CLAUDE);
      expect(frozen["task:b"]!.selection).toEqual({ agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" });
      expect(frozen["task:b"]!.provenance).toEqual({ agent: "task", model: "descriptor", contextWindow: "descriptor" });
      expect(frozen["task:c"]!.selection).toEqual({ ...CLAUDE, contextWindow: 1_000_000 });
      expect(frozen.reconcile!.selection).toEqual({ agent: "codex", model: "gpt-6-reconcile", contextWindow: "agent-default" });
      await startConfirmed(runtime, 10_000_000);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a", "b", "c"]); }, 360_000, "every task to settle");
      expect(w.show("shared.txt")).toBe("A\nB");
      expect(w.show("c.txt")).toBe("C");
      expect(workRuns(runtime).filter((run) => run.body.drive.reconcile !== null)).toHaveLength(1);
      // a: plan, execute, verify (agent verifier); c: plan, execute (command verifier) with the 1M suffix (spec §4.1).
      expect(tally(w.argv("claude").map(modelOf))).toEqual({ "claude-opus-5-5": 3, "claude-opus-5-5[1m]": 2 });
      // b: plan, execute, verify; the reconciliation (whichever task landed second): plan, execute, with the reconcile slot's model.
      expect(tally(w.argv("codex").map(modelOf))).toEqual({ "gpt-6-sol": 3, "gpt-6-reconcile": 2 });
      expect(w.scriptedOf("codex").filter((line) => / reconcile-/.test(line))).toHaveLength(2);
      for (const run of workRuns(runtime)) expect(claimAgent(runtime, run)).toEqual(frozen[`task:${run.task}`]!.selection);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("F1: once confirmed, a change of the operator's default reaches nothing the group dispatches -- not the envelope, not ccloop's materialized config, not the CLI, not the gates' capability probes", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], {}, { claudeScript: { a: { files: { "shared.txt": "A\n" } } } });
    const probes: PartialSelection[] = [];
    const recording = (port: ExecutionPort): ExecutionPort => ({
      ...port,
      resolveAgent: async (partial: PartialSelection) => { probes.push(structuredClone(partial)); return port.resolveAgent(partial); },
    });
    const runtime = await w.boot(undefined, recording); try {
      await setPreferences(runtime, { defaultAgent: "claude", perAgent: {} });
      const frozen = await confirmAgentGroup(runtime, w.repoId);
      expect(frozen["task:a"]!.selection).toEqual(CLAUDE);
      // A default no dispatch may use: another agent, and a model ccloop refuses (spec §4.1), so a gate that
      // read it would either probe with it -- recorded below -- or block the run.
      await setPreferences(runtime, { defaultAgent: "codex", perAgent: { codex: { model: "-poisoned" }, claude: { model: "claude-poisoned" } } });
      const mark = probes.length;
      await startConfirmed(runtime);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a"]); }, 240_000, "a to settle");
      const [run] = runsOf(runtime, "a");
      expect(claimAgent(runtime, run!)).toEqual(CLAUDE);
      expect(materialized(run!).selection).toEqual(CLAUDE);
      expect(w.argv("claude").map(modelOf)).toEqual(["claude-opus-5-5", "claude-opus-5-5", "claude-opus-5-5"]);
      expect(w.argv("codex")).toEqual([]);
      const gates = probes.slice(mark);
      expect(gates.length).toBeGreaterThan(0);
      for (const partial of gates) expect(partial).toEqual(CLAUDE);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("CH: under fake claude, a run stopped mid-execute parks its half, the panel's resume continues it with the same frozen selection, and the task lands whole", async () => {
    const w = await world(HALVES_TASKS, {}, { claudeScript: HALVES });
    const runtime = await w.boot(); try {
      await setPreferences(runtime, { defaultAgent: "claude", perAgent: {} });
      await confirmAgentGroup(runtime, w.repoId);
      await startConfirmed(runtime);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [predecessor] = runsOf(runtime, "a");
      const [requestId] = await handoffStop(runtime);
      await until(() => { noBlocked(runtime); return requestState(runtime, requestId!) === "settled-recoverable"; }, 120_000, "the request to settle recoverable");
      const parked = readDriverRun(runtime.store, predecessor!.runId) as unknown as Record<string, any>;
      expect(parked).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(readStopIntent(runtime.store, "g")!.state).toBe("handoff-complete");
      const selections = panelSelections(runtime);
      expect(selections).toEqual([{ taskId: "a", predecessorRunId: predecessor!.runId, checkpointId: parked.checkpointId }]);
      const resumed = await runtime.service.resumeFromHandoff(raw(runtime, `resume-${++seq}`, "resume-from-handoff", { selections }));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a"]); }, 240_000, "the continuation to land and settle");
      const continuation = runsOf(runtime, "a").find((run) => run.runId !== predecessor!.runId)!;
      expect([w.show("a1.txt"), w.show("a2.txt")]).toEqual(["A1", "A2"]);
      expect(w.landings()).toBe(1);
      // spec §3 I1: the continuation inherits its predecessor's selection, and ccloop materialized the same one.
      expect(claimAgent(runtime, continuation)).toEqual(claimAgent(runtime, predecessor!));
      expect(materialized(continuation).selection).toEqual(CLAUDE);
      expect(w.scriptedOf("claude")).toEqual(HALVES_SCRIPTED);
      expect(w.argv("claude").map(modelOf)).toEqual(Array(5).fill("claude-opus-5-5"));
      expect(w.argv("codex")).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("CC: under fake claude, a held task is continued by continue-task after an empty resume, with the same frozen selection", async () => {
    const w = await world(HALVES_TASKS, {}, { claudeScript: HALVES });
    const runtime = await w.boot(); try {
      await setPreferences(runtime, { defaultAgent: "claude", perAgent: {} });
      await confirmAgentGroup(runtime, w.repoId);
      await startConfirmed(runtime);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a"]);
      const [predecessor] = runsOf(runtime, "a");
      const [requestId] = await handoffStop(runtime);
      await until(() => { noBlocked(runtime); return requestState(runtime, requestId!) === "settled-recoverable"; }, 120_000, "the request to settle recoverable");
      const parked = readDriverRun(runtime.store, predecessor!.runId) as unknown as Record<string, any>;
      // continue-task needs a dispatch-enabled group (continuation.ts applyContinueTask): an empty resume reopens it
      // and leaves a held (continuation.ts applyResumeFromHandoff registers nothing for an empty selection).
      const reopened = await runtime.service.resumeFromHandoff(raw(runtime, `resume-${++seq}`, "resume-from-handoff", { selections: [] }));
      expect("error" in reopened ? reopened.error : reopened.result.kind).toBe("resumed-from-handoff");
      expect(workStatus(runtime, "a")).toBe("held");
      const continued = await runtime.service.continueTask(raw(runtime, `continue-${++seq}`, "continue-task",
        { predecessorRunId: predecessor!.runId, checkpointId: parked.checkpointId }, { kind: "task", groupId: "g", taskId: "a" }));
      expect("error" in continued ? continued.error : continued.result.kind).toBe("task-continuing");
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a"]); }, 240_000, "the continuation to land and settle");
      const continuation = runsOf(runtime, "a").find((run) => run.runId !== predecessor!.runId)!;
      expect([w.show("a1.txt"), w.show("a2.txt")]).toEqual(["A1", "A2"]);
      expect(claimAgent(runtime, continuation)).toEqual(CLAUDE);
      expect(materialized(continuation).selection).toEqual(CLAUDE);
      expect(w.scriptedOf("claude")).toEqual(HALVES_SCRIPTED);
      expect(w.argv("claude").map(modelOf)).toEqual(Array(5).fill("claude-opus-5-5"));
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("C3: under fake claude, three parallel runs stopped mid-execute all continue, and both reconciliations run with the reconcile slot's own model", async () => {
    const own = (id: string): ScriptEntry => ({ files: { "shared.txt": `${id.toUpperCase()}\n`, [`${id}.txt`]: `${id.toUpperCase()}\n` }, delayMs: { execute: 8_000 } });
    const script: Record<string, ScriptEntry> = {
      a: own("a"), b: own("b"), d: own("d"),
      "a#continuation": { files: { "a.txt": "A2\n" } }, "b#continuation": { files: { "b.txt": "B2\n" } }, "d#continuation": { files: { "d.txt": "D2\n" } },
    };
    for (const [self, other] of [["a", "b"], ["b", "a"], ["a", "d"], ["d", "a"], ["b", "d"], ["d", "b"]] as const) {
      script[`reconcile-${self}-${other}`] = { files: { "shared.txt": [self, other].sort().map((id) => `${id.toUpperCase()}\n`).join("") } };
    }
    for (const [self, x, y] of [["a", "b", "d"], ["b", "a", "d"], ["d", "a", "b"]] as const) script[`reconcile-${self}-${x}-${y}`] = { files: { "shared.txt": "A\nB\nD\n" } };
    const w = await world(["a", "b", "d"].map((id) => ({ taskId: id, targetPaths: ["shared.txt", `${id}.txt`] })), {}, { claudeScript: script });
    const runtime = await w.boot(); try {
      await setPreferences(runtime, { defaultAgent: "claude", perAgent: {}, reconcile: { model: "claude-fable-5" } });
      const frozen = await confirmAgentGroup(runtime, w.repoId);
      expect(frozen.reconcile!.selection).toEqual({ ...CLAUDE, model: "claude-fable-5" });
      await startConfirmed(runtime, 10_000_000);
      runtime.startPump(50);
      await inExecute(w, runtime, ["a", "b", "d"]);
      const requestIds = await handoffStop(runtime);
      expect(requestIds).toHaveLength(3);
      await until(() => requestIds.every((id) => requestState(runtime, id) === "settled-recoverable"), 120_000, "three requests to settle recoverable");
      const selections = panelSelections(runtime);
      expect(selections.map((selection) => selection.taskId).sort()).toEqual(["a", "b", "d"]);
      const resumed = await runtime.service.resumeFromHandoff(raw(runtime, `resume-${++seq}`, "resume-from-handoff", { selections }));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
      await until(() => { noBlocked(runtime); return settledAll(runtime, ["a", "b", "d"]); }, 360_000, "three continuations to land");
      expect(w.show("shared.txt")).toBe("A\nB\nD");
      expect(w.landings()).toBe(3);
      expect(w.scriptedOf("claude").filter((line) => line.startsWith("execute reconcile-"))).toHaveLength(2);
      // ④ H2's count (handoffE2E.test.ts): 3 stopped (plan, execute) + 3 continuations (plan, execute, verify) = 15
      // worker calls at the worker model; 2 reconciliations (plan, execute) = 4 calls at the reconcile slot's model.
      expect(tally(w.argv("claude").map(modelOf))).toEqual({ "claude-opus-5-5": 15, "claude-fable-5": 4 });
      expect(w.argv("codex")).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
```

- [ ] **Step 4：造含 T1–T6 的 ccloop build 与 env（新目录，不在旧副本里 pull —— handoff §8.2）**

```bash
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad
DEST="$S/ccloop-agents-$(date +%Y%m%d%H%M%S)"
/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop "$DEST" > "$S/t16-ccloop-clone.log" 2>&1; echo "RC=$?" >> "$S/t16-ccloop-clone.log"
ln -s /Users/biran/code/skills/loop/ccloop/node_modules "$DEST/node_modules"
( cd "$DEST" && npm run build ) > "$S/t16-ccloop-build.log" 2>&1; echo "RC=$?" >> "$S/t16-ccloop-build.log"
/usr/bin/git -C "$DEST" log --oneline -3 > "$S/t16-ccloop-head.txt"
python3 - "$DEST" >> "$S/t16-ccloop-head.txt" <<'EOF'
import os, sys
d = sys.argv[1]
fc = open(f"{d}/tests/fixtures/fake-codex.mjs").read()
print("FAKE_CLAUDE_CLI", os.path.exists(f"{d}/tests/fixtures/fake-claude-cli.mjs"))
print("CODEX_ARGV", '".argv"' in fc or "'.argv'" in fc or '+".argv"' in fc)
print("CODEX_VERSION", "--version" in fc)
print("AGENTS_DIR", os.path.isdir(f"{d}/src/agents"))
print("CLAUDE_ADAPTER", os.path.exists(f"{d}/src/runtime/claude/claudeAgentAdapter.ts"))
EOF
cat "$S/t16-ccloop-clone.log" "$S/t16-ccloop-build.log" "$S/t16-ccloop-head.txt"
```

Expected：两个 RC 0；五行 `True`。任一 `False` ⇒ **停下报控制器**（W6-13 或 T1／T3 未落）。

env 与一张给**既有**消费者用的表（`verify:control` 的前置检查、T7 改写后的 `webCcloopSmoke`；**本 Task 的判据各自造表**）：

```bash
python3 - "$S" "$DEST" > "$S/t16-env.log" 2>&1 <<'EOF'
import json, os, re, subprocess, sys
s, dest = os.path.realpath(sys.argv[1]), os.path.realpath(sys.argv[2])
node = os.path.realpath(os.popen("command -v node").read().strip())
root = f"{s}/t16-agents"; os.mkdir(root, 0o700)
def version(command):
    out = subprocess.run(command + ["--version"], capture_output=True, text=True, timeout=10).stdout
    return re.search(r"\d+\.\d+\.\d+(-[\w.]+)?", out).group(0)
empty = f"{root}/claude-script.json"; open(empty, "w").write("{}")
codex = [node, f"{dest}/tests/fixtures/fake-codex.mjs", "integration", f"{root}/codex-marker.json"]
claude = [node, f"{dest}/tests/fixtures/fake-claude-cli.mjs", "script", f"{root}/claude-marker.json", empty]
table = {"schema": "ccloop-agents-table-v1", "installations": {
  "codex": {"kind": "codex", "command": codex, "version": version(codex), "configDir": None, "timeoutMs": 120000, "killGraceMs": 5000, "sandbox": "workspace-write", "budgetMode": "soft"},
  "claude": {"kind": "claude", "command": claude, "version": version(claude), "configDir": None, "timeoutMs": 120000, "killGraceMs": 5000},
}}
path = f"{root}/agents.json"
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.write(fd, json.dumps(table, indent=2).encode()); os.close(fd)
binary = f"{dest}/dist/cli.js"
for p in (binary, path): assert os.path.realpath(p) == p, p
print("mode", oct(os.stat(path).st_mode & 0o777), "dir", oct(os.stat(root).st_mode & 0o777))
open(f"{s}/t16-env.sh", "w").write(f"export ORCA_CCLOOP_BIN={binary}\nexport ORCA_AGENTS_TABLE={path}\n")
print(open(f"{s}/t16-env.sh").read())
EOF
echo "RC=$?" >> "$S/t16-env.log"; cat "$S/t16-env.log"
( source "$S/t16-env.sh" && "$ORCA_CCLOOP_BIN" agents validate "$ORCA_AGENTS_TABLE" ) > "$S/t16-validate.log" 2>&1; echo "RC=$?" >> "$S/t16-validate.log"; cat "$S/t16-validate.log"
```

Expected：`mode 0o600 dir 0o700`；两行 export；`agents validate` 两条 `ok`、RC 0（W6-14：RC 非 0 且报 `agent-version-drift` ⇒ `version()` 与 ccloop 的 `probeVersion` 规则不一致，报控制器，按 T1 的规则改这里与 Step 1 的 `versionOf`，两处一起改）。

- [ ] **Step 5：跑判据（先不带 env 看它 skip，再带 env 跑）**

```bash
cd /Users/biran/code/skills/loop/Orca
./node_modules/.bin/vitest run tests/control/agentSelectionE2E.test.ts > "$S/t16-noenv.log" 2>&1; echo "rc=$?" >> "$S/t16-noenv.log"
( source "$S/t16-env.sh" && ./node_modules/.bin/vitest run tests/control/agentSelectionE2E.test.ts --reporter=json --outputFile="$S/t16-e2e.json" ) > "$S/t16-e2e.log" 2>&1; echo "rc=$?" >> "$S/t16-e2e.log"
cat "$S/t16-noenv.log" "$S/t16-e2e.log"
python3 -c "import json;d=json.load(open('$S/t16-e2e.json'));print([(a['title'][:3],a['status'],a.get('duration')) for f in d['testResults'] for a in f['assertionResults']])" > "$S/t16-e2e-summary.txt"; cat "$S/t16-e2e-summary.txt"
```

Expected：无 env ⇒ `5 skipped`、rc 0（**这不是过**，只证明 skipIf 生效）；带 env ⇒ `5 passed`、rc 0。本文件写在 T3–T14 之后，**RED 阶段不存在**——所以每条都必须靠 Step 6 的变异看见红，才算判据（Rule 9 推论 1）。

- [ ] **Step 6：变异（Orca 副本 ＋ 需要时 ccloop 副本；E2E 变异 `source "$S/t16-env.sh"`，用 `-t` 全名过滤只跑期望红的那条；ccloop 侧变异后在该 ccloop 副本里重 `npm run build`，并临时把 `ORCA_CCLOOP_BIN` 指向它）**

| 编号 | 仓 | 改哪 | 怎么改 | 期望红 |
|---|---|---|---|---|
| T16-M1 | Orca | `controlAssembly.ts` | `const port = input.wrapPort ? input.wrapPort(chosen) : chosen;` → `const port = chosen;` | F1（`gates.length` 为 0） |
| T16-M2 | Orca | T11 的派活闸门（`webDispatch.ts` 的 `scheduleStart` 或 `dispatch.ts` 的 `assertCapabilities` 调用点，按 T11 落地的实际一处） | 传给 `resolveAgent` 的 `run.agent` 换成按**当前**操作者偏好重新解析的 partial | F1（`partial` 不等于 `CLAUDE`，或 run 被 `-poisoned` 挡成 blocked） |
| T16-M3 | Orca | T12 的解冲突选择文件（`driverLanding.ts`） | 写入的 `selection` 用该 run 的 worker 选择而不是组冻结的 reconcile 选择 | M1（codex 的 tally 里没有 `gpt-6-reconcile`；或 ccloop 以 `control-config-hash-mismatch` 拒，run blocked） |
| T16-M4 | Orca | T11 的 continuation 造 run 行（`continuation.ts`） | 续跑 run 的 `agent` 改为按当前偏好重新解析 | CH 与 CC（`claimAgent` 不等） |
| T16-M5 | ccloop | `ClaudeAgentAdapter`／runner 的 `[1m]` 拼接 | 去掉 `[1m]` 后缀 | M1（claude tally 变 `{"claude-opus-5-5": 5}`） |
| T16-M6 | ccloop | fake claude CLI 的 `.argv` 追加 | 删掉追加 `.argv` 那一行 | M1、F1、CH、CC、C3 全红（`argv` 为空）——证明这些断言读的是真 argv 而不是空集 |
| T16-M7 | Orca | 本文件 `ccloopWorld.ts` 的 (f) | 删掉 `...(task.agent === undefined ? {} : { agent: task.agent })` | M1（`frozen["task:b"]` 是 claude） |

每条记「前后 sha256 全 64 位、红在哪条的哪个断言、RC、是否与预言一致」进 `mutations.md`；实测与预言不一致 ⇒ **记实测，不改判据迁就**。还原证明看两个副本的 `git diff`／`git diff --cached` 字节数为 0。

- [ ] **Step 7：提交**

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add tests/control/fixtures/ccloopWorld.ts src/panel/controlAssembly.ts tests/control/agentSelectionE2E.test.ts
/usr/bin/git diff --cached --stat > "$S/t16-stat.log"; cat "$S/t16-stat.log"
/usr/bin/git commit -F "$S/t16-msg.txt"
```

`$S/t16-msg.txt`：

```
test(control): drive a mixed claude and codex group through the loop on frozen selections

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

---

## Task 17：两仓全套门 ＋ 机械判定器 ＋ `check-known-reds` ＋ 台账收口

**依赖**：T1–T16 全部落地。

**Files:**
- Create（scratchpad，**不入库**）：`$S/check-agents.py`、`$S/gates-agents.sh`
- Modify（只追加）：`.superpowers/sdd/2026-09-26-agent-selection/progress.md`（`git add -f` **单独**加）

**台账约定（判定器读，所有 Task 从现在起照写）**：改写既有判据的每一条，在 `progress.md` 写一行
`- REWRITTEN: <orca|web|ccloop>:<相对路径> > <describe …> > <it>`（`<describe …>` 多层时用 ` > ` 连；编译期半边这种非 `it` 的写 `(compile-time half) <函数名>`，判定器跳过它的状态检查、只查文件里有注释）。

- [ ] **Step 1：判定器 `$S/check-agents.py`**

```python
# check-agents.py <orca-json> <web-json> <ccloop-json> <added.txt> <progress.md> [<rerun-json>...]
#   -- agent selection round (spec docs/superpowers/specs/2026-09-26-agent-selection-design.md)
import json, os, re, sys
orca, web, ccloop = (json.load(open(p)) for p in sys.argv[1:4])
added = [line.strip() for line in open(sys.argv[4]) if line.strip()]          # "<repo>:<path>" from git diff --diff-filter=A
progress = open(sys.argv[5]).read()
reruns = [json.load(open(p)) for p in sys.argv[6:]]                            # single-file re-runs of each failed file

# handoff §三: load-sensitive criteria; each may fail in the full run only if its file then passes alone.
FLAKE_FILES = {
    "tests/panel/controlShutdown.test.ts", "tests/control/driverRecovery.test.ts", "tests/control/driverLanding.test.ts",
    "tests/control/executionDriverE2E.test.ts", "tests/control/driverSettle.test.ts",
}
FLAKE_NAMES = {  # a flake in a file that also holds non-flaky criteria: named exactly
    "handoff delivery against real ccloop (spec §9.2) G: a delivered stop that yields nothing turns outcome-unknown only past deadline + the adapter's killGraceMs + 60 s",
}
WEB_FLAKE_NAMES = {"drops the id when the lookup returns the command's retained result"}
# W6's criterion files with their exact counts (T14-T16). Every other added criterion file is checked below by
# "present, >= 1, all passed"; its owner's plan part states its count and the controller adds it here.
EXPECTED = {
    ("orca", "tests/panel/agentSelectionApi.test.ts"): 7,
    ("orca", "tests/panel/webParity.test.ts"): 4,
    ("orca", "tests/control/agentSelectionE2E.test.ts"): 5,
    ("web", "web/tests/agentSettings.test.tsx"): 4,
    ("web", "web/tests/agentSelectionEditor.test.tsx"): 8,
}
REPORTS = {"orca": orca, "web": web, "ccloop": ccloop}
problems = []

def rows(report, suffix):
    return [a for f in report["testResults"] if f["name"].endswith("/" + suffix) or f["name"].endswith(suffix) for a in f["assertionResults"]]
def is_test(path):
    return re.search(r"\.test\.tsx?$", path) is not None

for name, d in REPORTS.items():
    if d["numPendingTests"] or d["numTodoTests"]:
        problems.append(f"{name}: pending={d['numPendingTests']} todo={d['numTodoTests']} (0 skipped is the bar: run the gates with t16-env.sh)")
for (repo, suffix), count in EXPECTED.items():
    got = rows(REPORTS[repo], suffix)
    if len(got) != count or any(a["status"] != "passed" for a in got):
        problems.append(f"{repo}:{suffix}: expected {count} passed, got {[a['status'] for a in got]}")
for entry in added:
    repo, path = entry.split(":", 1)
    if not is_test(path):
        continue
    report = web if path.startswith("web/") else REPORTS[repo]
    got = rows(report, path)
    if len(got) == 0 or any(a["status"] != "passed" for a in got):
        problems.append(f"added criterion file {entry}: expected >=1 all passed, got {[a['status'] for a in got]}")
for line in re.findall(r"^- REWRITTEN: (\S+?):(\S+) > (.+)$", progress, re.M):
    repo, path, chain = line
    if chain.startswith("(compile-time half)"):
        if "Rewritten for agent selection (2026-09-26" not in open(os.path.join({"orca": ".", "web": ".", "ccloop": "../ccloop"}[repo], path)).read():
            problems.append(f"rewritten compile-time half without its annotation: {repo}:{path}")
        continue
    report = web if path.startswith("web/") else REPORTS[repo]
    wanted = [a for a in rows(report, path) if " > ".join(a["ancestorTitles"] + [a["title"]]) == chain]
    if len(wanted) != 1 or wanted[0]["status"] != "passed":
        problems.append(f"rewritten criterion missing or not passed: {repo}:{path} > {chain}")

def failures(report):
    return [(f["name"], a["fullName"]) for f in report["testResults"] for a in f["assertionResults"] if a["status"] == "failed"]
def rerun_green(file_name):
    alone = [r for r in reruns if any(f["name"] == file_name for f in r["testResults"])]
    return bool(alone) and all(a["status"] == "passed" for r in alone for f in r["testResults"] for a in f["assertionResults"])
for file_name, full in failures(orca):
    flaky = any(file_name.endswith(x) for x in FLAKE_FILES) or full in FLAKE_NAMES
    if not flaky:
        problems.append(f"orca unexpected failure: {full}")
    elif not rerun_green(file_name):
        problems.append(f"orca flake not re-run green alone: {full}")
for file_name, full in failures(web):
    if not any(full.endswith(n) for n in WEB_FLAKE_NAMES):
        problems.append(f"web unexpected failure: {full}")
    elif not rerun_green(file_name):
        problems.append(f"web flake not re-run green alone: {full}")
# ccloop's failures are check-known-reds.mjs's to judge (by full name, against its roster); not repeated here.
print("OK" if not problems else "\n".join(problems))
sys.exit(1 if problems else 0)
```

红证（**必须先看见它退 1，两次**，输出与 RC 整份记进台账）：
(a) 拿本轮开工前的一份 Orca 全量 json（锚点 `545f452` 上跑的；没有就在一个 `git clone --local` 副本里 checkout `545f452` 跑一次 `./node_modules/.bin/vitest run --reporter=json`）、一份开工前的 web json 与 ccloop json，配上本轮的 `added.txt` 与 `progress.md` 喂它 ⇒ `EXPECTED` 五个文件各一行 `expected N passed, got []`、每个新增判据文件一行 ⇒ RC 1；
(b) 把本轮的 Orca json 复制一份，将 `tests/panel/agentSelectionApi.test.ts` 的一条 `status` 改成 `"failed"` 喂它 ⇒ RC 1（`orca unexpected failure` 与该文件那一行）。

- [ ] **Step 2：全套门 `$S/gates-agents.sh`**（逐段单跑、各取 RC、全部重定向到文件；**不许**用 `npm run verify` 的 `&&` 链；**不并发**，本机有常驻生产 daemon）

```bash
#!/bin/bash
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad
source "$S/t16-env.sh"
O=/Users/biran/code/skills/loop/Orca
C=/Users/biran/code/skills/loop/ccloop
G="$S/gates/agents"; mkdir -p "$G"
: > "$G/summary.txt"
run() { name=$1; shift; ( cd "$O" && "$@" ) > "$G/$name.log" 2>&1; echo "$name RC=$?" >> "$G/summary.txt"; }
crun() { name=$1; shift; ( cd "$C" && "$@" ) > "$G/$name.log" 2>&1; echo "$name RC=$?" >> "$G/summary.txt"; }
# ccloop first: Orca's E2E files run against a ccloop build, and a red ccloop tree means that build is not one to trust.
crun ccloop-typecheck npm run typecheck
crun ccloop-build npm run build
crun ccloop-test ./node_modules/.bin/vitest run --reporter=json --outputFile="$G/ccloop.json"
crun ccloop-known-reds node scripts/check-known-reds.mjs "$G/ccloop.json"
crun ccloop-verify-control npm run verify:control
# Orca: web build first (staticFiles/verify:panel read web/dist).
run web-build npm run build --workspace web
run typecheck npm run typecheck
run test ./node_modules/.bin/vitest run --reporter=json --outputFile="$G/orca.json"
( cd "$O/web" && ../node_modules/.bin/vitest run --reporter=json --outputFile="$G/web.json" ) > "$G/web-test.log" 2>&1; echo "web-test RC=$?" >> "$G/summary.txt"
run verify-control npm run verify:control
run web-control npm run verify:web-control
run web-control-consumer npm run verify:web-control:consumer
run scheduler npm run verify:scheduler
run chain npm run verify:chain
run panel npm run verify:panel
run ws-check npm run --ws check
run claude-md node scripts/check-claude-md-lines.mjs
run hooks-path node scripts/check-hooks-path.mjs
run ledger npm run ledger -- validate .decisions
# The round's added files, both repos, from the observation anchors (Orca 545f452, ccloop f4e49a2).
( cd "$O" && /usr/bin/git diff --diff-filter=A --name-only 545f452..HEAD | sed 's/^/orca:/' ) > "$G/added.txt"
( cd "$C" && /usr/bin/git diff --diff-filter=A --name-only f4e49a2..HEAD | sed 's/^/ccloop:/' ) >> "$G/added.txt"
echo DONE >> "$G/summary.txt"
```

之后（同一 shell，`S`、`G` 已设）：

```bash
python3 - "$G/orca.json" "$G/web.json" > "$G/failed-files.txt" <<'EOF'
import json, sys
for p in sys.argv[1:]:
    d = json.load(open(p))
    for f in d["testResults"]:
        if any(a["status"] == "failed" for a in f["assertionResults"]): print(f["name"])
EOF
i=0; RERUNS=()
while read -r file; do
  i=$((i+1))
  case "$file" in
    */web/tests/*) ( cd /Users/biran/code/skills/loop/Orca/web && ../node_modules/.bin/vitest run "$file" --reporter=json --outputFile="$G/rerun-$i.json" ) > "$G/rerun-$i.log" 2>&1 ;;
    *) ( cd /Users/biran/code/skills/loop/Orca && source "$S/t16-env.sh" && ./node_modules/.bin/vitest run "$file" --reporter=json --outputFile="$G/rerun-$i.json" ) > "$G/rerun-$i.log" 2>&1 ;;
  esac
  echo "rerun-$i $file RC=$?" >> "$G/summary.txt"; RERUNS+=("$G/rerun-$i.json")
done < "$G/failed-files.txt"
( cd /Users/biran/code/skills/loop/Orca && python3 "$S/check-agents.py" "$G/orca.json" "$G/web.json" "$G/ccloop.json" "$G/added.txt" .superpowers/sdd/2026-09-26-agent-selection/progress.md "${RERUNS[@]}" ) > "$G/check.log" 2>&1; echo "check RC=$?" >> "$G/summary.txt"
cat "$G/summary.txt"
```

判定（spec §9 criterion 13）：
- ccloop：`ccloop-typecheck`、`ccloop-build`、`ccloop-known-reds`、`ccloop-verify-control` RC 0（`ccloop-test` 的 RC 可以非 0，只要 `known-reds` RC 0 —— 失败 ⊆ 名单；W6-17：T4 若改了 `stopProof` 那条的全名，名单必须已同步改）。
- Orca：`web-build`、`typecheck`、`web-test`、`check`、`verify-control`、`web-control`、`web-control-consumer`、`scheduler`、`chain`、`panel`、`ws-check`、`claude-md`、`hooks-path` 逐段 RC 0；`ledger` RC ∈ {0, 2}；`test` 与 `chain` 的 RC 可以非 0，**只要** `check` RC 0（失败 ⊆ 已登记 flake 且单文件重跑绿）。
- **0 skipped**：`agentSelectionE2E`、`handoffE2E`、`executionDriverE2E` 必须带 env 跑；判定器的 pending 检查会抓 skip。
- `summary.txt`、每段日志、`check.log` **整份读回**；台账只抄工具报数（文件数、条数、RC、耗时），**不估**。
- ⚠️ `verify:control`／`verify:chain` 各会再跑含三份真 ccloop E2E 的套件，慢：整份脚本放后台（`run_in_background`）或给 600000 ms；**RC 从 `summary.txt` 读，不读后台通知的退出码**（handoff §6.8）。

- [ ] **Step 3：变异电池（单独的变异席，不是写实现的那一席 —— handoff §6.4）**

在 Orca 与 ccloop 各一个 `git clone --local` 副本里（软链 `node_modules`，Orca 副本另软链 `web/node_modules`；E2E 相关的 `source "$S/t16-env.sh"`，ccloop 侧变异要在副本里重 build 并把 `ORCA_CCLOOP_BIN` 指过去），逐条跑 T1–T16 各自的变异表：
1. 每组先跑一次该组判据文件的绿基线，RC 0 才往下；
2. 每条：`shasum -a 256` 前值 → python 整行锚点替换、断言命中 == 1 → 后值（相等当场停）→ 跑期望红（E2E 用 `-t` 全名过滤）→ 记红在哪几条 → `cat` 原文件还原 → `shasum` 等于前值；
3. 实测与预言不一致 ⇒ 记实测，不改判据迁就；预言不红的（T14-M9、T15-M13，及其它 Task 标出的）实测不红就登记「该分支无独占判据」进报控制器清单；
4. 跨 Task 的红证（T16-M2／M3／M4 让 T16 的 E2E 红）**真的重跑一次**，不许纸上推；
5. 还原证明：两个副本 `/usr/bin/git diff | wc -c` 与 `/usr/bin/git diff --cached | wc -c` 都是 0；删副本前 `/bin/rm -f` 软链本身，再 `/bin/rm -rf` 副本。

- [ ] **Step 4：台账收口（只追加）**

`.superpowers/sdd/2026-09-26-agent-selection/progress.md` 追加一节：本 Task 的归属（会话、席、模型）；Step 1 判定器两次红证的输出与 RC；Step 2 的门表（每段 RC，只抄工具报数）与 `t16-ccloop-head.txt` 全文（ccloop build 的头提交主题行）；所有 `- REWRITTEN:` 行是否齐全（逐条对照各 Task 的「既有判据」小节）；变异电池每条的「前后 sha256 全 64 位、红集合、RC、是否与预言一致」；登记为「无独占判据」的分支清单；W6-1 … W6-20 各条的实际处理。

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git add -f .superpowers/sdd/2026-09-26-agent-selection/progress.md
/usr/bin/git commit -F "$S/t17-msg.txt"
```

`$S/t17-msg.txt`：

```
docs(sdd): record the agent selection gates, judge and mutation battery

Co-Authored-By: <implementer's own model> <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR
```

（`.superpowers/sdd/**` 被 gitignore，**必须单独** `git add -f`，不和别的路径同一条 add —— handoff §7.2。）

- [ ] **Step 5：交回控制器的清单**（写进本席报告，不写进仓库）：两仓 `ls-remote` 与本地 `main` 的比对（开工一次、收尾一次，`/usr/bin/git`）；门表；判定器红证；变异电池里所有「预言不红」的实测；E2E 各条实测耗时（只抄工具报数）；**push（先 ccloop 后 Orca，spec §5）、合并进 main、删分支或 worktree 一律没做，列进 `awaitingHuman`**。
