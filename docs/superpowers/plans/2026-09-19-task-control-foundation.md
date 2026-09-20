# Task Control Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划建议 Native；执行方式保留人的选择，实施前先审阅本计划。

**Goal:** 实现 task-control §13.6 第一项：所有组内工作共用持久领取与预算账本，启动不确定时不重复派发，证据独立归档后再一致提交和回收。

**Architecture:** Orca 单写服务以 SQLite 保存授权、任务版本、领取、账本和已提交引用；不可变文件保存证据内容。复用 scheduler 的图、写集、harvest 和 landing 判据，通过一个控制端口调用 ccloop；具体 agent、请求封顶和进程隔离仍由 ccloop 实现。先交付真实数据库／文件系统上的应用层与离线协议对端，未完成新协议的真实 ccloop 按名拒绝接入受控任务组。

**Tech Stack:** TypeScript ESM、Zod、Vitest、Node `node:sqlite` DatabaseSync、Git、已有 scheduler。新增控制服务要求 Node >=22.13.1；旧命令不因惰性加载控制模块而提高运行前置条件。数据库 API 仍属实验性，封装在 `store.ts`，不散落到 Web。

**Spec:** `docs/superpowers/specs/2026-09-19-task-control-design.md`，尤其 §4–7、§13.1–13.6；§13 优先于旧正文。规格已获批准，标题及末尾的历史“待审”不再代表当前状态。

归属：Codex task `01a0b836-21b3-7d93-89c4-4a9b86293eb0`，2026-09-19；规划源码基点 Orca `75d65eca0f4bcf047d62854c5af191815a00d485`。ccloop 主树 `9b64b3a`，Codex 开发树 `532f3e1`，ccmem `ffd1da0`，均为本轮只读观测锚点，不规定未来 HEAD。

## Global Constraints

- Orca 控制 ccloop；agent 参数、事件、进程与请求上界留在 ccloop。Web > CLI，两者以后共用本服务；本计划不扩展 chain。
- 默认 `strict`；显式 `soft` 才能软限制。实时 usage 不等于可封顶。Codex 当前仅 soft；现有 claude/scripted adapter 也不能凭名称推断支持新控制协议。
- 所有组内模型工作都有 `groupId/workItemId/runId/kind`；拆分、冲突修复、交接、组复核、模型型记忆处理均归账。纯代码操作不虚构模型用量。
- 累计 tokens、上下文占用、活动时间、wall deadline、attempt、session 分开；cached input 不二次累计，美元无来源即 unknown。
- `used + reserved <= limit` 是领取不变量。超额照实写账，未知消耗保留预留，停止后已预留的交接可以完成。
- 默认 stateDir 为仓库内 `.orca/control/`，加入忽略；测试显式临时 stateDir，不创建真实 `~/.orca`，不触碰 ccmem 用户数据。
- 新目录 `0700`，新文件 `0600`；已有文件不 chmod。归档存储模式与快照记录的原文件模式是两个字段。
- 不变检查点：`checkpoints/<runId>/<checkpointId>.json`；数据库引用决定执行权，Markdown/latest 是投影。不可从孤立文件恢复预算或授予执行权。
- 每新增分支配点名删除变异；变异只在 local clone，亲读红绿完整日志、还原 tracked/cached diff 为零。不得放宽既有判据。
- 所有验证重定向到文件，保留退出码并完整读回；不把摘要或本计划的预期当成验证结果。
- 保留历史 handoff、SDD、开发树和 live 证据。整合进 main、push、删分支/worktree 由人在终端操作。
- 不调用真实模型；Claude 2026-09-22 09:00 Asia/Shanghai 后核实额度，chain 活验仍需人选 model 并点头。

## Review Focus

1. 同 commandId 的不同 payload、重试时旧 revision：相同请求返回首次结果，不同内容按名拒绝（Task 2）。
2. 乱序／重复／冲突 usage、缺失与显式零：不退账、不重复记账、不把未知变零（Task 3）。
3. accepted 已持久化但连接中断、租约过期而旧执行仍活：不开第二个 agent，不因 generation 改变就释放所有权（Task 4）。
4. 脏 index、二进制、符号链接、文件在快照中途变化、特殊文件：独立读回或明确 partial，不能伪装完整快照（Task 5）。
5. 归档／事务／投影／清理四个边界掉电及磁盘满：恢复只补缺失动作，不重复计费、运行或落地（Task 6、8）。

## 交付边界与既有接缝

本计划交付可直接调用的 `ControlService` 与持久化读模型；不做 Web 页面，也不提供仅靠旧 `resumeLoop` 实现的“恢复”按钮。真实 ccloop 新公共协议、handoff 请求、静止证明、快照物化属于下一计划。这里定义 Orca 所需的端口和版本化数据，不声称 ccloop 已实现。

现有 `runRound` 是旧单轮 CLI，继续保持旧契约；受控组不能降级调用它。将其执行／清理／reconciliation 接缝显式抽出，使同一 orchestration 的 **controlled 路径**只能使用新入口。旧 CLI 不承诺组账本或恢复能力，文档注明迁移边界；所有 Web 组操作只使用 controlled 路径。此隔离不是允许组内另开无账本 run 的例外。

| 现有文件／符号 | 实测问题或复用点 | 本计划处理 |
|---|---|---|
| `scheduler/run.ts` `runRound`、`reconcileAndLand` | 两处直接 `runTask`；后者另分配 run | Task 7 抽执行端口，受控分支统一领取 |
| `scheduler/reconcile.ts` `synthesizeReconcileContract` | 预算取双方 max，maxAttempts 固定 1 | 受控分支必须传获批额度；旧入口保持兼容 |
| `scheduler/ccloopRunner.ts` `runTask` | 只收终态，吞在 stdout/stderr 内存中的原始输出 | 不冒充新协议；新端口不得调用旧 runner 作降级 |
| 同文件 `disposeWorkdir` | 成功后直接删除完整 workdir | 受控分支只经归档提交后的清理授权 |
| `scheduler/graph.ts` `buildGraph` | 已有环和写集排序 | Task 2 重用；额外拒绝悬空依赖 |
| `checkpoint/**`、`chain/**` | 开发会话检查点依赖 Claude transcript | 不改写；产品检查点单独版本和目录 |

