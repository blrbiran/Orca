# Task 6 report: 其余消费者同步 ＋ 全门验收

**Who／when**: Orca 控制器会话的 Task 6 执行 agent，2026-09-24。
**在哪一笔上**：Orca `2e6f47a` (`test(control): sync the last v1 capability-vocabulary consumers to v2`)，父提交 `2040f77`。ccloop 侧未改动，仍在 `f9727a1`。

## Step 1: python 清点（不用 grep）

命令（见「Read first」段落原样复用）：

```python
import os, re
pat = re.compile(r'durableAccept|ownershipIsolation|evidenceRetention|requestBoundEvidence')
for root, _, files in os.walk("."):
    if "node_modules" in root or "/.git" in root: continue
    for f in files:
        if not f.endswith((".ts", ".tsx", ".mjs")): continue
        p = os.path.join(root, f)
        hits = [i for i, l in enumerate(open(p, encoding="utf-8"), 1) if pat.search(l)]
        if hits: print(p, hits)
```

跑在 HEAD `2040f77` 的原始输出：

```
./tests/panel/controlConfigPort.test.ts [62]
./tests/panel/controlReadApi.test.ts [95]
./tests/panel/controlConfig.test.ts [49]
./tests/panel/fixtures/controlPanel.ts [114]
./tests/control/planImport.test.ts [74]
./tests/control/budget.test.ts [34, 45, 46, 47]
./tests/control/capabilitySchema.test.ts [18]
./tests/control/profiles.test.ts [64, 65, 66, 69, 125]
./tests/control/endToEnd.test.ts [73]
./tests/control/webFaults.test.ts [271]
./tests/control/schedulerBridge.test.ts [57]
./tests/control/fixtures/fake-control-peer.mjs [8]
./tests/control/fixtures/web.ts [29]
RC=0
```

13 个文件。逐文件核对后分三类：

1. **要改**（10 个）：`tests/panel/{controlConfigPort,controlReadApi,controlConfig}.test.ts`、
   `tests/panel/fixtures/controlPanel.ts`、`tests/control/{planImport,profiles,endToEnd,webFaults}.test.ts`、
   `tests/control/fixtures/{fake-control-peer.mjs,web.ts}`。
2. **已授权保持不动**（2 个）：`tests/control/budget.test.ts`（41-52 行 `it("refuses a peer answering the
   retired v1 vocabulary"...)` 故意构造 v1 `legacy` 对象，证明被拒绝）、`tests/control/capabilitySchema.test.ts`
   （18 行 `durableAccept:true` 故意混入证明被 `.strict()` 拒绝）。这两处读下来确认就是任务说明里点名的
   「intentional v1-refusal criteria」。
3. **误报**（1 个）：`tests/control/schedulerBridge.test.ts:57` 命中的是一句英文注释（"`durableAccept` is a
   retired field..."），不是代码；该文件本身已经是 v2（用 `caps`/`roundPeer`）。

Task 6 结束后重跑同一脚本，命中收敛为：

```
./tests/control/budget.test.ts [34, 45, 46, 47]        # 授权不动
./tests/control/capabilitySchema.test.ts [18]           # 授权不动
./tests/control/profiles.test.ts [62, 63]               # 我新写的英文注释，提到退役字段名
./tests/control/endToEnd.test.ts [71]                    # 同上
./tests/control/schedulerBridge.test.ts [57]             # 已存在的注释，未改动
./tests/control/fixtures/fake-control-peer.mjs [9]       # 我新写的英文注释
RC=0
```

逐行核对：新增的命中全部是注释文本（`Human authorization ...: durableAccept/ownershipIsolation/...`），
没有一处是真正的 v1 字段使用。

## Step 2: 逐文件改动（v1 → v2 映射）

**通用映射**：`protocol:1` → `protocol:2`；删 `durableAccept`／`ownershipIsolation`／`evidenceRetention`；
`requestBoundEvidence`（`string|null`）→ `requestBoundProof`（descriptor|null）。凡是「健康态」mock，
一律从该测试自己已声明的 profile capabilities 对象 spread 出来（`{ protocol: 2 as const, ...snapshot.profile.capabilities }`
或等价写法），而不是手写字面量——这样 mock 天然满足 `capabilitiesSchema`，也天然和 strict 模式（`budgetEnforcement==="bounded" && requestBoundProof!==null`）一致，因为它抄的就是同一份声明。

