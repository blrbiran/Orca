# ccloop Public Control Protocol, Handoff, and D3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划建议 Native；先审阅计划，再由人确认执行方式。

**Goal:** 实现 task-control §13.6 第二项：由 ccloop 提供版本化公共控制协议、持久 accepted、具名 handoff、可核验静止证明及新 run 从完整快照恢复；由 Orca 继承跨 run 预算并从已提交检查点生成任务/组 D3 handoff。

**Architecture:** ccloop 是协议生产者和 agent 生命周期所有者，新增本地 JSON-over-stdio `control` 命令；每次 RPC 都是短进程，实际执行由带持久身份的监督 worker 承担。Orca 新增生产 `ExecutionPort` 调用该命令、归档 ccloop 证据、提交检查点，再原子领取 continuation run；D3 Markdown 只由已提交 JSON 检查点投影，不成为第二套真相源。当前 Codex adapter 只声明 `phase-end + soft`，本切片不虚构严格 token 封顶。

**Tech Stack:** 两仓均为 TypeScript ESM、Zod、Vitest、Node 22+、Git；ccloop 继续文件持久化与进程组管理，Orca 继续 SQLite 单写、不可变 artifact/checkpoint 与 outbox 投影。

**Spec:** Orca `docs/superpowers/specs/2026-09-19-task-control-design.md` §4–7、§13.1–13.6，尤其 §13.3–13.6；§13 优先于旧正文。规格已获批准，不重开架构选择。

归属：2026-09-19 当前 Codex task。规划观测锚点为 Orca 控制开发树 `1b1997a52ca7ffed0d384c98e02375d2a66dbe02`、ccloop Codex 开发树 `532f3e17b68ed439ec9fbaca5c841739af618945`。这些是只读规划锚点，不规定实施时 HEAD。Orca 底座实现提交按主题 `fix(control): preserve accounting and checkpoint recovery invariants` 定位；ccloop Codex 修复按主题 `fix(codex): harden output reads and watchdog cleanup` 定位。

## Global Constraints

- Orca 控制 ccloop；具体 adapter 参数、agent 事件、进程、停止与交接候选留在 ccloop。禁止 Orca 直接启动 agent，禁止 controlled 路径回退旧 `ccloop run/resume`。
- Codex 当前仅支持显式 `soft`，usage 为阶段末观测；新协议不能将进程停止包装成 token 硬封顶。`strict` 组继续按名拒绝。
- ccloop 的旧 `run/resume/sweep/ls/unlock` 行为和退出码保持不变。新 `control` 是独立命令族；现有原生 `resumeLoop` 不是新 run 恢复实现。
- 启动必须先持久化 accepted；同 `runId/generation/commandId` 的相同 envelope 幂等，不同 envelope 按名拒绝。启动结果不明时保留所有权和预算，不启动第二个 worker。
- handoff 请求持久锁存；接受请求不等于交接完成。候选、停止、usage 结算、Orca 检查点提交是四个独立事实。
- 静止证明不得只看一个 PID 消失。证明至少包含 worker 的完成 seal、owner/lease 释放、全部登记进程组的最终探测和请求 generation；缺任一项即 `stopProof:null`。
- work 与 handoff 两个 usage bucket 都必须出现明确累计观测，包括合法零；未知 token 产生 `cumulative:null`，Orca 保留对应预留。
- ccloop 不删除 sourceDir、运行日志、控制记录或快照输入。只有 Orca 独立归档、完整读回、提交检查点后，既有 cleanup outbox 才能回收。
- continuation 使用新 `runId`，固定 `predecessorRunId/checkpointId/checkpointHash`；旧 run 保留终态和消耗。原生 agent session resume 仅可作为未来 adapter 内部优化，本计划不用它。
- D3 不修改或删除仓库现有 `docs/handoff/handoff.md`。产品 handoff 输出到显式 Orca state/export root；JSON 权威、Markdown/latest 可重建。
- 两仓验证全部使用临时 state、临时仓库和 fake executable；不创建真实 `~/.orca`，不访问 ccmem 用户数据，不调用真实模型。
- 既有判据不改写或放宽；新覆盖只新增。每个新增分支有点名删除变异，变异仅在 `git clone --local` 副本运行，完整读回日志并证明 tracked/cached diff 均为零。
- 验证输出保存原始 log/rc 后整份读回；计数、耗时、token 只报工具输出，不自估。正式验收不得 skipped/todo。
- 不整合 main、不 push、不删除分支/worktree。两个开发树、既有 SDD 台账、真钱记录及未跟踪 `node_modules` 全部保留。

## Review Focus