### 分片依赖与明确延后

`1 store → 2 group commands → 3 ledger → 4 dispatch`；`5 archive` 依赖 1/2；`6 commit` 汇合 3/4/5；`7 scheduler → 8 crash acceptance`。

- R1 请求级封顶／内部重试的真执行、R3 agent handoff 与新 run 物化：下一 ccloop/D3 计划；本计划测试能力拒绝、额度分桶和协议消费端。
- R4 跨主机迁移：本计划没有可执行导入 API，离线备份始终无执行授权；跨主机 transfer/revocation 留下一协议切片，不做复制即恢复。
- R5 Web 详情显示：本计划提供稳定 artifact 读接口，Web 切片验证页面；底座必须在源目录移除后仍独立读全证据。
- 自动拆分、记忆与 goal 模型复核的业务 prompt 留第四切片；它们的 work kind、领取与计费现在可测试。所有子任务完成只进入 review，不能当 goal done。

## 文件结构与共享类型

新建 `src/control/`：

| 文件 | 单一职责 |
|---|---|
| `types.ts`, `schema.ts`, `errors.ts` | 公共类型、边界校验、具名错误 |
| `paths.ts`, `store.ts`, `migrations.ts` | 私有 stateDir、SQLite 生命周期、事务与版本迁移 |
| `commands.ts`, `graph.ts` | 幂等用户命令、目标／图版本及组停止 |
| `budget.ts`, `usage.ts` | 额度领取和有序幂等结算 |
| `executionPort.ts`, `dispatch.ts`, `ownership.ts` | ccloop 端口、持久启动 intent、执行所有权 |
| `archive.ts`, `snapshot.ts` | 原始证据与 Git／脏工作区快照 |
| `checkpoints.ts`, `projection.ts`, `cleanup.ts` | 提交事务、可重建视图、安全回收 |
| `service.ts`, `queries.ts`, `recovery.ts` | 对 Web/CLI 的应用 API、读模型、重启核对 |
| `schedulerBridge.ts` | 将受控工作接入 scheduler 的共用 orchestration |

测试在 `tests/control/` 同名文件；fixture 在 `tests/control/fixtures/`。新增 `scripts/verify-control.mjs`，`package.json` 接入 verify；`README.md` 只补控制底座能力与边界；`.gitignore` 加 `.orca/control/`。不修改 ccloop/ccmem 产品源码。

公共类型在 Task 1 建立，此后不在各 Task 复制第二套定义：

```ts
export type WorkKind = "task" | "decompose" | "reconcile" | "handoff" | "goal-review" | "memory";
export type BudgetMode = "strict" | "soft";
export interface Amount { tokens: number; activeMs: number; attempts: number; sessions: number }
export interface Grant { work: Amount; handoff: Amount }
export interface CommandMeta { commandId: string; expectedRevision: number; by: string }
export interface Identity {
  groupId: string; workItemId: string; taskId: string | null; runId: string;
  generation: number; graphVersion: number; targetVersion: number;
}
export interface Capabilities {
  protocol: 1; durableAccept: boolean; ownershipIsolation: boolean;
  evidenceRetention: boolean;
  usageObservation: "realtime" | "phase-end" | "unavailable";
  budgetEnforcement: "bounded" | "soft" | "unsupported";
  requestBoundEvidence: string | null;
}
export interface GroupInput {
  groupId: string; projectKey: string; goal: string; successConditions: string[];
  budgetMode?: BudgetMode; limit: Amount; reviewReserve: Amount;
  deadlineAt: string | null;
}
export interface WorkBase {
  workItemId: string; taskId: string | null;
  dependsOn: string[]; contract: unknown; configHash: string; grant: Grant;
}
export type WorkInput = WorkBase & (
  | {kind:"handoff";parentRunId:string}
  | {kind:Exclude<WorkKind,"handoff">;parentRunId?:never}
);
export interface ClaimInput extends CommandMeta {
  groupId: string; workItemId: string; graphVersion: number; targetVersion: number;
  capabilities: Capabilities;
}
export interface Claim extends Identity {
  commandId: string; configHash: string; grant: Grant; ownerToken: string;
}
export interface ArtifactRef { artifactId: string; hash: string }
export interface UsageEvent {
  runId: string; generation: number; eventSeq: number;
  bucket: "work" | "handoff";
  cumulative: Amount | null; source: ArtifactRef;
}
export interface StopProof {
  executionId: string; generation: number; isolated: true; source: ArtifactRef;
}
export interface Candidate extends Identity {
  checkpointId: string; usageHighWater: number;
  result: "complete" | "partial" | "failed";
  artifacts: ArtifactRef[]; snapshot: ArtifactRef | null;
  missing: string[]; unresolvedRequestIds: string[];
  stopProof: StopProof | null; terminalOutcome: string;
}
export interface GroupView {
  groupId: string; revision: number; graphVersion: number; stopped: boolean;
  status: "draft" | "ready" | "running" | "review" | "done" | "blocked";
  used: Amount; reserved: Amount; limit: Amount;
}
export interface RunView {
  runId: string; generation: number; executionId: string | null;
  state: "claimed" | "starting" | "accepted" | "unknown" | "settled";
  checkpointId: string | null; recoverable: boolean;
}
```

所有 Amount 分量是非负 safe integer；运算先判溢出，不能用 Number.MAX_VALUE 或 Infinity 代表无限。`cumulative` 是**每 run、每 bucket 的累计值**，不是每个事件的增量；`eventSeq` 在 run 内全局连续递增。请求级原始累计由 ccloop 转成此协议，Orca 不解析 Codex thread usage。

## Task 1: 私有 stateDir 与可回滚的 SQLite 存储

**Files:** Create `src/control/{types,schema,errors,paths,store,migrations}.ts`; `tests/control/store.test.ts`; `tests/control/fixtures/store.ts`. Modify `.gitignore`。

**Interfaces:** `openControlStore({stateDir: string, recovery?: boolean}): Promise<ControlStore>`；`ControlStore` 暴露 `db: DatabaseSync`、同步 `transaction<T>(fn:()=>T):T`、`close():void`。所有后续数据函数接受该实例；事务回调禁止 Promise。测试 fixture `openTestStore(): Promise<{store:ControlStore;root:string;dispose():Promise<void>}>` 只创建临时根并注册清理。