| 文件 | 改动 | 理由 |
|---|---|---|
| `tests/control/fixtures/fake-control-peer.mjs` | `capabilities` 分支的 JSON 字面量改写为 v2 八字段，`requestBoundProof` 给一个完整 descriptor（`evidenceKind:"offline-peer-v1"`，与 `store.ts` 的 `caps` 同款） | 这是 51 个失败（archive/checkpointRecoverability/checkpoints/cleanup/continuation/dispatch/endToEnd/finalReview/handoff/handoffTransaction/projectionJournal/resumeBundle/snapshot）的根因：`fakePeer()`→这个子进程脚本→`startClaim`→`assertCapabilities`→`capabilitiesSchema.safeParse` 对 v1 形状必挂。这些组的 `seedBudgetCase` 默认 `budgetMode:"strict"`，所以答案必须带非空 `requestBoundProof`，否则会把「答案是 v2 但不够 strict」误判成「还是 v1」 |
| `tests/control/fixtures/web.ts` | `webFixture` 里的 `port.capabilities` 改成 `async () => ({ protocol: 2 as const, ...snapshot.profile.capabilities })` | `startClaim` 真正落地时会用它；spread 自身声明的 capabilities 保证和 `confirmPayload()` 的 `budgetMode:"strict"` 兼容 |
| `tests/panel/fixtures/controlPanel.ts` | `boot()` 里的 `port.capabilities` 同上，spread 自 `createHarness()` 闭包里的 `snapshot` | 同一构造模式，被 `controlApi.test.ts`／`controlRecoveryApi.test.ts`／`controlShutdown.test.ts`／`chainsApi.test.ts` 等间接消费 |
| `tests/control/planImport.test.ts` | `setup()` 里的 `port.capabilities` 改为 `async () => ({ protocol: 2 as const, ...profile().profile.capabilities })` | 同构 |
| `tests/panel/controlReadApi.test.ts` | 同上，直接引用已有的 `snapshot` 变量 | 同构 |
| `tests/panel/controlConfigPort.test.ts` | `capablePort.capabilities` 改为 spread `snapshot().profile.capabilities` | 该文件 `capabilities()` 未被断言直接消费，但改成 v2 避免和已升级的生产 schema 打架 |
| `tests/panel/controlConfig.test.ts` | `port.capabilities` 改为 spread 本地 `snapshot.profile.capabilities` | 同上 |
| `tests/control/profiles.test.ts` | ① `port()` helper 的 `capabilities` 换成明确的 v2 字面量（未被断言消费，纯接口占位）；② `ReceiverPort` 类的 `capabilities` 字段同样换成 spread `snapshot().profile.capabilities` | 两处都只是满足 `ExecutionPort` 接口形状，测试断言只碰 `probeProfileCapabilities`／`accept` |
| `tests/control/endToEnd.test.ts` | `"rejects malformed peer capability booleans"` 里 `{...caps,durableAccept:"false"}` 改成 `{...caps,handoffControl:false}` | **映射说明**：这条测试的意图是「一个类型错误的能力字段被 `capabilitiesSchema.safeParse` 拒绝」。人裁给出的例子原句就是 `durableAccept:false → handoffControl`，所以直接采用；把布尔值塞进本该是枚举字符串的字段，同样是类型错配，被同一条 `safeParse` 挡下，判据（`rejects().toThrow()` + `runs count 0`）逐字不变 |
| `tests/control/webFaults.test.ts` | `"recovers an open run before anything listens..."` 里内联的 `port.capabilities` 改为 spread `profileSnapshot().profile.capabilities` | 该测试用 `claimed()`（默认 snapshot）先 `confirm` 成 `strict`、再真的 dispatch 一次 start，所以这里的 mock 必须 strict-safe；`profileSnapshot` 已在文件顶部 import，直接复用 |

**未改动，按人裁保持原样**：
- `tests/control/budget.test.ts`（41-52 行, 已有 Task 3/5 的 `Human authorization` 注释在先）
- `tests/control/capabilitySchema.test.ts`（本身就是 v2 + 故意反证）
- `tests/control/schedulerBridge.test.ts`（误报注释，代码早已是 v2）
- `src/**`：全程零改动（typecheck/verify:control 等门确认，未触发 NEEDS_CONTEXT）

## Step 3+4: 四道门（以及全部剩余门）实测

