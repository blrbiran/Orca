# Agent 选择：安装表、分层默认值、claude 走 ccloop control —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 操作者可在面板／plan 文件里按「操作者 → 组 → 任务」分层选择 agent（claude／codex）、model 与上下文档位；确认时冻结进每个 work item，经 ccloop control（envelope v2、capabilities v3、`--agents <table>`）下发；在 fake claude CLI ＋ fake codex 混组下，驱动环从确认跑到落地，选择一路出现在 CLI 的 argv 里。

**Architecture:** ccloop 新增 `src/agents/`（描述、安装表、探测、物化、版本核对）与 `ClaudeAgentAdapter`（进程组注册），control 改走安装表＋选择；Orca 新增 `src/control/agentSelection.ts`（纯函数分层解析）、偏好表与两个命令动词、异步 confirm（`selectionsHash`）、执行快照 v2、profile v2、`orca agents`，面板加设置页与提案视图的选择编辑。物化规则只在 ccloop（Orca 不重算 `configHash`）。

**Tech Stack:** TypeScript、zod、vitest、node:sqlite（ControlStore）、git CLI、React（`web/`）；ccloop 的 fake codex（`tests/fixtures/fake-codex.mjs`）与新的 CLI 层 fake claude（`tests/fixtures/fake-claude-cli.mjs`）。

**Spec:** `docs/superpowers/specs/2026-09-26-agent-selection-design.md`（**先读它**；**§12 优先于正文**，正文已按 §12 就地改）。上游：`2026-09-25-handoff-delivery-design.md`、`2026-09-25-execution-driver-design.md`、`2026-09-19-web-recoverable-control-design.md`；ccloop `docs/superpowers/specs/2026-09-24-g1-control-wire-contract-design.md`。

**归属**：Orca 控制器会话 `75ec878e`（Claude Opus 5.5），2026-09-26。骨架由控制器写；各 Task 正文由计划写作席展开（归属写在各节头）。观测锚点：Orca 主题行 `docs(spec): fold the independent review into the agent selection design`；ccloop 主题行 `docs(handoff): roll the Orca section: C5-C7 and C-3 landed here for the handoff delivery round`。**行号会移动 ⇒ 引用前现测。**

## Global Constraints

- 代码、注释、错误消息、CLI help、commit message 一律英文；spec／plan／台账／handoff 中文。
- Commit message 结尾两行：`Co-Authored-By: <实施席自己的模型> <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_018mArcQDZBWMymL3MHT6WzR`。
- 两仓都在 `main` 上落本地提交；**不 push、不 merge、不删分支或 worktree**（Rule 15）；Tier 0 闸门会拦。
- **主树禁令**（每个派发重申）：不许 `git stash`／`checkout`／`reset`／`restore`，不许临时撤回或移动任何文件取 RED；变异只在 `git clone --local` 副本里做，副本建在会话 scratchpad `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/` 下。
- 验证性跑一律重定向到文件再整份读回；不用管道过滤；`rtk` 会改写 git，git 核对用 `/usr/bin/git`。本机 `rm`／`cp` 有 `-i` alias：用 `/bin/rm -rf`、`cat src > dst`。
- 不在本机造 CPU 负载（常驻生产 daemon）：全量套件不并发跑。
- ccloop 副本做 E2E 前必须 `npm run build`（`dist/` 被 gitignore）；Orca 全量前先 `npm run build --workspace web`。
- 既有判据：人 2026-09-26「同意修改几个仓库的现有test」⇒ 可改，但**整条改写不许放宽**，改后在判据旁注释 `// Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): <它现在编码什么>`，并在台账 `progress.md` 逐条列全名（文件 ＞ describe ＞ it）。
- RED 阶段就绿的新判据：先在副本里打一条删掉被测分支的变异并看见红，记进 `mutations.md`。
- 错误码字面量（全仓统一）：`agents-table-invalid`、`agent-installation-missing`、`agent-context-unsupported`、`agent-selection-invalid`、`agent-version-drift`、`agent-unselected`、`agent-selection-changed`、`agent-selection-rejected`（带后缀 `:<taskId|slot>:<ccloop 码>`）、`control-config-hash-mismatch`（已有）。
- 默认值字面量：claude 描述默认 model `claude-opus-5-5`；codex 描述默认 model `gpt-6-sol`；上下文档位 claude `["agent-default", 1000000]`、codex `["agent-default"]`；1M ⇔ `--model <model>[1m]`。
- 协议号：start envelope `protocol: 2`；capabilities 应答 `protocol: 3`；handoff request 仍 `protocol: 1`；schema 名 `ccloop-agents-table-v1`、`ccloop-agent-config-v1`、`ccloop-agents-detect-v1`、`agent-selection-v1`、`orca-execution-profile-snapshot-v2`。
- 仓库外写入只有 `orca agents init`（spec §8）；判据一律 `ORCA_AGENTS_TABLE` 改道到临时目录。