- [ ] **Step 1: 写持久化／回滚／路径隔离判据。** 每条测试 `try/finally` 调 dispose；另进程测试使用退出码和真实 DB，不 mock transaction。

```ts
const h = await openTestStore();
try {
  expect(() => h.store.transaction(() => {
    h.store.db.prepare("INSERT INTO meta(key,value) VALUES (?,?)").run("probe", "one");
    throw new Error("abort");
  })).toThrow("abort");
  expect(h.store.db.prepare("SELECT value FROM meta WHERE key=?").get("probe")).toBeUndefined();
  expect((await stat(h.root)).mode & 0o777).toBe(0o700);
} finally { await h.dispose(); }
```

补文件 0600、已有模式不改、stateDir 指向 symlink 拒绝、坏 schemaVersion 不修改、第二 writer 被拒（并有第一 writer 正向成功）、崩溃 rollback 后重开无半行。

- [ ] **Step 2: `rtk proxy npx vitest run tests/control/store.test.ts`，确认未实现红；完整日志留存。**
- [ ] **Step 3: 建表和事务。** 初版 schema v1 用以下表；JSON 列保存经 schema 校验的对象，账本运算仍取事务内最新记录，不依赖内存 cache。

```sql
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE groups(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, graph_version INTEGER NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE work_items(group_id TEXT NOT NULL REFERENCES groups(id), id TEXT NOT NULL, target_version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(group_id,id)) STRICT;
CREATE TABLE commands(group_id TEXT NOT NULL, id TEXT NOT NULL, payload_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(group_id,id)) STRICT;
CREATE TABLE runs(id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), work_item_id TEXT NOT NULL, generation INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)), body TEXT NOT NULL) STRICT;
CREATE UNIQUE INDEX one_active_work ON runs(group_id,work_item_id) WHERE active=1;
CREATE TABLE usage_events(run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, payload_hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,seq)) STRICT;
CREATE TABLE artifacts(id TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE checkpoints(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), hash TEXT NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE outbox(id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0) STRICT;
```

用专属 service lock（mkdir + 随机 owner nonce + PID/start identity）限制单写；第二普通 writer 不通过删除 stale lock 夺权。`recovery:true` 只有确认原**服务进程**身份已消失、host/path 一致后，才能在单独 recovery-lock 下重读 nonce、隔离旧 service-lock 记录并取得新的服务锁；PID 检测不明、活进程或 nonce 改变均拒绝。此时全局 dispatchBlocked=true，只允许核对与记证据；ccloop run 的 active/owner/预留保持不动。Task8 核对各执行停止/隔离后逐项恢复派发资格，租约超时本身不是 takeover 证据。DB 先以 `open('wx',0600)` 预建再打开；初版用 `journal_mode=DELETE`，SQLite journal 位于0700目录并核对0600；`foreign_keys=ON`、`synchronous=FULL`、`busy_timeout=5000`。事务 `BEGIN IMMEDIATE/COMMIT/ROLLBACK`，finally 不能吞原错误。Node 版本检查先于动态 import，错误名 `control-node-unsupported`。

- [ ] **Step 4: 绿跑并删变异 M01（删 ROLLBACK）、M02（删 one_active_work）、M03（绕 stateDir symlink 检查）。M02 在 Task 3 领取判据补跑。**
- [ ] **Step 5: 提交本 Task 明确文件，主题 `feat(control): persist private versioned control state`。**

## Task 2: 组、任务图与命令幂等

**Files:** Create `src/control/{commands,graph,queries}.ts`; `tests/control/commands.test.ts`。

**Interfaces:** `createGroup(store,input:GroupInput,meta:CommandMeta):GroupView`；`putWork(store,groupId,input:WorkInput,meta):GroupView`；`setGroupStopped(store,groupId,stopped:boolean,meta):GroupView`；`setGroupLimit(store,groupId,limit:Amount,meta):GroupView`；`getGroup(store,groupId):GroupView`；`getRun(store,runId):RunView`。这些是内部应用 API，不允许任意 SQL 由 Web 提交。

- [ ] **Step 1: 写命令重放和冲突测试。** `createGroup` expectedRevision=0；成功 revision=1；初始预算 100 tokens、组验收 reserve=10。

```ts
const input: GroupInput = {
  groupId: "g1", projectKey: "github.com/example/repo", goal: "Ship a checked change",
  successConditions: ["required checks pass"],
  limit: {tokens:100,activeMs:10000,attempts:10,sessions:10},
  reviewReserve: {tokens:10,activeMs:1000,attempts:1,sessions:1}, deadlineAt:null
};
const meta = {commandId:"create-1",expectedRevision:0,by:"human"};
const first = createGroup(store,input,meta);
expect(createGroup(store,input,meta)).toEqual(first);
expect(() => createGroup(store,{...input,goal:"Different"},meta)).toThrow("command-id-conflict");
expect(first.reserved.tokens).toBe(10);
expect(() => setGroupStopped(store,"g1",true,{...meta,commandId:"stop-1"})).toThrow("revision-conflict");
```

另测重复 id、环、悬空依赖、不同 project 隔离、空目标、非整数／负／溢出额度、reviewReserve 超 limit、降低 limit 到已用+预留以下拒绝。图变更影响 active run 时保存 proposed 版本且锁存停止派发，直到静止确认才激活；本切片无 handoff 能力则按名 `graph-change-needs-handoff`，不能直接换 active 契约。

- [ ] **Step 2: 跑 commands 文件，确认 RED。**
- [ ] **Step 3: 实现共用幂等事务，重用 `buildGraph` 与写集规则。** command 的稳定序列化递归排序对象键、保持数组顺序，hash 包括 verb/group/by/expectedRevision/body；先查 command，再核 revision。因此真正重试旧 revision 可返回首次结果，换新 commandId 的陈旧修改拒绝。

```ts
return store.transaction(() => {
  const previous = store.db.prepare("SELECT payload_hash,result FROM commands WHERE group_id=? AND id=?").get(groupId, meta.commandId);
  if (previous) {
    if (previous.payload_hash !== payloadHash) throw new ControlError("command-id-conflict");
    return JSON.parse(String(previous.result));
  }
  const group = getGroup(store, groupId);
  if (group.revision !== meta.expectedRevision) throw new ControlError("revision-conflict");
  const result = mutate(group);
  store.db.prepare("INSERT INTO commands VALUES (?,?,?,?)").run(groupId,meta.commandId,payloadHash,JSON.stringify(result));
  return result;
});
```