**环境**：`ORCA_CCLOOP_BIN`/`ORCA_CCLOOP_ADAPTER_CONFIG` 按任务给定路径 export；`ORCA_CORRECTIONS_DIR`
由既有测试基础设施逐测试自行改道（`tests/corrections/harness.ts` 等），未额外设置全局值。

⚠️ **一次环境事故（已诊断、已解决、与本次改动无关）**：第一次 `npm run verify:control` 在
`tests/control/schedulerBridge.test.ts` 的两条 `"runs a real conflicting graph..."` 子测试上以
`Test timed out in 30000ms` 失败（不在两条已知红名单里）。诊断：`ps aux` 发现 9 个 `node (vitest N)`
孤儿进程（`PPID=1`），是我自己先前 `npm test` 跑完后 vitest 的 worker pool 没被回收，仍在吃 CPU
（单进程 8-44%），叠加 `uptime` 显示的系统级负载（`load averages 17-24`，`42 users`，与 CLAUDE.md
Rule 13 「本仓库是多 agent 共享的」一致）。**清理证据**：把这 9 个孤儿进程逐一 kill 后，单独跑
`schedulerBridge.test.ts`（`--minWorkers=1 --maxWorkers=1`）在 9820ms／5796ms 内通过（预算 30000ms）；
再整体重跑 `verify:control` 两次，均只剩两条已知红。判定：这是环境资源争用，不是本次改动引入的回归——
`schedulerBridge.test.ts` 及其夹具（`roundPeer.ts`／`store.ts` 的 `caps`）本轮完全没有改动。

| 门 | 命令 | RC（从文件取） | 计数 |
|---|---|---|---|
| typecheck | `npm run typecheck` | 0 | 0 个类型错误 |
| npm test | `npm test` | 1（预期） | Test Files 1 failed \| 182 passed (183)；Tests 2 failed \| 1620 passed (1622)；0 skipped |
| ledger validate | `npm run ledger -- validate .decisions` | 2（package.json 声明可接受） | 7 条 `.decisions/orca-dev-09cc3ea1.jsonl` 降级为 tier 0（既有夹具数据，非本轮改动触发） |
| check-claude-md-lines | `node scripts/check-claude-md-lines.mjs` | 0 | `ok: CLAUDE.md is 150/200 lines` |
| check-hooks-path | `node scripts/check-hooks-path.mjs` | 0 | `ok: core.hooksPath is scripts/githooks` |
| verify:control（第 3 次，干净基线） | `npm run verify:control` | 1（预期） | Test Files 1 failed \| 43 passed (44)；Tests 2 failed \| 434 passed (436) |
| verify:web-control | `npm run verify:web-control` | 1（预期） | Test Files 1 failed \| 16 passed (17)；Tests 2 failed \| 189 passed (191) |
| verify:scheduler | `npm run verify:scheduler` | 0 | Test Files 51 passed (51)；Tests 167 passed (167) |
| verify:chain | `npm run verify:chain` | 1（预期，第二段是全量套件+chain env 的泄漏检测） | 第一段 `tests/chain`：13 passed(13)／213 passed(213)，RC 0；第二段全量：182 passed(183)／1620 passed(1622)，同两条已知红 |
| build --workspace web | `npm run build --workspace web` | 0 | vite build 46 modules，`dist/index.js` 260.36kB |
| verify:panel | `npm run verify:panel` | 0 | PASS 0 至 PASS 14，共 15 项全过，含「~/.orca 前后不变」两条 |
| --ws check（web workspace） | `npm run --ws check` | 0 | Test Files 14 passed (14)；Tests 70 passed (70) |
| npm run verify（收尾整条） | `npm run verify` | 1（预期，`&&` 链在 `npm test` 处止步） | 与单独 `npm test` 同：182 passed(183)／1620 passed(1622)，同两条已知红 |

**除两条已知红外，全部为零红。** `verify:control` 里 0 skipped（431+2=436 test 的 sum 已核对）。

**日志路径**（均在会话 scratchpad，全程重定向 + `RC=` 追加，整份读回，未用管道过滤）：
- `g-typecheck.log`、`g-test.log`、`g-ledger.log`、`g-claudemd.log`、`g-hookspath.log`
- `g-verifycontrol.log`（第 1 次，含孤儿进程导致的假红）、`g-verifycontrol2.log`（第 2 次，复现同样两条 timeout，确认非偶发）、`g-verifycontrol3.log`（清理孤儿进程后的干净基线，采纳为记录值）
- `g-sb-isolated.log`（`schedulerBridge.test.ts` 单独隔离跑，证明清理后个体测试远在预算内）
- `g-verifywebcontrol.log`、`g-verifyscheduler.log`、`g-verifychain.log`
- `g-buildweb.log`、`g-verifypanel.log`、`g-wscheck.log`、`g-verifyfull.log`