---

## 共用接口（**控制器定死；各 Task 只许用这些名字与类型**，要改先报控制器）

### ccloop `src/agents/types.ts`

```ts
export type ContextWindow = "agent-default" | number;              // number: positive safe integer
export interface AgentSelectionV1 { agent: string; model: string; contextWindow: ContextWindow }
export interface PartialSelectionV1 { agent?: string; model?: string; contextWindow?: ContextWindow }
export interface InstallationV1 {                                   // common fields; kinds add strict extras
  kind: string;
  command: [string, ...string[]];                                   // [absolute path, ...args]
  version: string;
  configDir: string | null;                                         // absolute or null
  timeoutMs: number;                                                // 1..2_147_483_647
  killGraceMs: number;                                              // 0..60_000
  [extra: string]: unknown;                                         // e.g. codex: sandbox, budgetMode
}
export interface AgentsTableV1 { schema: "ccloop-agents-table-v1"; installations: Record<string, InstallationV1> }
export interface MaterializedAgentConfigV1 {
  schema: "ccloop-agent-config-v1";
  kind: string;
  installation: InstallationV1;
  selection: AgentSelectionV1;                                      // defaults filled
}
export interface AgentResolutionV1 {                                // what capabilities v3 answers for a selection
  selection: AgentSelectionV1;
  configHash: string;                                               // canonicalHash(MaterializedAgentConfigV1)
  timeoutMs: number;
  killGraceMs: number;
  capabilities: CapabilityViewV1;                                   // the seven capability fields, no `protocol`
}
export class AgentError extends Error { constructor(readonly code: string, detail?: string) }
```

### ccloop `src/agents/registry.ts` ／ descriptors

```ts
export interface AgentDescriptor {
  kind: string; binary: string;
  searchDirs(input: { home: string; env: NodeJS.ProcessEnv; platform: NodeJS.Platform }): string[];
  configDirEnv: string;                                             // "CLAUDE_CONFIG_DIR" | "CODEX_HOME"
  defaults: { model: string; contextWindow: ContextWindow };
  contextOptions: ContextWindow[];
  installationExtras: z.ZodRawShape;                                // merged into the strict installation schema
  validateSelection(selection: AgentSelectionV1): void;             // throws AgentError
  capabilities(config: MaterializedAgentConfigV1): CapabilityViewV1;
  createAdapter(config: MaterializedAgentConfigV1): RuntimeAdapter;
}
export function getDescriptor(kind: string): AgentDescriptor;       // throws AgentError("agent-installation-missing")
export function listDescriptors(): AgentDescriptor[];
```

### ccloop 其余