上述片段置于 `applyCommand<T>(store,groupId,meta,payload,mutate):T`，`mutate` 是同步函数；createGroup 另用不存在视为 revision 0 的分支。每次状态成功修改 revision+1；usage 不改变用户配置 revision，另有 budgetVersion。

- [ ] **Step 4: GREEN + M04（删 payload hash 比较）、M05（删 revision 校验）、M06（组创建不预留复核）。**
- [ ] **Step 5: 提交 `feat(control): version groups and deduplicate commands`。**

## Task 3: 统一领取与真实消耗结算

**Files:** Create `src/control/{budget,usage}.ts`; `tests/control/budget.test.ts`, `tests/control/usage.test.ts`。

**Interfaces:** `claimWork(store,input:ClaimInput):Claim`；`recordUsage(store,event:UsageEvent):{applied:boolean;highWater:number}`；`releaseRunReserve(store,runId,proof:StopProof):void` 仅供 Task 6 事务内调用。`assertCapabilities(mode,capabilities):void` 放 `budget.ts`，固定错误码。

- [ ] **Step 1: 用真实 store 构造 g1（100）、review reserve 10、T1 work 60+handoff 10、T2 work 25+handoff 5；领取 T1 后 T2 拒绝。** 另进程争抢同 workItem 仅一方成功（M02），同 command 重投返回同 runId。

```ts
const c1 = claimWork(store, t1Claim);
expect(getGroup(store,"g1").reserved.tokens).toBe(80);
expect(() => claimWork(store,t2Claim)).toThrow("group-budget-unavailable");
recordUsage(store,{runId:c1.runId,generation:c1.generation,eventSeq:1,bucket:"work",
  cumulative:{tokens:40,activeMs:20,attempts:1,sessions:1},source:usageRef});
expect(getGroup(store,"g1").used.tokens).toBe(40);
expect(getGroup(store,"g1").reserved.tokens).toBe(40);
```

测试内 t1Claim/t2Claim 是填满公共类型的字面量；usageRef 来自临时文件 hash（Task 5 之后接真实归档），不使用无来源零。用 helper `seedBudgetCase(store)` 返回 `{t1Claim,t2Claim,usageRef}`，定义在 `tests/control/fixtures/store.ts` 并完整创建上述组与两项工作。

补判据表，使用 `it.each`，不得只测一类工作：

| 输入／动作 | 断言 |
|---|---|
| task/decompose/reconcile/goal-review/memory 停组后领取 | 全部拒绝且 executor 调用数 0 |
| 预留交接的 active run 收 handoff usage | 停组仍结算；不能另造无关联 handoff run |
| strict+realtime+soft；strict+bounded 无 bound evidence | capability 拒绝，reserved 不变 |
| soft work 实耗 120 > grant 60 | used=120，work reserve=0，breach 留痕；handoff/review reserve 不偷用；后续领取拒绝 |
| seq1 重复相同／重复改内容 | 分别 no-op／usage-event-conflict |
| seq3 先于 seq2 | 存 pending，highWater 停在1，结算不跳过缺口；seq2 到后按序重放 |
| bucket cumulative 从40降30 | usage-regression，仍保留40和预留 |
| null／坏 usage | 待核对，预留不释放；显式0+原始证据才是0 |
| 两个 run 各 activeMs=60000 | 总实耗120000，不按墙钟60000算 |
| 同 attempt handoff | attempts 不增加；确需新会话先预留 sessions |
| 工作额度不足但 handoff 尚足 | 不转移 handoff 给 work |

- [ ] **Step 2: 分别 RED 跑 budget/usage。**
- [ ] **Step 3: 同一个 BEGIN IMMEDIATE 内校验所有权、组停止、依赖、版本、能力、分量预算、deadline，再写 run 与 reservation。** claim 生成不可复用随机 runId；同 command 返回已存值。记录 ledger 保留 per-run grant、两桶 cumulative、remainingReserve、reviewReserve、budgetVersion；组 used/reserved 是这些项的事务聚合。

```ts
const delta = subtract(nextCumulative, previousCumulative);
const released = componentMin(delta, bucketRemainingReserve);
group.used = add(group.used, delta);
group.reserved = subtract(group.reserved, released);
bucketRemainingReserve = subtract(bucketRemainingReserve, released);
```

`add/subtract/componentMin` 在 budget.ts 定义并逐分量检查 safe integer；负 delta 拒绝。超额不裁 used；如果用量突破 strict 声明也保存 breach、锁存停止，而不是回滚事实。group-review 从已有复核 reserve **转账**到 run，不重复增加 reserved；无可用复核余额保持 review。handoff workItem 必须 parentRunId，借用父 run 的 handoff 桶；该引用扩展 WorkInput 为 discriminated union，其他 kind 禁止 parentRunId。

每次记录事件时核对 generation，拒旧写；恢复时接收旧 run 原身份的最终证据走 recovery 专用核对，不能把新 generation 写进旧事件。attempt/session 使用累计计数而非每条事件+1，防重投虚扣。handoff workItem 是父run下独立归因项，claimWork 对它返回父run身份、绑定其hand-off桶，不创建第二个并发执行；因此预算索引按run+bucket，同时保存该桶的workItemId。若交接确需独立执行会话由后续ccloop协议落实，不能在此调用旧runner冒充。

- [ ] **Step 4: GREEN；M07 删停止检查、M08 删预算分量检查、M09 unknown 改0并释放、M10 去掉 eventSeq 去重、M11 去掉累计单调检查、M12 取消分桶、M13 group review reserve 二次预留。每个变异必须由行为断言打红。**
- [ ] **Step 5: 提交 `feat(control): claim all work against one budget ledger`。**

## Task 4: 持久启动意图与执行所有权

**Files:** Create `src/control/{executionPort,dispatch,ownership}.ts`; `tests/control/dispatch.test.ts`; `tests/control/fixtures/fake-control-peer.mjs`。

**Interfaces:**