全部位于 `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/9c9f7f5f-625c-4222-8a9e-75ba7479f148/scratchpad/`。

## 两条不许变绿的红——现测确认仍红

`tests/control/webCcloopSmoke.test.ts` 的两条：
- `carries the ledger's claim identity byte-for-byte and is durably accepted once`
- `latches the stop under the ledger's request identity and returns evidence the store re-hashes`

两条报错都是 `ControlError: start-envelope-conflict:run:targetVersion`，出处 `src/control/startEnvelope.ts:65`
（`startEnvelopeSourceSchema.safeParse` 对 `run.targetVersion` 类型分叉），与缝 B（人裁排除在 G1 外）完全对应，
每一道跑过它的门里都只有这两条红，没有第三条。

## `~/.orca` 前后对照

```
# 之前（Step 开始前）
/Users/biran/.orca:                 drwx------@ 3 ... Sep 22 10:01 .
/Users/biran/.orca/control:         drwx------@ 2 ... Sep 22 23:02 .

# 之后（全部门跑完）
diff 前后快照：仅 `~/.orca` 的【父目录】`~` 的 mtime 变化（Sep 24 09:05 → 09:35，属于 home 目录下其他无关活动），
`~/.orca` 与 `~/.orca/control` 自身连同内部条目逐字节相同，未新增任何文件。
```

`verify:panel` 自己的 PASS 12／PASS 13 也各自现测了一次「~/.orca 不变」。

## ccloop 侧（Step 5）

- HEAD 现测：`f9727a18cd4bc77ed9999068fefe2f81ab059295`，与 Task 1 记录一致，未变。
- 命令：
  ```
  ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run --reporter=json --outputFile=<SP>/t6-ccloop.json
  → RC=1（vitest 自身：因为已知红的存在而非 0，符合预期）
  node scripts/check-known-reds.mjs <SP>/t6-ccloop.json
  → known reds in roster: 13
    failed: 1
      known  quiet execution proof > does not treat leader exit as group quiet and proves only after the full tree is gone
    unexpected: 0
    RC=0   ← 判据
  ```
- `git status --short` 之后：无输出（干净）。

## 改动文件清单（本次 commit `2e6f47a`）

```
tests/control/endToEnd.test.ts
tests/control/fixtures/fake-control-peer.mjs
tests/control/fixtures/web.ts
tests/control/planImport.test.ts
tests/control/profiles.test.ts
tests/control/webFaults.test.ts
tests/panel/controlConfig.test.ts
tests/panel/controlConfigPort.test.ts
tests/panel/controlReadApi.test.ts
tests/panel/fixtures/controlPanel.ts
```
10 files changed, 52 insertions(+), 15 deletions(-). `src/**` 零改动。

## 顾虑 / 需要人看一眼的点

1. **环境孤儿进程**：本轮亲历一次 vitest worker pool 在父进程退出后未被完整回收（9 个进程，`PPID=1`，
   持续吃 CPU 10+ 分钟），在共享机器上会拖慢后续任何 agent 的门禁。诊断见上；已手动 kill 干净并复核。
   这是 vitest/环境层面的行为，不在本任务的「v1→v2 词汇」范围内，未做代码改动去「修」它，仅记录，
   供后续任务或人判断是否需要专门处理（例如给 verify 脚本加超时/孤儿回收）。
2. **ledger validate 的 RC=2**：来自既有夹具 `.decisions/orca-dev-09cc3ea1.jsonl` 里 7 条被降级为 tier 0
   的记录，任务书本身把 RC 0/2 都列为可接受，未深挖是否是本仓库一直如此；本轮未改动 `.decisions/**`
   或任何 ledger 相关代码。
3. **T3/T4 变异电池**：Task 6 的任务书本身没有列新的变异表（那是 Task 2-5 的判据），本轮按字面执行
   「同步词汇 + 跑门」，未额外补做变异测试；`budget.test.ts`/`capabilitySchema.test.ts` 里既有的
   v1-refusal 判据保持不动、继续覆盖 T3/T5 那两类回归。