1. accepted 已落盘后响应丢失、worker 刚 spawn 尚未 seal、PID 被复用：重试不得产生第二个 agent；无法判明时保持 unknown（Tasks 2、8）。
2. handoff 重复/冲突/旧 generation、deadline 落在 phase 中间、子进程晚生：请求幂等，旧请求无写权，缺静止证明不开 continuation（Tasks 4、8）。
3. phase usage 缺失、显式零、重复/乱序、Codex thread total 重复：不重复累计、不把未知当零、work/handoff 两桶都明确收口（Task 3）。
4. 恢复包路径穿越、坏 hash、缺 blob、脏 index stage、symlink/可执行位：拒绝坏包，完整包在独立 worktree 逐字节恢复（Task 5）。
5. ccloop 候选已写但 Orca 未提交、事务已提交但 Markdown 缺失、组中有未完成任务：不宣称可恢复，投影可重建且组 handoff 如实包含未完成项（Tasks 6、7、8）。

## Scope, dependency order, and existing seams

实施顺序：`1 wire contract → 2 durable accept → 3 execution/usage → 4 handoff/quiet proof → 5 snapshot materialization → 6 Orca port/continuation → 7 D3 projections → 8 cross-repo acceptance`。

本切片交付一个可离线运行的真实 ccloop 对端和 Orca 应用 API，但不做 Web 页面、自动拆分、ccmem、goal 模型复核、跨主机执行权迁移，也不扩展 Claude/OpenCode/oh-my-pi/pi。Web 下一切片只消费这里完成的 service API。

| Existing seam | Current fact | This plan |
|---|---|---|
| Orca `src/control/executionPort.ts` | `productionExecutionPort()` 明确抛 `control-protocol-unavailable` | Task 6 新增真实 ccloop port；无配置时仍拒绝 |
| Orca `dispatch.ts` | 已持久 start intent、处理 accepted/unknown | 保留权威；新增 handoff RPC 和 continuation 输入 |
| Orca `budget.ts` | handoff 复用父 run；settled 后没有 continuation claim | Task 6 新增固定 predecessor 的新 run 领取，不重置 group used |
| Orca `archive/checkpoints/projection` | 已归档脏快照、事务提交和 latest JSON | Task 6 导出恢复包；Task 7 增加任务/组 handoff 投影 |
| ccloop `cli.ts` | 只有前台 run/resume/sweep | Tasks 1–4 新增独立 control 命令族 |
| ccloop `runLoop.ts` | stop slot 只在边界检查，run 入口未注入；未知 usage 内部按 0 扣减 | Task 3 增加只观察 hook；Task 4 增加受控停止，不改变旧入口语义 |
| ccloop `worktreeManager.ts` | 每次从 repo HEAD 新建 worktree | Task 5 首 attempt 可从经验证恢复包物化；不是调用 `resumeLoop` |
| ccloop Codex phase runner | detached phase 进程组、原始 JSONL/usage 证据已存在 | Task 3 登记并汇总；Task 4 以全登记组静止为证明前提 |

## Versioned wire contract

ccloop 的 `src/control/protocol.ts` 是 producer-side canonical schema；Orca 保留自己的 consumer schema并在真实二进制契约测试中防漂移，不建立跨仓源码 import。CLI 形式固定为：

```text
ccloop control capabilities|accept|inspect|handoff|collect|read-evidence \
  --adapter codex --adapter-config /private/tmp/ccloop-control/config.json
```

请求是 stdin 中单个严格 JSON 值；成功时 stdout 仅一个 JSON 值并退出 0；具名协议拒绝在 stderr 输出稳定错误码并退出 2；CLI/IO/坏 JSON 退出 1。`read-evidence` 返回 `{artifactId,hash,base64}`，不用裸 stdout 混合二进制和诊断。

两仓共享以下线格式；实现时 ccloop 用 Zod 严格解析，Orca 的 decoder 逐字段复核：

```ts
export interface InputCheckpointV1 {
  predecessorRunId: string;
  checkpointId: string;
  checkpointHash: string;
  bundlePath: string; // Orca 复制到新 sourceDir/input/ 下的私有、不可变目录
}

export interface StartEnvelopeV1 {
  protocol: 1;
  claim: Claim;
  contractHash: string;
  inputCheckpoint: InputCheckpointV1 | null;
  work: {
    contract: LoopContract;
    targetRepo: string;
    base: string;
    sourceDir: string;
  };
}

export interface HandoffRequestV1 {
  protocol: 1;
  requestId: string;
  runId: string;
  generation: number;
  reason: "budget" | "context" | "human" | "graph-change" | "shutdown";
  deadlineAt: string;
}

export type HandoffReason = HandoffRequestV1["reason"];

export type ExecutionStatusV1 =
  | {kind:"absent"}
  | {kind:"accepted";executionId:string;configHash:string}
  | {kind:"unknown"}
  | {kind:"stopped";proof:StopProof};

export type HandoffAckV1 =
  | {kind:"latched";requestId:string}
  | {kind:"complete";requestId:string;checkpointId:string}
  | {kind:"unknown";requestId:string};

export type ControlRequestV1 =
  | {method:"capabilities"}
  | {method:"accept";input:StartEnvelopeV1}
  | {method:"inspect";input:StartEnvelopeV1}
  | {method:"handoff";input:StartEnvelopeV1;request:HandoffRequestV1}
  | {method:"collect";input:StartEnvelopeV1;afterSeq:number}
  | {method:"read-evidence";input:StartEnvelopeV1;ref:ArtifactRef};
```