```ts
export interface StartEnvelope {
  protocol: 1; claim: Claim; contractHash: string;
  inputCheckpoint: {checkpointId:string;hash:string} | null;
}
export type ExecutionStatus =
  | {kind:"absent"}
  | {kind:"accepted";executionId:string;configHash:string}
  | {kind:"unknown"}
  | {kind:"stopped";proof:StopProof};
export interface ExecutionReport {
  events: UsageEvent[];
  candidate: Candidate | null;
  terminal: {
    outcome: "succeeded" | "blocked_waiting_human" | "exhausted" | "cancelled" | "failed";
    attemptSha: string | null; sourceDir: string; repoDir: string;
  } | null;
}
export interface ExecutionPort {
  capabilities(): Promise<Capabilities>;
  accept(input:StartEnvelope): Promise<ExecutionStatus>;
  inspect(input:StartEnvelope): Promise<ExecutionStatus>;
  collect(input:StartEnvelope, afterSeq:number): Promise<ExecutionReport>;
}
export function startClaim(store:ControlStore, port:ExecutionPort, input:StartEnvelope):Promise<RunView>;
export function reconcileStart(store:ControlStore, port:ExecutionPort, runId:string):Promise<RunView>;
```

`ExecutionPort` 是 Orca 侧消费合同，不是以 Orca 实现 agent 适配。production factory 首版固定 `control-protocol-unavailable`，没有自动退回 `runTask`、Claude 或其他 PATH executable。fake peer 只在 tests 中，具有自身独立 accept journal 和 launch counter，先 fsync accepted 再增长计数，用管道/子进程协议测断连；不是 production runtime。ClaimInput.capabilities 由服务查询已配置的 peer 后填入，不能由 Web 请求体声明 bounded；schema 拒绝客户端提供该字段。future peer 的能力证据要与 ccloop版本/adapter/configHash绑定，字符串非空只作协议形状校验，不是实际封顶的证明。

- [ ] **Step 1: 写 accepted 后断连测试。** 同 envelope 再调 start，inspect 返回原 executionId，fake launch counter=1；不同 configHash 拒绝。

```ts
await expect(startClaim(store, peer, envelope)).rejects.toThrow("start-outcome-unknown");
expect(getRun(store,envelope.claim.runId).state).toBe("unknown");
const recovered = await reconcileStart(store,peer,envelope.claim.runId);
expect(recovered.executionId).toBe("execution-1");
expect(await readFile(counterPath,"utf8")).toBe("1\n");
```

补：发送前 crash、accept 写盘后 crash、Orca accepted 写盘后 crash、inspect 无响应、旧进程仍活、PID reuse、旧 generation 提交、第二监督者与 clock 后退。所有不确定情况保存 active=1 和预留；必须经 peer 隔离旧执行并校验证据后才能接替。单纯 lease 到期、PID 不存在、父进程退出均不够。

- [ ] **Step 2: RED dispatch，观察计数仪器的正控（正常启动计数1）与必抓控（故意非幂等 fake 计数2）。**
- [ ] **Step 3: 实现两阶段本地操作。** claim 事务创建 outbox start intent；派发者 CAS claimed→starting 后才调用 accept；返回 accepted 持久保存 executionId/configHash 映射。发送结果不明记 unknown、先 inspect 原身份，永不生成另一个 runId 重试。inspect absent 只允许同 envelope 重送，依赖 durable accept 幂等；stop intent 已锁存时不重送尚未开始的工作。

服务锁保护唯一派发者，run ownerToken/generation 防本地过期写；ccloop 的 ownershipIsolation 能力负责实际 fencing。fresh generation 不销毁旧代次证据；接替只能在旧执行静止／隔离已确认后事务记录授权。缺任一能力的 adapter 在 claim 前拒绝。

`collect` 补齐执行中用量与终态接缝；有界长轮询由服务持有，浏览器断开不影响它。端口返回的 sourceDir/repoDir 必须位于预登记 run root，不能据任意返回路径读文件或清理。UsageEvent.source 指向先独立归档的原始协议证据，未经核验不能结算。底座先写测试 peer 的完整 collect 流，下一切片才把 ccloop 真实生产者接上；非终态或 collect 失败不合成 failed/zero，不释放预留。

- [ ] **Step 4: GREEN；M14 删持久 start intent、M15 unknown 时新建 run、M16 lease 超时直接释放、M17 删 generation 检查、M18 protocol 不支持时回退旧 runner。**
- [ ] **Step 5: 提交 `feat(control): reconcile durable starts without duplicate execution`。**

## Task 5: 独立证据归档与完整脏快照

**Files:** Create `src/control/{archive,snapshot}.ts`; `tests/control/archive.test.ts`; `tests/control/snapshot.test.ts`。

**Interfaces:** `archiveRun(store,input:{runId:string;sourceDir:string;repoDir:string;stopProof:StopProof|null}):Promise<{artifacts:ArtifactRef[];snapshot:ArtifactRef|null;missing:string[]}>`；`readArtifact(store,ref:ArtifactRef):Promise<Buffer>`；`verifySnapshot(store,ref:ArtifactRef):Promise<void>`。archiveRun 不提交 checkpoint、不中止进程、不清理源目录。

- [ ] **Step 1: 用临时 Git repo 构造 HEAD 文件、不同的 staged/unstaged 内容、untracked 二进制、删除项、可执行位和 symlink。归档后移走原 sourceDir，独立从 archive 读取并验证每类字节。** 不能只比 manifest 存在。

```ts
const result = await archiveRun(store,{runId:"r1",sourceDir,repoDir,stopProof});
expect(result.missing).toEqual([]);
await rename(sourceDir, sourceDir + "-retained-for-test");
await verifySnapshot(store,result.snapshot!);
for (const ref of result.artifacts) {
  const bytes = await readArtifact(store,ref);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(ref.hash);
}
```

另外：同 id 同 hash 可重试；同 id 不同 hash 拒绝；../ 与绝对路径、symlink 父目录逃逸拒绝；FIFO/socket 不阻塞（missing 按名登记、snapshot 不完整）；ENOSPC 留 source；静止证明缺失不能完整可恢复；复制中改变文件后最终 hash 不符判 partial。