- `src/agents/table.ts`：`readAgentsTable(path: string): Promise<AgentsTableV1>`（O_NOFOLLOW、普通文件、realpath＝自身、属主＝euid、`mode & 0o022 == 0`、父目录同）；`parseAgentsTable(raw: unknown): AgentsTableV1`；`assertAgentsTablePath(path: string): Promise<void>`（只核路径形状，给非 accept 方法用）。
- `src/agents/materialize.ts`：`resolveAgent(table: AgentsTableV1, partial: PartialSelectionV1, deps?: { probeVersion?: (command: string[]) => Promise<string | null> }): Promise<{ config: MaterializedAgentConfigV1; resolution: AgentResolutionV1 }>`；`agentConfigHash(config: MaterializedAgentConfigV1): string`；`probeVersion(command: string[]): Promise<string | null>`。
- `src/agents/detect.ts`：`detectAgents(input: { home: string; path: string; platform: NodeJS.Platform; probe?: typeof probeVersion }): Promise<DetectResultV1>`，`DetectResultV1 = { schema: "ccloop-agents-detect-v1"; table: AgentsTableV1; candidates: Record<string, CandidateV1[]> }`，`CandidateV1 = { path: string; realpath: string; version: string | null; runnable: boolean; source: string; isPathDefault: boolean; error?: string }`。
- CLI：`ccloop agents detect [--home <dir>] [--path <PATH>]`、`ccloop agents validate <table>`；`ccloop control <method> --agents <table>`；`ccloop run --agents <table> --agent-selection <file> --run-dir … --contract …`（与 `--adapter` 互斥）。选择文件形状 `{ selection: AgentSelectionV1, configHash: string }`。
- `src/runtime/claude/claudeAgentAdapter.ts`：`export class ClaudeAgentAdapter implements RuntimeAdapter { constructor(config: MaterializedAgentConfigV1) }`；`export class ClaudePhaseAborted extends Error { evidenceDir: string; observedTokens: null }`。runner 新增环境变量 `CCLOOP_CLAUDE_COMMAND`（JSON 数组）、`CCLOOP_CLAUDE_EXTRA_ARGS`（JSON 数组）。
- codex：`CodexAdapter` 构造签名不变；descriptor 用 `toCodexConfig(config: MaterializedAgentConfigV1): CodexConfig` 转换，`configDir` 经 `runCodexPhase` 新增的可选 `extraEnv?: Record<string,string>` 传入（`CodexAdapter` 新增可选第二参 `extraEnv`）。
- control：`StartEnvelopeV2`（`protocol: 2`，`claim.agent: AgentSelectionV1`）；capabilities 请求 `{ agent: PartialSelectionV1 | null }`，应答 `{protocol:3, installations:[{id, kind, defaults, contextOptions, version}]}` 或 `{protocol:3, ...AgentResolutionV1}`。
- 停机证明：`<sourceDir>/control/phases-completed.json` ＝ `{ "count": n }`；`proveStopped` 在 `count > 0 && processes.length === 0` 时返回 `null`。
- fakes：`tests/fixtures/fake-claude-cli.mjs`（`script <marker> <scriptPath>` 模式；答 `--version`；`.calls`／`.tasks` 与 fake codex 同格式；`.argv` 每次一行 JSON 数组）；fake codex 新增 `.argv` 追加。

### Orca `src/control/agentSelection.ts`

```ts
export type ContextWindow = "agent-default" | number;
export interface AgentSelection { agent: string; model: string; contextWindow: ContextWindow }
export interface PartialSelection { agent?: string; model?: string; contextWindow?: ContextWindow }
export type LayerName = "operator" | "operator-estimator" | "operator-reconcile" | "group" | "group-estimator" | "group-reconcile" | "task";
export type ProvenanceSource = LayerName | "operator-agent" | "descriptor";
export interface SelectionLayer { name: LayerName; partial: PartialSelection }
export interface OperatorPreferences {                             // agent_preferences.doc_json
  defaultAgent?: string;
  perAgent: Record<string, { model?: string; contextWindow?: ContextWindow }>;
  estimator?: PartialSelection;
  reconcile?: PartialSelection;
}
export interface GroupAgentOverrides { worker?: PartialSelection; estimator?: PartialSelection; reconcile?: PartialSelection }
export type Slot = "worker" | "estimator" | "reconcile";
export function slotLayers(slot: Slot, prefs: OperatorPreferences, group: GroupAgentOverrides, task?: PartialSelection): SelectionLayer[];
export function resolveSelection(layers: SelectionLayer[], perAgent: OperatorPreferences["perAgent"]):
  { partial: PartialSelection; provenance: Record<"agent" | "model" | "contextWindow", ProvenanceSource | null> };
export function descriptorProvenance(partial: PartialSelection, resolved: AgentSelection,
  provenance: ReturnType<typeof resolveSelection>["provenance"]): Record<"agent"|"model"|"contextWindow", ProvenanceSource>;
export interface AgentResolution { selection: AgentSelection; configHash: string; timeoutMs: number; killGraceMs: number; capabilities: CapabilityViewV1 }
export interface FrozenSlot extends AgentResolution { partial: PartialSelection; provenance: Record<"agent"|"model"|"contextWindow", ProvenanceSource> }
export function selectionsHash(slots: Record<string, FrozenSlot>): string;  // sha256Canonical over {partial, selection, configHash} per slot key
```