`claim.configHash` 是经 ccloop adapter schema 解析后的配置做 canonical JSON 后的 SHA-256；不是源文件排版字节 hash。accept 将这份已验证配置复制并封存，之后 inspect/worker 不重新信任可变的外部配置文件。

恢复包 `resume-bundle.json` 固定为：

```ts
export interface ResumeBundleV1 {
  protocol: 1;
  predecessorRunId: string;
  checkpointId: string;
  checkpointHash: string;
  checkpoint: ArtifactRef;
  snapshot: ArtifactRef;
  artifacts: Array<{ref:ArtifactRef;file:string}>; // file 必须是 bundlePath 下的普通文件
  unfinished: string[];
  pendingDecisions: string[];
  awaitingHuman: string[];
}
```

## Task 1: ccloop public schemas, CLI boundary, and private control layout

**Files:** Create in ccloop `src/control/{protocol,paths,command}.ts`, `tests/control/{protocol,command}.test.ts`, `docs/control-protocol-v1.md`. Modify `src/cli.ts` only to dispatch the new command before legacy flag parsing.

**Interfaces:** `parseControlRequest(method,raw): ControlRequestV1`; `runControlCommand(argv,stdin,deps?): Promise<{code:number;stdout:string;stderr:string}>`; `controlRoot(envelope): string` returns `{sourceDir}/control`; `canonicalHash(value): string` recursively sorts object keys and preserves array order.

- [ ] **Step 1: Add failing strict-schema tests.** Cover unknown keys, unsafe integers, invalid hash/ID, relative adapter config, non-absolute or symlinked sourceDir, input bundle outside `{sourceDir}/input`, and a positive round trip for every method.

```ts
const envelope = startEnvelopeFixture();
expect(parseControlRequest("accept", envelope)).toEqual(envelope);
expect(() => parseControlRequest("accept", {...envelope, protocol: 2})).toThrow("control-protocol-unsupported");
expect(() => parseControlRequest("accept", {...envelope, extra: true})).toThrow("control-request-invalid");
```

- [ ] **Step 2: Run `rtk proxy npx vitest run tests/control/protocol.test.ts tests/control/command.test.ts`; save log/rc and confirm RED because modules do not exist.**
- [ ] **Step 3: Implement the exact wire schemas above and CLI dispatch.** `main()` must route `argv[0]==="control"` before the legacy `run/resume/sweep` parser. stdout is written only after the handler returns a schema-valid value; caught protocol errors map to exit 2, all other errors to 1.
- [ ] **Step 4: Implement private paths.** Create sourceDir/control and children with 0700, files with 0600, `O_NOFOLLOW` on reads, atomic temp+fsync+rename+directory fsync on replacement. Reject symlink ancestors and any path whose `realpath` escapes sourceDir. Never chmod existing user paths.
- [ ] **Step 5: Green-run the two test files, then deletion mutations H01 (remove `.strict()`), H02 (allow bundle escape), H03 (print diagnostics to stdout). Each must fail a behavior assertion.**
- [ ] **Step 6: Document every request/response, exit code, durability boundary and declared Codex capability in `docs/control-protocol-v1.md`; do not claim handoff/restore complete until Tasks 4–5 pass.**
- [ ] **Step 7: Commit only Task 1 ccloop files with `feat(control): define versioned public control protocol`.**

## Task 2: durable accepted identity and fail-closed worker launch

**Files:** Create in ccloop `src/control/{store,accept,workerLauncher}.ts`, `tests/control/{accept,workerLaunch}.test.ts`, `tests/fixtures/control-worker.mjs`. Extend `src/control/command.ts` for `accept` and `inspect`.

**Interfaces:** `acceptStart(input,adapterBinding): Promise<ExecutionStatusV1>`; `inspectStart(input): Promise<ExecutionStatusV1>`; `readAccepted(sourceDir): Promise<AcceptedRecordV1>`; `launchWorker(record,deps?): Promise<void>`.

```ts
export interface AcceptedRecordV1 {
  protocol: 1;
  envelopeHash: string;
  executionId: string;
  configHash: string;
  generation: number;
  acceptedAt: string;
  launch: "intended" | "claimed" | "sealed" | "unknown";
  worker: {pid:number;startedAt:string;nonce:string} | null;
}
```

- [ ] **Step 1: Write failing real-process tests.** The fixture increments an agent-launch file only after exclusively claiming the accepted record. Test: same accept twice launches once; same identity/different payload returns `control-envelope-conflict`; response drop after worker claim is recovered by inspect; crash after `launch:"intended"` but before a worker receipt returns unknown and never spawns a replacement.
- [ ] **Step 2: Add PID-reuse and config drift cases.** A live PID with mismatched UTC start identity is not the worker; changed adapter-config bytes after accepted do not alter the stored canonical config, and a request whose `claim.configHash` differs refuses before worker creation.
- [ ] **Step 3: Run the two files and confirm RED.**
- [ ] **Step 4: Persist accepted before spawn.** Copy the validated adapter config into `control/config.json`, fsync it, write `accepted.json` with `launch:"intended"`, then spawn a detached worker with only absolute paths, executionId and random nonce. The worker must atomically claim the same record before constructing any adapter.
- [ ] **Step 5: Make ambiguous launch fail closed.** If the launcher dies after spawn is attempted but before a matching worker receipt, write/retain `launch:"unknown"`; inspect reports unknown and does not call spawn. A human/recovery design is required before that execution can be superseded; this plan does not guess from a timeout.
- [ ] **Step 6: Green-run, then mutations H04 (spawn before accepted fsync), H05 (ignore envelope hash on replay), H06 (treat intended/unknown as absent), H07 (compare PID without start identity).**
- [ ] **Step 7: Commit Task 2 as `feat(control): persist accepted execution identity`.**