- [ ] **Step 2: RED archive/snapshot。**
- [ ] **Step 3: 实现 staging→fsync→不可变发布→独立读回。** 输出在 stateDir `artifacts/<artifactId>/`，临时 staging 同文件系统；文件 close 前 sync，目录也 sync；最终路径 exclusive 发布，重试只比相同内容。不从原路径读作为归档验证。

快照 manifest v1 包含：HEAD、所有 refs 的独立 `git bundle`（含 detached HEAD）、`git ls-files --stage -z` 的完整 stage0–3 条目与各 blob 内容、working tree 完整字节／symlink target／模式／删除清单。所有恢复必需 Git 对象由 bundle+index blob 显式携带，不依赖 local clone hardlink 或源 object alternates。`git bundle verify` 在独立空仓核验。不复制可执行 hooks 或旧锁作为新执行配置。

仓内 `.git` 使用 Git 数据语义采集；其他工作文件包括 ignored/untracked，不能默认忽略 node_modules 就声称完整。特殊文件、嵌套 Git/submodule 或无法独立获取的 LFS 内容首版按名 missing、partial，留现场；不静默跳过。大文件流式 hash/copy；symlink 仅记录链接文本，永不跟随。stateDir 不得位于 sourceDir 内，防自包含递归；真实 `~/.orca` 不是归档默认路径。

归档的日志必须包括原始 ccloop 输出、usage、验证输出、输入契约和配置版本（机密凭据不由 Orca额外读取）；权限私有。Snapshot 的 mode 保存在 metadata，归档对象本身仍0600。

- [ ] **Step 4: GREEN；M19 去掉 fsync（通过注入记录顺序+crash测试），M20 清单漏 untracked，M21 index 与 worktree 合并一份，M22 跟随 symlink，M23 从源读作验证，M24 缺项仍 complete。**
- [ ] **Step 5: 提交 `feat(control): archive logs and dirty snapshots independently`。**

## Task 6: 一致提交、投影重建与可重试清理

**Files:** Create `src/control/{checkpoints,projection,cleanup}.ts`; `tests/control/checkpoints.test.ts`, `tests/control/cleanup.test.ts`。

**Interfaces:** `commitCandidate(store,candidate:Candidate):Promise<{checkpointId:string;hash:string}>`；`publishPending(store,deps?:{writeProjection:(path:string,bytes:Buffer)=>Promise<void>}):Promise<void>`；`cleanupCommittedRun(store,runId:string,sourceDir:string):Promise<{removed:boolean}>`；`readCommittedCheckpoint(store,runId):Promise<Candidate>`。不得使用单个布尔 `isSafe` 绕全部前提。

- [ ] **Step 1: 写故障边界测试（真实 files+DB，每个 crash 重开 store）。** 测试 helper `makeCandidate(store,claim,result):Promise<Candidate>` 由 Task 5 的真实临时源、archiveRun、已记录 usage 构造，不能凭空 hash。故障钩子仅经依赖注入：`afterArchive/afterTransaction/beforeProjection/beforeCleanup`，生产无环境变量后门。

```ts
const committed = await commitCandidate(store,candidate);
const beforePublish = getGroup(store,candidate.groupId);
await expect(publishPending(store,{writeProjection:async () => {
  throw new Error("projection-write-failed");
}})).rejects.toThrow("projection-write-failed");
expect((await readCommittedCheckpoint(store,candidate.runId)).checkpointId).toBe(committed.checkpointId);
expect(getGroup(store,candidate.groupId).used).toEqual(beforePublish.used);
await publishPending(store);
expect(getGroup(store,candidate.groupId).used).toEqual(beforePublish.used);
```

注入只替换投影写入函数，不另开 writer，默认使用生产 fs 实现。`beforePublish` 在结算完成后读取，判据测实际调用前后不重复结算。

必须测试：仅候选无DB引用不可恢复；DB引用坏 hash 阻塞；usage 高水位有 gap、未结算请求、无 stop proof 时不释放余额；完整归档但验收未过不可 done；投影失败重建不退账；清理失败任务不重新执行；多 checkpoint 不覆盖前一份；late candidate 不覆盖新版本。

- [ ] **Step 2: RED checkpoints/cleanup。**
- [ ] **Step 3: 按 §13.4 固定顺序实现。**

```ts
await verifyCandidateArtifacts(store, candidate);
const reference = await persistImmutableCheckpoint(store, candidate);
store.transaction(() => {
  assertCurrentIdentity(store, candidate);
  assertUsageThrough(store, candidate.runId, candidate.usageHighWater);
  recordCheckpointReference(store, candidate, reference);
  enqueueProjection(store, candidate, reference);
  if (candidate.stopProof && candidate.unresolvedRequestIds.length === 0) {
    releaseRunReserve(store, candidate.runId, candidate.stopProof);
  }
});
await publishPending(store);
```

这些内部 helper 均在 checkpoints.ts 定义，消费者只依赖公开接口。`verifyCandidateArtifacts` 独立重验文件内容及 manifest；`persistImmutableCheckpoint` 用独占创建、fsync、父目录fsync；transaction 同时保存 evidence、run 结果、workItem 引用、budgetVersion、projection outbox。usage 只通过 Task3 唯一路径结算；候选不携带可覆盖 used 的任意数值。

无停止确认时可提交 partial **证据**，但 active 与预留不释放、recoverable=false；只有 complete+快照完整+停止确认+预算高水位结算+无 pending 请求才 recoverable。task done 还须原 required checks/landing 证据，不能据 ccloop succeeded；组无 goal-review 成功永远 review。

投影 outbox id 固定 checkpointId，latest 只允许版本单调前进；checkpoint 投影失败不覆盖运行完成事实。Task/组 handoff 文本生成属于 D3，本计划只发布 JSON 读模型和事件。

清理在 transaction committed **且从归档重验通过**、停止明确后才允许；只删注册 sourceDir，验证 realpath 位于记录的 runsRoot 下且 basename==runId、不是 root／symlink、无复用身份。失败记 cleanup_pending，重复清理不再次执行。没有授权 token 的直接 `disposeWorkdir` 不进入 controlled 路径。仍被任务/组引用的归档本版不自动删除。

- [ ] **Step 4: GREEN；M25 先写 latest 后事务、M26 仅 candidate 即恢复、M27 无 proof 释放、M28 删除前不读归档、M29 清理失败重新派发、M30 跳 hash 验证、M31 late projection 覆盖新引用。**
- [ ] **Step 5: 提交 `feat(control): commit checkpoints before publishing and cleanup`。**