### Orca `ExecutionPort`（`src/control/executionPort.ts`，替换现有能力方法）

```ts
resolveAgent(partial: PartialSelection): Promise<AgentResolution>;          // capabilities v3 with a selection
listAgents(): Promise<AgentsView>;                                          // capabilities v3 with agent:null
// probeProfileCapabilities / capabilities() without a selection are REMOVED; gates call resolveAgent(run.agent)
```

`AgentsView = { installations: Array<{ id: string; kind: string; defaults: {model: string; contextWindow: ContextWindow}; contextOptions: ContextWindow[]; version: string }> }`。

### Orca 持久化字段（名字定死）

- work item／run 行新增：`agent: AgentSelection`、`agentProvenance`、`configHash`（确认前 `null`）、`timeoutMs`、`killGraceMs`、`agentCapabilities: CapabilityViewV1`。
- 组记录新增：`agentOverrides: GroupAgentOverrides`（面板与 plan 顶层合并后的组层）、`reconcileSlot: FrozenSlot | null`、`estimatorSlot: FrozenSlot | null`。
- 表 `agent_preferences(operator_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, doc_json TEXT NOT NULL)`。
- 命令动词 `set-agent-preferences`（target `{kind:"operator", operatorId}`，payload `{preferences: OperatorPreferences}`，revision 只在命令信封的 `expectedRevision`，§0.2 P5）、`proposal-set-agent`（target group，payload `{baseProposalVersion, scope: {kind:"group", slot: Slot} | {kind:"task", taskId}, partial: PartialSelection | null}`，`null` ＝ 清除该层）。
- confirm payload 新增 `selectionsHash: string`。
- 环境变量 `ORCA_AGENTS_TABLE` 取代 `ORCA_CCLOOP_ADAPTER_CONFIG`。

---


## §0 执行顺序与控制器裁定（**先读**）

**执行顺序**（依赖已按各写作席的现量修正）：ccloop **T1 → T2 → T4 → T3 → T6 → T5**；Orca **T8 → T7 → T9 → T10 → T11 → T12 → T13 → T14 → T15 → T16 → T17**。T7 依赖 T5＋T6（W4 M-4）；T8 先于 T7（W5-M1）。T14 与 T15 紧挨着落（其间 web tsc 红，W6）。

**控制器裁定**（全文与依据在台账 `.superpowers/sdd/2026-09-26-agent-selection/progress.md` §3；各分节正文**已按裁定写**，个别分节写于裁定之前的，以本表为准）：