## Task 3: supervised Codex execution, ordered usage evidence, and collection

**Files:** Create in ccloop `src/control/{worker,usage,evidence,collect}.ts`, `tests/control/{worker,usage,collect}.test.ts`. Modify `src/controller/runLoop.ts`, `src/runtime/types.ts`, `src/runtime/codex/runCodexPhase.ts` only to add optional observation/registration hooks; legacy callers omit them. Extend `src/control/command.ts` for `collect` and `read-evidence`.

**Interfaces:**

```ts
export interface RunControlHooks {
  stopRequested?: StopRequestSignal;
  phaseSignal?: AbortSignal;
  onPhaseSettled?: (observation: {
    phase:"plan"|"execute"|"verify";
    attempt:number;
    elapsedMs:number;
    tokenUsage:number|null;
    usageEvidence:UsageEvidence|undefined;
  }) => Promise<void>;
  onProcessRegistered?: (process:{pid:number;pgid:number;startedAt:string;phase:string}) => Promise<void>;
}
```

`runLoop(contract,runDir,adapter,hooks?)` passes hooks into `runLoopFromState`; no hook changes existing decisions. `appendUsageObservation(...)` emits run-global consecutive `eventSeq` and per-bucket cumulative `Amount|null`. `collectExecution(envelope,afterSeq)` returns only events with `eventSeq>afterSeq`, plus current candidate/terminal.

- [ ] **Step 1: Write failing hook tests around every `applyPhaseUsage` call site.** Success, timeout, abort, adapter throw and missing usage must each call the observer once for the phase actually entered. The hook receives raw `tokenUsage:null` when absent; it must not receive the internal budget snapshot's synthetic zero.
- [ ] **Step 2: Write failing usage tests.** Feed Codex thread-total observations `15,35,60`; expect cumulative work tokens `15,35,60`, not `15,50,110`. Duplicate evidence produces the same event, conflicting evidence at the same seq refuses, an absent usage emits `cumulative:null`, and an explicit final zero remains an `Amount` rather than null.
- [ ] **Step 3: Write collection/evidence tests.** `afterSeq` filters without renumbering; evidence content hash is rechecked on each read; traversal, symlink, FIFO and >16 MiB control response refuse. Diagnostics never enter JSON stdout.
- [ ] **Step 4: Run the three files and confirm RED.**
- [ ] **Step 5: Implement hooks surgically.** Keep ccloop's existing soft `RunState.budgetSnapshot` behavior for legacy compatibility, but build protocol usage only from raw observations. Register each Codex detached phase group before writing stdin; observation write failure aborts the phase and preserves its raw evidence.
- [ ] **Step 6: Emit session/attempt/time consistently.** Work cumulative has `sessions:1` after the worker begins, `attempts` equal to attempts actually entered, and saturating is forbidden—overflow is a named protocol error. Mechanical handoff consumption is written later to the handoff bucket.
- [ ] **Step 7: Green-run and mutations H08 (replace null usage with zero), H09 (sum thread totals as deltas), H10 (skip process registration), H11 (renumber afterSeq results).**
- [ ] **Step 8: Commit Task 3 as `feat(control): supervise runs and publish ordered usage`.**

## Task 4: named handoff, deadline stop, final candidate, and quiet proof

**Files:** Create in ccloop `src/control/{handoff,stopProof}.ts`, `tests/control/{handoff,stopProof}.test.ts`, `tests/fixtures/process-tree.mjs`. Modify `src/controller/runLoop.ts` to distinguish an external handoff abort from timeout; extend `src/control/{worker,collect,command}.ts`.

**Interfaces:** `requestHandoff(envelope,request): Promise<HandoffAckV1>`; `buildHandoffPacket(...)`; `proveStopped(record): Promise<StopProof|null>`.

```ts
export interface HandoffPacketV1 {
  protocol: 1;
  identity: Identity;
  request: HandoffRequestV1 | null; // null only for a natural terminal run
  runState: RunState;
  completed: string[];
  unfinished: string[];
  pendingDecisions: string[];
  awaitingHuman: string[];
  validationCommands: string[];
  rawLogs: ArtifactRef[];
  usageHighWater: number;
  unresolvedRequestIds: string[];
  artifacts: ArtifactRef[];
}
```