## Task 7: scheduler 受控执行与冲突修复接线

**Files:** Create `src/control/{schedulerBridge,service}.ts`; Modify `src/scheduler/run.ts`, `src/scheduler/reconcile.ts`; Create `tests/control/schedulerBridge.test.ts`。

**Interfaces:** `ControlService` 是上述 commands/claim/start/usage/archive/commit/query 的组合，不重复业务判断。`makeControlledExecution(service,groupId):RoundExecution`；新 `RoundExecution` 定义在 `scheduler/run.ts`，由单轮共用 orchestration 接收：

```ts
export interface RoundExecution {
  execute(input:{plan:PlanFile;task:PlanTask;base:string;kind:"task"|"reconcile"}):Promise<TaskRun>;
  dispose(run:TaskRun, options:DisposeOptions):Promise<Disposal>;
  reconcileBudget(taskId:string):Promise<{maxAttempts:number;perAttemptTimeoutMs:number;totalRuntimeBudgetMs:number;tokenBudget:number}>;
}
```

TaskRun/DisposeOptions/Disposal/PlanFile/PlanTask 为现有导出。旧 CLI 的 legacy 实现保持原值；controlled execute 从已登记的 WorkInput 取 configHash 和 grant，调用 claim/start 的统一入口；不能让 caller 传任意 adapter 绕过。

`execute` 用同一个已领取 run 的 collect 流记录 usage、原始日志和候选；terminal 存在且身份／路径核验后才映射为 TaskRun。此时尚未 task done；harvest/landing 通过后再提交业务结果与清理。`reconcileBudget` 不是另做一次临时预算估算：它原子登记并领取 reconcile workItem，缓存其 Claim；execute 必须消费同一 Claim，不能第二次预留或换 runId。合成契约后把最终 contractHash 固定进 start envelope，第一次 accept 前写盘；失败保留可核对的 claim 状态。

- [ ] **Step 1: 用 fake peer 跑真实两任务冲突图。** T1/T2 的原预算高于当前剩余额度，reconcileBudget 只能给当前批准额度；预算不足时 launch counter 不增加，冲突 ref 和原始日志仍在且任务 blocked。停组后同样不启动 reconciliation。

```ts
const result = await synthesizeReconcileContract(a,b,contracts,runsDir,conflict,{
  maxAttempts:1,perAttemptTimeoutMs:500,totalRuntimeBudgetMs:500,tokenBudget:7
});
if ("escalate" in result) throw new Error(result.escalate);
const built = JSON.parse(await readFile(result.path,"utf8"));
expect(built.executionPolicy.tokenBudget).toBe(7);
expect(built.executionPolicy.totalRuntimeBudgetMs).toBe(500);
```

新增第六参数 `approvedBudget?:` 同上述返回类型，仅旧 legacy 可省略；受控调用处类型要求非可选。原 both-intents、union checks、非main landing 判据全部保留。拒绝0额度而不是为 schema 正整数要求伪造1。

- [ ] **Step 2: RED bridge；原 scheduler 判据先作为对照跑全文件。**
- [ ] **Step 3: 将 run.ts 两处执行及所有处置调用接到 RoundExecution，抽 `runPreparedRound` 供旧 runRound 和 controlled 服务共用。** 受控路径要求持久 groupId，并先检查真实 peer 能力；未支持新协议在任何 Git 改动、预算领取和 spawn 之前拒绝。旧 runRound 保留 CLI schema 和输出，不给它隐式创建 soft 组。

共享函数签名固定为 `runPreparedRound(round:Round,options:RunOptions,execution:RoundExecution):Promise<number>`，原 runRound 负责 loadRound 后构造 legacy execution；controlled 服务读取已批准 group/graph 构造 round，调用同一函数。preflight/repoLock/landing 仍由共用函数持有，不允许调用者绕过。

controlled reconciliation 先保存冲突证据、登记 kind=reconcile，领取额度后再 synthesize，contract 额度来自 claim.grant.work；其交接桶只在新控制 envelope 中传递。synthesized contract 的副作用失败，release 仅在可证明未 accept 的情况下处理，否则保留预留。不得直接用 `Math.max(sideA.tokenBudget,sideB.tokenBudget)` 为受控修复再造预算。

controlled landing 单独记录 intent（base/tip/run/artifact）；恢复查目标 ref 和已存在的 merge commit 再决定补记结果，不盲重 merge。repoLock 仍约束目标仓库；服务所有权不能替代它。Task 6 归档、结算、业务验收全部满足后 dispose，日志读接口只返回稳定 archive 引用。

- [ ] **Step 4: GREEN + 原 scheduler 全套；M32 controlled reconcile 直调 runTask、M33 预算改回双方max、M34 controlled dispose 直删、M35 省 capability preflight、M36 landing 恢复不查ref而重做。**
- [ ] **Step 5: 提交 `feat(control): route scheduler work through durable claims`。**

## Task 8: 崩溃恢复、应用读模型与总体验收

**Files:** Create `src/control/recovery.ts`; `tests/control/recovery.test.ts`, `tests/control/endToEnd.test.ts`; `tests/control/fixtures/crash-worker.mjs`; `scripts/verify-control.mjs`; Modify `package.json`, `README.md`。

**Interfaces:** `recoverControl(store,port):Promise<{blockedRunIds:string[];replayedProjectionIds:string[]}>`；`listGroupArtifacts(store,groupId):ArtifactRef[]` 与 `listTaskArtifacts(store,groupId,taskId):ArtifactRef[]` 放 queries.ts。`readArtifact` 独立重新校验 hash。无 import-as-new-run 接口，无从扫描 latest 猜恢复点的路径。

- [ ] **Step 1: 建真实进程 crash matrix。** worker 每到故障点写同步 marker，父测试确认 marker 后 SIGKILL worker，重开数据库并调用 recovery；计数器和原始证据从磁盘核对。不要以 throw 模拟全部“掉电”。