| # | 裁定 |
|---|---|
| R1 | `probeVersion(command)` 跑 `[...command,"--version"]`（`--version` 在末），取 stdout 第一个 `/\d+\.\d+\.\d+(-[\w.]+)?/`，无则 `null`；`resolveAgent` 默认探版本；`AgentError.message` 以码开头；fake codex 与 fake-claude-cli 答 `--version` 且不写 `.calls`／`.tasks`／`.argv`。 |
| R2 | 新码 `agent-selection-file-invalid`、`agent-config-invalid`、`agents-command-invalid` 并入全仓字面量；`agent-adapter-unavailable` 为 T3 之前的临时码，T3 删。 |
| R3 | `AgentDescriptor` 加 `draftInstallationExtras`；「全局可写」＝他人可写（`mode & 0o002`）；`runLoop` 观测加 `completedWithResult`。 |
| R4 | T5 把选择 schema 从 `src/agents/types.ts` 挪到 `src/control/protocol.ts`、`types.ts` 再导出（防循环 import）；T5 整条改写 T4 的 worker 判据；T5 补 worker 层的进程注册判据。 |
| R5 | W6-1…W6-20 全采纳（`src/control/agentFreeze.ts` 的 `resolveGroupSelections`、槽位键 `task:<id>`／`reconcile`、`readAgentPreferences`、`@operator:<id>`、result kinds、zod 名）；**W6-8**：`set-agent-preferences` 的 payload 只有 `{preferences}`。 |
| R6 | W5：M2 采 (a)（`router.probe(profile, selection?)` 过渡）；M4 面板层整层替换（登记偏离）；M5「删 `configHash`＋草稿 `null`」在 T11；M9 T11–T15 间面板确认 fail closed。 |
| R7 | **W5-M16（偏离 spec，报人）**：导入时 estimator 只解析操作者两层；plan 文件本轮**不加 `estimatorAgent`**；组级 estimator 只来自面板、在 reestimate 生效。既有判据 `planImport.test.ts > immutable plan import > rechecks revision after a successful in-flight probe before source I/O` **不改**。W5 分节里按「选项 A」写的步骤作废，实施席按本条实现。 |
| R8 | W4：M-2 三处「T7 bridge」T11 删净；M-3 T7 的 plan 行仍带 `configHash`（取自 `resolveAgent`）；M-4 解冲突新形态进 T7；M-5 T7 临时问 `killGraceMs`；M-6 无选择探测取字典序第一条安装；M-8 `show` 不读 store；M-9 面板仍要两个 env。 |

各分节自带的「现量」表是写作席在副本里量的，**实施席开工前按内容锚点重核**（行号会移动；前面的 Task 会改同一文件）。

---

## §0.2 计划复审更正（2026-09-26，复审报告 `.superpowers/sdd/2026-09-26-agent-selection/plan-review.md`；**优先于 §0 以下所有分节正文**）

**总原则**：各分节是并行写的，后面 Task 的 before 锚点可能写的是前面 Task 落地**之前**的代码。**实施席以真实的树为准**：前面 Task 已产出的符号、文件、判据**只增量修改，不重新创建、不整份覆盖、不重复声明**；分节正文与已落地代码冲突时，保留已落地的名字与形状，按本节与 §0 做。