- [ ] **Step 1: Write failing request tests.** Same `requestId`/payload is idempotent; changed reason/deadline conflicts; wrong run/generation refuses; request is fsynced before ack; once latched, no new attempt or phase begins.
- [ ] **Step 2: Write a phase/deadline test.** A cooperative request waits for the next phase boundary and spends no new attempt. At deadline the active adapter abort signal fires, Codex phase kills its registered process group, and the packet is `partial` if a complete narrative cannot be built.
- [ ] **Step 3: Write real process-tree tests.** The fixture forks a child and late grandchild in the registered pgid. PID leader exit alone must keep `stopProof:null`; proof appears only after worker seal exists, owner/lease is released, every registered `(pgid,startedAt)` is probed quiet, and a second probe after the grace interval is also quiet. Unknown `ps`/kill permission also yields null.
- [ ] **Step 4: Write packet tests.** Packet derives facts from contract, run state, attempt artifacts and events; no LLM call. Blocked state supplies awaitingHuman/decision text, validation commands and raw log refs are explicit, missing artifacts are listed, and both `complete/partial/failed` result paths retain raw refs. A natural terminal run also emits a packet with `request:null`, so D3 never has to guess facts from generic artifact names.
- [ ] **Step 5: Run both files and confirm RED.**
- [ ] **Step 6: Implement a watcher inside the worker.** It reads the immutable request record, sets the boundary stop slot immediately, and arms a deadline abort. External abort is persisted as handoff interruption, not misclassified as phase timeout, budget exhaustion or success.
- [ ] **Step 7: Finalize in order:** stop new phases → settle/abort current phase → write final usage event for work → build and fsync packet/candidate → write explicit handoff cumulative observation, including zero → seal worker → release ccloop owner/lease → let a later inspect/collect produce stop proof. Extend the wire `Candidate` with required `handoff:ArtifactRef`, pointing to the packet; do not write `isolated:true` from inside the still-running worker.
- [ ] **Step 8: Green-run and mutations H12 (ack before request fsync), H13 (ignore generation), H14 (treat leader exit as quiet), H15 (omit second quiet probe), H16 (map deadline to successful complete).**
- [ ] **Step 9: Commit Task 4 as `feat(control): persist handoff and prove execution quiet`.**

## Task 5: validated dirty-snapshot materialization for a new ccloop run

**Files:** Create in ccloop `src/control/materialize.ts`, `tests/control/materialize.test.ts`. Modify `src/workspace/worktreeManager.ts`, `src/controller/runLoop.ts`, `src/control/worker.ts`. Create in Orca `src/control/resumeBundle.ts`, `tests/control/resumeBundle.test.ts`; modify Orca `src/control/snapshot.ts` to export its validated `SnapshotV1` schema/type rather than duplicating the archive format.

**Interfaces:** Orca `exportResumeBundle(store,{predecessorRunId,newSourceDir}): Promise<InputCheckpointV1>`; ccloop `materializeFirstWorkspace(repoPath,runDir,attempt,input): Promise<{worktreePath:string}>`.

The artifact format consumed by ccloop is fixed rather than inferred:

```ts
export interface SnapshotV1 {
  version: 1;
  head: string;
  bundle: ArtifactRef;
  index: Array<{path:string;mode:string;oid:string;stage:number;ref:ArtifactRef|null}>;
  tree: Array<{path:string;kind:"file"|"directory"|"symlink";mode:number;ref?:ArtifactRef;target?:string}>;
  deleted: string[];
  missing: string[];
}
```

- [ ] **Step 1: Add Orca failing export tests.** Export only a committed, recoverable checkpoint whose snapshot and all nested refs re-read successfully. Manifest files are regular 0600 files under `{newSourceDir}/input/{checkpointId}/`; export refuses partial snapshot, bad hash, missing artifact, unsettled predecessor and destination symlink.
- [ ] **Step 2: Add ccloop failing materialization tests.** Build a snapshot with staged, unstaged, untracked, deleted, binary, executable, symlink and index stages 1/2/3. The first continuation attempt must reproduce Git HEAD, index bytes, worktree bytes, modes and symlink targets; `git status --porcelain=v2` must match the source fixture after path normalization.
- [ ] **Step 3: Add hostile bundle tests.** Reject `../` and absolute file names, duplicate artifactId with conflicting hash, missing blob, extra unmanifested input, symlink/FIFO artifact, bad checkpointHash, wrong predecessor and source snapshot changing during read.
- [ ] **Step 4: Run the two files in their respective repositories and confirm RED.**
- [ ] **Step 5: Implement Orca export as copy-and-verify, not path lending.** Read bytes through `readArtifact`, create a manifest containing every recursively referenced snapshot/checkpoint artifact, fsync files and directory, then re-read the exported directory and hash every file before returning `InputCheckpointV1`.
- [ ] **Step 6: Implement ccloop materialization.** Validate all bytes first; fetch the bundle's objects into the target repo without moving its branch; create the new run's attempt-1 worktree at snapshot HEAD; reconstruct index stages with `git update-index --index-info`; reconstruct tree entries without following symlinks; verify the completed worktree again before the adapter is constructed.
- [ ] **Step 7: Inject structured continuation context.** Write immutable `continuation-input.json` in the new run and append its absolute path to a copied contract's `context.relevantDocs`; append one exact constraint requiring the planner to treat `unfinished`, `pendingDecisions` and `awaitingHuman` as inputs. Do not mutate the predecessor contract or reset its run state.
- [ ] **Step 8: Green-run and mutations H17 (skip nested artifact hash), H18 (normalize `..` instead of reject), H19 (drop index stages), H20 (create attempt from target HEAD rather than snapshot), H21 (omit structured continuation input).**
- [ ] **Step 9: Commit ccloop and Orca Task 5 files separately with `feat(control): materialize committed continuation snapshots` and `feat(control): export immutable continuation bundles`.**