```ts
for (const point of ["after-claim","after-accept","after-archive","after-transaction","before-projection","before-cleanup"]) {
  const sample = await crashCase(point);
  try {
    const first = await sample.recover();
    const second = await sample.recover();
    expect(second.used).toEqual(first.used);
    expect(second.launches).toBe(first.launches);
    expect(second.landingCount).toBe(first.landingCount);
    expect(second.referencedHashes).toEqual(first.referencedHashes);
  } finally { await sample.dispose(); }
}
```

`crashCase(point)` 在 fixtures/crash-worker 的 TS 驱动 helper 中定义，返回 recover/dispose；recover 返回实际 DB used、fake peer durable launch count、真实 Git merge 数和 archive hashes，不能由预期常量生成。after-claim 若未派发，恢复可以同 run 首次派发一次；断言 first/second 比的是恢复后的稳定值。

另外明确测试：复制 stateDir 到新 host identity 仅可只读核对，`control-host-mismatch` 拒绝启动；缺授权的备份不能执行；预算增加保留既有 used；无 goal review 时所有子任务 done 仍 group review；archive 源删后 task/group refs 都可读；未实现 production protocol 拒绝，fake 不能进生产 factory。

- [ ] **Step 2: RED recovery/endToEnd；确认每个 kill 点确实发生，不将未命中 marker 当成功。**
- [ ] **Step 3: 实现 recovery 的固定顺序。** 验证 service owner/host → 查每个 active run 的原 start envelope/accepted → 核对静止／隔离 → 幂等收 usage → 核对候选/DB引用 → 补未提交事务 → 重放投影 → 重试授权清理。任一未知保留 active 和预算并报告 blocked，不能开替代 run。

本机 host identity 使用 OS 稳定 machine identity 的 hash，另保存 canonical stateDir 与 service instance identity；复制到同机另一目录也拒绝启动，防同机副本复制授权。身份无法可靠读取则拒绝写模式，不能退化成 hostname。它不等于跨机 fencing。跨主机写入始终拒绝，直到后续显式 transfer 协议实现。复制备份本身不能换 identity。已有源端授权不明时只能读。

`scripts/verify-control.mjs` 与 verify-scheduler 同形，`spawnSync` 使用当前项目已安装 vitest（不网络安装），原始 stdout/stderr inherit，非零直接退出。`package.json` 新 `verify:control` 接入完整 verify；README 英文说明本切片仅底座、真实 ccloop protocol 尚不支持、无 Web 停止承诺，列稳定证据读取方式。

- [ ] **Step 4: GREEN；M37 backup 自动获新执行权、M38 recovery 重放重算 usage、M39 goal done 从子任务数推断、M40 原始文件缺失时回退另一 checkpoint。**
- [ ] **Step 5: 完整验收后提交 `test(control): verify restart accounting and evidence retention`。**

## 统一验证流程与变异登记

每 Task 使用独立证据目录 `.superpowers/sdd/2026-09-19-task-control-foundation/task-N/`，写 who/when/base/命令/RC/完整日志位置；本计划不预造结果。执行命令形式：

```sh
rtk proxy sh -c 'npx vitest run tests/control/budget.test.ts > /tmp/orca-control-budget.log 2>&1; result=$?; printf "%s\n" "$result" > /tmp/orca-control-budget.rc; exit "$result"'
rtk proxy cat /tmp/orca-control-budget.log /tmp/orca-control-budget.rc
rtk proxy npm run typecheck
```

完整最终验收：`rtk proxy npm run verify` 后台保存 log/rc，连续分块覆盖全部字节读回；当时 HEAD、node、测试 RUN 路径和状态都留证。不存在 skipped/todo。确认真实 ~/.orca 前后不存在，fake 登记进程全静止；保留实验树和证据，不广泛杀进程／清临时目录。

M01–M40 是最小变异清单，不是只允许40个分支；实施新增分支即补条目。每条在 `git clone --local` 副本中先证明 pristine 字节等于被测实现，单独删除目标行为，跑上表归属文件；必须因行为断言失败，不能拿语法/typecheck/import失败冒充红。还原后 diff 与 cached diff 原始文件各0字节，原判据与主树比字节相同。代码修订后相关变异重跑。

## 规格覆盖与自查

| 规格 | 本切片验收 | 后续真实闭环 |
|---|---|---|
| §4 身份、版本、单写、stateDir | Tasks1/2/4，持久命令与claim | Web 页面 Task切片3 |
| §5 图与变更影响 | Task2，复用图、阻止变更中的派发 | 自动拆分与纠正切片4 |
| §6、§13.1 预算语义 | Task3，所有维度、能力拒绝、保留未知 | ccloop 每请求上界／重试／交接执行 |
| §13.2 全组归账 | Tasks3/7，各 kind、冲突无免费额度、review reserve | 自动拆分/记忆/goal提示词切片4 |
| §13.3 启动身份与所有权 | Task4，durable accept 对端断连测试 | ccloop 实现公共协议与停止隔离证据 |
| §7、§13.4 一致提交 | Tasks5/6/8，断点／坏hash／预算不退 | D3 handoff、跨run物化与显式transfer |
| §13.5 证据保留 | Tasks5/6/8，源清理后独立读全证据 | Web task/group详情消费读模型 |
| §9 Web > CLI | 共用service/queries，无CLI专属执行器 | 下一Web切片实现操作页 |

- [x] 检查已完成的 Codex 五任务不是本计划任务；不需要整合该分支才能写/验 Orca 底座。
- [x] 每任务有文件、接口、RED/GREEN、实现算法或代码与点名变异；测试命令明确标为实施后命令。
- [x] 公共标识统一 groupId/workItemId/taskId/runId，budget work/handoff 分桶；ccloop executionId 另映射。
- [x] 逐项对照 R1–R5，消费端与真实 agent 生产者验收不混称，延后责任明确。
- [x] Review Focus 五项分别落入 Task2/3/4/5/6/8，包含正控与真实持久化断点。
- [x] 本计划只写文档，不把现有回归通过写成新底座已实现；实施完成前所有任务仍未勾选。

## 执行交接

建议 Native：这八项共享 ledger／ownership／checkpoint 接口，先由同一实施者保持一致，最终再做独立整支审查。用户此前 Native 选择明确覆盖已完成 Codex 切片；不据此擅自派新 subagent。本计划审阅通过并确认执行方式后再进入产品实施。整合/推送/清理仍由人操作。