| # | Task | 必须这样做 |
|---|---|---|
| P1（C1） | T13 | `agentsTablePath(env)` 缺省分支用 `env.HOME`（缺或非绝对 ⇒ 拒），**不许调 `os.homedir()`**；补判据「不给 `ORCA_AGENTS_TABLE`、`HOME` 指向临时目录 ⇒ 表落 `<tmpHOME>/.orca/agents.json`、0700／0600」；判据文件 `beforeAll` 把进程级 `HOME` 与 `ORCA_AGENTS_TABLE` 改道到临时目录；变异 M13-10 在这三条落地前**禁止跑**，跑时只在副本且 HOME 改道。 |
| P2（C2） | T3 | 3.5.6 之后加一步：`src/agents/claude.ts` 的 `createAdapter` 改 `return new ClaudeAgentAdapter(config)`；`AGENT_ERROR_CODES` 删 `agent-adapter-unavailable`；T1 的 registry 判据「does not yet build a claude adapter」整条改写为 `toBeInstanceOf(ClaudeAgentAdapter)`（带改写注释）；变异「改回抛错」须红；核 `grep -rn "agent-adapter-unavailable" src tests` rc=1。 |
| P3（C3） | T3 | **跳过 §3.4**（`extraEnv` 已由 T1 产出）及 Files 里对应四项；变异 E1–E3 改跑 T1 的 `tests/runtime/codex/extraEnv.test.ts`。 |
| P4（C4／R7） | T10 | 按 R7 实现：导入时 `prepareEstimatorSlot` **不读 plan 源**，只解析操作者两层（`estimatorSlotFor(deps, actorId, {}, profile)`），在调用 probe 前不得插入任何 `await`；plan 文件与 `ControlPlanV1` **没有** `estimatorAgent`（带它的 plan 被拒为 malformed，补判据）；**跳过**把受保护判据 `planImport.test.ts > immutable plan import > rechecks revision after a successful in-flight probe before source I/O` 改写的那一段（判据本体一字不改，只允许改 `setup()` 让 `estimatorObservation` 带 `resolution`）；变异 T10-M3 换成「`prepareEstimatorSlot` 经 `resolveTarget` 读源 ⇒ 受保护判据红」；补判据：面板组级 estimator 在 reestimate 生效（R7 正向面）＋变异。 |
| P5（C5／R5） | T14、T15、T16、骨架 | `set-agent-preferences` 的 payload 一律 `{ preferences }`；revision 只在命令信封的 `expectedRevision`。T14 判据、`web/src/controlTypes.ts` 的 `SetAgentPreferencesPayloadV1`、T15 `sendAgentPreferences`、T16 `setPreferences` 都按此写（不许 `as never` 掩盖）。 |
| P6（C6） | T10 | `tests/control/fixtures/web.ts` 只对 T7 版本**增量**改，保留 T7 的 `FIXTURE_AGENT` 与桥（桥到 T11 才删）；不重新加回 `probeProfileCapabilities`／`capabilities`；T10 新文件 `agents.ts` 里的 id 常量叫 `FIXTURE_AGENT_ID`，不与 `web.ts` 的 `FIXTURE_AGENT` 同名；port 字面量不得出现重复键。 |
| P7（C7） | T9 | `src/control/webService.ts`、`src/control/stopIntent.ts` 里排除 `global`／`repository` 后直接读 `target.groupId` 的三处，改为正向判断 `target.kind === "group"`（或加上 `operator`），列入 T9 Files，T9 提交前 tsc rc=0。 |
| P8（C8） | T14 | 面板夹具：`BootOptions` 加 `agents?`、`resolveAgent?`、`seedPreferences?: false`；未给时回落 T10 的版本；T14 自己的替身改名 `claudeCodexResolveAgent`，由 T14 判据显式传入；T14 判据里「初始 `revision:0`」「`agent-unselected`」两条用 `seedPreferences:false` 启动。 |
| P9（I1） | T11、T12 | 「T7 bridge」共 **6 处**：T11 删 `web.ts`、`live-driver-acceptance.ts`、`ccloopWorld.ts` 两处（连同无用的 `const resolution`）四处，核「剩下的只在 `driverReconcile.test.ts` 与 `src/control/driverLanding.ts`」；T12 删这两处，之后 `/usr/bin/grep -rn "T7 bridge" src tests scripts > $S/bridge.txt; echo rc=$?` 期望 rc=1。R8 的「三处」以本条为准。 |
| P10（I2） | T10、T11 | 以 T7 终态为 before：`handoffGraceMsOf` 已由 T7 放进 `driverHandoff.ts`（async、带 `graceByRun`），T11 只换函数体为读冻结 `killGraceMs`、删 WeakMap、调用点改读冻结值，**不新增同名导出**；T11 显式删 T7 的 `temporaryProbeSelection` 与判据「`ccloopPort.test.ts` > … > TEMPORARY (plan T11 deletes it): …」（登记为按计划删除的临时判据），核 `grep -rn "temporaryProbeSelection\|TEMPORARY (plan T11" src tests` 零命中；legacy 路径沿用 T7 的 `workAgents`／`parentAgent`，**不新造** `groupAgents`／`workAgent`／`taskAgent`；T10 Step 10.6 只把 T7 的 `selection?: AgentSelection` 放宽为 `PartialSelection`；`persistedRunSchema.agent`、`errors.ts` 的 agent 码若已存在则跳过（不重复键）。T10／T11 的既有判据红表以**实跑**为准（W5 的 251 条是静态预测）。 |
| P11（I3） | T11、T15 | T11 补 web 判据「无 `selectionsHash` 时点确认不调用 `onCommand`」＋删条件的变异；T15 Step 7 **替换** T11 那一行（升级为 `disabled`），不重复加 prop／键；核 `selectionsHash:` 在 `BudgetEditor.tsx` 恰 1 次、`W5-M9` 临时注释已消失。 |
| P12（I4） | T14 | 只加 T14 自己的新类型；跳过已由 T9／T10／T11 完成的镜像与 `controlGroupWebToServer` 改写（L16036–16053 与重复的 `REWRITTEN` 行）；期望 web tsc rc=0。 |
| P13（I5） | T7、T16、T11 | T7 把表对象抽成导出的 `const agentsTable`（写文件前）；T16 跳过重复的 `versionOf` 声明、往 `agentsTable.installations.claude` 加条目后重写文件；T11 用字面量 `"codex"`（不引用不存在的 `WORLD_AGENT`），`raw(...)` 按实际签名调用。 |
| P14（I6） | T12 | 断言从冻结的 `reconcileSlot.selection` 读值比对（不写死 `fixture-model`），并断言与 worker 冻结值不同；读组的 reconcile 槽用 T11 的 `readConfirmedReconcileSlot`。 |
| P15（I7） | T7 | `fake-ccloop-control.mjs` 的退出码与码名对齐真 T5：具名拒绝退 2、stderr `<code>[: <detail>]`；坏 argv 退 1；`capabilities {}` 拒 `control-request-invalid`；判据字面量改 `"2:agent-version-drift: …"`。 |
| P16（I8） | 全部 | 台账 `progress.md` 的改写记录格式统一为一行 `- REWRITTEN: <文件> > <describe> > <it> — <为什么>`（从 T1 起）；新判据文件记 `- NEW-CRITERIA: <文件> <条数>`；T17 的判定器从台账读这两类行生成 `EXPECTED`。 |
| P17（I9） | T5、T17、W5 各变异 | ccloop **主树不跑 `npm run build`／`verify:control`**（会换掉主树 `dist/` 的线上协议）；这类步骤在 `git clone --local` 副本里做。变异复原一律写字面路径 `/usr/bin/git -C "$S/mut-…" checkout -- src`，**不许**依赖跨调用的 `$C`。T17 门先断言 E2E 用的 ccloop build 的 HEAD 等于 ccloop `main` HEAD，不等就重新 clone＋build。 |
| P18（I10） | T5、T6、T9 | 选择／上下文 schema 只有一个来源：ccloop 用 `protocol.ts` 的（R4），T6 用 `agentSelectionSchema`；Orca 用 T7 在 `schema.ts` 定义的，`webProtocol.ts` 以 `export { … } from "./schema.js"` 再导出（T14 Step 0 的检查接受再导出）。 |
| P19（I11） | T3 | `ClaudeAgentAdapter` 调 T1 的 `claudeModelArgument(config.selection)` 拼 1M，不自己拼 `[1m]`、不再定义第二份 `ONE_MILLION`；变异 M1m 改针对 `claude.ts`。 |
| P20（I12） | T17 | 加一步：给本 spec 末尾追加「§13 实施期更正」（只追加、原文不动，判据核 append-only），登记 R7、R6 M4、R8 M-8、W5-M12、W5-M15 等偏离；报人清单另列 C1 残留文件与改写过的既有判据。 |
| P21（I13） | 全部 | 每一波末个 Task 之后派一席复审（波 1：T1–T4；波 2：T6、T5、T7；波 3：T8–T13；波 4：T14、T15；波 5：T16），T17 之后派一席终审。 |
| P22（I14） | T11 | `profiles.test.ts > trusted execution profiles > keeps Codex phase-end and soft` 整条改写为「v2 快照带 `adapter:"codex"` 被拒」（编码 profile v2 删 adapter 身份字段），不删除。 |
| P23（m1–m12） | 各 Task | m1 `CapabilityViewV1` 是 7 键；m2 删 T7 startEnvelope 判据里读回自己写入值的那一行、T15 判据 7 限定 `section[aria-label="Agent selection"]`、driverHarness 冻结 `killGraceMs` 用非 5000 的值；m3 T5 `claudeEndToEnd` 不过滤 `--version`、断言恰 3 行；m5 T6 用 `AgentError` 抛这两个码；m6 为列出的分支各补判据或登记；m7 T2 detect／validate 与 T13 加「HOME＋四个 XDG 根改道、零写入」断言；m8 D12／D13 注入 probe、PATH 指向空目录；m9 逐文件 `git add`；m10 不用管道取字节数；m11 变异电池等门的 `summary.txt` 出 DONE 后才开始；m12 各条照做。 |