## Task 6: Orca production port, handoff transaction, and continuation budget inheritance

**Files:** Create in Orca `src/control/{ccloopPort,continuation}.ts`, `tests/control/{ccloopPort,continuation}.test.ts`, `tests/control/fixtures/fake-ccloop-control.mjs`. Modify `src/control/{types,schema,executionPort,dispatch,budget,service,schedulerBridge,checkpoints}.ts`.

**Interfaces:**

```ts
export interface ExecutionPort {
  capabilities(): Promise<Capabilities>;
  readEvidence(ref:ArtifactRef): Promise<Buffer>;
  accept(input:StartEnvelope): Promise<ExecutionStatus>;
  inspect(input:StartEnvelope): Promise<ExecutionStatus>;
  requestHandoff(input:StartEnvelope,request:HandoffRequest): Promise<HandoffAck>;
  collect(input:StartEnvelope,afterSeq:number): Promise<ExecutionReport>;
}

export function createCcloopExecutionPort(options:{
  binary:string;
  adapter:"codex";
  adapterConfigPath:string;
  timeoutMs:number;
}): ExecutionPort;

export class ControlService {
  requestHandoff(groupId:string,runId:string,input:{requestId:string;reason:HandoffReason;deadlineAt:string}): Promise<RunView>;
  continueTask(groupId:string,taskId:string,input:{commandId:string;expectedRevision:number}): Promise<RunView>;
}
```

- [ ] **Step 1: Write failing port tests.** Spawn the fake executable through the same `execFile` path as production. Assert stdin JSON, no shell, bounded stdout/stderr, exit 2 stable error propagation, bad stdout schema refusal, evidence base64/hash validation, and executable/config absolute regular-file checks.
- [ ] **Step 2: Write failing handoff orchestration tests.** `requestHandoff` first registers/claims the existing handoff work item against the parent run, persists an Orca request intent, then sends ccloop RPC. Response loss retries the same request; changed payload conflicts. Candidate without proof remains blocked and retains both reservations.
- [ ] **Step 3: Write failing continuation tests.** Only a settled recoverable predecessor with committed checkpoint can create a new run. The new run gets a new runId, `generation:1`, predecessor/checkpoint/hash in its start envelope, remaining group budget only, and does not reduce historical used. Same command replays the same new run; another active run, stale revision, wrong task/version or bad bundle refuses.
- [ ] **Step 4: Run the three Orca test files and confirm RED.**
- [ ] **Step 5: Implement ccloop port.** Use `execFile(binary,args,{input,maxBuffer,timeout})`; never interpolate a shell. `productionExecutionPort()` without explicit options keeps throwing `control-protocol-unavailable`, so no ambient PATH/config silently enables execution.
- [ ] **Step 6: Extend the envelope/schema.** Replace the old two-field input checkpoint with `InputCheckpointV1`; require `work` on production starts; add required `Candidate.handoff:ArtifactRef` and verify/read it with the other candidate evidence. Preserve existing fake tests by updating fixtures, not by making required production fields optional.
- [ ] **Step 7: Implement handoff commit sequence.** Collect and archive all evidence, append usage in sequence, combine ccloop candidate with Orca's independently captured snapshot, verify stop proof, call `commitCandidate`, publish projections, and only then mark the run recoverable/release reserve. Any failure retains sourceDir and ownership.
- [ ] **Step 8: Implement `claimContinuation` in `budget.ts`.** It is a new command verb, never a special case of `claimWork` returning the settled run. It requires the same task/work versions and computes each bucket exactly as `subtract(predecessor.grant[bucket], predecessor.cumulative[bucket])`—never from settle-cleared `predecessor.remaining`. It copies no used amount, atomically re-reserves that calculated grant, records predecessor/checkpoint/hash, and inserts a new active run; any zero required work dimension refuses before export/start.
- [ ] **Step 9: Green-run and mutations H22 (fallback to legacy runner), H23 (release reserve without proof), H24 (reuse settled runId), H25 (reset group used), H26 (start before resume bundle verification).**
- [ ] **Step 10: Commit Orca Task 6 as `feat(control): connect ccloop handoff and continuation`.**

## Task 7: D3 task/group JSON and Markdown projections

**Files:** Create in Orca `src/control/handoff.ts`, `tests/control/handoff.test.ts`. Modify `src/control/{projection,queries,checkpoints}.ts`.

