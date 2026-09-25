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
  capabilities: CapabilityViewV1;                                   // the eight fields, no `protocol`
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
- 命令动词 `set-agent-preferences`（target `{kind:"operator", operatorId}`，payload `{expectedRevision, preferences: OperatorPreferences}`）、`proposal-set-agent`（target group，payload `{baseProposalVersion, scope: {kind:"group", slot: Slot} | {kind:"task", taskId}, partial: PartialSelection | null}`，`null` ＝ 清除该层）。
- confirm payload 新增 `selectionsHash: string`。
- 环境变量 `ORCA_AGENTS_TABLE` 取代 `ORCA_CCLOOP_ADAPTER_CONFIG`。

---

## 任务总表（波次见 spec §10；各 Task 正文在下文各节）

| Task | 仓 | 内容 | 依赖 |
|---|---|---|---|
| T1 | ccloop | `src/agents/{types,registry,claude,codex,table,materialize}.ts`：描述、表 schema 与读表安全检查、物化与哈希、`--version` 核对 | — |
| T2 | ccloop | `src/agents/detect.ts` ＋ `ccloop agents detect|validate` | T1 |
| T3 | ccloop | `fake-claude-cli.mjs`、fake codex `.argv`、runner 环境变量、`ClaudeAgentAdapter`（注册顺序、杀组、证据） | T1 |
| T4 | ccloop | 停机证明通用闸（`phases-completed.json`） | — |
| T5 | ccloop | control 走 `--agents`：envelope v2、capabilities v3、accept（物化、哈希、版本）、worker 经描述建 adapter、只有 capabilities／accept 读表；改写既有判据；`verify-control-protocol.mjs` | T1–T4 |
| T6 | ccloop | `ccloop run --agents --agent-selection`（哈希与版本核对、与 `--adapter` 互斥） | T1 |
| T7 | Orca | 线上 v2／v3：schema、types、`executionPort`、`ccloopPort`（`--agents`、`resolveAgent`／`listAgents`）、`startEnvelope`、`ownership`、`schedulerBridge`、`dispatch`、`unconfiguredPort`、`fake-ccloop-control.mjs`、`ccloopWorld.ts`（表＋CLI 层 fake）、`ORCA_AGENTS_TABLE` 各消费者 | T5 |
| T8 | Orca | `agentSelection.ts` 纯函数（§6.3 形式定义，(a)–(e) 各一判据） | — |
| T9 | Orca | `agent_preferences` 表与迁移、命令台账 `operator` scope、`set-agent-preferences` | T8 |
| T10 | Orca | plan 文件 `agent`／`estimatorAgent`／`reconcileAgent`（删 `configHash`）、`ControlPlanV1`、导入（草稿 `configHash:null`、estimator 导入时冻结、失败退化 `blocked-capability`、估算 `configHash` 不再是 `profileHash`）、`proposal-set-agent` | T7–T9 |
| T11 | Orca | 异步 confirm＋`selectionsHash`＋冻结、执行快照 v2、`controlViews` 以快照为权威、profile v2、闸门逐调用点用冻结选择、`handoffGraceMs` 用冻结值 | T10 |
| T12 | Orca | 解冲突 run 走 `ccloop run --agents --agent-selection`（`driverLanding.ts`、`ccloopRunner.ts`；旧 `orca run` 保留 `--adapter`） | T6、T11 |
| T13 | Orca | `orca agents init|show`（Rule 17） ＋ Web spec 两节 ERRATUM（I3 的 `ControlPlanV1.configHash`、I14 的信任边界） | T7 |
| T14 | Orca web | 面板 API：`GET /api/control/agents`、偏好读写、提案的逐任务解析预览（返回 `FrozenSlot` 与 `selectionsHash`） | T9–T11 |
| T15 | Orca web | 面板 UI：设置页「Agents」、提案视图组级／任务级编辑与来源标注、确认带 `selectionsHash` | T14 |
| T16 | Orca | 驱动环 E2E：fake claude＋fake codex 混组（`.argv` 断言含 reconcile）、确认后改默认值的冻结判据、④ 的 handoff／续跑／三路冲突在 fake claude 下各一次 | T12、T15 |
| T17 | 两仓 | 全套门＋机械判定器＋`check-known-reds`；台账收口 | T16 |