**Interfaces:** `buildTaskHandoff(store,groupId,taskId): Promise<{json:Buffer;markdown:Buffer}>`; `buildGroupHandoff(store,groupId): Promise<{json:Buffer;markdown:Buffer}>`; `publishPending` handles versioned `task-handoff` and `group-handoff` outbox events serially.

Output layout under `stateDir/exports/`:

```text
groups/{groupId}/checkpoints/{checkpointId}.json
groups/{groupId}/handoff.md
groups/{groupId}/tasks/{taskId}/checkpoints/{checkpointId}.json
groups/{groupId}/tasks/{taskId}/handoff.md
```

- [ ] **Step 1: Write failing task projection tests.** A committed partial checkpoint follows `Candidate.handoff`, verifies and parses that packet, then renders identity, target version, completed/unfinished/pending/awaitingHuman, exact budget ledger reference, snapshot/artifact hashes, validation commands/raw logs and continuation command inputs. Markdown contains no private `ownerToken` or grant internals and no fact absent from JSON.
- [ ] **Step 2: Write failing group projection tests.** Completing or pausing one task updates the group handoff immediately; ready/running/blocked tasks remain listed with reason and dependency impact. The group links exact committed task checkpoint IDs, never scans “latest file” to guess.
- [ ] **Step 3: Write crash/order tests.** Transaction committed but projection missing is rebuilt; older outbox replay cannot overwrite a newer task/group handoff; projection failure neither rolls back usage nor removes recoverability; corrupt current checkpoint blocks rendering instead of falling back.
- [ ] **Step 4: Run the file and confirm RED.**
- [ ] **Step 5: Implement pure builders from DB + `readCommittedCheckpoint` + artifact readers.** Stable ordering is taskId/artifactId; omit a generated-at timestamp rather than inventing replay time. Define `groupCheckpointId` as the canonical hash of groupId, group revision, budgetVersion and the sorted exact task checkpoint refs. Markdown is a deterministic rendering of JSON.
- [ ] **Step 6: Publish versioned JSON first, then atomically replace `handoff.md`; fsync files/directories.** Register both projection events in the same checkpoint transaction. A group pause/exhaustion uses the same path and includes incomplete work.
- [ ] **Step 7: Green-run and mutations H27 (render from latest path), H28 (omit incomplete tasks), H29 (allow old replay overwrite), H30 (hide corrupt checkpoint and continue).**
- [ ] **Step 8: Commit Task 7 as `feat(control): project per-task and group handoffs`.**

## Task 8: real cross-repo protocol, crash recovery, and final verification

**Files:** Create in ccloop `tests/control/endToEnd.test.ts`, `scripts/verify-control-protocol.mjs`; create in Orca `tests/control/ccloopProtocol.integration.test.ts`, `tests/control/fixtures/control-crash-worker.mjs`. Modify ccloop `package.json` to add `verify:control`; modify Orca `scripts/verify-control.mjs` only if the existing `tests/control` glob does not already include the integration file. Update ccloop `docs/control-protocol-v1.md`, both rolling handoff sections, and the new plan's final checklist after evidence exists.

**Interfaces:** The Orca integration test requires explicit `ORCA_CCLOOP_BIN` and `ORCA_CCLOOP_ADAPTER_CONFIG`; if absent it skips only when run outside `verify:control`, while the dedicated cross-repo verification script requires both and fails if absent. Formal final acceptance has no skips.

- [x] **Step 1: Build ccloop and run an actual Orca `createCcloopExecutionPort` against its `dist/cli.js` with fake Codex.** Exercise accept → phase usage → handoff → proof → Orca archive/commit → export bundle → new run materialization → collect. Assert one agent launch per executionId and different runIds across continuation.
- [x] **Step 2: Cover the required R3 cases in that path:** duplicate handoff; accepted response dropped; stop proof missing; dirty snapshot continuation; old generation request; config/envelope conflict. Each must assert both product outcome and no extra process/launch.
- [x] **Step 3: Add six synchronized SIGKILL cases.** Kill at: accepted fsynced before spawn; worker claimed before agent; handoff request fsynced; candidate fsynced before quiet proof; Orca archive complete before DB commit; DB committed before D3 projection. Recovery must not duplicate agent, usage, checkpoint, continuation run or Markdown version.
- [x] **Step 4: Add positive controls.** Deliberately non-idempotent fake peer must increment twice; deliberately incomplete process-tree proof must remain null; deliberately corrupted artifact must block resume. These prove the tests can see the forbidden behavior.
- [x] **Step 5: Run ccloop targeted/full validation with saved logs:**

```sh
rtk proxy npx vitest run tests/control tests/controller/codex.integration.test.ts tests/runtime/codex
rtk proxy npm run typecheck
rtk proxy npm run build
rtk proxy npm test
```

- [x] **Step 6: Run Orca targeted/cross-repo validation with the built explicit binary:**

```sh
ORCA_CCLOOP_BIN=/tmp/ccloop-codex-0919/dist/cli.js \
ORCA_CCLOOP_ADAPTER_CONFIG=/private/tmp/orca-ccloop-d3-task8/fake-codex-config.json \
rtk proxy npm run verify:control
rtk proxy npm run typecheck
rtk proxy npm run verify
```

The executor must create `/private/tmp/orca-ccloop-d3-task8` with `mkdir` semantics that fail if it already exists, write the fake config there, and record its exact path/hash; it must not point at a real Codex binary. If the directory already exists, stop and choose a new fully written literal path in the plan evidence before running—never overwrite or reuse unknown contents.

- [x] **Step 7: Run every H01–H30 mutation in local clones.** Before each mutation copy uncommitted implementation bytes into the clone if needed, prove byte equality, require a behavioral assertion failure, restore, and record raw tracked/cached diff byte counts as zero. Re-run mutations affected by later fixes.
- [x] **Step 8: Read every final log in full and record:** commands, RC, actual commits, Node version, Vitest `RUN` paths, test counts, skip/todo scan, process registry, temp roots, artifact/checkpoint hashes, and confirmation that real `/Users/biran/.orca` remains absent. Do not infer values from this plan.
- [x] **Step 9: Update handoffs append-only.** Mark this slice complete only if both repositories' formal validation and the cross-repo path pass. Preserve Codex soft-only and unrerun真钱-wrapper facts; keep Web/automatic split/ccmem as next work; keep merge/push/cleanup and paid live checks awaitingHuman.
- [x] **Step 10: Commit each repository's final docs/evidence pointers separately. No merge, push or worktree deletion.**

## Verification and mutation evidence discipline

Each implementation task uses new evidence roots, without editing historical `.superpowers/sdd/**`:

```text
ccloop: .superpowers/sdd/2026-09-19-ccloop-control-handoff-d3/task-N/
Orca:   .superpowers/sdd/2026-09-19-ccloop-control-handoff-d3/task-N/
```

Every root records who/when/base, exact command, RC file and unfiltered log. A typical targeted run is executed with a shell only to preserve the tested command's exit code:

```sh
rtk proxy sh -c 'npx vitest run tests/control/handoff.test.ts > /tmp/ccloop-handoff.log 2>&1; result=$?; printf "%s\n" "$result" > /tmp/ccloop-handoff.rc; exit "$result"'
rtk proxy cat /tmp/ccloop-handoff.log /tmp/ccloop-handoff.rc
```

Final runs use new log names and continuous full-file readback. Do not reuse the foundation's `final-full-verify-2.log` or the Codex adapter's 45/706 result as proof for this slice.

## Spec coverage and self-review

| Spec requirement | Executable ownership in this plan |
|---|---|
| §13.1 truthful capability / soft-only Codex | Tasks 1, 3, 6, 8 |
| §13.2 all work grouped; work/handoff buckets | Tasks 3, 4, 6 |
| §13.3 durable accept and idempotent identity | Tasks 2, 6, 8 |
| §13.3 named handoff and quiet proof | Task 4, cross-repo Task 8 |
| §13.3 new run from exact checkpoint/snapshot | Tasks 5, 6, 8 |
| §13.4 archive then DB commit then projection | Tasks 6, 7, 8 |
| §13.5 evidence retained after source cleanup | Tasks 3, 4, 6, 8 |
| §7 D3 per-task and group handoff | Task 7 |
| §13.6 Web dependency | This plan supplies service APIs; Web remains next slice |

- [x] The plan does not repeat E7/settle, the five Codex adapter tasks, or the eight control-foundation tasks.
- [x] Producer and consumer responsibilities are explicit; no cross-repo source import or hidden direct agent call exists.
- [x] `runId`, `executionId`, `generation`, `requestId`, `checkpointId` and `predecessorRunId` remain distinct in every interface.
- [x] Unknown usage and explicit zero are distinct; both work and handoff observations are required before reserve release.
- [x] A missing quiet proof blocks replacement; PID disappearance alone is insufficient.
- [x] D3 Markdown is a projection from committed state, includes incomplete tasks, and cannot grant execution authority.
- [x] Review Focus items each have a named test task and positive control.
- [x] No unresolved marker or generic error/testing instruction remains; implementation steps identify files, interfaces, commands, expected failures and mutations.
- [x] Implementation completed under the accompanying SDD ledger; final commands, counts, hashes, identities, temp roots, and limitations are recorded in `task-8-final-metadata.md` rather than inferred from this plan.

## Execution handoff

建议 **Native**：Tasks 1–5 在 ccloop 建立紧密相依的持久协议，Tasks 6–8 随即用同一 wire contract 接入 Orca；在两个尚未整合的开发分支之间频繁切换，保持一个实施上下文比逐任务重新解释跨仓身份和崩溃边界更稳。全部任务完成后再做一次独立整支审查；审查发现按同一实施者修复、保存 RED/GREEN/变异证据，并明确是否进行第二轮审查。

本计划获人审阅并明确执行方式后才实施。整合 main、push、删除分支/worktree仍由人在终端操作；真钱 agent 与 Claude chain 验收不属于本计划。
