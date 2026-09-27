# ⑤ 预算预估链（single-call estimate）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让配置了 estimator 的 Web 组在导入后真的跑一次模型预估：Orca 驱动环经 ccloop 的通用 `single-call` 活执行它、记账、结算成 `ready`／`failed`，start 不再被 `estimate-in-flight` 永久挡住；冻结与重启不再因估算 run 卡死；面板能按字段／行／整体应用建议。

**Architecture:** ccloop 的 start envelope 升到 `protocol: 3`，`work` 分 `loop`／`single-call`；worker 对 `single-call` 不进 `runLoop`，只做一次无工具、有输出上限的结构化调用，照常写停机证明所需文件、usage 与 evidence。Orca 驱动环按 phase 分流出估算链（A1 → A2e → B/B′ → Ce），Ce 在停机证明后调 `completeEstimate`；`handoffRunIds`／`stepH`／恢复都认估算 run；web 只加「应用建议」。

**Tech Stack:** TypeScript、zod、vitest（Orca 与 ccloop）、React（Orca `web/`）、Node 22 ESM 脚本（ccloop runner 与 fake）。

**Spec:** Orca `docs/superpowers/specs/2026-09-27-single-call-estimate-design.md`（先读全文；§2 人裁）。进度源 `.superpowers/sdd/2026-09-27-single-call-estimate/progress.md`（Orca）。

## 执行顺序与分工

1. Task 0（控制器）：已做第 1 项（台账 §2.1）；第 2 项由 O4 Step 1 实测，第 3 项已静态答（见 Part B 开头），第 4 项由 O3 Step 1 实测。
2. **Part A：ccloop T1 → T5**，全部落地后才开始 Part B（Part B 的 F16：Orca 落 O1 后只发 protocol 3）。
3. **Part B：Orca O1 → O7**。E2E 判据的 `ORCA_CCLOOP_BIN` ＝ ccloop T5 之后的 `git clone --local` build。
4. **Final（控制器）**：变异总表（各 Task 末尾的 Mutation 行）在单独 clone 里跑；两仓干净门（spec §8.5）；台账；三份 handoff。

## Global Constraints（两仓共同；各 Part 另有自己的一节，冲突以本节为准）

- 两仓都直接在 `main` 上落本地提交；**绝不 push**；不开／删分支、不建／删 worktree。
- 提交信息结尾两行：`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`、`Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN`。
- `SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/f341f05f-84e7-49c6-b186-2e7b5855627a/scratchpad`。验证跑一律 `> "$SCRATCH/<name>.txt" 2>&1; echo rc=$?` 再整份读回；不许管道过滤。
- 主树不 build、不跑全量；只跑本 Task 点名的判据文件（及 `npm run typecheck`）。
- **既有判据只改本计划点名的**（人裁 S6，spec §2）：整条改写、不放宽、旁注释写明 S6 与现在编码什么，台账追加一行 `REWRITTEN`。点名之外的既有判据红了 ⇒ 停下报控制器。
- 常量：call record `ccloop-single-call-record-v1`；错误码 `single-call-unsupported`（exit 2）、`single-call-output-invalid`；`terminalOutcome` ∈ `single-call-complete|single-call-aborted|single-call-failed`；估算 `reasonCode` ∈ `estimate-call-failed|estimate-output-invalid|estimate-output-plan-mismatch`；块因 `single-call-prompt-mismatch`、`estimate-usage-unknown`（`blockedAt` 用 `"A2"`／`"C"`，Orca F4）。
- 控制器裁定 F10（2026-09-28）：Orca 只比对 `promptSha256`；`responseSchemaSha256` 是 ccloop 交给 `--json-schema` 的那个字符串的 sha256，只作证据。
- 控制器裁定（ccloop 起草发现 3）：single-call 也写一条机械的零 `handoff` usage event（Orca `hasObservedUsage`／`completeEstimate` 要两个 bucket）。
- 仓库外零写入（Rule 17）；变异只在单独 clone；被当作 `ORCA_CCLOOP_BIN` 的 clone 不做变异。

## Review Focus（两仓合并，最可能咬人的五条）

1. **loop 行为一字不变**：protocol 3 只给 envelope 加 `kind:"loop"`，所有 S6 改写只改字面量不改断言（ccloop T1、Orca O1）。
2. **`null` 不当 0**：single-call 中止或失败且无用量 ⇒ `cumulative: null` ⇒ Orca 块成 `estimate-usage-unknown`，不空转（ccloop T5 W4、Orca O3）。
3. **估算 run 不碰人的仓库**：无工作区、清理跳过、目标仓库 `git worktree list` 前后相同（Orca O3／O4、ccloop T5 W5）。
4. **只要库里有过估算 run，重启就全局 `dispatchBlocked`**（Orca F7）——修后「在飞」与「已完成」两种都不再阻塞（Orca O4 Step 1）。
5. **冻结与 Ce 竞态**：Ce 收集期间来了 handoff-stop ⇒ 让给 H，估算记 `interrupted`，组能到 `handoff-complete`（Orca F6，O4 H3）。

---

# Part A — ccloop


> 起草者：Orca 控制器会话 `f341f05f` 派出的只读起草子 agent（Claude Opus 5.5），2026-09-27／28。只读探查，未改任何仓库文件。
> 读过：`scratchpad/plan/contract.md`、Orca spec `docs/superpowers/specs/2026-09-27-single-call-estimate-design.md`（全文）、上一份计划 `docs/superpowers/plans/2026-09-27-claude-stream-usage.md`、ccloop `CLAUDE.md`，以及下文每处引用的 ccloop 源码与判据。
> 行号一律「measured 2026-09-27, re-measure before use」。观测锚点：ccloop 主题行 `docs(handoff): the stream-usage round is reviewed; nothing here is waiting on the human but the push`。

## Drafter findings

下列问题是**真实代码与 spec／contract 对不上**之处。每条给证据和本草稿的选择；控制器可推翻，推翻哪条就改哪个 Task。

1. **S6 与 ccloop Rule 15(a) 冲突（要人看一眼）。** ccloop `CLAUDE.md` Rule 15：改既有判据须「由人**指名到具体测试**」，且 Rule 18 不许控制器代人宣布。S6 原话是整体授权（「这个session 中如果有需要的话，我授权你改」），spec §2 把「指名」挪到了台账里。两份规则都能摆出来，按 Orca Rule 7 属「证据势均力敌 ⇒ 升人」。**本草稿的选择**：T1 列出全部要改的判据（按文件＋测试名）……
   **控制器裁定（2026-09-28，依 S8）**：不停下等人；Step 0 改为把名单记进台账后按 S6 改，最后统一报人审。T2 不用 S6（见第 2 条）。
2. **`command.test.ts` 里没有用 `toEqual` 钉解析应答的判据。** 证据：`tests/control/command.test.ts` 全文（1–193 行）只有表视图的 `toEqual`（131–156 行，`{agent:null}`），没有解析应答（`{agent:{…}}`）。最接近的是 `tests/control/agentsControl.test.ts:91` 的 `answers capabilities for a selection with descriptor defaults filled, given fields echoed, and the materialized config's hash`，但它用的是 `toMatchObject`（105–111、117–122 行），多一个兄弟字段不会变红。⇒ **不需要改任何既有判据**；按 ccloop Rule 15「能只加不改就只加」，T2 **新增**一条 `toEqual` 判据。spec §8.2 那句「改写既有的 `command.test.ts` 那条 ⇒ S6」前提不成立，S6 在 T2 用不上。
3. **只写 `work` 一条 usage event，Orca 结算不了。** Orca `src/control/budget.ts:136-142` 的 `hasObservedUsage` 要求 `work` 和 `handoff` 两个 bucket **都**有非 null 的 cumulative；`src/control/webService.ts:390-391` 的 `completeEstimate` 要求 `run.unknown.handoff` 为假、`cumulative.handoff` 为零。spec §5.2 第 3 步只写了 `work` 一条。⇒ 本草稿照 loop worker 的写法（ccloop `src/control/worker.ts:218-228`）再补一条机械的零 `handoff` event（`threadTotalTokens: 0`，evidence 带 `mechanical: true`）。估算的 grant `handoff` 本就是零，这条 event 放得下。
4. **ccloop 里没有 JSON Schema 校验器。** `package.json` 的 dependencies 只有 `zod`。「输出不合 `responseSchema`」ccloop 自己判不了，靠的是 claude CLI 的 `--json-schema`。⇒ 本草稿里 ccloop 只在两种情况下判 `single-call-output-invalid`：结果事件里没有 `structured_output`，或它不是 JSON 对象。完整校验在 Orca（`classifyEstimateOutput`，zod）。不引新依赖（Rule 2）。
5. **candidate 的 `artifacts` 里要不要放 handoff。** loop 的 candidate 把 handoff 也放进 `artifacts`（`src/control/handoff.ts:356`）；spec §5.2 第 6 步写的是 `artifacts ＝ [输出]（有时）`。Orca 的 collect 会把 `handoff` 单独取回（Orca `src/control/ccloopPort.ts:116`），两种写法它都接得住。⇒ **照 spec**：有输出时 `artifacts = [输出]`，否则 `[]`；`handoff` 单列。
6. **handoff 什么时候中止调用。** 今天的 `armRequest`（`src/control/worker.ts:126-141`）只在请求的 **deadline** 到了才 abort，loop 靠 `stopRequested` 在阶段边界上停。single-call 没有阶段边界，spec §5.3 写的是「发现请求 ⇒ abort」。⇒ 对 single-call，`armRequest` **立刻** abort（T5）。W3 判据量这一点：deadline 定在 60 s 之后，worker 要在 15 s 内结束。
7. **非 output-invalid 的失败，`errorCode` 填什么、用量记什么。** contract 只起了 `single-call-output-invalid` 这一个名字。⇒ 本草稿对其他失败取错误自带的 `code`（字符串时），没有就取 message 冒号前那一段（`claude-timeout`、`claude-exit-error`、`claude-spawn-error`，都是 adapter 里已有的名字，`src/runtime/claude/claudeAgentAdapter.ts:175`），**不新造名字**。这类失败的用量是 `null` ⇒ `cumulative: null`，与今天 loop 阶段失败又没用量时一样。**后果要提醒 Orca 起草者**：spec §6.3 第 4 步只考虑了「中止且无观测」，但「调用失败且无用量」同样会让 `completeEstimate` 抛 `run-stop-unconfirmed` ⇒ `estimate-usage-unknown`。
8. **单次调用的 cwd 叫什么。** spec 只说「`sourceDir/run/` 下建空私有目录」，没起名。⇒ `run/cwd`（`0700`）。
9. **类型怎么定，才能让 TS 收窄整个 envelope。** contract 写的是 `StartEnvelopeV3`，`work` 是联合。但 TS 不会按 `envelope.work.kind` 去收窄 `envelope` 本身，而 `buildHandoffPacket`、`materializeResultRepository` 要的是 loop 形状的 envelope。⇒ 草稿把 `StartEnvelopeV3` 定成 `LoopStartEnvelope | SingleCallStartEnvelope` 两种 envelope 的联合（`work` 仍按 `kind` 区分，线上形状与 contract 一样），另加类型守卫 `isLoopEnvelope`。`LoopWork`、`SingleCallWork` 与 contract 同名；`LoopStartEnvelope`、`SingleCallStartEnvelope`、`isLoopEnvelope` 是新增的 ccloop 内部名字。zod 用两种 envelope 的 `z.union`，这样「single-call 的 `inputCheckpoint` 必须是 `null`」就是 schema 本身，不用另写 refine。
10. **claude 的调用证据放哪。** 沿用 adapter 现成的目录布局：`run/claude/1/single-call/call-XXXXXX/`（attempt 固定为 1）。zero-write 判据的预期文件清单里有它。
11. **spec §5.4 的 codex single-call 与 contract 冲突。** contract 按 Task 0 的结果定了 codex 答 `null`、不加方法 ⇒ **按 contract**：不写 codex 的 `singleCall`，也不给 fake codex 加 single-call 模式。
12. **T1 到 T5 之间 worker 有一行临时守卫。** T1 让 worker 在 kind 不是 `loop` 时抛 `control-work-kind-unsupported`，T5 用分叉替换掉这行。之所以要它：没有这行，T1 过不了 typecheck。
13. **runner 自己设 cwd 那一行，经 adapter 杀不掉。** adapter 本来就在 `cwd` 里起 runner，所以把 runner 那行 `cwd` 改掉，claude 仍继承同一个目录，adapter 层的判据看不出来。⇒ T4 加一条**直接起 runner** 的判据 R1：runner 自己的 cwd 是另一个目录，看 claude 实际落在哪。
14. **超时取哪个值。** `SingleCallRequest.timeoutMs` 取 `claim.grant.work.activeMs`，adapter 里再和安装记录的 `timeoutMs` 取小（spec §5.2 第 2 步）。
15. **`endToEnd.test.ts`、`claudeEndToEnd.test.ts` 跑的是 `dist/cli.js`。** 这两条也在 S6 的改写范围里，但全局约束规定主树不 build ⇒ 只在控制器 clone 里 build 之后的门上跑（Task 6）。T1 的跑判据命令把它们排除在外，并写明了排除。
16. **既有注释里写着「protocol-2」。** 按 ccloop Rule 16，**原注释逐字保留**，在它下面追加一行具名 ERRATUM（写法见 T1 Step 1）。另有 `src/control/protocol.ts:269` 的注释是本轮要改的代码旁边的，同样保留原文、追加一行。

---

## Global Constraints（ccloop 部分）

- 仓 `/Users/biran/code/skills/loop/ccloop`，**直接在 `main` 上落本地提交**；绝不 `git push`，不开分支、不删分支、不建 worktree（ccloop Rule 13）。
- 提交信息结尾两行：`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN`。
- `SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/f341f05f-84e7-49c6-b186-2e7b5855627a/scratchpad`。每条验证跑都写成 `> "$SCRATCH/<name>.txt" 2>&1; echo rc=$?`，**再用 Read 整份读回**，并核对第一行 `RUN` 指向 ccloop 路径。不许 `| tail`、`| grep`（ccloop Rule 14）。
- 跑判据前加 `ECC_GATEGUARD=off DISABLE_OMC=1`，只用 `./node_modules/.bin/vitest run <files>`。**主树不跑 `npm run build`，也不跑全量**。`npm run typecheck` 可以跑（它不写 `dist/`）。
- **既有判据只按 T1 的 S6 名单改**（T1 Step 0 先把名单记进台账）。名单以外的既有判据红了 ⇒ **停下报控制器**，不要去改它。
- 仓库外零写入：判据只写 `mkdtemp` 临时目录。
- 注释照邻近代码的风格：英文，写「为什么」，并写明依据哪条人裁或 spec 哪一节。
- 本轮的新常量与名字：call record schema `"ccloop-single-call-record-v1"`；错误码 `single-call-unsupported`（accept，exit 2）、`single-call-output-invalid`（adapter）；candidate 的 `terminalOutcome` 取 `single-call-complete`／`single-call-aborted`／`single-call-failed`；usage 的 observationId 是 `single-call`；cwd 目录是 `run/cwd`；evidence 目录是 `run/claude/1/single-call/call-*`。
- fake 的固定用量（沿用上一轮）：`result.usage` 总 15；usage-then-hang 模式下，闭合消息的观测值为 1109。

## Review Focus

1. **loop 的行为一字不变**：S6 名单上的每条判据只改 envelope 字面量（`protocol: 3`、`kind: "loop"`、类型名），断言不动（T1）。
2. **`null` 不当 0**：中止时没有观测 ⇒ `cumulative: null`（T5 W4）。
3. **零写**：single-call 不碰 git，`sourceDir` 下只出现预期的文件（T5 W5）。
4. **Orca 结算得了**：`work` 和 `handoff` 两个 bucket 都有 event，停机证明成立（T5 W1–W4，Drafter finding 3）。
5. **argv 和 env 是从 CLI 那一侧读回来的**，不是从 adapter 的请求里读（T4 S1、R1、R2）。

---

### Task 1: protocol 3 的 start envelope（`work` 分 `loop`／`single-call`），loop 路径照旧能跑（ccloop）

**Files:**
- Modify: `src/control/protocol.ts`（类型、zod、协议号、路径校验）
- Modify（改类型名，外加必要的收窄）: `src/control/accept.ts`、`src/control/collect.ts`、`src/control/handoff.ts`、`src/control/paths.ts`、`src/control/resultRepository.ts`、`src/control/worker.ts`
- Test（只追加）: `tests/control/protocol.test.ts` 新增 6 条
- Modify（S6 名单，见下表）: 14 个测试文件／helper

**Interfaces:**
- Produces（T2–T5 依赖）:
  - `export interface LoopWork { kind: "loop"; contract: LoopContract; targetRepo: string; base: string; sourceDir: string }`
  - `export interface SingleCallWork { kind: "single-call"; prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens: number; sourceDir: string }`
  - `export type LoopStartEnvelope`、`export type SingleCallStartEnvelope`（后者 `inputCheckpoint: null`）、`export type StartEnvelopeV3 = LoopStartEnvelope | SingleCallStartEnvelope`
  - `export function isLoopEnvelope(envelope: StartEnvelopeV3): envelope is LoopStartEnvelope`
  - 线上规则：只收 `protocol: 3`，其他版本一律 `control-protocol-unsupported`；两种 `work` 都是 strict；`responseSchema` 必须是对象且顶层 `type === "object"`；`maxOutputTokens` 必须是正安全整数；single-call 的 `inputCheckpoint` 必须是 `null`，且 single-call 不校验任何仓库路径。
- Consumes: 无。

**S6 名单**（都是「只改 envelope 字面量」；每个文件动的是它的 fixture 或 envelope 字面量，所以**读这个 fixture 的每条判据都算在内**）：

| 文件 | 改动点（行号 measured 2026-09-27, re-measure before use） | 受影响的判据 |
|---|---|---|
| `tests/control/protocol.test.ts` | `fixture()` 19–97 行；**另外整条改写**判据 `names unsupported protocol versions separately from invalid requests`（129–143 行） | 文件里全部 8 条：`round-trips the strict payload for every method`、`names unsupported protocol versions separately from invalid requests`、`rejects unsafe integers, malformed identities, and malformed hashes`、`requires a canonical absolute sourceDir with no symlink ancestor`、`keeps an input bundle inside the canonical source input directory`、`canonicalizes object keys recursively while preserving array order`（不读 fixture，不受影响）、`derives the control root from the accepted source directory`、`requires a full agent selection on the claim and at most a partial one on capabilities` |
| `tests/control/accept.test.ts` | `fixture()` 77–96 行 | `durable control acceptance` 下全部 7 条 |
| `tests/control/workerLaunch.test.ts` | `fixture()` 26–32 行 | `does not accept a recycled live PID with a mismatched UTC start identity` |
| `tests/control/collect.test.ts` | `fixture()` 32–38 行 | `filters afterSeq without renumbering`、`rechecks the content hash on every read`、`rejects traversal, symlink, FIFO, and evidence over 16 MiB` |
| `tests/control/handoff.test.ts` | `fixture()` 70–76 行；判据内字面量 195–201 行 | `named handoff request` 与 `mechanical handoff packet` 下全部 7 条（其中 `watches a latched deadline through packet, zero handoff usage, seal, and released lease` 用的是它自己的字面量） |
| `tests/control/handoffEnteredPhases.test.ts` | `fixture()` 44–50 行 | 两个 describe 下全部 7 条 |
| `tests/control/phasesCompleted.test.ts` | 159–165 行 | `writes one count per phase a registering adapter completed, and the run still proves isolation` |
| `tests/control/handoffDeadlineUsage.test.ts` | 36–42 行 | `books the observed tokens as a known cumulative and still hands off a partial candidate that answers its request` |
| `tests/control/claudeHandoffDeadlineUsage.test.ts` | 35–41 行 | 同名的那一条（claude 版） |
| `tests/control/claudeEndToEnd.test.ts` | 66–76 行 | `carries the claimed selection to the claude CLI's argv and still proves the run stopped`（跑的是 build，只在门上跑） |
| `tests/control/endToEnd.test.ts` | 29 行（单行字面量） | `control protocol through the built CLI` 下全部判据（跑的是 build，只在门上跑） |
| `tests/control/resultRepository.test.ts` | 44–47 行（`as unknown as` 强转） | `C2 reads its own run's attempt ref, not the shared path-derived one a later run overwrote`、`C1 shares the object store by hard links instead of copying it` |
| `tests/control/agentsFixture.ts`（helper `startEnvelope`） | 96–115 行 | `agentsControl.test.ts` 里用到它的判据：`acceptFixture()` 的全部使用者（`seals the materialized agent config whose canonical hash the claim carries`、`refuses a claim whose selection changed after its configHash was taken, before any worker`、`accepts a claim frozen before the CLI was upgraded, once the table records the new version`、`accepts a claim frozen before the CLI moved or its run limits changed, under the table as it is now`、`refuses a CLI whose --version drifted from the table, before anything is persisted`、`fails without a code and without persisting anything`、`reads the table only for capabilities and accept: a table broken after accept blocks neither inspect nor collect`、`keeps inspect and collect working after the table is deleted, while capabilities still refuses it`），外加 `refuses a sealed config whose schema or kind does not hold, or that is not JSON, before any phase`、`registers the claude phase's process group in processes.json, and that record proves nothing while the group lives` |

- [ ] **Step 0: 记名单（ccloop Rule 15(a)／Orca S6，控制器 Ruling）**：控制器先把上表（文件＋测试名）原样追加进进度源台账，写明「依据人裁 S6（本会话一揽子授权）＋ S8（问题先按控制器建议执行、最后统一报人）；ccloop Rule 15(a) 要的逐条指名由这张表承担，人最后统一审」，然后才动 Step 1 里的 S6 改写。**这张表以外的既有判据一条都不许改**；实施中发现表外判据红了 ⇒ 停下报控制器。

- [ ] **Step 1: 写判据**

(a) `tests/control/protocol.test.ts`：import 里的 `type StartEnvelopeV2` 改成 `type LoopStartEnvelope`；`fixture()` 的返回类型改成 `Promise<{ root: string; envelope: LoopStartEnvelope }>`；字面量里 `protocol: 2,` 改成 `protocol: 3,`，`work: {` 的下一行插入 `kind: "loop",`；在原有注释（16–18 行）**下面**追加：

```ts
// Human ruling S6 (2026-09-27, session f341f05f): protocol 3 envelope
// ERRATUM (same ruling): where the comment above says protocol-2, the fixture is now a protocol-3 envelope whose work
// is tagged `kind: "loop"` (Orca spec 2026-09-27-single-call-estimate-design.md §4.1); nothing else in it changed.
```

`round-trips the strict payload for every method` 上方的注释（100–102 行）下面，也追加上面这三行。

**整条改写** `names unsupported protocol versions separately from invalid requests`：它原来断言 protocol 3 被拒，现在 3 是唯一被接受的版本。原注释（126–128 行）逐字保留，把判据换成：

```ts
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the retired envelope
  // (protocol 1) and an unknown one (3) are both refused by name, apart from invalid requests; a capabilities request
  // must name its agent field (null for the table view), so `{}` is invalid like any extra key.
  // Human ruling S6 (2026-09-27, session f341f05f): protocol 3 envelope
  // Rewritten under S6 (Orca spec 2026-09-27-single-call-estimate-design.md §4.1, human ruling S7 "ccloop 现在没有发布，
  // 暂时不用考虑兼容性"): 3 is now the only start envelope; the retired 1 and 2 and an unknown 4 are each refused by name,
  // apart from invalid requests. The capabilities assertions are unchanged.
  it("names unsupported protocol versions separately from invalid requests", async () => {
    const { envelope } = await fixture();
    for (const protocol of [1, 2, 4]) {
      expect(() => parseControlRequest("accept", { ...envelope, protocol })).toThrow("control-protocol-unsupported");
    }
    expect(() => parseControlRequest("accept", { ...envelope, extra: true })).toThrow(
      "control-request-invalid",
    );
    expect(() => parseControlRequest("capabilities", { extra: true })).toThrow("control-request-invalid");
    expect(() => parseControlRequest("capabilities", { agent: null, extra: true })).toThrow("control-request-invalid");
    expect(() => parseControlRequest("capabilities", {})).toThrow("control-request-invalid");
  });
```

（保留的三行旧注释是 126–128 行原文逐字照抄，动手前再对一次现场。）

在 `fixture()` 之后加 helper，并在 `describe("control protocol v1", …)` 的末尾追加 6 条新判据：

```ts
// Orca single-call estimate (2026-09-27), spec §4.1 and §8.2 "协议": the single-call twin of the loop fixture.
function singleCallOf(root: string, loop: LoopStartEnvelope) {
  return {
    ...loop,
    inputCheckpoint: null,
    work: {
      kind: "single-call" as const,
      prompt: "Estimate the plan below.\n\n{\"planHash\":\"p\"}",
      responseSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
      maxOutputTokens: 4096,
      sourceDir: root,
    },
  };
}
```

```ts
  // Orca single-call estimate (2026-09-27), spec §4.1: protocol 3 carries one read-only structured call as a second
  // kind of work, through every method that carries a start envelope.
  it("round-trips a single-call envelope for every method that carries one", async () => {
    const { root, envelope: loop } = await fixture();
    const envelope = singleCallOf(root, loop);
    const request = { protocol: 1 as const, requestId: "request-1", runId: envelope.claim.runId, generation: envelope.claim.generation, reason: "human" as const, deadlineAt: "2026-09-27T10:00:00+08:00" };
    const ref = { artifactId: "artifact-1", hash: "c".repeat(64) };
    expect(parseControlRequest("accept", envelope)).toEqual(envelope);
    expect(parseControlRequest("inspect", envelope)).toEqual(envelope);
    expect(parseControlRequest("handoff", { input: envelope, request })).toEqual({ input: envelope, request });
    expect(parseControlRequest("collect", { input: envelope, afterSeq: 0 })).toEqual({ input: envelope, afterSeq: 0 });
    expect(parseControlRequest("read-evidence", { input: envelope, ref })).toEqual({ input: envelope, ref });
  });

  // Spec §4.1: both kinds are strict, and a single call names no repository and no contract.
  it("refuses a work without its kind, an unknown kind, and a single call carrying loop fields or extra keys", async () => {
    const { root, envelope: loop } = await fixture();
    const { kind: _kind, ...untagged } = loop.work;
    expect(() => parseControlRequest("accept", { ...loop, work: untagged })).toThrow("control-request-invalid");
    expect(() => parseControlRequest("accept", { ...loop, work: { ...loop.work, kind: "estimate" } })).toThrow("control-request-invalid");
    const single = singleCallOf(root, loop);
    expect(() => parseControlRequest("accept", { ...single, work: { ...single.work, targetRepo: root } })).toThrow("control-request-invalid");
    expect(() => parseControlRequest("accept", { ...single, work: { ...single.work, contract: loop.work.contract } })).toThrow("control-request-invalid");
    expect(() => parseControlRequest("accept", { ...single, extra: true })).toThrow("control-request-invalid");
    expect(() => parseControlRequest("accept", { ...single, protocol: 2 })).toThrow("control-protocol-unsupported");
  });

  // Spec §4.1: the claude API takes the schema as a tool's input_schema, whose top level must be `type: "object"`.
  it("requires a response schema whose top level is an object schema", async () => {
    const { root, envelope: loop } = await fixture();
    const single = singleCallOf(root, loop);
    for (const responseSchema of [{ type: "array", items: {} }, { properties: {} }, { oneOf: [{ type: "object" }] }, [], "object", null]) {
      expect(() => parseControlRequest("accept", { ...single, work: { ...single.work, responseSchema } })).toThrow("control-request-invalid");
    }
  });

  it("requires a positive safe integer output cap", async () => {
    const { root, envelope: loop } = await fixture();
    const single = singleCallOf(root, loop);
    for (const maxOutputTokens of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "4096"]) {
      expect(() => parseControlRequest("accept", { ...single, work: { ...single.work, maxOutputTokens } })).toThrow("control-request-invalid");
    }
    expect(parseControlRequest("accept", { ...single, work: { ...single.work, maxOutputTokens: 1 } })).toMatchObject({ work: { maxOutputTokens: 1 } });
  });

  // Spec §4.1 and §6.5: a single call is never continued, so it takes no input checkpoint -- not even one a loop
  // envelope with the same sourceDir would accept.
  it("refuses an input checkpoint on a single call that a loop envelope accepts", async () => {
    const { root, envelope: loop } = await fixture();
    const inside = { predecessorRunId: "run-0", checkpointId: "checkpoint-1", checkpointHash: "d".repeat(64), bundlePath: join(root, "input", "checkpoint-1") };
    expect(parseControlRequest("accept", { ...loop, inputCheckpoint: inside })).toEqual({ ...loop, inputCheckpoint: inside });
    expect(() => parseControlRequest("accept", { ...singleCallOf(root, loop), inputCheckpoint: inside })).toThrow("control-request-invalid");
  });

  it("requires a canonical absolute sourceDir on a single call too", async () => {
    const { root, envelope: loop } = await fixture();
    const single = singleCallOf(root, loop);
    expect(() => parseControlRequest("accept", { ...single, work: { ...single.work, sourceDir: "relative" } })).toThrow("control-request-invalid");
  });
```

(b) 其余 S6 文件，逐处改动全是同一个形状（用 Edit 做，不用 sed）：
- import 里的 `type StartEnvelopeV2` 改成 `type LoopStartEnvelope`；类型注解和返回类型里的 `StartEnvelopeV2` 同样改成 `LoopStartEnvelope`。
- `protocol: 2,` 改成 `protocol: 3,`（`endToEnd.test.ts` 里是 `protocol:2,`，改成 `protocol:3,`）。
- `work: { contract` 改成 `work: { kind: "loop", contract`（`endToEnd.test.ts`：`work:{contract` 改成 `work:{kind:"loop",contract`）。
- 在该 envelope 字面量的上一行（`endToEnd.test.ts` 是第 29 行的上一行；`agentsFixture.ts` 是 `return {` 的上一行；`collect.test.ts` 是 `envelope: {` 的上一行）加：

```ts
    // Human ruling S6 (2026-09-27, session f341f05f): protocol 3 envelope
```

- 文件里原有写着「protocol-2」的注释（`accept.test.ts:64`、`workerLaunch.test.ts:25`、`phasesCompleted.test.ts:151`、`resultRepository.test.ts:43`、`handoffDeadlineUsage.test.ts:32`、`collect.test.ts:31`、`handoff.test.ts:68`、`handoff.test.ts:187`、`claudeHandoffDeadlineUsage.test.ts:30`、`endToEnd.test.ts:19`、`handoffEnteredPhases.test.ts:43`）**逐字保留**，在它下面追加一行：

```ts
    // ERRATUM (human ruling S6, 2026-09-27, session f341f05f): the envelope named above is now protocol 3, work tagged kind "loop".
```

改完后跑：`cd /Users/biran/code/skills/loop/ccloop && grep -rn "StartEnvelopeV2\|protocol: 2,\|protocol:2," tests src > "$SCRATCH/t1-scan.txt" 2>&1; echo rc=$?`，整份读回。**期望 rc=1、文件为空**。grep 的 rc=1 在这里表示「一处也没剩下」；这是扫描，不是验证跑。

- [ ] **Step 2: 跑，确认红**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/control/protocol.test.ts > "$SCRATCH/t1-red.txt" 2>&1; echo rc=$?`，整份读回 `$SCRATCH/t1-red.txt`。
Expected: rc≠0。读 fixture 的判据都红在 `control-protocol-unsupported`（此时代码还只认 2）；6 条新判据红；`canonicalizes object keys …` 仍绿。

- [ ] **Step 3: 实现 `src/control/protocol.ts`**

把 `StartEnvelopeV2` 接口（57–68 行）整段换成：

```ts
/** Orca single-call estimate (2026-09-27), spec §4.1: the work a loop run does -- protocol 2's four fields, now tagged. */
export interface LoopWork {
  kind: "loop";
  contract: LoopContract;
  targetRepo: string;
  base: string;
  sourceDir: string;
}

/**
 * Spec §4.1 and §4.2: one read-only structured call. The prompt and the schema are the caller's bytes, handed to the
 * agent as they are and never rebuilt here; ccloop knows nothing of what the call is for.
 */
export interface SingleCallWork {
  kind: "single-call";
  prompt: string;
  responseSchema: Record<string, unknown>;
  maxOutputTokens: number;
  sourceDir: string;
}

interface StartEnvelopeBaseV3 {
  protocol: 3;
  claim: ClaimV2;
  contractHash: string;
}

export type LoopStartEnvelope = StartEnvelopeBaseV3 & { inputCheckpoint: InputCheckpointV1 | null; work: LoopWork };
/** Spec §6.5: a single call is never continued, so it takes no input checkpoint. */
export type SingleCallStartEnvelope = StartEnvelopeBaseV3 & { inputCheckpoint: null; work: SingleCallWork };
/** Human ruling S7 (2026-09-27, "ccloop 现在没有发布，暂时不用考虑兼容性"): protocol 3 is the only start envelope. */
export type StartEnvelopeV3 = LoopStartEnvelope | SingleCallStartEnvelope;

export function isLoopEnvelope(envelope: StartEnvelopeV3): envelope is LoopStartEnvelope {
  return envelope.work.kind === "loop";
}
```

`ControlRequestV1`、`ControlPayloadV1`，以及 `parseControlRequest` 的各个重载签名里，`StartEnvelopeV2` 全部改成 `StartEnvelopeV3`。

把 `workSchema` 与 `startEnvelopeSchema`（158–174 行）换成：

```ts
const loopWorkSchema = z
  .object({
    kind: z.literal("loop"),
    contract: loopContractSchema,
    targetRepo: z.string().min(1),
    base: z.string().min(1),
    sourceDir: z.string().min(1),
  })
  .strict();
// Orca single-call estimate (2026-09-27), spec §4.1: the claude API takes the schema as a tool's input_schema, whose top
// level must be `type: "object"` (scripts/claude-phase-runner.mjs records the 400 it answers otherwise).
const singleCallWorkSchema = z
  .object({
    kind: z.literal("single-call"),
    prompt: z.string().min(1),
    responseSchema: z.record(z.unknown()).refine((schema) => schema.type === "object"),
    maxOutputTokens: positiveSafeInteger,
    sourceDir: z.string().min(1),
  })
  .strict();
const envelopeBase = { protocol: z.literal(3), claim: claimSchema, contractHash: hashSchema };
const startEnvelopeSchema = z.union([
  z.object({ ...envelopeBase, inputCheckpoint: inputCheckpointSchema.nullable(), work: loopWorkSchema }).strict(),
  z.object({ ...envelopeBase, inputCheckpoint: z.null(), work: singleCallWorkSchema }).strict(),
]);
```

`validateEnvelopePaths`（236–245 行）改为：

```ts
function validateEnvelopePaths(envelope: StartEnvelopeV3): void {
  const sourceDir = validateCanonicalDirectory(envelope.work.sourceDir);
  // Orca single-call estimate (2026-09-27), spec §5.1: a single call names no repository and takes no input
  // checkpoint (its schema holds that to null), so its sourceDir is all there is to check.
  if (!isLoopEnvelope(envelope)) return;
  if (!isAbsolute(envelope.work.targetRepo)) throw new ControlProtocolError("control-request-invalid");
  if (envelope.inputCheckpoint === null) return;
  const bundle = validateCanonicalDirectory(envelope.inputCheckpoint.bundlePath);
  const inputRoot = resolve(sourceDir, "input");
  if (!isWithin(inputRoot, bundle) || bundle === inputRoot) {
    throw new ControlProtocolError("control-request-invalid");
  }
}
```

`parseControlRequest` 里的版本判断（269–273 行）：原注释保留，下面追加一行，再改条件：

```ts
  // Agent selection (2026-09-26), spec §5: the start envelope is protocol 2; a v1 envelope is refused by name.
  // Handoff requests stay protocol 1 and are nested, so this reads the envelope's number (spec §5 M4).
  // ERRATUM (Orca single-call estimate, 2026-09-27, human ruling S7): the start envelope is now protocol 3 only; 1 and 2 are refused by name.
  if (version !== undefined && version !== 3) {
    throw new ControlProtocolError("control-protocol-unsupported");
  }
```

其余函数体里 `as StartEnvelopeV2` 改成 `as StartEnvelopeV3`。

- [ ] **Step 4: 其他 src 文件改类型，并收窄**

- `src/control/accept.ts`：import 与三处签名里的 `StartEnvelopeV2` 改成 `StartEnvelopeV3`（读的只有 `input.work.sourceDir` 与 `input.claim`，两种 kind 都有）。
- `src/control/collect.ts`、`src/control/paths.ts`：`StartEnvelopeV2` 改成 `StartEnvelopeV3`。
- `src/control/handoff.ts`：import 改成 `type LoopStartEnvelope, type StartEnvelopeV3`。`requestHandoff`、`identity`、`persistHandoffCandidate` 的 `envelope` 参数用 `StartEnvelopeV3`；`buildHandoffPacket`、`finalizeHandoffCandidate` 读 `work.contract`，参数改用 `LoopStartEnvelope`。
- `src/control/resultRepository.ts`：import 与参数改成 `LoopStartEnvelope`。
- `src/control/worker.ts`：import 改成 `{ canonicalJson, isLoopEnvelope, parseControlRequest, type StartEnvelopeV3 }`；108 行的 `as StartEnvelopeV2` 改成 `as StartEnvelopeV3`；在 `const runDir = join(sourceDir, "run");`（158 行）的上一行插入：

```ts
    // Orca single-call estimate (2026-09-27), spec §5.2: until the single-call branch exists, only loop work runs.
    if (!isLoopEnvelope(envelope)) throw new Error("control-work-kind-unsupported");
```

（守卫之后 `envelope` 收窄成 `LoopStartEnvelope`，后面 `runLoop` 的回调里对 `materializeResultRepository`／`buildHandoffPacket` 的调用才能过 typecheck。T5 会替换这两行。）

- [ ] **Step 5: 跑，确认绿**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/control/protocol.test.ts tests/control/accept.test.ts tests/control/workerLaunch.test.ts tests/control/collect.test.ts tests/control/handoff.test.ts tests/control/handoffEnteredPhases.test.ts tests/control/phasesCompleted.test.ts tests/control/handoffDeadlineUsage.test.ts tests/control/claudeHandoffDeadlineUsage.test.ts tests/control/resultRepository.test.ts tests/control/agentsControl.test.ts tests/control/command.test.ts tests/control/worker.test.ts tests/control/materialize.test.ts > "$SCRATCH/t1-green.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc=0，没有 skipped。`endToEnd.test.ts`、`claudeEndToEnd.test.ts` 依赖 `dist/`，**这里有意不跑**，由 Task 6 在 clone 里 build 后跑（Drafter finding 15）；`stopProof.test.ts` 里有一条已知红，也不在本表里。

Run: `cd /Users/biran/code/skills/loop/ccloop && npm run typecheck > "$SCRATCH/t1-tsc.txt" 2>&1; echo rc=$?`，整份读回。Expected: rc=0。

- [ ] **Step 6: 台账**：在进度源（`.superpowers/sdd/2026-09-27-single-call-estimate/progress.md`）记下这次用 S6 的情况：S6／S8 原话、上表逐行、本 Task 的提交主题行。

- [ ] **Step 7: 提交**

```bash
cd /Users/biran/code/skills/loop/ccloop && git add src/control/protocol.ts src/control/accept.ts src/control/collect.ts src/control/handoff.ts src/control/paths.ts src/control/resultRepository.ts src/control/worker.ts tests/control/protocol.test.ts tests/control/accept.test.ts tests/control/workerLaunch.test.ts tests/control/collect.test.ts tests/control/handoff.test.ts tests/control/handoffEnteredPhases.test.ts tests/control/phasesCompleted.test.ts tests/control/handoffDeadlineUsage.test.ts tests/control/claudeHandoffDeadlineUsage.test.ts tests/control/claudeEndToEnd.test.ts tests/control/endToEnd.test.ts tests/control/resultRepository.test.ts tests/control/agentsFixture.ts && git commit -F - <<'EOF'
feat(control): carry loop or single-call work in a protocol-3 start envelope

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**（每条改一处，在 `git clone --local` 副本里做）:
- `protocol.ts` 的 `version !== 3` 改成 `version !== 2 && version !== 3` ⇒ 改写后的 `names unsupported protocol versions separately from invalid requests` 红（protocol 2 不再是 unsupported，变成 invalid）。
- `singleCallWorkSchema` 删掉 `.strict()` ⇒ `refuses a work without its kind, an unknown kind, and a single call carrying loop fields or extra keys` 红。
- 删掉 `.refine((schema) => schema.type === "object")` ⇒ `requires a response schema whose top level is an object schema` 红。
- `maxOutputTokens: positiveSafeInteger` 改成 `maxOutputTokens: safeInteger` ⇒ `requires a positive safe integer output cap` 红（0 被收下）。
- single-call envelope 的 `inputCheckpoint: z.null()` 改成 `inputCheckpoint: inputCheckpointSchema.nullable()` ⇒ `refuses an input checkpoint on a single call that a loop envelope accepts` 红。
- 删掉 `validateEnvelopePaths` 里的 `if (!isLoopEnvelope(envelope)) return;` ⇒ `round-trips a single-call envelope for every method that carries one` 红（`isAbsolute(undefined)` 抛错，变成 `control-request-invalid`）。

---

### Task 2: 能力位 `singleCallExecution`（解析应答的兄弟字段）＋ accept 闸 `single-call-unsupported`（ccloop）

**Files:**
- Modify: `src/agents/registry.ts`（`AgentDescriptor` 加方法）、`src/agents/claude.ts`、`src/agents/codex.ts`
- Modify: `src/control/command.ts`（解析应答与其 schema）、`src/control/accept.ts`（闸）
- Modify（只加 export）: `tests/control/agentsFixture.ts`，加 `SINGLE_CALL_SCHEMA` 与 `singleCallEnvelope`
- Create: `tests/control/singleCallCapability.test.ts`

**不改既有判据**（Drafter finding 2）：没有既有判据用 `toEqual` 钉解析应答；`agentsControl.test.ts` 的 `answers capabilities for a selection with descriptor defaults filled, given fields echoed, and the materialized config's hash` 用的是 `toMatchObject`，多一个兄弟字段仍然绿。

**Interfaces:**
- Consumes: T1 的 `SingleCallStartEnvelope`。
- Produces:
  - `AgentDescriptor.singleCallExecution(config: MaterializedAgentConfigV1): "v1" | null`（claude 答 `"v1"`，codex 答 `null`）
  - capabilities 解析应答 ＝ `{ protocol: 3, selection, configHash, timeoutMs, killGraceMs, capabilities, singleCallExecution }`；七键视图与表视图都不变。
  - accept：`work.kind === "single-call"` 且 agent 答 `null` ⇒ `ControlProtocolError("single-call-unsupported")`（exit 2），发生在任何落盘之前。
  - 测试 helper：`export const SINGLE_CALL_SCHEMA`；`export function singleCallEnvelope(input: { sourceDir: string; agent: AgentSelectionV1; configHash: string }): SingleCallStartEnvelope`（`runId: "run-estimate-1"`、`taskId: null`、grant 为 `work {250000, 60000, 1, 1}`、`handoff` 为零、`maxOutputTokens: 4096`）。

- [ ] **Step 1: 加 helper**（追加到 `tests/control/agentsFixture.ts` 末尾；import 里加 `type SingleCallStartEnvelope`）

```ts
/** Orca single-call estimate (2026-09-27): the schema every single-call criterion asks for. */
export const SINGLE_CALL_SCHEMA = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };

/**
 * Orca single-call estimate (2026-09-27), spec §4.1: a protocol-3 single-call envelope shaped like Orca's estimate
 * (no task, a work grant and a zero handoff grant). Nothing in it names a repository.
 */
export function singleCallEnvelope(input: { sourceDir: string; agent: AgentSelectionV1; configHash: string }): SingleCallStartEnvelope {
  const zero = { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
  return {
    protocol: 3,
    claim: {
      groupId: "group-1", workItemId: "estimate-1", taskId: null, runId: "run-estimate-1", generation: 1, graphVersion: 1,
      targetVersion: 1, commandId: "command-1", configHash: input.configHash, agent: input.agent,
      grant: { work: { tokens: 250_000, activeMs: 60_000, attempts: 1, sessions: 1 }, handoff: zero }, ownerToken: "owner-1",
    },
    contractHash: "d".repeat(64),
    inputCheckpoint: null,
    work: {
      kind: "single-call",
      prompt: "Estimate the plan below.\n\n{\"planHash\":\"p\"}",
      responseSchema: SINGLE_CALL_SCHEMA,
      maxOutputTokens: 4096,
      sourceDir: input.sourceDir,
    },
  };
}
```

- [ ] **Step 2: 写判据** `tests/control/singleCallCapability.test.ts`

```ts
import { mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgent } from "../../src/agents/materialize.js";
import { acceptStart } from "../../src/control/accept.js";
import { runControlCommand } from "../../src/control/command.js";
import { FAKE_CLAUDE_CLI, FAKE_CODEX, claudeInstallation, codexInstallation, singleCallEnvelope, writeAgentsTable } from "./agentsFixture.js";

// Orca single-call estimate (2026-09-27), spec §4.4, §5.1 and §8.2 "capabilities"/"accept": whether an agent can run
// one read-only structured call is a sibling of the seven-key capability view (like timeoutMs and killGraceMs, a fact
// Orca does not intersect with a profile), and accept refuses single-call work for an agent that answers null even
// when Orca's preflight let it through. Additive only (ccloop Rule 15): no existing criterion pins this answer.
const SEVEN = {
  usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable",
  handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
};

async function twoAgentTable() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-single-call-table-")));
  const script = join(dir, "script.json");
  await writeFile(script, "{}\n", { mode: 0o600 });
  return await writeAgentsTable({
    claude: await claudeInstallation([process.execPath, FAKE_CLAUDE_CLI, "script", join(dir, "claude-marker"), script]),
    codex: await codexInstallation({ command: [process.execPath, FAKE_CODEX, "integration", join(dir, "codex-marker")], sandbox: "workspace-write", budgetMode: "soft", timeoutMs: 1_000, killGraceMs: 100 }),
  }, dir);
}

describe("single-call capability and its accept gate (Orca single-call estimate)", { timeout: 30_000 }, () => {
  it("C1: answers singleCallExecution beside an unchanged seven-key view: v1 for claude, null for codex", async () => {
    const { path, table } = await twoAgentTable();
    const claude = await runControlCommand(["capabilities", "--agents", path], JSON.stringify({ agent: { agent: "claude" } }));
    expect(claude.code, claude.stderr).toBe(0);
    const claudeResolution = (await resolveAgent(table, { agent: "claude" })).resolution;
    expect(claudeResolution.capabilities).toEqual(SEVEN);
    expect(JSON.parse(claude.stdout)).toEqual({ protocol: 3, ...claudeResolution, singleCallExecution: "v1" });

    const codex = await runControlCommand(["capabilities", "--agents", path], JSON.stringify({ agent: { agent: "codex" } }));
    expect(codex.code, codex.stderr).toBe(0);
    const codexResolution = (await resolveAgent(table, { agent: "codex" })).resolution;
    expect(codexResolution.capabilities).toEqual(SEVEN);
    expect(JSON.parse(codex.stdout)).toEqual({ protocol: 3, ...codexResolution, singleCallExecution: null });
  });

  it("C2: leaves the table view without it", async () => {
    const { path } = await twoAgentTable();
    const view = await runControlCommand(["capabilities", "--agents", path], JSON.stringify({ agent: null }));
    expect(view.code, view.stderr).toBe(0);
    expect(Object.keys(JSON.parse(view.stdout)).sort()).toEqual(["installations", "protocol"]);
  });

  it("C3: accept refuses single-call work for an agent that answers null, by name and before anything is persisted", async () => {
    const { path, table } = await twoAgentTable();
    const sourceDir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-single-call-refused-")));
    const { resolution } = await resolveAgent(table, { agent: "codex" });
    const envelope = singleCallEnvelope({ sourceDir, agent: resolution.selection, configHash: resolution.configHash });
    expect(await runControlCommand(["accept", "--agents", path], JSON.stringify(envelope))).toEqual({ code: 2, stdout: "", stderr: "single-call-unsupported\n" });
    expect(await readdir(sourceDir)).toEqual([]);
  });

  it("C4: accept admits single-call work for claude and seals its envelope", async () => {
    const { path, table } = await twoAgentTable();
    const sourceDir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-single-call-admitted-")));
    const { resolution } = await resolveAgent(table, { agent: "claude" });
    const envelope = singleCallEnvelope({ sourceDir, agent: resolution.selection, configHash: resolution.configHash });
    const status = await acceptStart(envelope, {
      agentsTablePath: path,
      workerCommand: [resolve("node_modules/.bin/tsx"), resolve("tests/fixtures/control-worker.mjs")],
      receiptTimeoutMs: 2_000,
    });
    expect(status.kind).toBe("accepted");
    expect(JSON.parse(await readFile(join(sourceDir, "control", "envelope.json"), "utf8"))).toEqual(envelope);
  });
});
```

- [ ] **Step 3: 跑，确认红**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/control/singleCallCapability.test.ts > "$SCRATCH/t2-red.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc≠0；C1 红（stdout 里没有 `singleCallExecution`）；C3 红（accept 答 exit 0，`sourceDir` 下已经写出了 `control/`）；C2、C4 绿。

- [ ] **Step 4: 实现**

`src/agents/registry.ts`，在 `capabilities(...)` 那一行后面加：

```ts
  /**
   * Orca single-call estimate (2026-09-27), spec §4.4: "v1" when this kind can run one read-only structured call with
   * an output-token cap and every tool turned off; null when either cannot be done. A sibling of capabilities, not a
   * key of it: Orca does not intersect it with a profile or freeze it into a task.
   */
  singleCallExecution(config: MaterializedAgentConfigV1): "v1" | null;
```

`src/agents/claude.ts`，在 `capabilities(config) {…},` 之后加：

```ts
  // Orca single-call estimate (2026-09-27), Task 0 item 1 (claude 2.1.283, static only): `--tools ""` turns every tool
  // off (claude --help: 'Use "" to disable all tools') and CLAUDE_CODE_MAX_OUTPUT_TOKENS sets max_tokens.
  singleCallExecution() {
    return "v1";
  },
```

`src/agents/codex.ts`，在 `capabilities() {…},` 之后加：

```ts
  // Orca single-call estimate (2026-09-27), Task 0 item 1 (codex-cli 0.155.1): no config caps the model's output, so a
  // single call cannot be bounded the way spec §4.4 asks.
  singleCallExecution() {
    return null;
  },
```

`src/control/command.ts`：`capabilitiesSchema` 第二个成员里，`capabilities: capabilityViewSchema,` 之后加 `singleCallExecution: z.enum(["v1"]).nullable(),`；`defaultHandler` 里的解析分支改为：

```ts
    const { config, resolution } = await resolveAgent(await readAgentsTable(context.agentsTablePath), request.agent);
    // Orca single-call estimate (2026-09-27), spec §4.4: a sibling of `capabilities`, like timeoutMs and killGraceMs,
    // so the seven-key view (frozen into Orca profiles and task records) stays exactly as it is.
    return { protocol: 3, ...resolution, singleCallExecution: getDescriptor(config.kind).singleCallExecution(config) };
```

`src/control/accept.ts`：import 加 `import { getDescriptor } from "../agents/registry.js";`，在 `control-config-hash-mismatch` 那个判断（80–82 行）之后加：

```ts
  // Orca single-call estimate (2026-09-27), spec §5.1: refused here, before anything is persisted, even when Orca's
  // preflight let it through.
  if (input.work.kind === "single-call" && getDescriptor(config.kind).singleCallExecution(config) === null) {
    throw new ControlProtocolError("single-call-unsupported");
  }
```

- [ ] **Step 5: 跑，确认绿**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/control/singleCallCapability.test.ts tests/control/command.test.ts tests/control/agentsControl.test.ts tests/control/accept.test.ts tests/agents > "$SCRATCH/t2-green.txt" 2>&1; echo rc=$?`，整份读回。Expected: rc=0。
Run: `cd /Users/biran/code/skills/loop/ccloop && npm run typecheck > "$SCRATCH/t2-tsc.txt" 2>&1; echo rc=$?`。Expected: rc=0。

- [ ] **Step 6: 提交**

```bash
cd /Users/biran/code/skills/loop/ccloop && git add src/agents/registry.ts src/agents/claude.ts src/agents/codex.ts src/control/command.ts src/control/accept.ts tests/control/agentsFixture.ts tests/control/singleCallCapability.test.ts && git commit -F - <<'EOF'
feat(control): answer whether an agent can run a single call, and refuse single-call work for one that cannot

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**:
- `claude.ts` 的 `return "v1";` 改成 `return null;` ⇒ C1 红，C4 红（`single-call-unsupported`）。
- `codex.ts` 的 `return null;` 改成 `return "v1";` ⇒ C1 红，C3 红。
- `command.ts` 删掉 `singleCallExecution: getDescriptor(config.kind).singleCallExecution(config)` ⇒ C1 红（`control-response-invalid`）。
- `accept.ts` 删掉闸那个 `if` ⇒ C3 红。

---

### Task 3: fake claude CLI 的 single-call 模式（ccloop）

**Files:**
- Modify: `tests/fixtures/fake-claude-cli.mjs`
- Test（只追加）: `tests/runtime/claude/fakeClaudeCli.test.ts`

**Interfaces:**
- Produces（T4、T5 依赖）:
  - 新增值参数 `--tools <value>`；只有 `value === ""` 时这次调用才是 **single-call**，与 `--json-schema` 是什么无关。
  - single-call 的 phase 名叫 `"single-call"`：`.calls` 追加 `single-call`；script 模式读脚本的 `"single-call"` 条目，`.tasks` 追加 `single-call single-call`（没有条目 ⇒ exit 3，与 execute 一样）。
  - 脚本条目 `{ output: <object | null>, delayMs?: { "single-call": n }, usageBeforeDelay?: true }`。`output` 作为 `structured_output` 回；`output: null` ⇒ result 事件里**没有** `structured_output` 这个键。`ok` 模式回 `{ answer: "fixture" }`。
  - `<marker>` JSON 加字段 `maxOutputTokensEnv: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? null`（argv 本来就记在 `args` 与 `<marker>.argv` 里）。
  - `usage-then-hang`、`hang` 模式的行为不变（它们在读 schema 之前就分流了）。

- [ ] **Step 1: 写判据**（追加到 `fakeClaudeCli.test.ts` 那个 describe 的末尾；`workdir`、`lines`、`fake` 都在同一个作用域里）

```ts
  // Orca single-call estimate (2026-09-27), spec §5.4: the runner calls claude once with the caller's schema, every tool
  // off (`--tools ""`) and CLAUDE_CODE_MAX_OUTPUT_TOKENS set. The fake tells such a call apart by `--tools ""` alone,
  // answers it from its script's "single-call" entry, and records the output cap it was handed.
  const answerSchema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  const singleCallArgs = (withTools = true) =>
    ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--json-schema", JSON.stringify(answerSchema), ...(withTools ? ["--tools", ""] : []), "Estimate this."];
  const withoutCap = () => { const env = { ...process.env }; delete env.CLAUDE_CODE_MAX_OUTPUT_TOKENS; return env; };
  function launchEnv(cwd: string, argv: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fake, ...argv], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout }));
    });
  }
  async function singleCallScript(cwd: string, entry: unknown): Promise<string> {
    const scriptPath = join(cwd, "script.json");
    await writeFile(scriptPath, JSON.stringify({ "single-call": entry }));
    return scriptPath;
  }

  it("F1: answers a single call from the script's single-call entry and records the output cap it was given", async () => {
    const cwd = await workdir();
    const scriptPath = await singleCallScript(cwd, { output: { answer: "forty-two" } });
    const result = await launchEnv(cwd, ["script", join(cwd, "marker.json"), scriptPath, ...singleCallArgs()], { ...withoutCap(), CLAUDE_CODE_MAX_OUTPUT_TOKENS: "321" });
    expect(result.code).toBe(0);
    expect(lines(result.stdout).at(-1)).toEqual({ type: "result", subtype: "success", is_error: false, structured_output: { answer: "forty-two" }, usage: { input_tokens: 12, output_tokens: 3 } });
    expect(await readFile(join(cwd, "marker.json.calls"), "utf8")).toBe("single-call\n");
    expect(await readFile(join(cwd, "marker.json.tasks"), "utf8")).toBe("single-call single-call\n");
    const marker = JSON.parse(await readFile(join(cwd, "marker.json"), "utf8"));
    expect(marker.maxOutputTokensEnv).toBe("321");
    expect(marker.args).toEqual(singleCallArgs());
  });

  it("F2: leaves structured_output out of the result when the entry's output is null", async () => {
    const cwd = await workdir();
    const scriptPath = await singleCallScript(cwd, { output: null });
    const result = await launchEnv(cwd, ["script", join(cwd, "marker.json"), scriptPath, ...singleCallArgs()], withoutCap());
    expect(result.code).toBe(0);
    const last = lines(result.stdout).at(-1);
    expect(last).toMatchObject({ type: "result", usage: { input_tokens: 12, output_tokens: 3 } });
    expect(Object.keys(last)).not.toContain("structured_output");
  });

  it("F3: streams one closed message before a delayed single-call answer when usageBeforeDelay is set", async () => {
    const cwd = await workdir();
    const scriptPath = await singleCallScript(cwd, { output: { answer: "late" }, delayMs: { "single-call": 30_000 }, usageBeforeDelay: true });
    const child = spawn(process.execPath, [fake, "script", join(cwd, "marker.json"), scriptPath, ...singleCallArgs()], { cwd, env: withoutCap(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    await expect.poll(() => stdout.includes('"message_delta"'), { timeout: 5000 }).toBe(true);
    child.kill("SIGKILL");
    expect(stdout).not.toContain('"result"');
  });

  it("F4: without --tools \"\" the same schema is not a single call, and no cap is recorded when none is set", async () => {
    const cwd = await workdir();
    await launchEnv(cwd, ["ok", join(cwd, "marker.json"), ...singleCallArgs(false)], withoutCap());
    expect(await readFile(join(cwd, "marker.json.calls"), "utf8")).toBe("plan\n");
    expect(JSON.parse(await readFile(join(cwd, "marker.json"), "utf8")).maxOutputTokensEnv).toBeNull();
  });
```

- [ ] **Step 2: 跑，确认红**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/runtime/claude/fakeClaudeCli.test.ts > "$SCRATCH/t3-red.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc≠0；F1、F2、F3 红（`fake-claude-cli: unknown argument --tools`，exit 2）；F4 红（`maxOutputTokensEnv` 是 `undefined`，不是 `null`）；既有判据全绿。

- [ ] **Step 3: 实现 fake**

参数循环（29–46 行）：`let` 那一行加上 `tools`；值参数的判断加上 `--tools`：

```js
let print = false, outputFormat, schemaText, model = null, prompt, tools;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "-p") { print = true; continue; }
  if (arg === "--verbose" || arg === "--include-partial-messages") continue;
  if (arg === "--output-format" || arg === "--json-schema" || arg === "--model" || arg === "--tools") {
    const value = args[index + 1];
    if (value === undefined) fail(`missing value for ${arg}`);
    if (arg === "--output-format") outputFormat = value;
    if (arg === "--json-schema") schemaText = value;
    if (arg === "--model") model = value;
    if (arg === "--tools") tools = value;
    index += 1;
    continue;
  }
```

写 marker 的地方（50–55 行），在 `observedUsagePathEnv` 之后加：

```js
  // Orca single-call estimate (2026-09-27), spec §5.4: lets criteria see the output cap the runner handed claude.
  maxOutputTokensEnv: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? null,
```

正常回答分支（86 行起）里，phase 判定与 body：

```js
  const schema = JSON.parse(schemaText);
  // Orca single-call estimate (2026-09-27), spec §5.4: the runner turns every tool off with `--tools ""` only for a
  // single call, so that flag -- not the caller's schema, which can be anything -- tells a single call apart.
  const singleCall = tools === "";
  const phase = singleCall ? "single-call" : schema.oneOf || schema.properties?.changedFiles ? "execute" : schema.properties?.approved ? "verify" : "plan";
  let body = { summary: "fixture", primaryTargetPaths: ["answer.txt"] };
  if (phase === "execute") body = { changedFiles: ["answer.txt"], diffPatch: "fixture patch", commandOutputs: ["changed answer"], stdoutStderrLog: "fixture execution" };
  if (phase === "verify") body = { approved: true, rejectCategory: "", primaryTargetPaths: ["answer.txt"], failingCommand: null, safeToRetry: false, evidence: [], pauseSignals: [], stopSignals: [] };
  if (phase === "single-call") body = { answer: "fixture" };
```

script 分支（97–108 行）改为：

```js
  if (mode === "script") {
    const task = phase === "single-call"
      ? "single-call"
      : { plan: /^Plan one isolated L2 attempt for task (.+)\.$/m, execute: /^Execute one isolated attempt for task (.+)\.$/m, verify: /^Verify task (.+)\.$/m }[phase].exec(prompt)?.[1];
    const script = task === undefined ? {} : JSON.parse(readFileSync(process.argv[4], "utf8"));
    const key = prompt.includes(CONTINUATION) && script[`${task}#continuation`] !== undefined ? `${task}#continuation` : script[task] !== undefined ? task : undefined;
    entry = key === undefined ? undefined : script[key];
    appendFileSync(`${marker}.tasks`, `${phase} ${key ?? "-"}\n`);
    if ((phase === "execute" || phase === "single-call") && entry === undefined) {
      process.stderr.write(`fake-claude-cli script has no entry for task ${task}\n`);
      process.exitCode = 3;
      refused = true;
    }
    // Orca single-call estimate (2026-09-27): a single call answers what its entry scripts; null stands for an answer
    // with no structured object at all.
    if (phase === "single-call" && entry !== undefined) body = entry.output;
  }
```

`respond` 里构造 envelope 的那一行改为：

```js
    const envelope = { type: "result", subtype: "success", is_error: false, ...(body === null ? {} : { structured_output: body }), usage: { input_tokens: 12, output_tokens: 3 } };
```

文件头注释在 Modes 一段之后补一行：`// Orca single-call estimate (2026-09-27, spec §5.4): \`--tools ""\` marks a single call (phase "single-call"), answered from the script's "single-call" entry {output, delayMs, usageBeforeDelay}; <marker> also records maxOutputTokensEnv.`

- [ ] **Step 4: 跑，确认绿**：同 Step 2 的命令，输出写到 `"$SCRATCH/t3-green.txt"`。Expected: rc=0，整个文件全绿。

- [ ] **Step 5: 提交**

```bash
cd /Users/biran/code/skills/loop/ccloop && git add tests/fixtures/fake-claude-cli.mjs tests/runtime/claude/fakeClaudeCli.test.ts && git commit -F - <<'EOF'
test(claude): let the fake claude CLI answer one tool-less structured call

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**:
- `const singleCall = tools === "";` 改成 `const singleCall = false;` ⇒ F1 红。
- 删掉 marker 里的 `maxOutputTokensEnv` 那一行 ⇒ F1 与 F4 红。
- `...(body === null ? {} : { structured_output: body })` 改成 `structured_output: body` ⇒ F2 红。
- `const singleCall = tools === "";` 改成 `const singleCall = schema.properties?.answer !== undefined;`（按 schema 认，而不是按 `--tools ""` 认）⇒ F4 红（`.calls` 变成 `single-call`）。

---

### Task 4: claude runner 与 adapter 的 `singleCall`（ccloop）

**Files:**
- Modify: `src/runtime/types.ts`（`SingleCallRequest`、`SingleCallResult`、`SingleCallOutputInvalid`，`RuntimeAdapter` 加可选方法 `singleCall?`）
- Modify: `src/runtime/claude/types.ts`（`ClaudePhaseRequest` 加 `single-call` 成员）
- Modify: `src/runtime/claude/claudeAgentAdapter.ts`（`run` 改成吃一个 `ClaudeCall`，新增 `singleCall`）
- Modify: `scripts/claude-phase-runner.mjs`
- Create: `tests/runtime/claude/claudeSingleCall.test.ts`

**Interfaces:**
- Consumes: T3 的 fake（`--tools ""`、`single-call` 条目、marker 里的 `maxOutputTokensEnv`、`cwd`、`.argv`）。
- Produces（T5 依赖）:

```ts
export type SingleCallRequest = {
  prompt: string;
  responseSchema: Record<string, unknown>;
  maxOutputTokens: number;
  cwd: string;
  runDir: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onProcessRegistered?: AttemptContext["onProcessRegistered"];
};
export type SingleCallResult = { output: unknown; tokenUsage: number | null; usageEvidence: unknown };
export class SingleCallOutputInvalid extends Error { readonly code: "single-call-output-invalid"; readonly evidenceDir: string; readonly tokenUsage: number | null; readonly usageEvidence: unknown }
// RuntimeAdapter: singleCall?(request: SingleCallRequest): Promise<SingleCallResult>;
```

  - 中止时抛 `ClaudePhaseAborted(evidenceDir, observedTokens)`（`observedTokensOf` 能读出）。结果里没有结构化对象 ⇒ 抛 `SingleCallOutputInvalid`，用量照带。其余失败抛 `Error("claude-<reason>: <dir>")`，与各阶段一样。
  - runner 收到的请求：`{ phase: "single-call", prompt, attempt: 1, runDir, cwd, schema, maxOutputTokens }`。claude 的 argv 为 `[...command.slice(1), "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--json-schema", JSON.stringify(schema), "--tools", "", ...extraArgs, prompt]`；env 为 `claudeEnv()` 加 `CLAUDE_CODE_MAX_OUTPUT_TOKENS=String(maxOutputTokens)`；cwd 为 `request.cwd`。runner 回 `{ output, outputError: null | "single-call-output-invalid", usageEvidence, tokenUsage }`。
  - 超时 ＝ `min(installation.timeoutMs, request.timeoutMs)`。
  - 证据目录 ＝ `<runDir>/claude/1/single-call/call-XXXXXX/`。

- [ ] **Step 1: 写判据** `tests/runtime/claude/claudeSingleCall.test.ts`

```ts
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { MaterializedAgentConfigV1 } from "../../../src/agents/types.js";
import { ClaudeAgentAdapter, ClaudePhaseAborted, claudeRunnerPath } from "../../../src/runtime/claude/claudeAgentAdapter.js";
import { observedTokensOf, SingleCallOutputInvalid, type SingleCallRequest } from "../../../src/runtime/types.js";

// Orca single-call estimate (2026-09-27), spec §5.4 and §8.2 "adapter": ClaudeAgentAdapter.singleCall drives the claude CLI
// once through scripts/claude-phase-runner.mjs. As the stream-usage round's N7 did, these criteria read what the runner
// actually handed the CLI -- the fake records its argv, its cwd and CLAUDE_CODE_MAX_OUTPUT_TOKENS -- not the request.
const fakeCli = fileURLToPath(new URL("../../fixtures/fake-claude-cli.mjs", import.meta.url));
const SCHEMA = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
const PROMPT = "Estimate the plan below.\n\n{\"planHash\":\"p\"}";
const dirs: string[] = [];
const groups: number[] = [];
afterEach(async () => {
  for (const pgid of groups.splice(0)) { try { process.kill(-pgid, "SIGKILL"); } catch {} }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function world(mode: "script" | "usage-then-hang" | "hang", script: unknown = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "claude-single-call-"))); dirs.push(dir);
  const cwd = join(dir, "cwd"), runDir = join(dir, "run"), marker = join(dir, "marker.json"), scriptPath = join(dir, "script.json");
  await mkdir(cwd, { mode: 0o700 }); await mkdir(runDir, { mode: 0o700 });
  await writeFile(scriptPath, JSON.stringify(script));
  const command: [string, ...string[]] = mode === "script" ? [process.execPath, fakeCli, mode, marker, scriptPath] : [process.execPath, fakeCli, mode, marker];
  const config: MaterializedAgentConfigV1 = {
    schema: "ccloop-agent-config-v1", kind: "claude",
    installation: { kind: "claude", command, version: "9.9.9-fake", configDir: null, timeoutMs: 20_000, killGraceMs: 300 },
    selection: { agent: "claude", model: "claude-opus-5-5", contextWindow: "agent-default" },
  };
  const registrations: Array<{ pid: number; pgid: number; startedAt: string; phase: string }> = [];
  const request = (extra: Partial<SingleCallRequest> = {}): SingleCallRequest => ({
    prompt: PROMPT, responseSchema: SCHEMA, maxOutputTokens: 2048, cwd, runDir, timeoutMs: 20_000,
    onProcessRegistered: async (registration) => { registrations.push(registration); groups.push(registration.pgid); },
    ...extra,
  });
  return { dir, cwd, runDir, marker, config, registrations, request };
}
const callDir = async (runDir: string) => {
  const root = join(runDir, "claude", "1", "single-call");
  const [call] = await readdir(root);
  return join(root, call!);
};
const argvOf = async (marker: string) => (await readFile(`${marker}.argv`, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string[]);

function runRunner(cwd: string, command: string[], request: unknown): Promise<{ code: number | null; stdout: string }> {
  const env = { ...process.env, CCLOOP_CLAUDE_COMMAND: JSON.stringify(command), CCLOOP_CLAUDE_EXTRA_ARGS: "[]" };
  delete env.CCLOOP_CLAUDE_OBSERVED_USAGE_PATH;
  delete env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [claudeRunnerPath()], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(request));
  });
}

describe("ClaudeAgentAdapter.singleCall (Orca single-call estimate)", () => {
  it("S1: hands claude the request's schema, every tool off, the output cap and the empty cwd, and returns the answer with its usage", async () => {
    const w = await world("script", { "single-call": { output: { answer: "forty-two" } } });
    const result = await new ClaudeAgentAdapter(w.config).singleCall(w.request());
    expect(result).toMatchObject({ output: { answer: "forty-two" }, tokenUsage: 15 });
    const [argv] = await argvOf(w.marker);
    expect(JSON.parse(argv![argv!.indexOf("--json-schema") + 1]!)).toEqual(SCHEMA);
    expect(argv!.indexOf("--tools")).toBeGreaterThan(-1);
    expect(argv![argv!.indexOf("--tools") + 1]).toBe("");
    expect(argv!.at(-1)).toBe(PROMPT);
    const marker = JSON.parse(await readFile(w.marker, "utf8"));
    expect(marker.maxOutputTokensEnv).toBe("2048");
    expect(marker.cwd).toBe(w.cwd);
    expect(await readdir(w.cwd)).toEqual([]);
    expect(w.registrations.map((registration) => registration.phase)).toEqual(["single-call"]);
  }, 30_000);

  it("S2: an aborted call reports what claude streamed before the abort as its observed tokens", async () => {
    const w = await world("usage-then-hang");
    const abort = new AbortController();
    const running = new ClaudeAgentAdapter(w.config).singleCall(w.request({ signal: abort.signal })).then(() => null, (error: unknown) => error);
    await expect.poll(async () => {
      try { return JSON.parse(await readFile(join(await callDir(w.runDir), "observed-usage.json"), "utf8")).openMessage === false; } catch { return false; }
    }, { timeout: 10_000 }).toBe(true);
    abort.abort();
    const error = await running;
    expect(error).toBeInstanceOf(ClaudePhaseAborted);
    expect(observedTokensOf(error)).toBe(1109);
  }, 30_000);

  it("S3: an aborted call that streamed nothing reports no observed tokens, not zero", async () => {
    const w = await world("hang");
    const abort = new AbortController();
    const running = new ClaudeAgentAdapter(w.config).singleCall(w.request({ signal: abort.signal })).then(() => null, (error: unknown) => error);
    await expect.poll(() => w.registrations.length, { timeout: 10_000 }).toBe(1);
    abort.abort();
    const error = await running;
    expect(error).toBeInstanceOf(ClaudePhaseAborted);
    expect(observedTokensOf(error)).toBeNull();
  }, 30_000);

  it("S4: a call that ends without a structured object is single-call-output-invalid and keeps its usage", async () => {
    const w = await world("script", { "single-call": { output: null } });
    const error = await new ClaudeAgentAdapter(w.config).singleCall(w.request()).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(SingleCallOutputInvalid);
    expect(error).toMatchObject({ code: "single-call-output-invalid", tokenUsage: 15 });
  }, 30_000);

  it("S5: stops at the request's time limit when it is shorter than the installation's", async () => {
    const w = await world("hang");
    const startedAt = Date.now();
    await expect(new ClaudeAgentAdapter(w.config).singleCall(w.request({ timeoutMs: 500 }))).rejects.toThrow(/^claude-timeout: /);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 30_000);
});

describe("claude phase runner, single call (Orca single-call estimate)", () => {
  it("R1: starts claude in the request's cwd, not its own, with the cap from the request", async () => {
    const w = await world("script", { "single-call": { output: { answer: "a" } } });
    const elsewhere = join(w.dir, "elsewhere");
    await mkdir(elsewhere);
    const result = await runRunner(elsewhere, w.config.installation.command, { phase: "single-call", prompt: PROMPT, attempt: 1, runDir: w.runDir, cwd: w.cwd, schema: SCHEMA, maxOutputTokens: 7 });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ output: { answer: "a" }, outputError: null, tokenUsage: 15 });
    const marker = JSON.parse(await readFile(w.marker, "utf8"));
    expect(marker.cwd).toBe(w.cwd);
    expect(marker.maxOutputTokensEnv).toBe("7");
  }, 30_000);

  it("R2: gives a plan phase neither --tools nor an output cap", async () => {
    const w = await world("script", {});
    const result = await runRunner(w.cwd, [process.execPath, fakeCli, "ok", w.marker], { phase: "plan", prompt: "Plan one isolated L2 attempt for task t.", attempt: 1, runDir: w.runDir, worktreePath: w.cwd });
    expect(result.code).toBe(0);
    const [argv] = await argvOf(w.marker);
    expect(argv).not.toContain("--tools");
    expect(JSON.parse(await readFile(w.marker, "utf8")).maxOutputTokensEnv).toBeNull();
  }, 30_000);
});
```

- [ ] **Step 2: 跑，确认红**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/runtime/claude/claudeSingleCall.test.ts > "$SCRATCH/t4-red.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc≠0；import 失败（`SingleCallOutputInvalid` 未导出），或 S1–S5 红在 `singleCall is not a function`；R1 红（runner 把 single-call 当 verify 跑，argv 里没有 `--tools`，`cwd` 不对）；R2 绿。

- [ ] **Step 3: 实现 `src/runtime/types.ts`**（加在 `observedTokensOf` 之后；`RuntimeAdapter` 里加一行）

```ts
/**
 * Orca single-call estimate (2026-09-27), spec §5.4: one read-only structured call. The prompt and schema are handed to
 * the agent as they are; the adapter runs it in `cwd` (an empty private directory) and keeps its evidence under runDir.
 */
export type SingleCallRequest = {
  prompt: string;
  responseSchema: Record<string, unknown>;
  maxOutputTokens: number;
  cwd: string;
  runDir: string;
  /** The grant's activeMs; the adapter takes the smaller of this and its installation's timeoutMs. */
  timeoutMs: number;
  signal?: AbortSignal;
  onProcessRegistered?: AttemptContext["onProcessRegistered"];
};

export type SingleCallResult = { output: unknown; tokenUsage: number | null; usageEvidence: unknown };

/** Spec §5.2 item 8: the call ended but gave no structured object. The usage it spent is still carried, never 0 for null. */
export class SingleCallOutputInvalid extends Error {
  readonly code = "single-call-output-invalid" as const;
  constructor(readonly evidenceDir: string, readonly tokenUsage: number | null, readonly usageEvidence: unknown) {
    super(`single-call-output-invalid: ${evidenceDir}`);
    this.name = "SingleCallOutputInvalid";
  }
}
```

`RuntimeAdapter` 接口：

```ts
export interface RuntimeAdapter {
  plan(context: AttemptContext): Promise<AttemptPlan>;
  execute(context: AttemptContext): Promise<ExecutePhaseResult>;
  verify(context: AttemptContext): Promise<VerificationResult>;
  /** Orca single-call estimate (2026-09-27): only a kind whose descriptor answers singleCallExecution "v1" has it. */
  singleCall?(request: SingleCallRequest): Promise<SingleCallResult>;
}
```

- [ ] **Step 4: 实现 `src/runtime/claude/types.ts`**：在 `ClaudePhaseRequest` 联合末尾加：

```ts
  | {
      // Orca single-call estimate (2026-09-27), spec §5.4: the caller's schema and output cap, run in `cwd`.
      phase: "single-call";
      prompt: string;
      attempt: number;
      runDir: string;
      cwd: string;
      schema: Record<string, unknown>;
      maxOutputTokens: number;
    };
```

- [ ] **Step 5: 实现 adapter**（`src/runtime/claude/claudeAgentAdapter.ts`）

import 改为 `import { SingleCallOutputInvalid, type AttemptContext, type AttemptPlan, type ExecutePhaseResult, type ExecutionResult, type RuntimeAdapter, type SingleCallRequest, type SingleCallResult, type VerificationResult } from "../types.js";`。

在 `type Outcome` 之后加：

```ts
/** What one runner call needs from its caller: a phase's AttemptContext, or a single call's request (Orca single-call estimate). */
type ClaudeCall = {
  runDir: string;
  attempt: number;
  cwd: string;
  timeLimitMs: number;
  abortSignal?: AbortSignal;
  onProcessRegistered?: AttemptContext["onProcessRegistered"];
};
```

`run` 的签名改成 `private async run(request: ClaudePhaseRequest, call: ClaudeCall): Promise<Outcome>`，函数体里逐处替换（行号 measured 2026-09-27, re-measure before use）：
- 73 行 `join(context.runDir, "claude", String(context.attempt), phase)` 改成 `join(call.runDir, "claude", String(call.attempt), phase)`
- 88 行 `context.abortSignal?.aborted` 改成 `call.abortSignal?.aborted`
- 89 行 `Math.min(installation.timeoutMs, context.state.budgetSnapshot.timeRemainingMs)` 改成 `Math.min(installation.timeoutMs, call.timeLimitMs)`
- 102 行 `cwd: context.worktreePath` 改成 `cwd: call.cwd`
- 116、153、154 行 `context.abortSignal` 改成 `call.abortSignal`
- 163 行 `context.onProcessRegistered` 改成 `call.onProcessRegistered`

`phase()` 的第一行改为 `const outcome = await this.run(request, this.call(context));`，并在 `base()` 之前加：

```ts
  private call(context: AttemptContext): ClaudeCall {
    return {
      runDir: context.runDir, attempt: context.attempt, cwd: context.worktreePath,
      timeLimitMs: context.state.budgetSnapshot.timeRemainingMs,
      abortSignal: context.abortSignal, onProcessRegistered: context.onProcessRegistered,
    };
  }
```

在 `verify()` 之后加：

```ts
  /**
   * Orca single-call estimate (2026-09-27), spec §5.4: one call with the request's schema, every tool off and the output
   * capped (the runner's single-call branch), registered before its prompt is written, like every phase. An abort
   * carries the usage claude streamed before it; an answer with no structured object carries the usage it spent.
   */
  async singleCall(request: SingleCallRequest): Promise<SingleCallResult> {
    const outcome = await this.run(
      { phase: "single-call", prompt: request.prompt, attempt: 1, runDir: request.runDir, cwd: request.cwd, schema: request.responseSchema, maxOutputTokens: request.maxOutputTokens },
      { runDir: request.runDir, attempt: 1, cwd: request.cwd, timeLimitMs: request.timeoutMs, abortSignal: request.signal, onProcessRegistered: request.onProcessRegistered },
    );
    if (outcome.reason === "aborted") throw new ClaudePhaseAborted(outcome.evidenceDir, await readObservedTokens(join(outcome.evidenceDir, OBSERVED_USAGE_FILE)));
    if (outcome.reason !== "completed") throw new Error(`claude-${outcome.reason}: ${outcome.evidenceDir}`);
    let parsed: unknown;
    try { parsed = JSON.parse(outcome.stdout); } catch { parsed = undefined; }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      await writeFile(join(outcome.evidenceDir, "decode-error.txt"), "runner stdout is not a JSON object", { mode: 0o600 });
      throw new Error(`claude-result-invalid: ${outcome.evidenceDir}`);
    }
    const answer = parsed as { output?: unknown; outputError?: unknown; usageEvidence?: unknown; tokenUsage?: unknown };
    const usageEvidence = answer.usageEvidence ?? null;
    if (usageEvidence !== null) await writeFile(join(outcome.evidenceDir, "usage.json"), JSON.stringify(usageEvidence, null, 2), { mode: 0o600 });
    const tokenUsage = typeof answer.tokenUsage === "number" && Number.isSafeInteger(answer.tokenUsage) && answer.tokenUsage >= 0 ? answer.tokenUsage : null;
    const output = answer.output;
    if (answer.outputError !== null || output === null || typeof output !== "object" || Array.isArray(output)) {
      throw new SingleCallOutputInvalid(outcome.evidenceDir, tokenUsage, usageEvidence);
    }
    return { output, tokenUsage, usageEvidence };
  }
```

- [ ] **Step 6: 实现 runner**（`scripts/claude-phase-runner.mjs`）

`runClaude` 开头的 `const schema = getSchemaForPhase(request.phase);` 与 `spawn(...)` 调用（366–375 行）改为（中间那段 stream-usage 注释原样保留）：

```js
  // Orca single-call estimate (2026-09-27), spec §5.4 and Task 0 item 1 (claude 2.1.283, static): a single call answers
  // the caller's schema with every tool off (`--tools ""`; claude --help: 'Use "" to disable all tools') and its output
  // capped through CLAUDE_CODE_MAX_OUTPUT_TOKENS, in the empty directory the caller gave it. Phases are unchanged.
  const singleCall = request.phase === "single-call";
  const schema = singleCall ? request.schema : getSchemaForPhase(request.phase);
  // (the existing "Orca claude stream usage (2026-09-27), spec §3.1 …" comment stays here verbatim)
  const child = spawn(
    claudeCommand[0],
    [...claudeCommand.slice(1), "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--json-schema", JSON.stringify(schema), ...(singleCall ? ["--tools", ""] : []), ...extraArgs, request.prompt],
    {
      cwd: singleCall ? request.cwd : request.worktreePath,
      env: singleCall ? { ...claudeEnv(), CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(request.maxOutputTokens) } : claudeEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
```

`main()` 里 `const envelope = result.envelope;` 之后、`if (envelope === null)` 之前插入：

```js
    // Orca single-call estimate (2026-09-27), spec §5.2 item 8: an answer with no structured object is reported, not
    // thrown, so the usage claude spent on it is still booked. The caller's schema is claude's to enforce (--json-schema);
    // ccloop carries no JSON Schema validator, and the caller validates what it receives.
    if (request.phase === "single-call") {
      const usageEvidence = envelope === null ? null : buildUsageEvidence(envelope);
      const structured = envelope === null ? undefined : envelope.structured_output;
      const valid = structured !== null && typeof structured === "object" && !Array.isArray(structured);
      await writeJsonToStdout({
        output: valid ? structured : null,
        outputError: valid ? null : "single-call-output-invalid",
        usageEvidence,
        tokenUsage: usageEvidence === null ? null : usageEvidence.normalizedTotal,
      });
      return;
    }
```

- [ ] **Step 7: 跑，确认绿**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/runtime/claude > "$SCRATCH/t4-green.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc=0。既有 `claudeAgentAdapter.test.ts`（plan 的 argv 长度 10）、`claudePhaseRunnerStream.test.ts`、`claudePhaseRunnerEnv.test.ts` 必须仍绿；**有红就停下报控制器**。
Run: `cd /Users/biran/code/skills/loop/ccloop && npm run typecheck > "$SCRATCH/t4-tsc.txt" 2>&1; echo rc=$?`。Expected: rc=0。

- [ ] **Step 8: 提交**

```bash
cd /Users/biran/code/skills/loop/ccloop && git add src/runtime/types.ts src/runtime/claude/types.ts src/runtime/claude/claudeAgentAdapter.ts scripts/claude-phase-runner.mjs tests/runtime/claude/claudeSingleCall.test.ts && git commit -F - <<'EOF'
feat(claude): run one tool-less structured call with an output cap through the phase runner

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**:
- runner 的 `...(singleCall ? ["--tools", ""] : [])` 改成 `...[]` ⇒ S1 红。
- runner 的 `singleCall ? { ...claudeEnv(), CLAUDE_CODE_MAX_OUTPUT_TOKENS: … } : claudeEnv()` 改成 `claudeEnv()` ⇒ S1、R1 红。
- runner 的 `singleCall ? request.schema : getSchemaForPhase(request.phase)` 改成 `getSchemaForPhase(request.phase)` ⇒ S1 红（`--json-schema` 变成 VERIFY_SCHEMA）。
- runner 的 `cwd: singleCall ? request.cwd : request.worktreePath` 改成 `cwd: request.worktreePath` ⇒ R1 红（claude 落在 `elsewhere`）。
- runner 的 `...(singleCall ? ["--tools", ""] : [])` 改成 `"--tools", ""` ⇒ R2 红，外加既有判据 `passes the selected model to the claude CLI and returns the structured answer with its usage` 红（argv 长度 12）。
- runner 的 `const valid = …` 改成 `const valid = true;` ⇒ S4 红（`SingleCallOutputInvalid` 不再被抛出）。
- adapter 的 `timeLimitMs: request.timeoutMs` 改成 `timeLimitMs: Number.MAX_SAFE_INTEGER` ⇒ S5 红。
- adapter `singleCall` 里的 `throw new ClaudePhaseAborted(…, await readObservedTokens(…))` 改成 `throw new ClaudePhaseAborted(outcome.evidenceDir, null)` ⇒ S2 红。

---

### Task 5: worker 的 single-call 分支（`src/control/singleCall.ts`）、collect／inspect、handoff 中止（ccloop）

**Files:**
- Create: `src/control/singleCall.ts`
- Modify: `src/control/worker.ts`（`armRequest` 对 single-call 立刻 abort；把 `onProcessRegistered` 提成一个 const；用分叉替换 T1 的守卫）
- Modify（只加 `export`）: `src/control/handoff.ts` 的 `function identity`、`function candidatePath`
- Create: `tests/control/singleCall.test.ts`

**先读的既有函数**（名字都已现测，全部照用，不另造）：`recordCompletedPhase(sourceDir)`（`stopProof.ts`）、`appendUsageObservation(sourceDir, input)`（`usage.ts`）、`writeEvidence(sourceDir, bytes)`（`evidence.ts`）、`atomicReplacePrivateFile`、`ensurePrivateDirectory`（`paths.ts`）、`sealAcceptedWorker(sourceDir, executionId, nonce)`（`store.ts`）、`readHandoffRequestOptional`、`identity`、`candidatePath`（`handoff.ts`）、`proveStopped`（由 collect／inspect 调，`stopProof.ts`）、worker 内部的 `registerProcess`、`armRequest`、`watcher`、`deadlineTimer`、`observedRequest`、`sealed`、`testCrashPoint("candidate-fsynced")`、`OwnerRecord`（`runtime/types.ts`）。

**Interfaces:**
- Consumes: T1 的 `SingleCallStartEnvelope`、`isLoopEnvelope`；T2 的 `singleCallEnvelope`、`SINGLE_CALL_SCHEMA` helper；T3 的 fake；T4 的 `singleCall`、`SingleCallOutputInvalid`、`ClaudePhaseAborted`／`observedTokensOf`。
- Produces（Orca 读到的就是这些）:
  - `export async function runSingleCall(envelope: SingleCallStartEnvelope, sourceDir: string, config: MaterializedAgentConfigV1, hooks: SingleCallHooks): Promise<void>`
  - `export interface SingleCallHooks { executionId: string; signal: AbortSignal; onProcessRegistered: NonNullable<AttemptContext["onProcessRegistered"]>; settleRequest(): Promise<HandoffRequestV1 | null>; seal(): Promise<void> }`
  - `export const SINGLE_CALL_RECORD_SCHEMA = "ccloop-single-call-record-v1"`；`export interface SingleCallRecordV1 { schema; promptSha256; responseSchemaSha256; outcome: "complete" | "aborted" | "failed"; outputRef: ArtifactRefV1 | null; errorCode: string | null }`
  - 写盘顺序：`run/cwd`（0700，空）→ 调用 →（结束且有结果时）`recordCompletedPhase` →（complete 时）输出 evidence → `work` usage event（observationId `single-call`，`attempts: 1`，`sessions: 1`，tokens 为 null 时 `cumulative: null`）→ 停 watcher → `handoff` 零 usage event（observationId `handoff-<requestId>` 或 `natural-<executionId>`）→ 调用记录 evidence → `run/owner-record.json`（`leaseAffirmedAt: null`）→ `control/candidate.json` → seal。
  - candidate：`result` 取 complete／partial（中止）／failed；`terminalOutcome` 取 `single-call-<outcome>`；`artifacts` 有输出时是 `[输出]`，否则 `[]`；`handoff` 为调用记录；`snapshot: null`；`missing: []`；`unresolvedRequestIds: []`；`checkpointId` 与 `persistHandoffCandidate` 同一个公式；`usageHighWater` 是 handoff event 的 seq。`terminal`（collect 的返回）为 `null`。

- [ ] **Step 1: 写判据** `tests/control/singleCall.test.ts`

```ts
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectExecution, inspectExecution } from "../../src/control/collect.js";
import { readEvidence } from "../../src/control/evidence.js";
import { requestHandoff } from "../../src/control/handoff.js";
import { atomicReplacePrivateFile, ensurePrivateDirectory } from "../../src/control/paths.js";
import { canonicalHash, canonicalJson, type HandoffRequestV1 } from "../../src/control/protocol.js";
import { writeAccepted } from "../../src/control/store.js";
import { runControlWorker } from "../../src/control/worker.js";
import { FAKE_CLAUDE_CLI, claudeInstallation, sealClaude, singleCallEnvelope } from "./agentsFixture.js";

// Orca single-call estimate (2026-09-27), spec §5.2, §5.3 and §8.2 "worker 分支": single-call work runs in the control
// worker without git and is settled like any run -- read back through collect, as Orca reads it. The fake claude CLI
// and its marker live outside sourceDir, so sourceDir holds only what the worker wrote.
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    try {
      for (const registered of JSON.parse(await readFile(join(dir, "control", "processes.json"), "utf8")) as Array<{ pgid: number }>) {
        try { process.kill(-registered.pgid, "SIGKILL"); } catch {}
      }
    } catch {}
    await rm(dir, { recursive: true, force: true });
  }
});

async function world(mode: "script" | "usage-then-hang" | "hang", script: unknown = {}) {
  const sourceDir = await realpath(await mkdtemp(join(tmpdir(), "ccloop-single-call-source-")));
  const aux = await realpath(await mkdtemp(join(tmpdir(), "ccloop-single-call-aux-")));
  dirs.push(sourceDir, aux);
  const marker = join(aux, "marker.json"), scriptPath = join(aux, "script.json");
  await writeFile(scriptPath, JSON.stringify(script));
  const command: [string, ...string[]] = mode === "script" ? [process.execPath, FAKE_CLAUDE_CLI, mode, marker, scriptPath] : [process.execPath, FAKE_CLAUDE_CLI, mode, marker];
  const sealed = await sealClaude(await claudeInstallation(command, { timeoutMs: 60_000, killGraceMs: 300 }));
  const envelope = singleCallEnvelope({ sourceDir, agent: sealed.selection, configHash: sealed.configHash });
  const controlDir = join(sourceDir, "control");
  await ensurePrivateDirectory(sourceDir, controlDir);
  await atomicReplacePrivateFile(sourceDir, join(controlDir, "config.json"), Buffer.from(canonicalJson(sealed.config)));
  await atomicReplacePrivateFile(sourceDir, join(controlDir, "envelope.json"), Buffer.from(canonicalJson(envelope)));
  await writeAccepted(sourceDir, {
    protocol: 1, envelopeHash: canonicalHash(envelope), executionId: "execution-1", configHash: envelope.claim.configHash,
    generation: 1, acceptedAt: new Date().toISOString(), launch: "intended", worker: null,
  });
  const worker = runControlWorker(["--source-dir", sourceDir, "--execution-id", "execution-1", "--nonce", "nonce-1"]);
  return { sourceDir, marker, envelope, worker };
}

/** Every file under root, relative; the random call directory and content-addressed evidence names normalized. */
async function tree(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path); else files.push(relative(root, path));
    }
  };
  await walk(root);
  return files.map((path) => path.replace(/\/call-[^/]+\//, "/call-*/").replace(/evidence-[a-f0-9]{64}\.bin$/, "evidence-*.bin")).sort();
}

const bookedTokens = (events: Array<{ bucket: string; cumulative: { tokens: number } | null }>) =>
  events.map((event) => [event.bucket, event.cumulative?.tokens ?? null]);
const request = (): HandoffRequestV1 => ({ protocol: 1, requestId: "request-1", runId: "run-estimate-1", generation: 1, reason: "human", deadlineAt: new Date(Date.now() + 60_000).toISOString() });
async function waitForClosedObservation(sourceDir: string): Promise<void> {
  const root = join(sourceDir, "run", "claude", "1", "single-call");
  await expect.poll(async () => {
    try {
      const [call] = await readdir(root);
      return JSON.parse(await readFile(join(root, call!, "observed-usage.json"), "utf8")).openMessage === false;
    } catch { return false; }
  }, { timeout: 10_000 }).toBe(true);
}

describe("single-call work through the control worker (Orca single-call estimate)", { timeout: 30_000 }, () => {
  it("W1 + W5: books the call's output, call record, usage and stop proof, and writes nothing else", async () => {
    const w = await world("script", { "single-call": { output: { answer: "forty-two" } } });
    await w.worker;

    // W5, zero-write. Read before collect, whose stop proof writes evidence of its own. No repo/, no worktrees/, no
    // loop files: the call touched git nowhere, and its cwd is still empty.
    expect(await tree(w.sourceDir)).toEqual([
      "control/accepted.json",
      "control/candidate.json",
      "control/config.json",
      "control/envelope.json",
      "control/evidence/evidence-*.bin",
      "control/evidence/evidence-*.bin",
      "control/evidence/evidence-*.bin",
      "control/evidence/evidence-*.bin",
      "control/phases-completed.json",
      "control/processes.json",
      "control/usage.json",
      "run/claude/1/single-call/call-*/observed-usage.json",
      "run/claude/1/single-call/call-*/outcome.json",
      "run/claude/1/single-call/call-*/process.json",
      "run/claude/1/single-call/call-*/request.json",
      "run/claude/1/single-call/call-*/stderr.log",
      "run/claude/1/single-call/call-*/stdout.json",
      "run/claude/1/single-call/call-*/usage.json",
      "run/owner-record.json",
    ]);
    expect(await readdir(join(w.sourceDir, "run", "cwd"))).toEqual([]);
    expect((await stat(join(w.sourceDir, "run", "cwd"))).mode & 0o777).toBe(0o700);
    expect(await readFile(`${w.marker}.calls`, "utf8")).toBe("single-call\n");

    // W1, read back as Orca reads it.
    const collected = await collectExecution(w.envelope, 0);
    expect(collected.terminal).toBeNull();
    expect(bookedTokens(collected.events)).toEqual([["work", 15], ["handoff", 0]]);
    expect(collected.events[0]!.cumulative).toMatchObject({ tokens: 15, attempts: 1, sessions: 1 });
    const candidate = collected.candidate!;
    expect(candidate).toMatchObject({
      runId: "run-estimate-1", taskId: null, result: "complete", terminalOutcome: "single-call-complete",
      usageHighWater: collected.events[1]!.eventSeq, snapshot: null, missing: [], unresolvedRequestIds: [],
    });
    expect(candidate.stopProof).not.toBeNull();
    expect(candidate.artifacts).toHaveLength(1);
    expect(JSON.parse((await readEvidence(w.sourceDir, candidate.artifacts[0]!)).toString("utf8"))).toEqual({ answer: "forty-two" });
    expect(JSON.parse((await readEvidence(w.sourceDir, candidate.handoff)).toString("utf8"))).toEqual({
      schema: "ccloop-single-call-record-v1",
      promptSha256: createHash("sha256").update(w.envelope.work.prompt, "utf8").digest("hex"),
      responseSchemaSha256: createHash("sha256").update(JSON.stringify(w.envelope.work.responseSchema), "utf8").digest("hex"),
      outcome: "complete",
      outputRef: candidate.artifacts[0],
      errorCode: null,
    });
    expect(await inspectExecution(w.envelope)).toMatchObject({ kind: "stopped" });
  });

  it("W2: an answer with no structured object fails the call, keeps its usage and leaves no output artifact", async () => {
    const w = await world("script", { "single-call": { output: null } });
    await w.worker;
    const collected = await collectExecution(w.envelope, 0);
    expect(bookedTokens(collected.events)).toEqual([["work", 15], ["handoff", 0]]);
    expect(collected.candidate).toMatchObject({ result: "failed", terminalOutcome: "single-call-failed", artifacts: [] });
    expect(collected.candidate!.stopProof).not.toBeNull();
    expect(JSON.parse((await readEvidence(w.sourceDir, collected.candidate!.handoff)).toString("utf8"))).toMatchObject({
      outcome: "failed", outputRef: null, errorCode: "single-call-output-invalid",
    });
  });

  it("W3: a handoff request stops the call at once and books what claude streamed before it as the cumulative", async () => {
    const w = await world("usage-then-hang");
    await waitForClosedObservation(w.sourceDir);
    const latched = request();
    const latchedAt = Date.now();
    expect(await requestHandoff(w.envelope, latched)).toEqual({ kind: "latched", requestId: "request-1" });
    await w.worker;
    // Not waited out: the request's deadline is a minute away (spec §5.3).
    expect(Date.now() - latchedAt).toBeLessThan(15_000);
    const collected = await collectExecution(w.envelope, 0);
    expect(bookedTokens(collected.events)).toEqual([["work", 1109], ["handoff", 0]]);
    const candidate = collected.candidate!;
    expect(candidate).toMatchObject({ result: "partial", terminalOutcome: "single-call-aborted", artifacts: [], unresolvedRequestIds: [] });
    expect(candidate.stopProof).not.toBeNull();
    expect(JSON.parse((await readEvidence(w.sourceDir, candidate.handoff)).toString("utf8"))).toMatchObject({ outcome: "aborted", outputRef: null, errorCode: null });
    expect(await requestHandoff(w.envelope, latched)).toEqual({ kind: "complete", requestId: "request-1", checkpointId: candidate.checkpointId });
  });

  it("W4: a call stopped before claude streamed anything books no work usage (null, never 0)", async () => {
    const w = await world("hang");
    await expect.poll(async () => {
      try { return (JSON.parse(await readFile(join(w.sourceDir, "control", "processes.json"), "utf8")) as unknown[]).length; } catch { return 0; }
    }, { timeout: 10_000 }).toBe(1);
    expect(await requestHandoff(w.envelope, request())).toEqual({ kind: "latched", requestId: "request-1" });
    await w.worker;
    const collected = await collectExecution(w.envelope, 0);
    expect(bookedTokens(collected.events)).toEqual([["work", null], ["handoff", 0]]);
    expect(collected.candidate).toMatchObject({ result: "partial", terminalOutcome: "single-call-aborted" });
    expect(collected.candidate!.stopProof).not.toBeNull();
  });
});
```

- [ ] **Step 2: 跑，确认红**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/control/singleCall.test.ts > "$SCRATCH/t5-red.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc≠0。W1、W2 红：worker 抛 `control-work-kind-unsupported`（T1 的守卫），`runControlWorker` reject。W3、W4 红在等待（没有 `observed-usage.json`／`processes.json` 里没有登记），或同样 reject。

- [ ] **Step 3: `src/control/handoff.ts` 只加 export**：`function candidatePath(` 改成 `export function candidatePath(`；`function identity(` 改成 `export function identity(`。

- [ ] **Step 4: 写 `src/control/singleCall.ts`**

```ts
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getDescriptor } from "../agents/registry.js";
import type { MaterializedAgentConfigV1 } from "../agents/types.js";
import { observedTokensOf, SingleCallOutputInvalid, type AttemptContext, type OwnerRecord } from "../runtime/types.js";
import { writeEvidence } from "./evidence.js";
import { candidatePath, identity, type CandidateV1 } from "./handoff.js";
import { atomicReplacePrivateFile, ensurePrivateDirectory } from "./paths.js";
import { canonicalHash, canonicalJson, type ArtifactRefV1, type HandoffRequestV1, type SingleCallStartEnvelope } from "./protocol.js";
import { recordCompletedPhase } from "./stopProof.js";
import { testCrashPoint } from "./testCrashPoint.js";
import { appendUsageObservation } from "./usage.js";

// Orca single-call estimate (2026-09-27), spec docs/superpowers/specs/2026-09-27-single-call-estimate-design.md §5.2 in
// the Orca repository: single-call work is one read-only structured call. It never touches git (no attempt ref, no
// worktree, no result repository); it leaves exactly the files the control lifecycle reads -- processes, the completed
// count, usage, evidence, a released owner record and a candidate -- so accept, inspect, collect, handoff and the stop
// proof treat it like any run.

export const SINGLE_CALL_RECORD_SCHEMA = "ccloop-single-call-record-v1";

export interface SingleCallRecordV1 {
  schema: typeof SINGLE_CALL_RECORD_SCHEMA;
  /** sha256 of the prompt's UTF-8 bytes, so the caller can prove the call ran on the bytes it sent (spec §6.3). */
  promptSha256: string;
  /** sha256 of JSON.stringify(responseSchema) -- the exact string the runner passes to `--json-schema` (controller ruling F10). */
  responseSchemaSha256: string;
  outcome: "complete" | "aborted" | "failed";
  outputRef: ArtifactRefV1 | null;
  errorCode: string | null;
}

export interface SingleCallHooks {
  executionId: string;
  /** Aborted by a handoff request (spec §5.3) or a watcher failure. */
  signal: AbortSignal;
  onProcessRegistered: NonNullable<AttemptContext["onProcessRegistered"]>;
  /** Stops the worker's handoff watcher and answers the request it saw, or one on disk, or null. */
  settleRequest(): Promise<HandoffRequestV1 | null>;
  seal(): Promise<void>;
}

const RESULT = { complete: "complete", aborted: "partial", failed: "failed" } as const;

/** A failure's own code when it has one, else the name its message starts with (claude-timeout, claude-exit-error, ...). */
function errorCodeOf(error: unknown): string {
  const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string") return code;
  return (error instanceof Error ? error.message : String(error)).split(":")[0]!;
}

export async function runSingleCall(
  envelope: SingleCallStartEnvelope,
  sourceDir: string,
  config: MaterializedAgentConfigV1,
  hooks: SingleCallHooks,
): Promise<void> {
  const adapter = getDescriptor(config.kind).createAdapter(config);
  if (adapter.singleCall === undefined) throw new Error("single-call-unsupported");
  const { claim, work } = envelope;
  const runDir = join(sourceDir, "run");
  // Spec §5.2 item 1: an empty private directory is all the agent is given to stand in.
  const cwd = join(runDir, "cwd");
  await ensurePrivateDirectory(sourceDir, cwd);

  const startedAt = Date.now();
  let outcome: SingleCallRecordV1["outcome"];
  let output: unknown = null;
  let tokens: number | null = null;
  let usageEvidence: unknown = null;
  let errorCode: string | null = null;
  let completedWithResult = false;
  try {
    const result = await adapter.singleCall({
      prompt: work.prompt,
      responseSchema: work.responseSchema,
      maxOutputTokens: work.maxOutputTokens,
      cwd,
      runDir,
      timeoutMs: claim.grant.work.activeMs,
      signal: hooks.signal,
      onProcessRegistered: hooks.onProcessRegistered,
    });
    outcome = "complete";
    output = result.output;
    tokens = result.tokenUsage;
    usageEvidence = result.usageEvidence;
    completedWithResult = true;
  } catch (error) {
    outcome = hooks.signal.aborted ? "aborted" : "failed";
    if (outcome === "aborted") {
      // Spec §5.2 item 4: what the agent was observed spending before the stop, or null -- never 0.
      tokens = observedTokensOf(error);
    } else if (error instanceof SingleCallOutputInvalid) {
      // Spec §5.2 item 8: the call ran to its end; its usage is booked, its answer is not an output.
      tokens = error.tokenUsage;
      usageEvidence = error.usageEvidence;
      errorCode = error.code;
      completedWithResult = true;
    } else {
      errorCode = errorCodeOf(error);
    }
  }
  const elapsedMs = Date.now() - startedAt;

  if (completedWithResult) await recordCompletedPhase(sourceDir);
  const outputRef = outcome === "complete" ? await writeEvidence(sourceDir, Buffer.from(canonicalJson(output))) : null;
  await appendUsageObservation(sourceDir, {
    runId: claim.runId,
    generation: claim.generation,
    bucket: "work",
    observationId: "single-call",
    threadTotalTokens: tokens,
    elapsedMs,
    attempts: 1,
    sessions: 1,
    evidence: { phase: "single-call", outcome, errorCode, elapsedMs, tokenUsage: tokens, usageEvidence },
  });

  const request = await hooks.settleRequest();
  const result = RESULT[outcome];
  // As the loop worker does: a mechanical handoff costs nothing, and Orca settles a run only once both buckets are
  // observed (Orca budget.ts hasObservedUsage).
  const handoffUsage = await appendUsageObservation(sourceDir, {
    runId: claim.runId,
    generation: claim.generation,
    bucket: "handoff",
    observationId: request === null ? `natural-${hooks.executionId}` : `handoff-${request.requestId}`,
    threadTotalTokens: 0,
    elapsedMs: 0,
    attempts: 0,
    sessions: 0,
    evidence: { requestId: request?.requestId ?? null, result, mechanical: true },
  });

  const record: SingleCallRecordV1 = {
    schema: SINGLE_CALL_RECORD_SCHEMA,
    promptSha256: createHash("sha256").update(work.prompt, "utf8").digest("hex"),
    // Controller ruling F10 (2026-09-28): the hash of the exact string handed to `--json-schema`, not of a canonical form --
    // ccloop and Orca sort keys differently; Orca sends its canonical bytes, which JSON.parse/stringify keep in order.
    responseSchemaSha256: createHash("sha256").update(JSON.stringify(work.responseSchema), "utf8").digest("hex"),
    outcome,
    outputRef,
    errorCode,
  };
  const handoff = await writeEvidence(sourceDir, Buffer.from(canonicalJson(record)));

  // Spec §5.2 item 7: no lease was ever held, so the owner record is written released; with the sealed worker and the
  // quiet registered group, proveStopped's conditions all hold.
  const now = new Date().toISOString();
  const owner: OwnerRecord = {
    runId: claim.runId,
    logicalSessionId: `${claim.runId}:single-call`,
    currentOwnerEpoch: 1,
    currentProcessInstanceId: hooks.executionId,
    lastAffirmedAt: now,
    ownerStatus: "current",
    supersededByEpoch: null,
    leaseAffirmedAt: null,
  };
  await atomicReplacePrivateFile(sourceDir, join(runDir, "owner-record.json"), Buffer.from(`${JSON.stringify(owner, null, 2)}\n`));

  const candidate: CandidateV1 = {
    ...identity(envelope),
    checkpointId: `checkpoint-${canonicalHash({ handoff, usageHighWater: handoffUsage.eventSeq }).slice(0, 48)}`,
    usageHighWater: handoffUsage.eventSeq,
    result,
    artifacts: outputRef === null ? [] : [outputRef],
    snapshot: null,
    missing: [],
    unresolvedRequestIds: [],
    stopProof: null,
    terminalOutcome: `single-call-${outcome}`,
    handoff,
  };
  await atomicReplacePrivateFile(sourceDir, candidatePath(sourceDir), Buffer.from(`${canonicalJson(candidate)}\n`));
  await testCrashPoint("candidate-fsynced");
  await hooks.seal();
}
```

- [ ] **Step 5: 改 `src/control/worker.ts`**

import：加 `import { runSingleCall } from "./singleCall.js";`（protocol 的 import 已在 T1 带上 `isLoopEnvelope`）。

`armRequest`（126–141 行）的前两行之后插入：

```ts
      // Orca single-call estimate (2026-09-27), spec §5.3: a single call has no phase boundary to stop at, and its run is
      // settled as interrupted whatever the call returns (spec §6.5), so the request stops it now, not at its deadline.
      if (!isLoopEnvelope(envelope)) { phaseAbort.abort(); return; }
```

在 `const runDir = join(sourceDir, "run");` 之前，把 `runLoop` 选项里的 `onProcessRegistered` lambda（167–174 行）提成一个 const，loop 与 single-call 共用：

```ts
    const onProcessRegistered = async (registration: { pid: number; pgid: number; startedAt: string; phase: string }): Promise<void> => {
      await registerProcess(sourceDir, registration);
      const request = await readHandoffRequestOptional(sourceDir);
      if (request !== null) {
        armRequest(request);
        throw new Error("control-handoff-latched-before-prompt");
      }
    };
```

`runLoop` 选项里原来那段 lambda 换成一行 `onProcessRegistered,`。

把 T1 的两行守卫（注释＋`if (!isLoopEnvelope(envelope)) throw new Error("control-work-kind-unsupported");`）换成：

```ts
    if (!isLoopEnvelope(envelope)) {
      // Orca single-call estimate (2026-09-27), spec §5.2: one read-only structured call, forked before anything touches
      // git -- no attempt ref namespace, no worktree, no result repository.
      await runSingleCall(envelope, sourceDir, config, {
        executionId,
        signal: phaseAbort.signal,
        onProcessRegistered,
        settleRequest: async () => {
          watcherStopped = true;
          clearTimeout(deadlineTimer);
          await watcher;
          if (watcherError !== null) throw watcherError;
          return observedRequest ?? await readHandoffRequestOptional(sourceDir);
        },
        seal: async () => {
          await sealAcceptedWorker(sourceDir, executionId, nonce);
          sealed = true;
        },
      });
      return;
    }
```

（`return` 在 `try` 里，`finally` 看到 `sealed === true` 就不再 seal。`runSingleCall` 在 seal 之前抛错的话，走既有的 `catch`（`recordWorkerError`），再由 `finally` seal。）

- [ ] **Step 6: 跑，确认绿**

Run: `cd /Users/biran/code/skills/loop/ccloop && ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run tests/control/singleCall.test.ts tests/control/handoff.test.ts tests/control/handoffDeadlineUsage.test.ts tests/control/claudeHandoffDeadlineUsage.test.ts tests/control/phasesCompleted.test.ts tests/control/handoffEnteredPhases.test.ts tests/control/agentsControl.test.ts tests/control/worker.test.ts tests/control/collect.test.ts > "$SCRATCH/t5-green.txt" 2>&1; echo rc=$?`，整份读回。
Expected: rc=0。loop 的 handoff 与 deadline 判据必须仍绿（`armRequest` 对 loop 的行为没变）。**有红就停下报控制器。**
Run: `cd /Users/biran/code/skills/loop/ccloop && npm run typecheck > "$SCRATCH/t5-tsc.txt" 2>&1; echo rc=$?`。Expected: rc=0。

- [ ] **Step 7: 提交**

```bash
cd /Users/biran/code/skills/loop/ccloop && git add src/control/singleCall.ts src/control/worker.ts src/control/handoff.ts tests/control/singleCall.test.ts && git commit -F - <<'EOF'
feat(control): run single-call work in the worker without touching git, and settle it like any run

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**:
- worker 的分叉整块换成 `if (!isLoopEnvelope(envelope)) throw new Error("control-work-kind-unsupported");` ⇒ W1、W2 红。
- 删掉 `armRequest` 里的 `if (!isLoopEnvelope(envelope)) { phaseAbort.abort(); return; }` ⇒ W3 红（worker 等到 60 s 的 deadline，超过 30 s 的判据时限）；W4 也红。
- `singleCall.ts` 的 `tokens = observedTokensOf(error);` 改成 `tokens = null;` ⇒ W3 红（`["work", null]`）。
- `tokens = observedTokensOf(error);` 改成 `tokens = observedTokensOf(error) ?? 0;` ⇒ W4 红（`["work", 0]`）。
- 删掉 `SingleCallOutputInvalid` 那个 `else if` 分支 ⇒ W2 红（`["work", null]`）。
- `RESULT` 里的 `aborted: "partial"` 改成 `aborted: "failed"` ⇒ W3 红。
- 删掉 handoff 零 usage event 那次 `appendUsageObservation`（`usageHighWater` 改用 work event 的 seq）⇒ W1 红（`events` 只剩一条）。
- 删掉 `if (completedWithResult) await recordCompletedPhase(sourceDir);` ⇒ W5 红（清单里少了 `control/phases-completed.json`）。
- 删掉写 `owner-record.json` 那次 `atomicReplacePrivateFile` ⇒ W1 红（`stopProof` 为 null），W5 也红。
- `const cwd = join(runDir, "cwd");` 改成 `const cwd = runDir;` ⇒ W5 红（`run/cwd` 不存在）。
- `promptSha256` 改成 `canonicalHash(work.prompt)`（对 JSON 字符串求哈希，不是对 UTF-8 字节）⇒ W1 红。
- `artifacts: outputRef === null ? [] : [outputRef]` 改成 `artifacts: outputRef === null ? [handoff] : [outputRef, handoff]` ⇒ W1 红（`toHaveLength(1)`），W2、W3 也红。

---

### Task 6 提示（控制器自己做；ccloop 这边的门）

- 变异：只在 `git clone --local` 副本里做；副本软链 `node_modules`，`npm run build`，HOME 与四个 XDG 根改道；T1–T5 每条 **Mutation** 各跑一次相关文件，记下失败名单；`git checkout -- .` 还原，用 `git diff` 与 `git diff --cached` 的字节数（都为 0）证明还原干净。
- 全量：`vitest run --reporter=json --outputFile="$SCRATCH/ccloop-full.json"`，再 `node scripts/check-known-reds.mjs "$SCRATCH/ccloop-full.json"`，RC 0；`npm run typecheck`、`npm run build` RC 0。**`endToEnd.test.ts` 与 `claudeEndToEnd.test.ts`（S6 名单上的 build 判据）只在这里第一次跑。**
- 孤儿进程：`pgrep -fl "fake-claude-cli|claude-phase-runner|worker.js"`，结果记进台账；要杀先问人。

## 起草时没能落实的判据

- spec §8.2 说要「改写既有的 `command.test.ts` 那条」钉解析应答的判据：**找不到这样一条**（Drafter finding 2），T2 改为新增 C1。
- 零写里「不写 attempt ref」没有单独的 git 断言：single-call 的 envelope 里没有任何仓库路径（T1 的 strict 判据保证），`sourceDir` 下也没有 `repo/`、`worktrees/`（W5 清单保证）。worker 碰不到任何仓库，也就没有 ref 可查。


---

# Part B — Orca

> 草稿作者：计划写作席（会话 `f341f05f` 派出），2026-09-27～28。只读探查，**没有改任何仓库文件、没有跑任何判据**。
> 行号一律「measured 2026-09-27～28 at Orca `1447cd3` / ccloop `8d4d406`，re-measure before use」。
> spec：`docs/superpowers/specs/2026-09-27-single-call-estimate-design.md`；接口名：`scratchpad/plan/contract.md`。

## Drafter findings（spec／契约与真代码对不上的地方；每条都给了选择，需控制器过目）

| # | 问题 | 证据（file:line，见上注） | 本草稿的选择 |
|---|---|---|---|
| F1 | **spec §6.2「A1 同一函数」照原样不可行**：`reserveProviderAttemptInTransaction` 末尾无条件 `readWorkClaimEnvelope(store, groupId, runId)`，读的是 `work:<g>:<run>` 的 `work-claim` 行；估算 run 只有 `estimate:<g>:<estimateId>` 的 `estimate-claim` 行 ⇒ 今天的 A1 对估算 run 抛 `start-intent-missing`，走不到守恒式那一步 | `src/control/webDispatch.ts:384-400`（`readWorkClaimEnvelope` 在 :368-373）；`src/control/webService.ts:356`（`estimate-claim` 行） | 新增 `readEstimateClaimEnvelope`，`reserveProviderAttemptInTransaction` 按 `phase` 取 claim 行；A1 对估算传 `"estimate"`。仍是同一个函数、同一个事务形状 |
| F2 | `portFor` 写死 `router.resolve("task", …)`；估算 run 的 profile 是 estimator 绑定（`executionProfile.workKind: "budget-estimate"`），只允许 `budget-estimate` 的 profile 会被判 `profile-changed` | `src/control/executionDriver.ts:156-158`；`src/control/webService.ts:348` | `portFor` 按 `run.phase` 选 work kind（estimate ⇒ `budget-estimate`） |
| F3 | **spec §4.4「冻结记录逐字段显式写，不带它 ⇒ 不改任何持久化 schema」在两处为假**：两处都把整个 resolution 展开进 `FrozenSlot`，而 `frozenSlotSchema` 是 strict、被持久化进估算记录与执行快照 ⇒ 加上 `singleCallExecution` 后估算记录读回 `recovery-blocked`、confirm 冻结的 reconcile 槽不合 schema | `src/control/agentFreeze.ts:123`（`{ ...resolution, partial, provenance }`）；`src/control/planImport.ts:178`（`{ ...structuredClone(observation.resolution), partial, provenance }`）；`src/control/webProtocol.ts:116-126`（strict） | O1 加 `frozenSlotOf(resolution, partial, provenance)` 逐字段构造，两处改用它；`FrozenSlot extends Omit<AgentResolution, "singleCallExecution">` |
| F4 | spec 的块名 `blockRun("Ce", …)`／步名 `A2e` 不在 `driveStepSchema` 的枚举里（`A1 A2 B B' C D R E`），`RESUME_STATE` 也按这些键 | `src/control/driveRecord.ts:14,74-76` | 估算链沿用 `"A2"`／`"C"` 作 `blockedAt`，reason 用 spec 的字面串（`single-call-prompt-mismatch`、`estimate-usage-unknown`）。`recovery-retry` 语义正好对得上（A2 ⇒ 重新 prepare；C ⇒ 回 accepted 再收） |
| F5 | 「估算 run 无工作区」需要落在 `DriveRecord` 上；`workspacePath` 今天是 `z.string().min(1)`，且 `src/panel/controlViews.ts:157` 用同一 schema 解析 run 的 drive | `src/control/driveRecord.ts:49` | 选 **`workspacePath: z.string().min(1).nullable()`**，估算 run 写 `null`（契约二选一中的前者）。好处：tsc 会点出每一处用到 `workspacePath` 的地方（`executionDriver.ts:223,236,278,529`、`driverHandoff.ts:97`），不会漏 |
| F6 | **spec 没覆盖的竞态**：Ce 在 `await collect` 期间，handoff-stop 可以冻结这个估算 run（它 `active=1`）；随后 `completeEstimate` 把 run 结算为 `settled-restartable`、`active=0`，而请求仍是 `request-pending` ⇒ `stepH` 对 `settled-restartable` 走 `default: return false`，请求永不结算，组永停 `handoff-pending` | `src/control/driverHandoff.ts:65-77`；`src/control/stopIntent.ts:238-249` | `commitTerminal` 在同一事务里复查 `openRequestOf`，有请求就抛 `handoff-request-conflict:estimate-yields-to-handoff`，事务回滚，Ce 返回 false；下一轮 H 以 `settled-restartable` 结算（与 §6.5「已完成的调用仍记 interrupted」一致）。O4 H3 判据钉它 |
| F7 | **Task 0 第 2 项（静态读，O4 第 1 步实测）比 spec §1 说的更宽**：`recoverControl` 在 `driverOwnsWebRuns` 下只跳过 `isWebWorkRun`；估算 run（**任何状态**，包括已经 `settled-restartable` 的完成态）不是 `settled`、没有 `start:` 行 ⇒ 进 `blocked` ⇒ `store.dispatchBlocked = true`。即：只要库里有过一个估算 run，此后每次重启都全局阻塞 | `src/control/recovery.ts:24-32,53` | O4 第 1 步判据同时量「在飞」与「已完成」两种；修法照 spec §6.5.3：`driverOwnsWebRuns` 下跳过 `isEstimateRun`（不论状态） |
| F8 | spec §4.2「assumptions（排序去重）」与 zod 不一致：`budgetEstimateSchema` 的 `assumptions` 是 `orderedUniqueNonemptyStringsSchema`（去重、至少一条，**不要求排序**）；`tasks` 才是 sorted-unique | `src/control/webProtocol.ts:45-48,556,564` | 指令正文要求「去重且升序」（更严，仍被 zod 接受）；`classifyEstimateOutput` 只照 zod 判，不另加排序检查（加了会拒掉 zod 接受的输出，改 zod 不在范围） |
| F9 | 手写 JSON Schema 能用哪些关键字：真 claude 付费跑只验过 `type／properties／required／additionalProperties:false／items／enum／anyOf`（ccloop 的三个阶段 schema）；`"integer"` 未在付费跑里出现过 | ccloop `scripts/claude-phase-runner.mjs:10-73` | 常量只用 `type(object/array/string/integer)／properties／required／additionalProperties:false／items／enum`；数值上下界、hex 形状、非空串、去重、排序全部留给 zod。O2 判据把「JSON Schema 收、zod 拒」的缺口逐条钉成必收／必拒样本，并加「zod 收 ⇒ JSON Schema 必收」的健全性扫 |
| F10 | 两边 canonical JSON 的排序算法不同（ccloop `localeCompare`，Orca code-unit），且 ccloop accept 时会按自己的算法重写 envelope | ccloop `src/control/protocol.ts:195-215`、accept 写 `envelope.json`；Orca `src/control/canonicalJson.ts:57-68` | **控制器裁定（2026-09-28）**：Ce **只比 `promptSha256`**（单个字符串，逐字节可比）；`responseSchemaSha256` 只记作证据、不比对（被篡改的 schema 也过不了 `classifyEstimateOutput` 的 zod）。ccloop 记的是它实际交给 `--json-schema` 的字符串的 sha256 |
| F11 | prompt 里必然含仓库路径：请求的 `planSnapshotCanonicalJson` 带着每个任务的 `originalContractCanonicalJson`，其中有 `context.repoPath` | `src/control/estimator.ts:74-77`；`tests/control/fixtures/ccloopWorld.ts:121` | 不改（这是 Web spec §5.4 的原样字节）。**请控制器转告 ccloop 席**：spec §8.2 的零写判据「envelope 里没有任何仓库路径」只能按「没有仓库路径字段」写，不能做子串扫描 |
| F12 | Web 组视图的估算按 `ORDER BY id` 排（id 是哈希前缀），`view.estimates.at(-1)` 不是最新的 | `src/panel/controlViews.ts:374`；`web/src/BudgetEditor.tsx:102` | 「应用建议」按 `estimateVersion` 最大者判「最新」；既有的 `Re-estimate` 按钮仍用 `at(-1)`（只取 profile／mode，不在范围，登记不修） |
| F13 | `completeEstimate` 是 `WebControlService` 的方法，驱动环的 deps 里没有 service | `src/control/webService.ts:374-420`；`src/control/executionDriver.ts:51-69` | 把方法体原样搬成导出函数 `completeEstimateInStore(deps, …)`，方法委托给它 |
| F14 | 估算预检要读 `observation.resolution`，但 `EstimateInput.observation`／`ImportDeps.estimatorObservation` 的类型是 `Pick<…, "profile"\|"observed"\|"probeFailureCode">`，不含 `resolution`；十处测试桩也不给 | `src/control/estimator.ts:52,98`；`src/control/planImport.ts:43`；桩见 O2 表 | Pick 加上 `"resolution"`（必填），让 tsc 点名每一处桩；桩补一个 `singleCallExecution:"v1"` 的 resolution（保持桩原来的「估算排队」语义），逐条按 S6 登记 |
| F15 | **跨计划依赖**（ccloop 席的命名，本草稿按下列假设写，控制器须对齐）：fake claude 脚本键 `"single-call"`，条目 `{ output, delayMs?: { "single-call": number }, usageBeforeDelay?: boolean }`（控制器 2026-09-28 按 ccloop T3 定稿对齐）；marker 记 `maxOutputTokensEnv`；single-call 正常完成的 usage 取 fake 的 `result.usage`（12＋3＝15）；runner argv 含 `--tools ""` | contract.md「fake claude CLI」一节 | 用到这些的判据：O4 的 E2／E3、O5 的 E1、O7。任何一条与 ccloop 席的定稿不同 ⇒ 改这几行字面量，不改语义 |
| F16 | 顺序硬约束：O1 落地后 Orca 只发 protocol 3，**在 ccloop 侧（只认 3）落地之前，所有真 ccloop E2E 判据都会红** | spec §4.1 S7 | 先落 ccloop 全部任务；Orca 的 E2E 一律用「ccloop 计划最后一笔」的 `git clone --local` build 作 `ORCA_CCLOOP_BIN` |

## Task 0 的三项结论（本席能静态读到的；实测判据在对应任务的第 1 步）

- **第 2 项（在飞估算 ⇒ 重启全局 `dispatchBlocked`）**：静态读为**真**，且范围比 spec 说的大（F7）。证据：`recovery.ts:27` 只 `continue` `isWebWorkRun`；`:31` 只有 `state==="settled"` 才走 `repairAcceptedWork`；估算 run 无 `start:` 行 ⇒ `:32` `blocked.add` ⇒ `:53` `dispatchBlocked = blocked.size>0`。实测判据＝**O4 Step 1**（真 store，`recoverControl(…, {driverOwnsWebRuns:true})`）。预言：两条都红，`blockedRunIds` 等于 `[估算 runId]`、`dispatchBlocked === true`。
- **第 3 项（`provenance:"model"` 的 `proposal-edit` 有无真 store 判据）**：**有两条**，都是真 SQLite store，但估算都是手改 run 状态后结算的，不经驱动环：
  - `tests/control/proposal.test.ts:43` `it("validates explicit model field provenance again at confirmation")`（service 层，`h.store` 来自 `openTestStore`）；
  - `tests/panel/controlApi.test.ts` 约 :58-100 那条（HTTP 路由，断言 `fieldProvenance.tokens` 为 `{provenance:"model", estimateId}`）。
  ⇒ O5 的 E1 补的是「驱动环跑出来的估算」上的同一件事，不重复写 service 层判据。
- **第 4 项（A1 之后守恒式是否成立）**：**今天测不到——A1 在守恒式之前就抛 `start-intent-missing`**（F1）。修掉 F1 之后静态推理为**成立**：
  - A1 只做 `providerAttemptOrdinal += 1`，不动任何数额（`webDispatch.ts:381-383` 的注释与 :396-398 的代码）；
  - `recordUsage` 对每个事件 `delta = cum − run.cumulative`、`released = min(delta, remaining)`、`remaining −= released`、`cumulative = cum`（`usage.ts:29-33`）⇒ 累计单调时恒有 `remaining = max(grant − cumulative, 0)`；
  - `syncWebBudget` 同事务里令 `ledger.committedRemaining = reserved`、`proposal.explicitUnallocatedReserve = balance.reserve`（`budget.ts:67-80`）⇒ `completeEstimate` 的 `readWebGroup` 一致性与 `currentBalance` 两道检查（`webService.ts:396-399`）成立；
  - 事件从 `highWater+1` 连续推进（`usage.ts:23-40`）⇒ 只要 ccloop 的事件 seq 连续，`highWater` 之后无未处理事件。
  实测判据＝**O3 Step 1**（真 store：`stepA1` ＋ `recordUsage` ＋ `completeEstimate`）。**若修 F1 后它仍红在 `recovery-blocked`：停下报人，不改守恒式**（spec §8.1.4）。

## Global Constraints（Orca 侧）

- 仓库 `/Users/biran/code/skills/loop/Orca`。直接在 `main` 上落本地提交；**绝不 push**，不开分支、不删分支、不建 worktree（Rule 15）。多 agent 并行时照 memory「多 agent 时用 worktree 新分支」，由控制器决定。
- 提交信息用 `git commit -F -`，结尾两行：
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` 与 `Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN`（不许拆成两个 `-m`）。
- 每个 shell 块开头先设：`export SCRATCH=<你自己的 scratchpad 绝对路径>` 之后跑 `: "${SCRATCH:?set SCRATCH first}"`。下文命令都带这个护栏；**判据输出一律重定向到 `"$SCRATCH/…txt"`，再用 Read 整份读回**，不许 `| tail`／`| grep`（Rule 14）。
- 单元判据：在 Orca 主树跑 `./node_modules/.bin/vitest run <file>`（web 判据：`cd web && ../node_modules/.bin/vitest run <file>`）。主树不跑全量、不 build。
- **E2E 判据（`tests/control/estimateE2E.test.ts`）需要 ccloop clone**，只在 scratchpad 里建：
  ```bash
  : "${SCRATCH:?set SCRATCH first}"
  git clone --local /Users/biran/code/skills/loop/ccloop "$SCRATCH/ccloop-bin" > "$SCRATCH/ccloop-clone.txt" 2>&1; echo rc=$?
  ln -s /Users/biran/code/skills/loop/ccloop/node_modules "$SCRATCH/ccloop-bin/node_modules"
  (cd "$SCRATCH/ccloop-bin" && npm run build) > "$SCRATCH/ccloop-build.txt" 2>&1; echo rc=$?
  ```
  clone 必须包含 ccloop 计划的**最后一笔**（F16）。这份 clone **只作 `ORCA_CCLOOP_BIN`，不许在里面做变异**（handoff §4.0 教训）。
- 既有判据只在本文**点名**的地方改，每处按人裁 S6：整条改写、不放宽，判据旁注释以 `// Human ruling S6 (2026-09-27, session f341f05f): ` 开头并写明「这条现在编码什么」；每处在台账 `.superpowers/sdd/2026-09-27-single-call-estimate/progress.md` 追加一行 `- REWRITTEN: Orca:<path> > <it 名> — S6 — <现在编码什么>`（台账只追加，Rule 13）。**点名之外的既有判据红了 ⇒ 停下报控制器。**
- 夹具输入的修改（为保持原语义而补字段）同样逐条列进台账，单列一节「夹具改动」给人看（handoff §6.16）。
- Rule 17：判据只写 `mkdtemp` 目录；E2E 照 `relocateHome`。
- 变异只在单独的 `git clone --local` 里做，还原证明看 `git diff`／`git diff --cached` 字节数；变异落没落上去用 `shasum -a 256` 前后比。每条 Mutation 行都要先跑出绿基线。

---

### Task O1: 线协议 3、`singleCallExecution` 兄弟字段、冻结槽逐字段写

**Files:**
- Modify: `src/control/schema.ts`（`startEnvelopeSchema`）
- Modify: `src/control/executionPort.ts`（`StartEnvelope`、新 `LoopWork`／`SingleCallWork`）
- Modify: `src/control/startEnvelope.ts`（`toStartEnvelope` 发 `kind:"loop"`；新 `toSingleCallEnvelope`；抽出 `frozenClaim`）
- Modify: `src/control/dispatch.ts:47-50`（协议检查）
- Modify: `src/control/service.ts:186-188`（legacy 续跑：protocol 3、只接 loop）
- Modify: `src/control/schedulerBridge.ts:161-162`（protocol 3、`kind:"loop"`）
- Modify: `src/control/ccloopPort.ts:32`（`agentResolutionSchema`）
- Modify: `src/control/agentSelection.ts:34-35`（`AgentResolution`、`FrozenSlot`、新 `frozenSlotOf`）
- Modify: `src/control/agentFreeze.ts:123`、`src/control/planImport.ts:178`（改用 `frozenSlotOf`，F3）
- Modify（夹具）：`tests/control/fixtures/agents.ts`、`tests/control/fixtures/store.ts:27`、`tests/control/fixtures/driverPort.ts:66,111`、`tests/control/fixtures/fake-ccloop-control.mjs:29-40`、`tests/control/fixtures/archive.ts:13`、`tests/control/fixtures/crash-worker.mjs:25`
- Modify（S6 改写，见 Step 5 表）
- Create: `tests/control/singleCallWire.test.ts`

**Interfaces:**
- Consumes：无（第一个 Orca 任务）。ccloop 侧须已落地 protocol 3 与解析应答的 `singleCallExecution`（F16）。
- Produces：
  - `executionPort.ts`：`export interface LoopWork { kind: "loop"; contract: unknown; targetRepo: string; base: string; sourceDir: string }`、`export interface SingleCallWork { kind: "single-call"; prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens: number; sourceDir: string }`、`StartEnvelope { protocol: 3; claim; contractHash; inputCheckpoint; work: LoopWork | SingleCallWork }`。
  - `startEnvelope.ts`：`toSingleCallEnvelope(envelope: DispatchEnvelopeV1, run: unknown, work: SingleCallEnvelopeWork): StartEnvelope`，`SingleCallEnvelopeWork = { sourceDir; prompt; responseSchema; maxOutputTokens }`；只接 `phase:"estimate"` 的 dispatch envelope。
  - `agentSelection.ts`：`AgentResolution.singleCallExecution: "v1" | null`；`FrozenSlot extends Omit<AgentResolution, "singleCallExecution">`；`frozenSlotOf(resolution, partial, provenance): FrozenSlot`。
  - `ObservedProfile.resolution` 原样带着 `singleCallExecution`（`profiles.ts:171` 的展开不动）。
  - 夹具：`fixtureResolveAgent(capabilities, { singleCallExecution? })` 默认答 `"v1"`；新 `fixtureResolutionFor(capabilities, singleCallExecution = "v1"): AgentResolution`；`fake-ccloop-control.mjs` 解析应答带 `singleCallExecution: config.singleCallExecution ?? null`，`config.omitSingleCall` 为真时不带该键。

- [ ] **Step 1: 写失败的判据** — 新建 `tests/control/singleCallWire.test.ts`

```ts
import { mkdtemp, readFile, realpath, writeFile, chmod, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { startEnvelopeSchema } from "../../src/control/schema.js";
import { toSingleCallEnvelope, toStartEnvelope } from "../../src/control/startEnvelope.js";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { dispatchEnvelopeSchema } from "../../src/control/webProtocol.js";
import { readEstimateRecord } from "../../src/control/queries.js";
import { readConfirmedReconcileSlot } from "../../src/control/executionSnapshot.js";
import { WebControlService } from "../../src/control/webService.js";
import { webFixture } from "./fixtures/web.js";

// Single-call estimate spec §4.1 (human ruling S7) and §4.4: the start envelope is protocol 3 only, with a loop or a
// single call as its work, and ccloop's single-call capability travels beside -- never inside -- the seven-key view.
const hx = (v: string) => v.repeat(64);
const amount = (n: number) => ({ tokens: n, activeMs: n, attempts: n, sessions: n });
const zero = { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
const claim = {
  groupId: "g", workItemId: "w", taskId: null, runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c",
  configHash: hx("a"), agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }, grant: { work: amount(5), handoff: zero }, ownerToken: "owner",
};
const RESPONSE = { type: "object", properties: {}, required: [], additionalProperties: false };
const loop = { protocol: 3, claim, contractHash: hx("b"), inputCheckpoint: null, work: { kind: "loop", contract: { objective: "ship" }, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" } };
const single = { protocol: 3, claim, contractHash: hx("b"), inputCheckpoint: null, work: { kind: "single-call", prompt: "estimate", responseSchema: RESPONSE, maxOutputTokens: 64_000, sourceDir: "/tmp/src" } };

describe("start envelope protocol 3 (single-call estimate spec §4.1)", () => {
  it("parses a loop and a single call, and nothing else", () => {
    expect(startEnvelopeSchema.safeParse(loop).success).toBe(true);
    expect(startEnvelopeSchema.safeParse(single).success).toBe(true);
    const refused: Array<[string, unknown]> = [
      ["protocol 2, the shape before this round", { ...loop, protocol: 2, work: { contract: { objective: "ship" }, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" } }],
      ["a loop without its kind", { ...loop, work: { contract: {}, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" } }],
      ["an extra key on a loop", { ...loop, work: { ...loop.work, extra: 1 } }],
      ["an extra key on a single call", { ...single, work: { ...single.work, extra: 1 } }],
      ["a single call carrying a contract", { ...single, work: { ...single.work, contract: {} } }],
      ["a response schema whose top is not an object", { ...single, work: { ...single.work, responseSchema: { type: "array" } } }],
      ["no output cap", { ...single, work: { ...single.work, maxOutputTokens: 0 } }],
      ["a single call that resumes a checkpoint", { ...single, inputCheckpoint: { predecessorRunId: "run-0", checkpointId: "cp", checkpointHash: hx("c"), bundlePath: "/tmp/b" } }],
    ];
    for (const [label, value] of refused) expect(startEnvelopeSchema.safeParse(value).success, label).toBe(false);
  });

  it("builds a single-call envelope from an estimate claim: the ledger's contract hash, no checkpoint, the work as given", () => {
    const dispatch = dispatchEnvelopeSchema.parse({
      schema: "orca-dispatch-envelope-v1", phase: "estimate", groupId: "g", workItemId: "w", runId: "run-1", generation: 1, claimIdentity: "estimate:g:w",
      ownerTokenHash: hx("d"), continuationIntentId: null, claimOrdinal: null, derivedContractHash: hx("b"), grants: { work: amount(5), handoff: zero },
      profiles: { estimator: { profileId: "all", profileHash: hx("9") }, worker: null, handoff: null },
    });
    const run = { ...claim, state: "start-pending", estimateId: "w" };
    const built = toSingleCallEnvelope(dispatch, run, { sourceDir: "/tmp/src", prompt: "estimate", responseSchema: RESPONSE, maxOutputTokens: 64_000 });
    expect(built).toEqual(single);
    // A work claim is never turned into a single call.
    const work = dispatchEnvelopeSchema.parse({ ...dispatch, phase: "work", claimOrdinal: 1, profiles: { estimator: null, worker: { profileId: "w", profileHash: hx("9") }, handoff: { profileId: "h", profileHash: hx("9") } } });
    expect(() => toSingleCallEnvelope(work, run, { sourceDir: "/tmp/src", prompt: "estimate", responseSchema: RESPONSE, maxOutputTokens: 64_000 })).toThrow(expect.objectContaining({ code: "start-envelope-conflict", detail: "phase:work" }));
    // And an estimate claim is never turned into a loop.
    expect(() => toStartEnvelope(dispatch, run, { sourceDir: "/tmp/src", targetRepo: "/tmp/repo", base: "v1" }, {})).toThrow(expect.objectContaining({ code: "start-envelope-conflict", detail: "phase:estimate" }));
  });
});

async function peer(extra: Record<string, unknown>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-single-call-wire-")));
  const binary = join(root, "ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), ...extra }), { mode: 0o600 });
  return createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 });
}

describe("singleCallExecution beside the capability view (single-call estimate spec §4.4)", () => {
  it("returns ccloop's answer as given, and refuses an answer without the field", async () => {
    expect((await (await peer({ singleCallExecution: "v1" })).resolveAgent({ agent: "claude" })).singleCallExecution).toBe("v1");
    expect((await (await peer({})).resolveAgent({ agent: "codex" })).singleCallExecution).toBeNull();
    await expect((await peer({ omitSingleCall: true })).resolveAgent({ agent: "codex" })).rejects.toThrow("control-response-invalid");
    // The seven-key view is unchanged: the field is not inside it.
    expect(Object.keys((await (await peer({ singleCallExecution: "v1" })).resolveAgent({ agent: "claude" })).capabilities).sort())
      .toEqual(["budgetEnforcement", "contextObservation", "contextWindowTokens", "handoffControl", "handoffExecution", "requestBoundProof", "usageObservation"]);
  });

  it("never writes it into a frozen slot: not the estimate's (import) and not the reconcile slot (confirm)", async () => {
    const h = await webFixture(); try {
      // planImport.ts froze this slot from a resolution that answered singleCallExecution "v1" (fixtures/agents.ts).
      expect(Object.keys(readEstimateRecord(h.store, "g", h.estimateId).estimatorSlot!).sort())
        .toEqual(["capabilities", "configHash", "killGraceMs", "partial", "provenance", "selection", "timeoutMs"]);
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
      expect(Object.keys(readConfirmedReconcileSlot(h.store, "g")).sort())
        .toEqual(["capabilities", "configHash", "killGraceMs", "partial", "provenance", "selection", "timeoutMs"]);
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: 跑，确认红**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/singleCallWire.test.ts > "$SCRATCH/o1-red.txt" 2>&1; echo rc=$?
```
Expected: rc=1；四条全红：第一条红在 `loop`（protocol 3）解析为 false；第二条红在 `toSingleCallEnvelope is not a function`（导入为 undefined）；第三条红在 `.singleCallExecution` 为 `undefined`（`toBe("v1")`）；第四条**今天是绿的**（夹具还没答 `"v1"`）——它在 Step 3 夹具改动之后、`frozenSlotOf` 之前应当红在 `readEstimateRecord` 抛 `recovery-blocked`（Step 4 核这一点）。

- [ ] **Step 3: 实现**

`src/control/schema.ts` 第 42 行整行换成：

```ts
// Single-call estimate spec §4.1 (human ruling S7): start envelope protocol 3 only. `work` is a loop -- the four fields
// protocol 2 carried, now tagged -- or one single call whose prompt and response schema Orca assembled (spec §4.2).
const loopWorkSchema=z.object({kind:z.literal("loop"),contract:z.unknown(),targetRepo:z.string().min(1),base:z.string().min(1),sourceDir:z.string().min(1)}).strict();
const singleCallWorkSchema=z.object({kind:z.literal("single-call"),prompt:z.string().min(1),responseSchema:z.record(z.unknown()).refine(schema=>schema.type==="object",{message:"response-schema-not-object"}),maxOutputTokens:safeInteger.positive(),sourceDir:z.string().min(1)}).strict();
export const startEnvelopeSchema=z.object({protocol:z.literal(3),claim:z.object({groupId:idSchema,workItemId:idSchema,taskId:idSchema.nullable(),runId:idSchema,generation:safeInteger.positive(),graphVersion:safeInteger,targetVersion:safeInteger,commandId:idSchema,configHash:z.string().min(1),agent:agentSelectionSchema,grant:grantSchema,ownerToken:idSchema}).strict(),contractHash:z.string().regex(/^[a-f0-9]{64}$/),inputCheckpoint:inputCheckpointSchema.nullable(),work:z.discriminatedUnion("kind",[loopWorkSchema,singleCallWorkSchema])}).strict().superRefine((value,ctx)=>{
  // A single call is never resumed (spec §6.5): an interrupted estimate is re-estimated, not continued.
  if(value.work.kind==="single-call"&&value.inputCheckpoint!==null)ctx.addIssue({code:"custom",path:["inputCheckpoint"],message:"single-call-input-checkpoint"});
});
```
（第 41 行注释改为 `// Single-call estimate spec §4.1: StartEnvelopeV3 -- V2's claim, and work tagged as a loop or a single call.`）

`src/control/executionPort.ts` 第 6 行换成：

```ts
/** Single-call estimate spec §4.1: protocol 3's two kinds of work. */
export interface LoopWork { kind:"loop";contract:unknown;targetRepo:string;base:string;sourceDir:string }
export interface SingleCallWork { kind:"single-call";prompt:string;responseSchema:Record<string,unknown>;maxOutputTokens:number;sourceDir:string }
export interface StartEnvelope { protocol:3;claim:Claim;contractHash:string;inputCheckpoint:InputCheckpointV1|null; work:LoopWork|SingleCallWork }
```

`src/control/startEnvelope.ts`：把 `toStartEnvelope` 里 :64-93 的三道检查与 claim 组装抽成：

```ts
/** The checks both translations share (see toStartEnvelope's comment), and the claim built from the run row. */
function frozenClaim(envelope: DispatchEnvelopeV1, run: unknown): { frozen: DispatchEnvelopeV1; claim: StartEnvelope["claim"] } {
  const parsedEnvelope = dispatchEnvelopeSchema.safeParse(envelope);
  if (!parsedEnvelope.success) {
    throw new ControlError("start-envelope-conflict", `schema:${parsedEnvelope.error.issues[0]?.message ?? "invalid"}`);
  }
  const parsedRun = startEnvelopeSourceSchema.safeParse(run);
  if (!parsedRun.success) {
    throw new ControlError("start-envelope-conflict", `run:${parsedRun.error.issues[0]?.path.join(".") || "invalid"}`);
  }
  const source = parsedRun.data;
  const frozen = parsedEnvelope.data;
  if (frozen.runId !== source.runId || frozen.generation !== source.generation
    || frozen.groupId !== source.groupId || frozen.workItemId !== source.workItemId) {
    throw new ControlError("start-envelope-conflict", `identity:${frozen.runId}`);
  }
  return {
    frozen,
    claim: {
      groupId: source.groupId, workItemId: source.workItemId, taskId: source.taskId, runId: source.runId, generation: source.generation,
      graphVersion: source.graphVersion, targetVersion: source.targetVersion, commandId: source.commandId, configHash: source.configHash,
      agent: source.agent, grant: source.grant, ownerToken: source.ownerToken,
    },
  };
}
```

`toStartEnvelope` 的函数体变为：

```ts
  const { frozen, claim } = frozenClaim(envelope, run);
  // Single-call estimate spec §4.1: an estimate claim is one single call, never a loop.
  if (frozen.phase === "estimate") throw new ControlError("start-envelope-conflict", "phase:estimate");
  const built: StartEnvelope = {
    protocol: 3,
    claim,
    // The ledger's derived hash, never one recomputed here: recomputing would let a contract that
    // drifted after the freeze pass as the one the claim was made against.
    contractHash: frozen.derivedContractHash,
    inputCheckpoint,
    work: { kind: "loop", contract, targetRepo: work.targetRepo, base: work.base, sourceDir: work.sourceDir },
  };
  // Parsed against the repository's own start-envelope schema rather than merely typed as one, so
  // that a field this function assembles wrongly is refused here instead of at the peer.
  const checked = startEnvelopeSchema.safeParse(built);
  if (!checked.success) throw new ControlError("start-envelope-conflict", `built:${checked.error.issues[0]?.path.join(".") || "invalid"}`);
  return built;
```

并在文件末尾加：

```ts
export interface SingleCallEnvelopeWork { sourceDir: string; prompt: string; responseSchema: Record<string, unknown>; maxOutputTokens: number }

/**
 * Single-call estimate spec §4.1, §6.2 (A2 of an estimate run): the same claim and the same ledger contract hash as
 * toStartEnvelope, and one single call as the work -- the prompt and response schema Orca assembled, handed to ccloop
 * byte for byte (Web spec §5.4). Never a checkpoint: an estimate is not resumed.
 */
export function toSingleCallEnvelope(envelope: DispatchEnvelopeV1, run: unknown, work: SingleCallEnvelopeWork): StartEnvelope {
  const { frozen, claim } = frozenClaim(envelope, run);
  if (frozen.phase !== "estimate") throw new ControlError("start-envelope-conflict", `phase:${frozen.phase}`);
  const built: StartEnvelope = {
    protocol: 3, claim, contractHash: frozen.derivedContractHash, inputCheckpoint: null,
    work: { kind: "single-call", prompt: work.prompt, responseSchema: work.responseSchema, maxOutputTokens: work.maxOutputTokens, sourceDir: work.sourceDir },
  };
  const checked = startEnvelopeSchema.safeParse(built);
  if (!checked.success) throw new ControlError("start-envelope-conflict", `built:${checked.error.issues[0]?.path.join(".") || "invalid"}`);
  return built;
}
```

`src/control/dispatch.ts:50` 换成 `if(input.protocol!==3||input.work.kind!=="loop") throw new ControlError("control-protocol-unavailable");`（legacy 路径只跑 loop）。

`src/control/service.ts:186-188`：在 `const previous=…` 之后加 `if(previous.work.kind!=="loop")throw new ControlError("start-envelope-conflict","work-kind");`，第 188 行的字面量改为 `{protocol:3,claim,…,work:{kind:"loop",contract:work.contract,targetRepo:previous.work.targetRepo,base:previous.work.base,sourceDir}}`。

`src/control/schedulerBridge.ts:161-162`：`input:StartEnvelope={protocol:3,…,work:{kind:"loop",contract,targetRepo:await realpath(plan.targetRepo),base,sourceDir:join(root,claim.runId)}}`。

`src/control/ccloopPort.ts:32` 在 `capabilities:capabilityViewSchema` 之后加 `,singleCallExecution:z.enum(["v1"]).nullable()`，并在 :29-30 的注释后补一行：`// Single-call estimate spec §4.4: a selection's resolution also answers singleCallExecution, beside the view, never in it.`

`src/control/agentSelection.ts:34-35` 换成：

```ts
/** Single-call estimate spec §4.4: `singleCallExecution` sits beside the seven-key view, like timeoutMs/killGraceMs. */
export interface AgentResolution { selection: AgentSelection; configHash: string; timeoutMs: number; killGraceMs: number; capabilities: CapabilityViewV1; singleCallExecution: "v1" | null }
/** What confirmation and import freeze; `singleCallExecution` is never frozen (spec §4.4: no persisted schema changes). */
export interface FrozenSlot extends Omit<AgentResolution, "singleCallExecution"> { partial: PartialSelection; provenance: Record<Field, ProvenanceSource> }

/**
 * Single-call estimate spec §4.4 (drafter finding F3): a frozen slot is written field by field, so a field ccloop adds
 * to its resolution never reaches frozenSlotSchema (strict), the estimate record or the execution snapshot.
 */
export function frozenSlotOf(resolution: AgentResolution, partial: PartialSelection, provenance: Record<Field, ProvenanceSource>): FrozenSlot {
  return {
    selection: resolution.selection, configHash: resolution.configHash, timeoutMs: resolution.timeoutMs,
    killGraceMs: resolution.killGraceMs, capabilities: resolution.capabilities, partial, provenance,
  };
}
```

`src/control/agentFreeze.ts:123`：`const frozen: FrozenSlot = frozenSlotOf(resolution, partial, descriptorProvenance(partial, resolution.selection, provenance));`（import 加 `frozenSlotOf`）。
`src/control/planImport.ts:178`：`return { outcome: { kind: "frozen", partial, slot: frozenSlotOf(structuredClone(observation.resolution), partial, labelled) }, observation };`（import 加 `frozenSlotOf`）。

夹具：
- `tests/control/fixtures/agents.ts:24-33`：签名加 `singleCallExecution?: "v1" | null`，返回对象加 `singleCallExecution: options.singleCallExecution === undefined ? "v1" : options.singleCallExecution`；文件末尾加

```ts
/**
 * Single-call estimate spec §4.4: the stand-in's answer for the fixture agent, as a value, for an injected observation
 * (the synchronous imports' `estimatorObservation`). "v1" by default: these fixtures' estimates queue, as they did
 * before the single-call gate existed.
 */
export function fixtureResolutionFor(capabilities: CapabilityViewV1, singleCallExecution: "v1" | null = "v1"): AgentResolution {
  return {
    selection: { agent: FIXTURE_AGENT_ID, model: FIXTURE_DEFAULT_MODELS[FIXTURE_AGENT_ID]!, contextWindow: "agent-default" },
    configHash: sha256Canonical({}), timeoutMs: 120_000, killGraceMs: 5_000, capabilities, singleCallExecution,
  };
}
```
- `tests/control/fixtures/store.ts:27` `resolvedAs` 返回对象加 `singleCallExecution:"v1"`。
- `tests/control/fixtures/driverPort.ts:111` 返回对象加 `singleCallExecution: "v1"`；:66 前加 `if (work.kind !== "loop") throw new Error("driverPort: loop work only");`。
- `tests/control/fixtures/fake-ccloop-control.mjs:29-30`：注释改为 protocol 3，`envelopeOk` 改为 `if (input?.protocol !== 3) refuse("control-protocol-unsupported"); if (input.work?.kind !== "loop" && input.work?.kind !== "single-call") refuse("control-request-invalid"); if (input.claim?.agent === undefined) refuse("control-request-invalid"); return true;`；:40 的解析应答改为 `value = { protocol:3,selection,configHash:config.configHash ?? "d".repeat(64),timeoutMs:120000,killGraceMs:5000,capabilities:config.capabilities ?? view, ...(config.omitSingleCall ? {} : { singleCallExecution: config.singleCallExecution ?? null }) };`（默认 `null`：这个替身冒充的是 codex，真 ccloop 对 codex 答 null）。
- `tests/control/fixtures/archive.ts:13`、`tests/control/fixtures/crash-worker.mjs:25`：信封字面量 `protocol:2` → `protocol:3`，`work:{…}` → `work:{kind:"loop",…}`。

- [ ] **Step 4: 核 F3 的红（中间态）**

在做 `frozenSlotOf` 两处替换**之前**、夹具已答 `"v1"` 之后，单跑第四条：

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/singleCallWire.test.ts -t "never writes it into a frozen slot" > "$SCRATCH/o1-f3-red.txt" 2>&1; echo rc=$?
```
Expected: rc=1，红在 `readEstimateRecord` 抛 `recovery-blocked`（或 import 本身被拒）。**若是绿 ⇒ F3 的前提不成立，停下报控制器。** 然后做两处替换。

- [ ] **Step 5: S6 改写既有判据（逐条；只动点名的行）**

| 文件:行 | 所在 `it`（或 helper） | 改成 |
|---|---|---|
| `tests/control/startEnvelope.test.ts:53` | `copies the claim from the run row and the contract hash from the ledger, field by field` | `expect(built.protocol).toBe(3);` |
| `tests/control/startEnvelope.test.ts:64` | 同上 | `expect(built.work).toEqual({ kind: "loop", contract, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" });` |
| `tests/control/ccloopPort.test.ts:21` | helper `fixture()`（文件内每个用 `envelope` 的 `it`） | `protocol:3`，`work:{kind:"loop",…}` |
| `tests/control/ccloopPort.test.ts:157` | `asks capabilities about exactly the given selection and returns ccloop's resolution without the protocol tag` | `toEqual` 对象末尾加 `singleCallExecution:null`（替身默认值，=真 ccloop 对 codex 的答案） |
| `tests/control/webCcloopSmoke.test.ts:216` | `refuses an envelope that is not V2 and reads a well-formed one as no execution yet`（真 ccloop） | 信封改 `protocol: 3`、`work: { kind: "loop", … }`；**`it` 名改为 `…that is not V3…`** |
| `tests/control/webCcloopSmoke.test.ts:237` | 同上 | `port.inspect({ ...envelope, protocol: 2 as 3 })` 仍期望 `control-peer-exit:2:control-protocol-unsupported`（外来版本现在是 2，编码的仍是「非本协议即拒」） |
| `tests/control/ccloopPortMissingTable.test.ts:53` | `still inspects and collects an accepted run, and capabilities is refused as agents-table-invalid` | `protocol: 3`，`work: { kind: "loop", … }` |
| `tests/control/projectionJournal.test.ts:107` | `projects claim, starting, and accepted run/work transitions once per transaction` | 同上 |
| `tests/control/projectionJournal.test.ts:128` | `projects starting and unknown run transitions without changing authority` | 同上 |
| `tests/control/dispatch.test.ts:12` | helper `setup`（文件内全部 `it`） | 同上 |
| `tests/control/handoffTransaction.test.ts:18` | helper `started`（文件内全部 `it`） | 同上 |
| `tests/control/legacyAgentRouting.test.ts:101` | `requests a handoff after asking about the handed-off run's selection, not the handoff item's` | 同上 |
| `tests/control/ccloopProtocol.integration.test.ts:59` | `accepts, accounts, commits a handoff, resumes a dirty snapshot, and collects a fresh execution`（真 ccloop） | 同上 |
| `tests/control/profiledService.test.ts:94` | 信封 helper（文件内用到它的全部 `it`） | 同上 |
| `tests/control/executionDriver.test.ts:64` | `builds the workspace at orca/<group>'s tip and stores the rewritten envelope, leaving the person's checkout alone` | 断言前加 `if (envelope.work.kind !== "loop") throw new Error("loop expected");`（类型收窄，断言不变） |
| `tests/control/driverContinuation.test.ts:69` | `keeps its predecessor's base though the tip moved, carries the checkpoint, is cut to the remaining grant, and lands` | 同上 |
| `tests/control/planImport.test.ts:109` | helper `setup` | resolution 字面量加 `singleCallExecution: "v1" as const`（tsc 强制） |

不需要改的（登记理由）：`tests/control/capabilitySchema.test.ts:21`、`tests/control/webFaults.test.ts:277`、`fake-ccloop-control.mjs:35` 说的是 **capabilities** 的旧 protocol 2，与信封无关；`tests/control/unconfiguredPort.test.ts:42` 是 `as never` 的占位，端口在读信封之前就抛。

普查（落地前后各跑一次，结果写进台账）：

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && rg -n "protocol: ?2\b|\"protocol\": ?2\b" src tests scripts web/src web/tests > "$SCRATCH/o1-census.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/o1-tsc.txt" 2>&1; echo rc=$?
```
Expected（落地后）：普查只剩 `capabilitySchema.test.ts:21`、`webFaults.test.ts:277`、`fake-ccloop-control.mjs:35`、`unconfiguredPort.test.ts:42`、`webCcloopSmoke.test.ts` 那条故意喂 2 的外来版本；tsc rc=0。tsc 若点出本表之外缺 `singleCallExecution` 的 resolution 字面量（测试夹具）⇒ 补 `singleCallExecution: "v1"`，并**逐条补进本表与台账**。

- [ ] **Step 6: 跑，确认绿**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/singleCallWire.test.ts tests/control/startEnvelope.test.ts tests/control/ccloopPort.test.ts tests/control/dispatch.test.ts tests/control/handoffTransaction.test.ts tests/control/legacyAgentRouting.test.ts tests/control/projectionJournal.test.ts tests/control/profiledService.test.ts tests/control/executionDriver.test.ts tests/control/driverContinuation.test.ts tests/control/planImport.test.ts tests/control/agentFreeze.test.ts tests/control/estimator.test.ts tests/control/archive.test.ts > "$SCRATCH/o1-green.txt" 2>&1; echo rc=$?
```
Expected: rc=0，`singleCallWire.test.ts` 4 条全绿，其余文件与改写前同数通过。真 ccloop 的三个文件（`webCcloopSmoke`、`ccloopProtocol.integration`、`ccloopPortMissingTable`）另用 clone 跑：

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ORCA_CCLOOP_BIN="$SCRATCH/ccloop-bin/dist/cli.js" ./node_modules/.bin/vitest run tests/control/webCcloopSmoke.test.ts tests/control/ccloopProtocol.integration.test.ts tests/control/ccloopPortMissingTable.test.ts > "$SCRATCH/o1-real.txt" 2>&1; echo rc=$?
```
Expected: rc=0，0 skipped（skipped ≠ 0 说明 `ORCA_CCLOOP_BIN` 没生效）。

- [ ] **Step 7: 提交**

```bash
cd /Users/biran/code/skills/loop/Orca && git add src/control/schema.ts src/control/executionPort.ts src/control/startEnvelope.ts src/control/dispatch.ts src/control/service.ts src/control/schedulerBridge.ts src/control/ccloopPort.ts src/control/agentSelection.ts src/control/agentFreeze.ts src/control/planImport.ts tests/control && git commit -F - <<'EOF'
feat(control): speak start envelope protocol 3 and read ccloop's single-call capability beside the seven keys

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**（每条在独立 clone 里，先跑绿基线）：
- M-O1a：`schema.ts` 的 superRefine 删掉 `if(value.work.kind==="single-call"&&…)` 那行 ⇒ 红在 `parses a loop and a single call, and nothing else` 且仅它（label `a single call that resumes a checkpoint`）。
- M-O1b：`toSingleCallEnvelope` 删掉 `if (frozen.phase !== "estimate")` ⇒ 红在 `builds a single-call envelope…` 且仅它（`phase:work` 那句）。
- M-O1c：`toStartEnvelope` 删掉 `if (frozen.phase === "estimate")` ⇒ 红在同一条（`phase:estimate` 那句）。
- M-O1d：`agentResolutionSchema` 的 `singleCallExecution` 改成 `.optional()` ⇒ 红在 `returns ccloop's answer as given…` 且仅它（`omitSingleCall` 那句不再被拒）。
- M-O1e：`planImport.ts:178` 改回 `{ ...structuredClone(observation.resolution), partial, provenance: labelled }` ⇒ 红在 `never writes it into a frozen slot`（第一处 `Object.keys`，或 `webFixture` 导入即 `recovery-blocked`），另有依赖 `readEstimateRecord` 的既有判据同红（记名单，不预言数量）。
- M-O1f：`agentFreeze.ts:123` 改回展开 ⇒ 红在同一条的第二段（confirm 被拒或 reconcile 槽多键）。

---

### Task O2: 估算指令 v1、手写 JSON Schema、整条 prompt 计数、single-call 闸与三个 reasonCode

**Files:**
- Create: `src/control/estimatePrompt.ts`
- Modify: `src/control/estimator.ts`（`EstimateInput`、`buildBudgetEstimateRequest`、`estimateCapabilityDegraded`、`validateEstimateOutput` → `classifyEstimateOutput`）
- Modify: `src/control/planImport.ts:43-45`（`estimatorObservation` 类型、`exactTokenCount` 形参名）
- Modify: `src/control/webService.ts:7,401-409`（`completeEstimate` 写三个 reasonCode）
- Create: `tests/control/estimatePrompt.test.ts`、`tests/control/estimateSchema.test.ts`、`tests/control/estimateOutcome.test.ts`
- Modify（S6 改写，Step 6 表）

**Interfaces:**
- Consumes: O1 的 `AgentResolution.singleCallExecution`、`fixtureResolutionFor`。
- Produces（O3 起依赖）：
  - `estimatePrompt.ts`：`ESTIMATE_INSTRUCTIONS: Readonly<Record<string, string>>`（键 `"1"`）、`buildEstimatePrompt(instructionVersion: string, requestCanonicalJson: string): string`（未知版本抛 `recovery-blocked`，detail `estimate-instruction-unknown:<v>`）、`BUDGET_ESTIMATE_JSON_SCHEMA: Readonly<Record<string, unknown>>`。
  - `estimator.ts`：`classifyEstimateOutput(value: unknown, planHash: string, taskIds: string[]): { ok: true; output: BudgetEstimateV1 } | { ok: false; reasonCode: "estimate-call-failed" | "estimate-output-invalid" | "estimate-output-plan-mismatch" }`；`EstimateInput.observation: Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode" | "resolution">`；`estimateCapabilityDegraded(request, observation /* 同上 Pick */, mode)`；`readEstimateContract(store, groupId, estimateId): EstimateExecutionContractV1`（从 `estimate-contract` 行读冻结合同，O3 用）。

- [ ] **Step 1: 写失败的判据 A** — `tests/control/estimatePrompt.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { buildBudgetEstimateRequest, estimateCapabilityDegraded } from "../../src/control/estimator.js";
import { BUDGET_ESTIMATE_JSON_SCHEMA, ESTIMATE_INSTRUCTIONS, buildEstimatePrompt } from "../../src/control/estimatePrompt.js";
import { resolveProfile } from "../../src/control/profiles.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { profileSnapshot } from "./fixtures/web.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";

// Single-call estimate spec §4.2: the prompt is the instruction, a blank line and the request's canonical bytes, and
// the input tokens the preflight checks are that whole prompt's, in both tokenizer branches (review I2).
const contract = { objective: { taskId: "a", goal: "ship" } };
const plan = {
  schema: "orca-control-plan-v1", repoId: "repo", planId: "plan", goal: "ship", successConditions: ["passes"],
  tasks: [{ taskId: "a", dependencyTaskIds: [], targetVersion: 1, originalContractHash: sha256Canonical(contract), originalContractCanonicalJson: canonicalBytes(contract).toString("utf8") }],
};
const planCanonicalJson = canonicalBytes(plan).toString("utf8");
const planHash = sha256Canonical(plan);
const observe = (snapshot: ExecutionProfileSnapshotV1, singleCallExecution: "v1" | null | "no-resolution" = "v1") => {
  const profile = resolveProfile(snapshot);
  return { profile, observation: { profile, observed: snapshot.profile.capabilities, probeFailureCode: null,
    resolution: singleCallExecution === "no-resolution" ? null : fixtureResolutionFor(snapshot.profile.capabilities, singleCallExecution) } };
};
const exactSnapshot = (): ExecutionProfileSnapshotV1 => {
  const snapshot = profileSnapshot();
  snapshot.profile.estimatorPreflight = { ...snapshot.profile.estimatorPreflight!, tokenizer: { kind: "exact", tokenizerId: "tok", tokenizerVersion: "1" } };
  snapshot.resolved.tokenizerArtifactHashes = [{ purpose: "estimator", contentHash: "d".repeat(64) }];
  return snapshot;
};

describe("the estimate prompt (single-call estimate spec §4.2)", () => {
  it("is the v1 instruction, one blank line, then the request bytes exactly", () => {
    expect(buildEstimatePrompt("1", "{\"x\":1}")).toBe(`${ESTIMATE_INSTRUCTIONS["1"]}\n\n{"x":1}`);
    expect(ESTIMATE_INSTRUCTIONS["1"]!.endsWith("\n")).toBe(false);
    // The instruction names the output contract it will be checked against.
    for (const text of ["budget-estimate-v1", "planHash", "goalReviewReserve", "groupRationale", "assumptions", "\"S\"", "\"XL\"", "\"low\"", "\"high\"", "9007199254740991"]) {
      expect(ESTIMATE_INSTRUCTIONS["1"]).toContain(text);
    }
    expect(() => buildEstimatePrompt("2", "{}")).toThrow(expect.objectContaining({ code: "recovery-blocked", detail: "estimate-instruction-unknown:2" }));
  });

  it("counts the whole prompt under the utf8 upper bound", () => {
    const { profile, observation } = observe(profileSnapshot());
    const result = buildBudgetEstimateRequest({ planHash, planCanonicalJson, profile, observation, mode: "soft" });
    expect(result.state).toBe("queued");
    const requestBytes = canonicalBytes(result.request).length;
    const promptBytes = Buffer.byteLength(ESTIMATE_INSTRUCTIONS["1"]!) + 2 + requestBytes;
    expect(result.inputTokens).toBe(Math.ceil(promptBytes * 2 / 3) + 17);
    expect(result.requiredRequestTokens).toBe(Math.ceil(promptBytes * 2 / 3) + 17 + 64_000);
    // Not the request alone: the instruction is material (more than 500 tokens of it).
    expect(result.inputTokens! - (Math.ceil(requestBytes * 2 / 3) + 17)).toBeGreaterThan(500);
  });

  it("hands the exact tokenizer the whole prompt's bytes", () => {
    const snapshot = exactSnapshot();
    const { profile, observation } = observe(snapshot);
    const counted: Buffer[] = [];
    const exactTokenCount = vi.fn((_profile: unknown, bytes: Buffer) => { counted.push(bytes); return 4_321; });
    const result = buildBudgetEstimateRequest({ planHash, planCanonicalJson, profile, observation, mode: "soft", exactTokenCount });
    expect(counted).toHaveLength(1);
    expect(counted[0]!.toString("utf8")).toBe(`${ESTIMATE_INSTRUCTIONS["1"]}\n\n${canonicalBytes(result.request).toString("utf8")}`);
    expect(result.inputTokens).toBe(4_321 + 17);
  });

  it("is blocked-capability for an instruction version Orca does not know", () => {
    const snapshot = profileSnapshot();
    snapshot.profile.estimatorPreflight = { ...snapshot.profile.estimatorPreflight!, instructionVersion: "2" };
    const { profile, observation } = observe(snapshot);
    expect(buildBudgetEstimateRequest({ planHash, planCanonicalJson, profile, observation, mode: "soft" }))
      .toMatchObject({ state: "blocked-capability", reasonCode: "estimate-blocked-capability", request: null });
  });

  it("is blocked-capability unless ccloop answers singleCallExecution v1, and a claim degrades the same way", () => {
    const snapshot = profileSnapshot();
    const queued = buildBudgetEstimateRequest({ planHash, planCanonicalJson, ...observe(snapshot, "v1"), mode: "soft" });
    expect(queued.state).toBe("queued");
    for (const answer of [null, "no-resolution"] as const) {
      expect(buildBudgetEstimateRequest({ planHash, planCanonicalJson, ...observe(snapshot, answer), mode: "soft" }), String(answer))
        .toMatchObject({ state: "blocked-capability", reasonCode: "estimate-blocked-capability" });
      expect(estimateCapabilityDegraded(queued.request!, observe(snapshot, answer).observation, "soft"), String(answer)).toBe(true);
    }
    expect(estimateCapabilityDegraded(queued.request!, observe(snapshot, "v1").observation, "soft")).toBe(false);
  });
});
```

注：`resolveProfile(snapshot)` 用的是 profile 的 `unboundPort`（`profiles.ts:121`），`buildBudgetEstimateRequest` 不碰端口；它只比较 `observation.profile.profileHash === profile.profileHash`，两者同一对象。

- [ ] **Step 2: 写失败的判据 B** — `tests/control/estimateSchema.test.ts`（JSON Schema 常量 vs zod；仓库没有 ajv，不加依赖：`package.json` 只有 `express`、`zod`）

```ts
import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { BUDGET_ESTIMATE_JSON_SCHEMA } from "../../src/control/estimatePrompt.js";
import { budgetEstimateSchema } from "../../src/control/webProtocol.js";

// Single-call estimate spec §6.2: the hand-written JSON Schema ccloop hands the model, judged against the zod schema
// the answer is finally checked with. Drafter finding F9: the constant uses only the keywords real claude has already
// taken (ccloop's phase schemas), so this file interprets exactly those -- and first proves nothing else is used.
type Schema = Record<string, unknown>;
const KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "items", "enum"]);
const nodes = (schema: Schema, path = "#"): Array<[string, Schema]> => {
  const out: Array<[string, Schema]> = [[path, schema]];
  for (const [key, child] of Object.entries((schema.properties ?? {}) as Record<string, Schema>)) out.push(...nodes(child, `${path}/${key}`));
  if (schema.items) out.push(...nodes(schema.items as Schema, `${path}/items`));
  return out;
};
function accepts(schema: Schema, value: unknown): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  switch (schema.type) {
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "array": return Array.isArray(value) && value.every((item) => accepts(schema.items as Schema, item));
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      const properties = schema.properties as Record<string, Schema>, record = value as Record<string, unknown>;
      if ((schema.required as string[]).some((key) => !Object.hasOwn(record, key))) return false;
      if (schema.additionalProperties === false && Object.keys(record).some((key) => !Object.hasOwn(properties, key))) return false;
      return Object.entries(record).every(([key, item]) => properties[key] === undefined || accepts(properties[key]!, item));
    }
    default: throw new Error(`unsupported type ${String(schema.type)}`);
  }
}
const zodAccepts = (value: unknown) => budgetEstimateSchema.safeParse(value).success;
const jsonAccepts = (value: unknown) => accepts(BUDGET_ESTIMATE_JSON_SCHEMA as Schema, value);

const amount = { tokens: 1_000, activeMs: 60_000, attempts: 1, sessions: 1 };
const task = { taskId: "a", complexity: "M", confidence: "high", work: amount, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, rationale: "one module", assumptions: ["clean tree"] };
const valid = { schema: "budget-estimate-v1", planHash: "a".repeat(64), tasks: [task], goalReviewReserve: amount, groupRationale: "one task" };
const without = <T extends Record<string, unknown>>(value: T, key: string) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));

/** Refused by both: what the schema expresses. */
const BOTH_REJECT: Array<[string, unknown]> = [
  ...Object.keys(valid).map((key): [string, unknown] => [`no top-level ${key}`, without(valid, key)]),
  ...Object.keys(task).map((key): [string, unknown] => [`a task without ${key}`, { ...valid, tasks: [without(task, key)] }]),
  ...Object.keys(amount).map((key): [string, unknown] => [`work without ${key}`, { ...valid, tasks: [{ ...task, work: without(amount, key) }] }]),
  ["an extra top-level key", { ...valid, extra: 1 }],
  ["an extra task key", { ...valid, tasks: [{ ...task, extra: 1 }] }],
  ["an extra amount key", { ...valid, goalReviewReserve: { ...amount, extra: 1 } }],
  ["another schema version", { ...valid, schema: "budget-estimate-v2" }],
  ["a complexity outside S..XL", { ...valid, tasks: [{ ...task, complexity: "XXL" }] }],
  ["a confidence outside low..high", { ...valid, tasks: [{ ...task, confidence: "certain" }] }],
  ["tokens as a string", { ...valid, tasks: [{ ...task, work: { ...amount, tokens: "1" } }] }],
  ["a fractional amount", { ...valid, goalReviewReserve: { ...amount, activeMs: 1.5 } }],
  ["tasks as an object", { ...valid, tasks: {} }],
  ["assumptions as a string", { ...valid, tasks: [{ ...task, assumptions: "clean tree" }] }],
  ["planHash as a number", { ...valid, planHash: 1 }],
];
/** Refused by zod only: the gap the constant leaves to the final check, pinned so it is visible. */
const ZOD_ONLY: Array<[string, unknown]> = [
  ["a negative amount", { ...valid, tasks: [{ ...task, work: { ...amount, tokens: -1 } }] }],
  ["an amount past MAX_SAFE_INTEGER", { ...valid, goalReviewReserve: { ...amount, tokens: 9_007_199_254_740_992 } }],
  ["a planHash that is not 64 hex", { ...valid, planHash: "z".repeat(64) }],
  ["an empty rationale", { ...valid, tasks: [{ ...task, rationale: "" }] }],
  ["an empty groupRationale", { ...valid, groupRationale: "" }],
  ["no assumptions", { ...valid, tasks: [{ ...task, assumptions: [] }] }],
  ["an assumption twice", { ...valid, tasks: [{ ...task, assumptions: ["x", "x"] }] }],
  ["tasks out of taskId order", { ...valid, tasks: [{ ...task, taskId: "b" }, task] }],
  ["a taskId that is not an id", { ...valid, tasks: [{ ...task, taskId: "not an id" }] }],
];

describe("BUDGET_ESTIMATE_JSON_SCHEMA against budgetEstimateSchema (single-call estimate spec §6.2)", () => {
  it("uses only the keywords this file interprets, requires every property, and closes every object", () => {
    for (const [path, node] of nodes(BUDGET_ESTIMATE_JSON_SCHEMA as Schema)) {
      for (const key of Object.keys(node)) expect(KEYWORDS.has(key), `${path}: ${key}`).toBe(true);
      if (node.type === "object") {
        expect(node.additionalProperties, path).toBe(false);
        expect([...(node.required as string[])].sort(), path).toEqual(Object.keys(node.properties as Schema).sort());
      }
    }
    expect((BUDGET_ESTIMATE_JSON_SCHEMA as Schema).type).toBe("object");
  });

  it("accepts a valid estimate on both sides", () => {
    expect(zodAccepts(valid)).toBe(true);
    expect(jsonAccepts(valid)).toBe(true);
  });

  it.each(BOTH_REJECT)("refuses on both sides: %s", (_label, value) => {
    expect(zodAccepts(value)).toBe(false);
    expect(jsonAccepts(value)).toBe(false);
  });

  it.each(ZOD_ONLY)("is left to zod: %s", (_label, value) => {
    expect(zodAccepts(value)).toBe(false);
    expect(jsonAccepts(value)).toBe(true);
  });

  it("never refuses what zod accepts", () => {
    for (const [label, value] of [["valid", valid], ...BOTH_REJECT, ...ZOD_ONLY] as Array<[string, unknown]>) {
      if (zodAccepts(value)) expect(jsonAccepts(value), label).toBe(true);
    }
  });

});
```

- [ ] **Step 3: 写失败的判据 C** — `tests/control/estimateOutcome.test.ts`（三个 reasonCode；§6.4）

```ts
import { describe, expect, it } from "vitest";
import { classifyEstimateOutput } from "../../src/control/estimator.js";
import { readArchivedPlan, readEstimateRecord } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { webFixture } from "./fixtures/web.js";

// Single-call estimate spec §6.4: a failed estimate says why -- the call gave nothing, the answer is not
// budget-estimate-v1, or it is but for another plan. Before this round every one of them was plan-version-conflict.
const amount = { tokens: 100, activeMs: 100, attempts: 1, sessions: 1 };
const task = { taskId: "a", complexity: "M", confidence: "high", work: amount, handoff: { tokens: 0, activeMs: 100, attempts: 0, sessions: 0 }, rationale: "small", assumptions: ["clean tree"] };
const output = (planHash: string, patch: Record<string, unknown> = {}) => ({ schema: "budget-estimate-v1", planHash, tasks: [task], goalReviewReserve: amount, groupRationale: "small", ...patch });

describe("classifying an estimate's raw output (single-call estimate spec §6.4)", () => {
  it("names each reason by its own code", () => {
    const planHash = "a".repeat(64);
    expect(classifyEstimateOutput(null, planHash, ["a"])).toEqual({ ok: false, reasonCode: "estimate-call-failed" });
    expect(classifyEstimateOutput({ schema: "budget-estimate-v1" }, planHash, ["a"])).toEqual({ ok: false, reasonCode: "estimate-output-invalid" });
    expect(classifyEstimateOutput(output("b".repeat(64)), planHash, ["a"])).toEqual({ ok: false, reasonCode: "estimate-output-plan-mismatch" });
    expect(classifyEstimateOutput(output(planHash, { tasks: [{ ...task, taskId: "b" }] }), planHash, ["a"])).toEqual({ ok: false, reasonCode: "estimate-output-plan-mismatch" });
    expect(classifyEstimateOutput(output(planHash), planHash, ["a"])).toEqual({ ok: true, output: output(planHash) });
  });

  it.each([
    ["a call that returned nothing", () => null, "estimate-call-failed"],
    ["an answer that is not budget-estimate-v1", () => ({ schema: "budget-estimate-v1" }), "estimate-output-invalid"],
    ["a schema-valid answer that is not canonical JSON", (planHash: string) => output(planHash, { tasks: [{ ...task, work: { ...amount, tokens: -0 } }] }), "estimate-output-invalid"],
    ["an answer for another plan", () => output("f".repeat(64)), "estimate-output-plan-mismatch"],
    ["an answer about other tasks", (planHash: string) => output(planHash, { tasks: [{ ...task, taskId: "b" }] }), "estimate-output-plan-mismatch"],
  ] as const)("fails the estimate with its reason: %s", async (_label, raw, reasonCode) => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps), run = await service.claimEstimate("g", h.estimateId);
      const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(run!.runId)!.body));
      row.state = "settled-restartable";
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), run!.runId);
      service.completeEstimate("g", h.estimateId, raw(readArchivedPlan(h.store, "g").planHash));
      expect(readEstimateRecord(h.store, "g", h.estimateId)).toMatchObject({ state: "failed", reasonCode, output: null, outputHash: null });
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 4: 跑，确认红**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/estimatePrompt.test.ts tests/control/estimateSchema.test.ts tests/control/estimateOutcome.test.ts > "$SCRATCH/o2-red.txt" 2>&1; echo rc=$?
```
Expected: rc=1。`estimatePrompt`／`estimateSchema` 两个文件整份红在 `Failed to resolve import "../../src/control/estimatePrompt.js"`（**这是「模块加载失败」，不算这些判据被看见红**：Step 7 之后逐条用变异补红证）；`estimateOutcome` 的 `classifying…` 红在 `classifyEstimateOutput is not a function`，五条 `it.each` 红在 `reasonCode` 为 `"plan-version-conflict"`（`-0` 那条同样是 `plan-version-conflict`）。

- [ ] **Step 5: 实现**

新建 `src/control/estimatePrompt.ts`：

```ts
import { ControlError } from "./errors.js";

/**
 * Single-call estimate spec §4.2: the estimator's instruction, by the profile's `instructionVersion`. The prompt ccloop
 * hands the model is this text, one blank line, and the estimate request's canonical bytes -- assembled here and
 * nowhere else, so ccloop never rebuilds it (Web spec §5.4). The text tells the model the exact output contract of
 * `budgetEstimateSchema` (webProtocol.ts); changing either means a new instruction version, never an edit of "1".
 */
const INSTRUCTION_V1 = [
  "You are estimating the budget of a plan of software tasks before any of them runs. You cannot run, open, edit or inspect anything: you have no tools, and everything you may use is in the request below. Answer with one JSON object and nothing else.",
  "",
  "## The request",
  "",
  "After this instruction, separated from it by one blank line, comes one JSON object whose \"schema\" is \"budget-estimate-request-v1\". Its fields:",
  "- \"planHash\": the identity of the plan. Copy it into your answer exactly.",
  "- \"planSnapshotCanonicalJson\": a JSON document encoded as a string. Parse it. Its \"goal\" and \"successConditions\" describe the whole plan. Its \"tasks\" array lists the tasks in their order; each task has a \"taskId\", its \"dependencyTaskIds\", and \"originalContractCanonicalJson\": the task's contract, itself a JSON document encoded as a string (its objective, the paths it may change, its execution policy and how it is verified).",
  "- \"estimatorCapabilities.contextWindowTokens\": the context window, in tokens, of the agent that will do the work.",
  "- Every other field identifies this request. Ignore them.",
  "",
  "## What to estimate",
  "",
  "For each task, estimate what one agent will spend to finish it, as four whole numbers:",
  "- \"tokens\": every model token the task will consume, input and output, over every call and every attempt;",
  "- \"activeMs\": the wall-clock milliseconds the agent will be actively working;",
  "- \"attempts\": how many attempts the task will need;",
  "- \"sessions\": how many agent sessions it will need.",
  "Give two such amounts for each task: \"work\", for doing the task, and \"handoff\", for writing down where it stands if it is interrupted partway (usually a small part of work; its attempts and sessions may be 0).",
  "Give one more amount, \"goalReviewReserve\", for a single review of the finished plan against its goal and success conditions.",
  "Rate each task's \"complexity\" as one of \"S\", \"M\", \"L\", \"XL\", and your \"confidence\" in its numbers as one of \"low\", \"medium\", \"high\".",
  "Explain each task's numbers in \"rationale\" (one or two sentences) and list the facts you assumed in \"assumptions\". Explain the plan as a whole in \"groupRationale\".",
  "A person will read these numbers as advice and may apply them to the plan's budget. Estimate honestly: do not pad them to be safe and do not cut them to look cheap.",
  "",
  "## The answer",
  "",
  "Answer with exactly this object, with no other key at any level:",
  "{",
  "  \"schema\": \"budget-estimate-v1\",",
  "  \"planHash\": the request's planHash, unchanged,",
  "  \"tasks\": one entry for each task of the plan, in the same order as the plan's \"tasks\" array, none added and none left out, each",
  "    { \"taskId\": the task's taskId, unchanged,",
  "      \"complexity\": \"S\" | \"M\" | \"L\" | \"XL\",",
  "      \"confidence\": \"low\" | \"medium\" | \"high\",",
  "      \"work\": { \"tokens\": n, \"activeMs\": n, \"attempts\": n, \"sessions\": n },",
  "      \"handoff\": { \"tokens\": n, \"activeMs\": n, \"attempts\": n, \"sessions\": n },",
  "      \"rationale\": a non-empty string,",
  "      \"assumptions\": [ non-empty strings ] },",
  "  \"goalReviewReserve\": { \"tokens\": n, \"activeMs\": n, \"attempts\": n, \"sessions\": n },",
  "  \"groupRationale\": a non-empty string",
  "}",
  "",
  "The answer is checked against these rules, and an answer that breaks any one of them is discarded whole:",
  "- every n is a whole number from 0 to 9007199254740991, with no fraction, no exponent and no minus sign;",
  "- \"assumptions\" has at least one entry, no entry appears twice, and the entries are sorted in ascending order by character code;",
  "- every string is non-empty;",
  "- \"planHash\" and every \"taskId\" are copied exactly, and \"tasks\" keeps the plan's order.",
].join("\n");

export const ESTIMATE_INSTRUCTIONS: Readonly<Record<string, string>> = Object.freeze({ "1": INSTRUCTION_V1 });

/** Spec §4.2: instruction, "\n\n", request bytes. An unknown version never reaches here (the preflight blocks it). */
export function buildEstimatePrompt(instructionVersion: string, requestCanonicalJson: string): string {
  if (!Object.hasOwn(ESTIMATE_INSTRUCTIONS, instructionVersion)) throw new ControlError("recovery-blocked", `estimate-instruction-unknown:${instructionVersion}`);
  return `${ESTIMATE_INSTRUCTIONS[instructionVersion]}\n\n${requestCanonicalJson}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const amount = (): Record<string, unknown> => ({
  type: "object",
  properties: { tokens: { type: "integer" }, activeMs: { type: "integer" }, attempts: { type: "integer" }, sessions: { type: "integer" } },
  required: ["tokens", "activeMs", "attempts", "sessions"],
  additionalProperties: false,
});

/**
 * Spec §6.2 (controller decision, accepted by the human): `budget-estimate-v1` as a hand-written JSON Schema, the
 * response schema of the single call. Drafter finding F9: only the keywords real claude has already taken (type,
 * properties, required, additionalProperties false, items, enum); bounds, hex shapes, non-empty strings, uniqueness and
 * order are left to budgetEstimateSchema, which the answer is checked with afterwards (classifyEstimateOutput).
 * estimateSchema.test.ts pins both what this refuses and what it leaves to zod.
 */
export const BUDGET_ESTIMATE_JSON_SCHEMA: Readonly<Record<string, unknown>> = deepFreeze({
  type: "object",
  properties: {
    schema: { type: "string", enum: ["budget-estimate-v1"] },
    planHash: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          complexity: { type: "string", enum: ["S", "M", "L", "XL"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          work: amount(),
          handoff: amount(),
          rationale: { type: "string" },
          assumptions: { type: "array", items: { type: "string" } },
        },
        required: ["taskId", "complexity", "confidence", "work", "handoff", "rationale", "assumptions"],
        additionalProperties: false,
      },
    },
    goalReviewReserve: amount(),
    groupRationale: { type: "string" },
  },
  required: ["schema", "planHash", "tasks", "goalReviewReserve", "groupRationale"],
  additionalProperties: false,
});
```

`src/control/estimator.ts`：
- import 加 `import { ESTIMATE_INSTRUCTIONS, buildEstimatePrompt } from "./estimatePrompt.js";`、`import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";`（替换原 `writeCanonicalRecord` 单独导入）、`type EstimateExecutionContractV1` 已在。
- :52 与 :98 的 `Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode">` 改为 `Pick<ObservedProfile, "profile" | "observed" | "probeFailureCode" | "resolution">`；:54 `exactTokenCount?: (profile: FrozenProfile, promptBytes: Buffer) => number;`。
- :71 的 `if` 改为（其余子句原样）：

```ts
  // Single-call estimate spec §4.4: the estimate runs as one ccloop single call, so ccloop must answer v1 for this
  // selection (a failed probe has no resolution); spec §4.2: and Orca must hold the instruction the profile names.
  if (observation.probeFailureCode !== null || !preflight || observation.resolution?.singleCallExecution !== "v1"
    || !Object.hasOwn(ESTIMATE_INSTRUCTIONS, preflight.instructionVersion)
    || observed.contextWindowTokens === null || observed.handoffControl !== "durable" || observed.handoffExecution === null
```
- :78-88 换成：

```ts
  const requestHash = sha256Canonical(request);
  // Spec §4.2 (review I2): both branches count the whole prompt ccloop hands the model -- instruction, blank line and
  // request bytes -- not the request alone.
  const promptBytes = Buffer.from(buildEstimatePrompt(preflight.instructionVersion, canonicalBytes(request).toString("utf8")), "utf8");
  let serialized: bigint;
  if (preflight.tokenizer.kind === "exact") {
    if (!input.exactTokenCount) return { ...blocked, request, requestHash };
    const count = input.exactTokenCount(profile, promptBytes);
    if (!Number.isSafeInteger(count) || count < 0) throw new ControlError("numeric-overflow");
    serialized = BigInt(count);
  } else {
    const { numerator, denominator } = preflight.tokenizer;
    serialized = (BigInt(promptBytes.length) * BigInt(numerator) + BigInt(denominator) - 1n) / BigInt(denominator);
  }
```
- :98-108 `estimateCapabilityDegraded` 的 `return` 前加一个子句：`observation.probeFailureCode !== null || observation.resolution?.singleCallExecution !== "v1" || current.contextWindowTokens === null || …`（其余原样）。
- :109-113 `validateEstimateOutput` 整个删掉，换成：

```ts
export type EstimateOutputClass =
  | { ok: true; output: BudgetEstimateV1 }
  | { ok: false; reasonCode: "estimate-call-failed" | "estimate-output-invalid" | "estimate-output-plan-mismatch" };
/** Single-call estimate spec §6.4: why an estimate failed, by its own code (it used to borrow plan-version-conflict). */
export function classifyEstimateOutput(value: unknown, planHash: string, taskIds: string[]): EstimateOutputClass {
  if (value === null) return { ok: false, reasonCode: "estimate-call-failed" };
  const parsed = budgetEstimateSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reasonCode: "estimate-output-invalid" };
  if (parsed.data.planHash !== planHash || parsed.data.tasks.map(task => task.taskId).join("\0") !== taskIds.join("\0")) {
    return { ok: false, reasonCode: "estimate-output-plan-mismatch" };
  }
  return { ok: true, output: parsed.data };
}

/** The contract an estimate was queued under (persistEstimateArtifacts wrote it); its instruction version and output cap drive the call. */
export function readEstimateContract(store: ControlStore, groupId: string, estimateId: string): EstimateExecutionContractV1 {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='estimate-contract'").get(`estimate-contract:${groupId}:${estimateId}`);
  if (!row) throw new ControlError("recovery-blocked", `estimate-contract-missing:${estimateId}`);
  const { contractHash } = JSON.parse(String(row.body)) as { contractHash: string };
  return estimateExecutionContractSchema.parse(JSON.parse(readCanonicalRecord(store, contractHash)));
}
```

`src/control/planImport.ts:43` 同样加 `"resolution"`；:45 形参名 `canonicalRequestBytes` → `promptBytes`。

`src/control/webService.ts`：:7 的 import 把 `validateEstimateOutput` 换成 `classifyEstimateOutput`；:401-409 换成：

```ts
      // Single-call estimate spec §6.4: a failed estimate carries its own reason. A schema-valid answer that is not
      // canonical JSON (a lone surrogate, a negative zero) cannot be hashed, so it is an invalid answer too.
      const classified = classifyEstimateOutput(rawOutput, plan.planHash, plan.plan.tasks.map(t => t.taskId));
      let output: BudgetEstimateV1 | null = null, outputHash: string | null = null;
      let reasonCode: string | null = classified.ok ? null : classified.reasonCode;
      if (classified.ok) {
        try { outputHash = sha256Canonical(classified.output); output = classified.output; }
        catch (error) { if (!(error instanceof ControlError)) throw error; reasonCode = "estimate-output-invalid"; }
      }
      estimate.state = output ? "ready" : "failed"; estimate.output = output; estimate.outputHash = outputHash; estimate.reasonCode = reasonCode;
```
（`BudgetEstimateV1` 从 `./webProtocol.js` 以 `type` 导入；其后的 `if (output) writeCanonicalRecord(…, estimate.outputHash!, …)` 不动。）

- [ ] **Step 6: S6 改写与夹具补 resolution**

| 文件:行 | 所在 `it`（或 helper） | 改成 | 类别 |
|---|---|---|---|
| `tests/control/estimator.test.ts:32-34` | `freezes exact input formula, contract constants, and checks later degradation` | `const serialized = Math.ceil((Buffer.byteLength(ESTIMATE_INSTRUCTIONS["1"]!) + 2 + canonicalBytes(result.request).length) * 2 / 3);`，:33-34 两句不动；上方注释 `// Human ruling S6 (2026-09-27, session f341f05f): the input formula counts the whole prompt ccloop hands the model -- the v1 instruction, a blank line and the request bytes (single-call estimate spec §4.2) -- not the request alone.`；import 加 `ESTIMATE_INSTRUCTIONS` | 判据改写 |
| `tests/control/fixtures/web.ts:88` | `webFixture` | `estimatorObservation: () => ({ profile: frozen, observed, probeFailureCode: null, resolution: prepared.observation.resolution })` | 夹具 |
| `tests/panel/controlLifecycle.test.ts:44` | helper `shutdownHarness` | 桩加 `resolution: fixtureResolutionFor(profileSnapshot().profile.capabilities)` | 夹具 |
| `tests/panel/controlReadApi.test.ts:125` | 文件内 helper | 桩加 `resolution: fixtureResolutionFor(selected.snapshot.profile.capabilities)` | 夹具 |
| `tests/panel/fixtures/controlPanel.ts:156` | helper | 同上 | 夹具 |
| `tests/control/planImport.test.ts:339` | `persists a terminal %s preflight without a scheduler wake` | 桩加 `resolution: fixtureResolutionFor(observed)` | 夹具 |
| `tests/control/planImport.test.ts:422` | 崩溃点 `it.each` 的 deps | 桩加 `resolution: fixtureResolutionFor(selected.snapshot.profile.capabilities)` | 夹具 |
| `tests/control/agentPlanImport.test.ts:119` | `refuses an import whose operator layers changed after the estimator slot was resolved` | 桩加 `resolution: fixtureResolutionFor(h.frozen.snapshot.profile.capabilities)` | 夹具 |
| `tests/control/webFaults.test.ts:81` | `dies before the import commit with nothing booked, and the identical command then imports once` | 同上 | 夹具 |
| `tests/control/webFaults.test.ts:249` | `applies a cross-group shutdown to every group or to none, and an epoch replays it once` | 同上 | 夹具 |

每处夹具改动的注释：`// Single-call estimate spec §4.4: the injected observation carries ccloop's resolution, which answers singleCallExecution "v1", so this estimate queues exactly as before the single-call gate.`（夹具不是判据，不写 S6；照 Global Constraints 列进台账「夹具改动」）。
不改的、已核过的：`tests/control/fixtures/ccloopWorld.ts` 的 `startGroup:221`／`agentSelectionE2E.test.ts:75` 断言导入为 `blocked-capability`——真 ccloop 对 codex 答 `singleCallExecution: null`、`contextWindowTokens: null`，结论不变；`estimator.test.ts:36-43` 与 `:68-78` 的退化判据用的是真 router 探测（fixture 答 `"v1"`），只靠 handoff 两条子句拦，不变。

- [ ] **Step 7: 跑，确认绿**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/estimatePrompt.test.ts tests/control/estimateSchema.test.ts tests/control/estimateOutcome.test.ts tests/control/estimator.test.ts tests/control/planImport.test.ts tests/control/agentPlanImport.test.ts tests/control/webFaults.test.ts tests/control/proposal.test.ts tests/panel/controlLifecycle.test.ts tests/panel/controlReadApi.test.ts tests/panel/controlApi.test.ts > "$SCRATCH/o2-green.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/o2-tsc.txt" 2>&1; echo rc=$?
```
Expected: rc=0 两次；新增三个文件全绿，其余文件通过数与改写前相同。

- [ ] **Step 8: 提交**

```bash
cd /Users/biran/code/skills/loop/Orca && git add src/control/estimatePrompt.ts src/control/estimator.ts src/control/planImport.ts src/control/webService.ts tests/control tests/panel && git commit -F - <<'EOF'
feat(control): write the v1 estimate instruction and its JSON Schema, count the whole prompt, and gate on single-call

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**（独立 clone，先绿基线）：
- M-O2a：`buildBudgetEstimateRequest` 里 `promptBytes` 换回 `canonicalBytes(request)`（utf8 分支） ⇒ 红在 `counts the whole prompt under the utf8 upper bound` 与 `estimator.test.ts` 的 `freezes exact input formula…`，且仅这两条。
- M-O2b：exact 分支传 `canonicalBytes(request)` ⇒ 红在 `hands the exact tokenizer the whole prompt's bytes` 且仅它。
- M-O2c：删掉 `!Object.hasOwn(ESTIMATE_INSTRUCTIONS, preflight.instructionVersion)` 子句 ⇒ 红在 `is blocked-capability for an instruction version Orca does not know`（`buildEstimatePrompt` 抛 `recovery-blocked` ⇒ 断言对象不符），且仅它。
- M-O2d：删掉预检的 `singleCallExecution !== "v1"` 子句 ⇒ 红在 `is blocked-capability unless ccloop answers…`（前两句），且仅它。
- M-O2e：删掉 `estimateCapabilityDegraded` 的同名子句 ⇒ 红在同一条（`estimateCapabilityDegraded(...)` 那句），且仅它。
- M-O2f：`classifyEstimateOutput` 删掉 `if (value === null)` ⇒ 红在 `names each reason…` 首句与 it.each `a call that returned nothing`。
- M-O2g：plan-mismatch 分支返回 `"estimate-output-invalid"` ⇒ 红在 `names each reason…` 与 it.each 的两条 plan 行。
- M-O2h：`webService.ts` 的 `catch` 里删掉 `reasonCode = "estimate-output-invalid"` ⇒ 红在 it.each `…not canonical JSON` 且仅它（reasonCode 为 null）。
- M-O2i：`BUDGET_ESTIMATE_JSON_SCHEMA` 的任务 `required` 去掉 `"work"` ⇒ 红在 `refuses on both sides: a task without work` 与 `uses only the keywords…`（required≠properties），且仅这两条。
- M-O2j：金额 `amount()` 的 `additionalProperties` 改 `true` ⇒ 红在 `uses only the keywords…` 与 `refuses on both sides: an extra amount key`。

---

### Task O3: 驱动估算 run（A1 无工作区、A2e、Ce、结算）

**Files:**
- Modify: `src/control/webDispatch.ts`（`isEstimateRun`、`readEstimateClaimEnvelope`；`reserveProviderAttemptInTransaction` 按 phase 取 claim 行）
- Modify: `src/control/driveRecord.ts:49`（`workspacePath` 可空）
- Modify: `src/control/executionDriver.ts`（`newDrive`、`stepA1`、`portFor`、`driverRunIds`、`advance`、新 `stepA2Estimate`／`stepCEstimate`；`stepA2`／`cleanupPredecessor`／`stepE` 的类型收窄）
- Modify: `src/control/webService.ts`（`completeEstimate` 方法体搬成 `completeEstimateInStore`）
- Create: `tests/control/driverEstimate.test.ts`

**Interfaces:**
- Consumes: O1 `toSingleCallEnvelope`、`SingleCallWork`；O2 `buildEstimatePrompt`、`BUDGET_ESTIMATE_JSON_SCHEMA`、`readEstimateContract`、`classifyEstimateOutput`（经 `completeEstimate`）。
- Produces（O4／O5 依赖）：
  - `webDispatch.ts`：`isEstimateRun(store, runId): boolean`（`phase==="estimate"` 且 `estimate:<g>:<workItemId>` 的 `estimate-claim` 行存在、其 `runId` 是这个 run）；`readEstimateClaimEnvelope(store, groupId, runId): DispatchEnvelopeV1`；`reserveProviderAttemptInTransaction(store, runId, "estimate")` 可用。
  - `executionDriver.ts`：`stepA2Estimate(deps, runId): Promise<boolean>`、`stepCEstimate(deps, runId): Promise<boolean>`；估算 run 的 `drive.workspacePath === null`；块名 `"A2"`／`"C"`，reason `single-call-prompt-mismatch`、`estimate-usage-unknown`（F4）；`commitTerminal` 在有未结请求时抛 `handoff-request-conflict`，detail `estimate-yields-to-handoff`（F6）。
  - `webService.ts`：`completeEstimateInStore(deps: { store: ControlStore; admissionGate?: AdmissionGate }, groupId, estimateId, rawOutput: unknown, commitTerminal?: () => void): void`。

- [ ] **Step 1: 先量 Task 0 第 4 项** — 新建 `tests/control/driverEstimate.test.ts`，先只放这一条

```ts
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { ControlError } from "../../src/control/errors.js";
import { BUDGET_ESTIMATE_JSON_SCHEMA, buildEstimatePrompt } from "../../src/control/estimatePrompt.js";
import { createExecutionDriver, driverRunIds, stepA1, type ExecutionDriverDeps } from "../../src/control/executionDriver.js";
import type { ExecutionPort, ExecutionReport, StartEnvelope } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readArchivedPlan, readEstimateRecord } from "../../src/control/queries.js";
import { recordUsage } from "../../src/control/usage.js";
import { isEstimateRun } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots, workspacePathOf } from "../../src/control/workspace.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { ArtifactRef, Candidate } from "../../src/control/types.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Single-call estimate spec §6.1-§6.4: an estimate run is the driver's, runs as one ccloop single call, and settles
// into its estimate. The synthetic ccloop below answers only single calls (a loop envelope is a test failure).
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
type Outcome = "complete" | "failed" | "aborted";
interface SingleCallOptions {
  outcome?: Outcome; tokens?: number | null; output?: (planHash: string) => unknown; tamper?: "prompt";
  /** Until a handoff request arrives, collect reports usage but no candidate (the call is still running). */
  stoppable?: boolean;
  /** Runs inside the first collect that has a candidate to give, before it answers. */
  duringCollect?: () => Promise<void>;
}
const AMOUNT = { tokens: 100, activeMs: 100, attempts: 1, sessions: 1 };
export const estimateOutput = (planHash: string) => ({ schema: "budget-estimate-v1", planHash,
  tasks: [{ taskId: "a", complexity: "M", confidence: "high", work: AMOUNT, handoff: { tokens: 0, activeMs: 100, attempts: 0, sessions: 0 }, rationale: "small", assumptions: ["clean tree"] }],
  goalReviewReserve: AMOUNT, groupRationale: "small" });

function singleCallPort(options: SingleCallOptions, planHash: () => string) {
  const evidence = new Map<string, Buffer>();
  const calls = { accept: [] as StartEnvelope[], collect: 0, handoff: 0 };
  let requested = false, hookRan = false;
  const put = (artifactId: string, bytes: Buffer): ArtifactRef => { const ref = { artifactId, hash: sha(bytes) }; evidence.set(`${artifactId}:${ref.hash}`, bytes); return ref; };
  const accepted = (envelope: StartEnvelope) => ({ kind: "accepted" as const, executionId: `exec-${envelope.claim.runId}`, configHash: envelope.claim.configHash });
  const port: ExecutionPort = {
    resolveAgent: async () => { throw new ControlError("control-protocol-unavailable"); },
    listAgents: async () => ({ installations: [] }),
    async accept(envelope) { calls.accept.push(structuredClone(envelope)); return accepted(envelope); },
    async inspect(envelope) { return accepted(envelope); },
    async requestHandoff(_envelope, request) { calls.handoff += 1; requested = true; return { kind: "latched", requestId: request.requestId }; },
    async collect(envelope): Promise<ExecutionReport> {
      calls.collect += 1;
      const { claim, work } = envelope;
      if (work.kind !== "single-call") throw new Error("singleCallPort: single calls only");
      const outcome: Outcome = options.stoppable && requested ? "aborted" : options.outcome ?? "complete";
      const tokens = options.tokens === undefined ? 777 : options.tokens;
      const events = [{ runId: claim.runId, generation: claim.generation, eventSeq: 1, bucket: "work" as const,
        cumulative: tokens === null ? null : { tokens, activeMs: 5, attempts: 1, sessions: 1 }, source: put(`usage-${claim.runId}-1`, Buffer.from(`usage ${claim.runId}`)) }];
      if (options.stoppable && !requested) return { events, candidate: null, terminal: null };
      if (!hookRan && options.duringCollect) { hookRan = true; await options.duringCollect(); }
      const outputRef = outcome === "complete" ? put(`output-${claim.runId}`, canonicalBytes((options.output ?? estimateOutput)(planHash()))) : null;
      const record = {
        schema: "ccloop-single-call-record-v1",
        promptSha256: sha(Buffer.from(options.tamper === "prompt" ? `${work.prompt} ` : work.prompt, "utf8")),
        responseSchemaSha256: sha256Canonical(work.responseSchema),
        outcome, outputRef, errorCode: outcome === "failed" ? "single-call-output-invalid" : null,
      };
      const executionId = `exec-${claim.runId}`;
      const candidate: Candidate = {
        groupId: claim.groupId, workItemId: claim.workItemId, taskId: claim.taskId, runId: claim.runId, generation: claim.generation,
        graphVersion: claim.graphVersion, targetVersion: claim.targetVersion, checkpointId: `candidate-${claim.runId}`, usageHighWater: 1,
        result: outcome === "complete" ? "complete" : outcome === "aborted" ? "partial" : "failed",
        artifacts: outputRef === null ? [] : [outputRef], snapshot: null, missing: [], unresolvedRequestIds: [],
        stopProof: { executionId, generation: claim.generation, isolated: true, source: put(`stop-${claim.runId}`, Buffer.from(`stop ${executionId}`)) },
        terminalOutcome: `single-call-${outcome}`, handoff: put(`call-${claim.runId}`, canonicalBytes(record)),
      };
      return { events, candidate, terminal: null };
    },
    async readEvidence(ref) {
      const bytes = evidence.get(`${ref.artifactId}:${ref.hash}`);
      if (!bytes) throw new ControlError("control-evidence-context-missing");
      return bytes;
    },
  };
  return { port, calls };
}

/**
 * An imported group whose estimate is claimed (a `starting` estimate run), a driver over a synthetic single-call
 * ccloop, and an estimator-only profile -- so a driver that resolves the run's port as a task profile is refused.
 */
export async function estimateHarness(options: SingleCallOptions = {}) {
  const snapshot: ExecutionProfileSnapshotV1 = profileSnapshot();
  snapshot.profile.allowedWorkKinds = ["budget-estimate"];
  snapshot.profile.workMaxOutputTokens = null;
  const h = await webFixture(snapshot);
  const service = new WebControlService(h.deps);
  const run = await service.claimEstimate("g", h.estimateId);
  if (run === null) throw new Error("the estimate was not claimed");
  const runId = String((run as { runId: string }).runId);
  const fake = singleCallPort(options, () => readArchivedPlan(h.store, "g").planHash);
  const deps: ExecutionDriverDeps = {
    store: h.store, router: createExecutionProfileRouter([resolveProfile(snapshot, fake.port)]), admissionGate: h.deps.admissionGate,
    roots: controlWorkspaceRoots(h.store.stateDir), resolveRepository: () => join(h.root, "repo"),
    ccloopBin: "/bin/false", agentsTablePath: join(h.root, "agents.json"),
  };
  const body = () => JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
  const active = () => Number(h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active);
  const estimate = () => readEstimateRecord(h.store, "g", h.estimateId);
  const driver = createExecutionDriver(deps);
  const rounds = async (predicate: () => boolean, limit = 30): Promise<void> => {
    for (let i = 0; i < limit && !predicate(); i += 1) await driver.round();
    if (!predicate()) throw new Error(`the driver did not get there: run ${JSON.stringify(body().state)} ${JSON.stringify(body().drive?.blockedReason ?? null)}, estimate ${estimate().state}`);
  };
  return { h, service, runId, fake, deps, body, active, estimate, driver, rounds };
}

describe("Task 0 item 4: an estimate run after A1 and booked usage (single-call estimate spec §8.1)", () => {
  it("reserves its attempt at A1 and then satisfies completeEstimate's conservation guard", async () => {
    const x = await estimateHarness(); try {
      expect(stepA1(x.deps, x.runId)).toBe(true);
      expect(x.body()).toMatchObject({ state: "start-pending", providerAttemptOrdinal: 1 });
      recordUsage(x.h.store, { runId: x.runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 1_234, activeMs: 50, attempts: 1, sessions: 1 }, source: { artifactId: "usage-t0", hash: "e".repeat(64) } });
      expect(x.body().remaining.work).toEqual({ tokens: 250_000 - 1_234, activeMs: 900_000 - 50, attempts: 0, sessions: 0 });
      // The call gave nothing (null): completeEstimate must still get past every conservation check to record that.
      x.service.completeEstimate("g", x.h.estimateId, null, () => {
        const row = x.body(); row.state = "settled-restartable";
        x.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), x.runId);
      });
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode: "estimate-call-failed" });
      expect(x.active()).toBe(0);
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.used.tokens).toBe(1_234);
    } finally { await x.h.dispose(); }
  });
});
```

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/driverEstimate.test.ts > "$SCRATCH/o3-t0.txt" 2>&1; echo rc=$?
```
Expected（F1 的实测）：rc=1，红在 `stepA1` 抛 `start-intent-missing`（`reserveProviderAttemptInTransaction` → `readWorkClaimEnvelope`）。把这一行原文抄进台账 Task 0 第 4 项。

- [ ] **Step 2: 让 A1 能为估算 run 预留，再量守恒式**

`src/control/webDispatch.ts`：`readWorkClaimEnvelope` 之后加

```ts
/** Single-call estimate spec §6.1: the dispatch envelope claimEstimate froze for this estimate run (webService.ts claimEstimate). */
export function readEstimateClaimEnvelope(store: ControlStore, groupId: string, runId: string): DispatchEnvelopeV1 {
  const run = readDispatchRun(store, runId);
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='estimate-claim'").get(`estimate:${groupId}:${run.workItemId}`);
  if (!row) throw new ControlError("start-intent-missing");
  const { runId: claimed, envelopeHash } = JSON.parse(String(row.body)) as { runId: string; envelopeHash: string };
  if (claimed !== runId) throw new ControlError("start-intent-missing");
  return dispatchEnvelopeSchema.parse(JSON.parse(readCanonicalRecord(store, envelopeHash)));
}
```
`reserveProviderAttemptInTransaction` 的 `return` 改为 `envelope: phase === "estimate" ? readEstimateClaimEnvelope(store, run.groupId, runId) : readWorkClaimEnvelope(store, run.groupId, runId)`；文件末尾 `isWebWorkRun` 之后加

```ts
/**
 * Single-call estimate spec §6.1: a run claimEstimate made for an estimate -- phase `estimate`, and the
 * `estimate:<group>:<estimate>` claim row names this very run (a re-claim after a failure names another).
 */
export function isEstimateRun(store: ControlStore, runId: string): boolean {
  const row = store.db.prepare("SELECT group_id,work_item_id,body FROM runs WHERE id=?").get(runId);
  if (!row || (JSON.parse(String(row.body)) as { phase?: string }).phase !== "estimate") return false;
  const claim = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='estimate-claim'").get(`estimate:${String(row.group_id)}:${String(row.work_item_id)}`);
  return claim !== undefined && (JSON.parse(String(claim.body)) as { runId?: string }).runId === runId;
}
```

`src/control/driveRecord.ts:49`：`workspacePath: z.string().min(1).nullable(),` 并在上一行加注释 `// Single-call estimate spec §6.2 (review I3): null for an estimate run, which has no workspace to make or clean.`

`src/control/executionDriver.ts`：
- `newDrive(roots, runId, workspaceMode, workspace: boolean)`，`workspacePath: workspace ? workspacePathOf(roots, runId) : null`。
- `stepA1` 里：`const estimate = run.phase === "estimate";`，`newDrive(…, !estimate)`，`reserveProviderAttemptInTransaction(store, runId, estimate ? "estimate" : "work")`。函数注释补一句：`Single-call estimate spec §6.2: an estimate run enters the same way, with no workspace.`
- tsc 强制的三处收窄（**对 work run 不可达**，按 handoff §6.1 形状 2 登记为类型守卫，不编判据）：在文件里加

```ts
/** A work run's workspace; only an estimate run has none (spec §6.2), and it never reaches the steps that need one. */
function workspaceOf(drive: DriveRecord): string {
  if (drive.workspacePath === null) throw new ControlError("recovery-blocked", "workspace-missing");
  return drive.workspacePath;
}
```
  `stepA2` 的 :223 与 :236 用 `workspaceOf(drive)`；`cleanupPredecessor` :278 与 `stepE` :529 用 `workspaceOf(…drive)`。

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/driverEstimate.test.ts > "$SCRATCH/o3-t0-green.txt" 2>&1; echo rc=$?
```
Expected: rc=0（静态推理预言成立，见上「Task 0 第 4 项」）。**若红在 `recovery-blocked`（守恒式不成立）：停下，把原文报控制器与人，不改守恒式。**

- [ ] **Step 3: 写失败的判据**（追加进 `driverEstimate.test.ts`）

```ts
describe("the estimate chain (single-call estimate spec §6.1-§6.3)", () => {
  it("drives an estimate run from starting to a ready estimate through one single call, with no workspace", async () => {
    const x = await estimateHarness(); try {
      expect(isEstimateRun(x.h.store, x.runId)).toBe(true);
      expect(driverRunIds(x.h.store)).toEqual([x.runId]);
      await x.rounds(() => x.estimate().state !== "running");
      const plan = readArchivedPlan(x.h.store, "g");
      expect(x.estimate()).toMatchObject({ state: "ready", reasonCode: null, output: estimateOutput(plan.planHash), outputHash: sha256Canonical(estimateOutput(plan.planHash)) });
      expect(x.body()).toMatchObject({ state: "settled-restartable", cumulative: { work: { tokens: 777, activeMs: 5, attempts: 1, sessions: 1 } }, unknown: { work: false } });
      expect(x.active()).toBe(0);
      expect(driverRunIds(x.h.store)).toEqual([]);
      // Exactly one accept, and the envelope is the single call Orca assembled: the prompt byte for byte, the
      // hand-written schema, the frozen output cap, no checkpoint.
      expect(x.fake.calls.accept).toHaveLength(1);
      const sent = x.fake.calls.accept[0]!;
      const request = x.estimate().request!;
      expect(sent).toMatchObject({ protocol: 3, inputCheckpoint: null, claim: { runId: x.runId, taskId: null, workItemId: x.h.estimateId } });
      expect(sent.work).toEqual({ kind: "single-call", prompt: buildEstimatePrompt("1", canonicalBytes(request).toString("utf8")), responseSchema: BUDGET_ESTIMATE_JSON_SCHEMA, maxOutputTokens: 64_000, sourceDir: x.body().drive.sourceDir });
      // No workspace, recorded or on disk.
      expect(x.body().drive.workspacePath).toBeNull();
      expect(existsSync(workspacePathOf(x.deps.roots, x.runId))).toBe(false);
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.used.tokens).toBe(777);
    } finally { await x.h.dispose(); }
  });

  it("blocks the run and settles nothing when ccloop's call record names another prompt", async () => {
    const x = await estimateHarness({ tamper: "prompt" }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "single-call-prompt-mismatch" });
      expect(x.estimate().state).toBe("running");
      expect(x.active()).toBe(1);
    } finally { await x.h.dispose(); }
  });

  it("blocks as estimate-usage-unknown, not in a retry loop, when an aborted call observed no usage", async () => {
    const x = await estimateHarness({ outcome: "aborted", tokens: null }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown" });
      expect(x.body().state).toBe("blocked");
      expect(x.estimate().state).toBe("running");
      expect(readControlGroup(x.h.store, "epoch", "g").ledger.usageUnknown).toBe(true);
      const collects = x.fake.calls.collect;
      await x.driver.round();
      expect(x.fake.calls.collect).toBe(collects);
    } finally { await x.h.dispose(); }
  });

  it.each([
    ["a call that failed", { outcome: "failed" as const }, "estimate-call-failed"],
    ["an answer for another plan", { output: () => estimateOutput("f".repeat(64)) }, "estimate-output-plan-mismatch"],
    ["an answer that is not an estimate", { output: () => ({ schema: "budget-estimate-v1" }) }, "estimate-output-invalid"],
  ])("fails the estimate with its reason through the driver: %s", async (_label, options, reasonCode) => {
    const x = await estimateHarness(options); try {
      await x.rounds(() => x.estimate().state !== "running");
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode, output: null });
      expect(x.body().state).toBe("settled-restartable");
    } finally { await x.h.dispose(); }
  });

  it("is not an estimate run when its claim row names another run", async () => {
    const x = await estimateHarness(); try {
      const id = `estimate:g:${x.h.estimateId}`;
      const claim = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(id)!.body));
      x.h.store.db.prepare("UPDATE outbox SET body=? WHERE id=?").run(JSON.stringify({ ...claim, runId: "run-other" }), id);
      expect(isEstimateRun(x.h.store, x.runId)).toBe(false);
      expect(driverRunIds(x.h.store)).toEqual([]);
    } finally { await x.h.dispose(); }
  });
});
```

- [ ] **Step 4: 跑，确认红**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/driverEstimate.test.ts > "$SCRATCH/o3-red.txt" 2>&1; echo rc=$?
```
Expected: rc=1；Task 0 那条仍绿；`drives an estimate run…` 红在 `driverRunIds` 为 `[]`（`toEqual([runId])`）；prompt tamper、usage-unknown、三条 it.each 都红在 `the driver did not get there: run "starting"`；最后一条**今天绿**（`driverRunIds` 本来就是 `[]`）——它由 Step 7 的变异 M-O3f 补红证。

- [ ] **Step 5: 实现**

`src/control/webService.ts`：把 `completeEstimate` 方法体（:374-420 `this.mutate(() => this.store.transaction(() => { … }))` 里面那段）原样搬到类外：

```ts
/**
 * The estimate's terminal settlement (formerly WebControlService.completeEstimate's body, moved unchanged so the
 * execution driver can call it -- single-call estimate spec §6.3, drafter finding F13). `commitTerminal` runs first, in
 * the same transaction, and a throw from anything here rolls it back with the rest.
 */
export function completeEstimateInStore(deps: { store: ControlStore; admissionGate?: AdmissionGate }, id: string, estimateId: string, rawOutput: unknown, commitTerminal?: () => void): void {
  const release = deps.admissionGate?.enter();
  try {
    deps.store.transaction(() => {
      /* the former method body, with `this.store` → `deps.store` */
    });
  } finally { release?.(); }
}
```
（「the former method body」指 :376-419 逐行搬移，只把 `this.store` 换成 `deps.store`，不改任何语句；这是搬移不是新代码，搬完 `git diff --stat` 的删除行数应等于新增行数±包装行。）方法改为 `completeEstimate(id: string, estimateId: string, rawOutput: unknown, commitTerminal?: () => void): void { completeEstimateInStore({ store: this.store, admissionGate: this.deps.admissionGate }, id, estimateId, rawOutput, commitTerminal); }`。

`src/control/executionDriver.ts`：
- import 增加：`import { readArtifact, … } from "./archive.js";`（已有 `readArtifact`）、`import { BUDGET_ESTIMATE_JSON_SCHEMA, buildEstimatePrompt } from "./estimatePrompt.js";`、`import { readEstimateContract } from "./estimator.js";`、`import { readEstimateRecord } from "./queries.js";`（与既有 queries import 合并）、`import { toSingleCallEnvelope, toStartEnvelope } from "./startEnvelope.js";`、`import { isEstimateRun, isWebWorkRun, nextClaimableTask, readEstimateClaimEnvelope, readWorkClaimEnvelope, reserveProviderAttemptInTransaction } from "./webDispatch.js";`、`import { completeEstimateInStore } from "./webService.js";`、`import { z } from "zod";`。
- `portFor`：

```ts
/** The frozen profile's port: the one the run was claimed against -- the estimator's for an estimate run (F2). */
export function portFor(deps: Pick<ExecutionDriverDeps, "router">, run: DriverRun): ExecutionPort {
  return deps.router.resolve(run.phase === "estimate" ? "budget-estimate" : "task", run.executionProfile.profileId, run.executionProfile.profileHash).port;
}
```
- 新增 A2e 与 Ce：

```ts
/**
 * A2 of an estimate run (single-call estimate spec §6.2): a private source directory, the prompt (§4.2) and the
 * hand-written response schema in a protocol-3 single-call envelope. No workspace, no branch, no read of the target
 * repository. Everything is redone while `prepared` is false, as for a work run.
 */
export async function stepA2Estimate(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.phase !== "estimate" || run.state !== "start-pending" || run.drive === undefined || run.drive.prepared) return false;
  const estimateId = String(run.estimateId);
  const estimate = readEstimateRecord(store, run.groupId, estimateId);
  if (estimate.request === null) { blockRun(deps, runId, "A2", "estimate-request-missing"); return true; }
  const contract = readEstimateContract(store, run.groupId, estimateId);
  privateDirectory(run.drive.sourceDir);
  const envelope = toSingleCallEnvelope(readEstimateClaimEnvelope(store, run.groupId, runId), run, {
    sourceDir: run.drive.sourceDir,
    prompt: buildEstimatePrompt(contract.instructionVersion, canonicalBytes(estimate.request).toString("utf8")),
    responseSchema: BUDGET_ESTIMATE_JSON_SCHEMA as Record<string, unknown>,
    maxOutputTokens: contract.maxOutputTokens,
  });
  const envelopeHash = sha256Canonical(envelope);
  return write(deps, () => {
    writeCanonicalRecord(store, run.groupId, envelopeHash, canonicalBytes(envelope).toString("utf8"));
    const current = readDriverRun(store, runId);
    if (current.state !== "start-pending" || current.drive === undefined || current.drive.prepared) return false;
    current.drive = { ...current.drive, envelopeHash, prepared: true };
    saveDriverRun(store, current);
    return true;
  });
}

/** ccloop's record of one single call (contract: `ccloop-single-call-record-v1`). */
const singleCallRecordSchema = z.object({
  schema: z.literal("ccloop-single-call-record-v1"),
  promptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  responseSchemaSha256: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum(["complete", "aborted", "failed"]),
  outputRef: z.object({ artifactId: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable(),
  errorCode: z.string().min(1).nullable(),
}).strict();

/**
 * C of an estimate run (single-call estimate spec §6.3): collect as C does; once the stop is proved, check that the
 * call ccloop made is the one Orca sent (both hashes against the stored envelope), then settle the estimate and the
 * run in one transaction. An aborted call with no observed usage cannot settle (run-stop-unconfirmed) and is blocked
 * by name instead of retried every round. A stop that arrived while this step was collecting wins (drafter finding
 * F6): the settlement yields and step H closes the run next round.
 */
export async function stepCEstimate(deps: ExecutionDriverDeps, runId: string): Promise<boolean> {
  const { store } = deps;
  const run = readDriverRun(store, runId);
  if (run.phase !== "estimate" || run.state !== "accepted" || run.drive === undefined) return false;
  const report = await collectInto(deps, run);
  const candidate = report.candidate;
  if (!candidate?.stopProof) return report.events.length > 0;
  const envelope = readStartEnvelope(store, run);
  if (envelope.work.kind !== "single-call") throw new ControlError("recovery-blocked", `envelope-kind:${runId}`);
  const record = singleCallRecordSchema.parse(JSON.parse((await readArtifact(store, candidate.handoff)).toString("utf8")));
  // Controller ruling F10 (2026-09-28): only the prompt is compared. It is one string, byte-exact on both sides; the
  // schema's hash depends on key order, which ccloop re-sorts (localeCompare) when it stores the envelope, and a
  // tampered schema cannot slip an invalid answer past classifyEstimateOutput's zod check anyway.
  if (record.promptSha256 !== createHash("sha256").update(envelope.work.prompt, "utf8").digest("hex")) {
    blockRun(deps, runId, "C", "single-call-prompt-mismatch");
    return true;
  }
  let rawOutput: unknown = null;
  if (record.outcome === "complete" && record.outputRef !== null) {
    const text = (await readArtifact(store, record.outputRef)).toString("utf8");
    try { rawOutput = JSON.parse(text); } catch { rawOutput = text; }
  }
  try {
    completeEstimateInStore({ store, admissionGate: deps.admissionGate }, run.groupId, String(run.estimateId), rawOutput, () => {
      if (openRequestOf(store, run) !== null) throw new ControlError("handoff-request-conflict", "estimate-yields-to-handoff");
      const current = readDriverRun(store, runId);
      current.state = "settled-restartable";
      saveDriverRun(store, current);
    });
  } catch (error) {
    if (error instanceof ControlError && error.code === "run-stop-unconfirmed") { blockRun(deps, runId, "C", "estimate-usage-unknown"); return true; }
    if (error instanceof ControlError && error.code === "handoff-request-conflict" && error.detail === "estimate-yields-to-handoff") return false;
    throw error;
  }
  return true;
}
```
- `driverRunIds` :585 改为：

```ts
    // Single-call estimate spec §6.1: an estimate run the Web ledger claimed is the driver's too.
    const ours = (run.phase === "work" && isWebWorkRun(store, runId)) || (run.phase === "estimate" && isEstimateRun(store, runId));
    if (!ours) continue;
```
- `advance` 开头加：

```ts
  // Single-call estimate spec §6.1: an estimate run has its own chain; the work chain below is unchanged.
  if (run.phase === "estimate") {
    switch (run.state) {
      case "starting": return stepA1(deps, runId);
      case "start-pending": return run.drive?.prepared ? stepB(deps, runId) : stepA2Estimate(deps, runId);
      case "unknown": return stepBPrime(deps, runId);
      case "accepted": return stepCEstimate(deps, runId);
      default: return false;
    }
  }
```

- [ ] **Step 6: 跑，确认绿（含回归文件）**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/driverEstimate.test.ts tests/control/estimator.test.ts tests/control/estimateOutcome.test.ts tests/control/executionDriver.test.ts tests/control/driverHandoff.test.ts tests/control/driverRecovery.test.ts tests/control/driverSettle.test.ts tests/control/driverContinuation.test.ts tests/control/webDispatch.test.ts tests/panel/shutdownDriverGroup.test.ts > "$SCRATCH/o3-green.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/o3-tsc.txt" 2>&1; echo rc=$?
```
Expected: rc=0 两次；`driverEstimate.test.ts` 10 条（1＋1＋2＋1＋3＋1＋… 以报数为准）全绿。

- [ ] **Step 7: 提交**

```bash
cd /Users/biran/code/skills/loop/Orca && git add src/control/webDispatch.ts src/control/driveRecord.ts src/control/executionDriver.ts src/control/webService.ts tests/control/driverEstimate.test.ts && git commit -F - <<'EOF'
feat(control): drive an estimate run through one ccloop single call and settle it into the estimate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**（独立 clone，先绿基线）：
- M-O3a：`driverRunIds` 删掉 `|| (run.phase === "estimate" && …)` ⇒ 红在 `drives an estimate run…`（首个 `driverRunIds` 断言）以及本文件除 Task 0 与最后一条之外的全部（`the driver did not get there: run "starting"`）。跨 Task：O5 的 E1 红在 `start answered "estimate-in-flight"`（spec §8.4 点名的那条，在 O5 落地后重跑）。
- M-O3b：`portFor` 写死 `"task"` ⇒ 红在 `drives an estimate run…`（run 在 B 被判 `profile-changed` 而 blocked）及其它等 ready 的条目。
- M-O3c：`stepA1` 对估算仍传 `"work"` ⇒ 红在 Task 0 那条（`start-intent-missing`）与 chain 全部。
- M-O3d：`newDrive` 对估算也建 `workspacePathOf` ⇒ 红在 `drives an estimate run…` 的 `workspacePath` `toBeNull` 且仅它。
- M-O3e：删掉 Ce 的哈希比对 `if` ⇒ 红在 prompt tamper 那条，且仅它（估算变 ready）。
- M-O3f：`isEstimateRun` 去掉 `=== runId` 比较（只看行存在） ⇒ 红在 `is not an estimate run when its claim row names another run` 且仅它。
- M-O3g：删掉 `run-stop-unconfirmed` 的 catch 分支 ⇒ 红在 usage-unknown 那条且仅它（通用 catch 以 `run-stop-unconfirmed` 为 reason 块在 C，`blockedReason` 字面量不符）。
- M-O3h：A2e 的 prompt 换成只有请求字节 ⇒ 红在 `drives an estimate run…` 的 `sent.work` `toEqual` 且仅它。
- 登记为类型守卫、不编判据：`workspaceOf` 在 `stepA2`／`cleanupPredecessor`／`stepE` 的三处（work run 恒有工作区；估算 run 不进这三步）。

---

### Task O4: 冻结、重启恢复（估算 run 不碰目标仓库）

**Files:**
- Modify: `src/control/driverHandoff.ts`（`handoffRunIds`、`restartRun`、`deliverAndCollect`）
- Modify: `src/control/recovery.ts:27`
- Modify: `tests/control/fixtures/ccloopWorld.ts`（`SingleCallScriptEntry`、`declaredContextWindowTokens`、返回 `claudeScriptPath`／`claudeMarker`；只加不改）
- Create: `tests/control/driverEstimateHandoff.test.ts`、`tests/control/estimateE2E.test.ts`（E2、E3；E1 在 O5 追加）

**Interfaces:**
- Consumes: O3 的 `isEstimateRun`、`estimateHarness`／`estimateOutput`（从 `driverEstimate.test.ts` 导出）、`stepCEstimate` 的让位语义。
- Produces：`handoffRunIds` 收有未结请求的估算 run；估算 run 的请求一律 `settled-restartable`；`restartRun` 对 `workspacePath === null` 不清理；`recoverControl` 在 `driverOwnsWebRuns` 下跳过估算 run（不论状态）。`ccloopWorld` 的 `WorldOptions` 新增 `declaredContextWindowTokens?: number`，`claudeScript` 的值可为 `SingleCallScriptEntry = { output: unknown; delayMs?: { "single-call": number }; usageBeforeDelay?: boolean }`（F15），world 返回 `claudeScriptPath`、`claudeMarker`。

- [ ] **Step 1: 先量 Task 0 第 2 项** — 新建 `tests/control/driverEstimateHandoff.test.ts`，先放这一条

```ts
import { describe, expect, it } from "vitest";
import { recoverControl } from "../../src/control/recovery.js";
import { handoffRunIds, stepH } from "../../src/control/driverHandoff.js";
import { stepA1 } from "../../src/control/executionDriver.js";
import { groupStopState } from "../../src/control/stopIntent.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { estimateHarness } from "./driverEstimate.test.js";

// Single-call estimate spec §6.5: an estimate run under a stop and across a restart. Task 0 item 2 first.
describe("Task 0 item 2: startup recovery with estimate runs (single-call estimate spec §8.1)", () => {
  it("leaves an in-flight estimate run to the driver: nothing blocked, dispatch open", async () => {
    const x = await estimateHarness(); try {
      const result = await recoverControl(x.h.store, {} as never, undefined, { driverOwnsWebRuns: true });
      expect(result.blockedRunIds).toEqual([]);
      expect(x.h.store.dispatchBlocked).toBe(false);
    } finally { await x.h.dispose(); }
  });

  it("leaves a finished estimate run alone too", async () => {
    const x = await estimateHarness(); try {
      await x.rounds(() => x.estimate().state === "ready");
      const result = await recoverControl(x.h.store, {} as never, undefined, { driverOwnsWebRuns: true });
      expect(result.blockedRunIds).toEqual([]);
      expect(x.h.store.dispatchBlocked).toBe(false);
    } finally { await x.h.dispose(); }
  });
});
```
（`driverEstimate.test.ts` 里的 `estimateHarness`、`estimateOutput` 已 `export`；vitest 会把被 import 的测试文件里的 `describe` 也登记进本文件——**若出现重复收集，把 harness 挪到 `tests/control/fixtures/estimateHarness.ts` 并两处改 import**，这是纯搬移。）

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/driverEstimateHandoff.test.ts > "$SCRATCH/o4-t0.txt" 2>&1; echo rc=$?
```
Expected（F7 的预言）：rc=1，两条都红：`blockedRunIds` 为 `[估算 runId]`、`dispatchBlocked` 为 `true`。原文抄进台账 Task 0 第 2 项。**若两条都绿 ⇒ 预言错，按 spec §6.5.3「假 ⇒ 只加防回归判据」：仍做 Step 3 的改动，但在台账写明「量得为假」。**

- [ ] **Step 2: 写失败的判据（冻结）**（追加）

```ts
describe("an estimate run under a stop (single-call estimate spec §6.5)", () => {
  it("H1: a running call is stopped, its estimate interrupted, its commitment returned, and the stop completes", async () => {
    const x = await estimateHarness({ stoppable: true, tokens: 40 }); try {
      const atImport = readControlGroup(x.h.store, "epoch", "g").ledger;
      await x.rounds(() => x.body().state === "accepted" && x.fake.calls.collect > 0);
      const stopped = await x.service.handoffStop(x.h.command("handoff-stop", {}));
      if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(JSON.stringify(stopped));
      const [requestId] = stopped.result.requestIds;
      const request = () => String(x.h.store.db.prepare("SELECT state FROM handoff_requests WHERE id=?").get(requestId)!.state);
      await x.rounds(() => request() === "settled-restartable");
      expect(x.estimate()).toMatchObject({ state: "interrupted", output: null });
      expect(x.active()).toBe(0);
      expect(groupStopState(x.h.store, "g")).toBe("handoff-complete");
      const after = readControlGroup(x.h.store, "epoch", "g").ledger;
      expect(after.committedRemaining.tokens).toBe(atImport.committedRemaining.tokens - 250_000);
      expect(after.used.tokens).toBe(40);
      expect(x.fake.calls.handoff).toBe(1);
    } finally { await x.h.dispose(); }
  });

  it("H2: a run that never started is restarted without touching any workspace", async () => {
    const x = await estimateHarness(); try {
      expect(stepA1(x.deps, x.runId)).toBe(true);
      const stopped = await x.service.handoffStop(x.h.command("handoff-stop", {}));
      if ("error" in stopped) throw new Error(JSON.stringify(stopped));
      expect(await stepH(x.deps, x.runId, { reconciling: new Map(), stopped: false })).toBe(true);
      expect(x.estimate().state).toBe("interrupted");
      expect(x.body().drive).toMatchObject({ workspacePath: null, cleanedUp: true, cleanupError: null });
      expect(x.fake.calls.accept).toHaveLength(0);
    } finally { await x.h.dispose(); }
  });

  it("H3: a stop that lands while C collects a finished call wins; the estimate is interrupted, not ready", async () => {
    let x!: Awaited<ReturnType<typeof estimateHarness>>;
    x = await estimateHarness({ duringCollect: async () => {
      const stopped = await x.service.handoffStop(x.h.command("handoff-stop", {}));
      if ("error" in stopped) throw new Error(JSON.stringify(stopped));
    } }); try {
      await x.rounds(() => ["interrupted", "ready", "failed"].includes(x.estimate().state));
      expect(x.estimate()).toMatchObject({ state: "interrupted", output: null, outputHash: null });
      expect(x.h.store.db.prepare("SELECT id FROM outbox WHERE id=?").get(`estimate-result:g:${x.h.estimateId}`)).toBeUndefined();
      expect(groupStopState(x.h.store, "g")).toBe("handoff-complete");
    } finally { await x.h.dispose(); }
  });

  it("H4: a blocked estimate run is still closed by a stop (it is visited only through its request)", async () => {
    const x = await estimateHarness({ tamper: "prompt" }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(handoffRunIds(x.h.store)).toEqual([]);
      const stopped = await x.service.handoffStop(x.h.command("handoff-stop", {}));
      if ("error" in stopped) throw new Error(JSON.stringify(stopped));
      expect(handoffRunIds(x.h.store)).toEqual([x.runId]);
      await x.rounds(() => x.estimate().state === "interrupted");
      expect(groupStopState(x.h.store, "g")).toBe("handoff-complete");
    } finally { await x.h.dispose(); }
  });
});
```

- [ ] **Step 3: 跑，确认红**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/driverEstimateHandoff.test.ts > "$SCRATCH/o4-red.txt" 2>&1; echo rc=$?
```
Expected: rc=1。Task 0 两条红（同 Step 1）；H1 红在 `the driver did not get there`（`settleHandoffCheckpoint` 把请求记成 `settled-recoverable`／`settled-unrecoverable`，或 `archiveRun` 抛——**记下实际是哪种**）；H2 红在 `cleanedUp: false`／`cleanupError` 非空（`cleanupRunWorkspace(…, null)`）；H3 红在估算 `ready`；H4 红在 `handoffRunIds` 第二次仍为 `[]`。

- [ ] **Step 4: 实现**

`src/control/driverHandoff.ts`：
- import 加 `isEstimateRun`（与 `isWebWorkRun` 同行）、`settleHandoffRequestInTransaction` 已在。
- `handoffRunIds` :50：

```ts
    // Single-call estimate spec §6.5: an estimate run's request is the driver's to close too.
    const ours = (run.phase === "work" && isWebWorkRun(store, runId)) || (run.phase === "estimate" && isEstimateRun(store, runId));
    if (ours && openRequestOf(store, run) !== null) ids.push(runId);
```
- `restartRun` :96-99：`if (run.drive !== undefined && run.drive.workspacePath !== null) {`（注释：`// Single-call estimate spec §6.5 (review I3): an estimate run has no workspace; nothing in the target repository is touched.`）；:104-107 保持原样（`cleanedUp: cleanupError === null` 对估算 run 记 `true`）。
- `deliverAndCollect` :171-176 改为：

```ts
  const report = await collectInto(deps, run);
  // Single-call estimate spec §6.5: an estimate run's stop always settles restartable -- its estimate is interrupted and
  // its unused commitment returned (terminaliseRun) -- even when the call had already finished; the output stays as
  // evidence and a person can re-estimate. Never a checkpoint: there is no work to continue.
  if (run.phase === "estimate" && report.candidate?.stopProof) return settleEstimateUnderStop(deps, run, request);
  if (report.terminal !== null && report.candidate?.stopProof && run.state === "accepted") return stepC(deps, run.runId);
```
  并加：

```ts
function settleEstimateUnderStop(deps: ExecutionDriverDeps, run: DriverRun, request: HandoffRequestBody): boolean {
  return write(deps, () => {
    const current = readHandoffRequest(deps.store, run.groupId, request.requestId).request;
    if (!ADOPTABLE_STATES.includes(current.state)) return false;
    settleHandoffRequestInTransaction(stopDeps(deps), run.groupId, request.requestId, "settled-restartable", null);
    return true;
  });
}
```

`src/control/recovery.ts:4,27`：import 加 `isEstimateRun`；:26-27 改为

```ts
  // Execution driver spec §4: with a driver present, a Web work run is the driver's to reconcile, run by run -- and so
  // is an estimate run, in any state (single-call estimate spec §6.5.3; drafter finding F7: it has no start: row).
  if(options.driverOwnsWebRuns && (isWebWorkRun(store,runId)||isEstimateRun(store,runId))) continue;
```

- [ ] **Step 5: 跑，确认绿**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/driverEstimateHandoff.test.ts tests/control/driverEstimate.test.ts tests/control/driverHandoff.test.ts tests/control/driverRecovery.test.ts tests/control/handoffStop.test.ts tests/control/stopIntent.test.ts tests/control/recovery.test.ts tests/panel/shutdownDriverGroup.test.ts > "$SCRATCH/o4-green.txt" 2>&1; echo rc=$?
```
Expected: rc=0。

- [ ] **Step 6: 写 E2E 的 E2、E3**（world 夹具只加不改；E2E 需要 Global Constraints 里的 ccloop clone）

`tests/control/fixtures/ccloopWorld.ts`：
- :62 之后加 `/** Single-call estimate (F15, ccloop's fake claude): the answer to one single call, optionally after a delay, optionally streaming one closed message first. */ export interface SingleCallScriptEntry { output: unknown; delayMs?: { "single-call": number }; usageBeforeDelay?: boolean }`；
- :67 改为 `export interface WorldOptions { claudeScript?: Record<string, ScriptEntry | SingleCallScriptEntry>; /** Single-call estimate: the profile's declared context window (null otherwise, so the estimate stays blocked-capability). */ declaredContextWindowTokens?: number }`；
- :134 改为 `snapshot.profile.capabilities = { ...CCLOOP_CAPABILITIES, contextWindowTokens: worldOptions.declaredContextWindowTokens ?? null };`；
- :177 的返回对象加 `claudeScriptPath: join(root, "claude-script.json"), claudeMarker`。

新建 `tests/control/estimateE2E.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord } from "../../src/control/queries.js";
import { groupStopState } from "../../src/control/stopIntent.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ccloopWorlds, raw, realBinary, until, type World } from "./fixtures/ccloopWorld.js";

/**
 * Single-call estimate spec §8.3 E1-E3 against the real ccloop build (ORCA_CCLOOP_BIN, containing the ccloop half of
 * this round) and ccloop's CLI-level fake claude, relocated as agentSelectionE2E.test.ts is. The operator's layers put
 * the workers on the fake codex and the estimator on fake claude with the 1M window, which is what makes an estimate
 * queue (spec §1). The fake's single-call answer is written after the import (the plan hash is known then) and before
 * the pump starts (nothing claims the estimate before that).
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-estimate-e2e-", epochPrefix: "epoch-estimate-e2e-" });
afterAll(removeRoots);

const TASKS = [{ taskId: "a", targetPaths: ["a.txt"], verifierType: "command" as const }];
const CODEX = { a: { files: { "a.txt": "A\n" } } };
export const SUGGESTED_WORK = { tokens: 180_000, activeMs: 200_000, attempts: 1, sessions: 1 };
export const estimateOutput = (planHash: string) => ({
  schema: "budget-estimate-v1", planHash,
  tasks: [{ taskId: "a", complexity: "S", confidence: "high", work: SUGGESTED_WORK, handoff: { tokens: 10_000, activeMs: 30_000, attempts: 0, sessions: 0 }, rationale: "one new file", assumptions: ["a.txt does not exist yet"] }],
  goalReviewReserve: { tokens: 50_000, activeMs: 60_000, attempts: 1, sessions: 1 }, groupRationale: "a single small task",
});

/** Preferences, then the import; answers the queued estimate's id and the plan hash. */
export async function importWithClaudeEstimator(runtime: ControlRuntime, w: World): Promise<{ estimateId: string; planHash: string }> {
  const preferences = await runtime.service.setAgentPreferences(raw(runtime, "prefs", "set-agent-preferences",
    { preferences: { defaultAgent: "codex", perAgent: {}, estimator: { agent: "claude", contextWindow: 1_000_000 } } }, { kind: "operator", operatorId: "human" }));
  expect("error" in preferences ? preferences.error : "set").toBe("set");
  const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId: w.repoId, planId: "plan" }));
  expect(imported).toMatchObject({ result: { kind: "imported", estimateState: "queued" } });
  return { estimateId: (imported as { result: { estimateId: string } }).result.estimateId, planHash: readArchivedPlan(runtime.store, "g").planHash };
}
export const estimateRun = (runtime: ControlRuntime) => {
  const row = runtime.store.db.prepare("SELECT id,active,body FROM runs WHERE group_id='g' AND json_extract(body,'$.phase')='estimate'").get();
  return row === undefined ? null : { runId: String(row.id), active: Number(row.active), body: JSON.parse(String(row.body)) };
};
export async function confirmSoft(runtime: ControlRuntime, commandId: string) {
  const selections = await resolveGroupSelections({ store: runtime.store, port: runtime.port }, "g", "human");
  const hash = runtime.router.list()[0]!.profileHash;
  return runtime.service.confirm(raw(runtime, commandId, "confirm", {
    planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion, budgetMode: "soft",
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
    contextPolicy: { handoffAtContextTokens: null }, selectionsHash: selections.selectionsHash,
  }));
}

describe.skipIf(!realBinary)("the estimate chain against real ccloop and fake claude (single-call estimate spec §8.3)", { timeout: 420_000 }, () => {
  relocateHome("orca-estimate-e2e-home-");

  it("E2: a handoff-stop while the call runs interrupts the estimate, returns its commitment, and completes the stop", async () => {
    const w = await world(TASKS, CODEX, { claudeScript: {}, declaredContextWindowTokens: 1_000_000 });
    try {
      const worktreesBefore = w.worktrees();
      const runtime = await w.boot();
      const { estimateId, planHash } = await importWithClaudeEstimator(runtime, w);
      const atImport = readControlGroup(runtime.store, runtime.epoch, "g").ledger;
      await writeFile(w.claudeScriptPath, JSON.stringify({ "single-call": { output: estimateOutput(planHash), delayMs: { "single-call": 30_000 }, usageBeforeDelay: true } }));
      runtime.startPump(50);
      await until(() => estimateRun(runtime)?.body.state === "accepted" && w.argv("claude").length === 1, 60_000, "the single call to start", 50);
      const stopped = await runtime.service.handoffStop(raw(runtime, "stop", "handoff-stop", {}));
      if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(stopped)}`);
      const [requestId] = stopped.result.requestIds;
      const request = () => String(runtime.store.db.prepare("SELECT state FROM handoff_requests WHERE id=?").get(requestId)!.state);
      await until(() => request() !== "request-pending" && request() !== "latched" && request() !== "collecting", 60_000, "the request to settle", 50);
      expect(request()).toBe("settled-restartable");
      expect(readEstimateRecord(runtime.store, "g", estimateId)).toMatchObject({ state: "interrupted", output: null });
      expect(estimateRun(runtime)!.active).toBe(0);
      expect(groupStopState(runtime.store, "g")).toBe("handoff-complete");
      const after = readControlGroup(runtime.store, runtime.epoch, "g").ledger;
      expect(after.committedRemaining.tokens).toBe(atImport.committedRemaining.tokens - 250_000);
      expect(after.used.tokens).toBe(estimateRun(runtime)!.body.cumulative.work.tokens);
      expect(w.worktrees()).toEqual(worktreesBefore);
    } finally { await w.teardown(); }
  });

  it("E3: a restart with the call in flight leaves dispatch open, and the driver reconciles the estimate to ready", async () => {
    const w = await world(TASKS, CODEX, { claudeScript: {}, declaredContextWindowTokens: 1_000_000 });
    try {
      const first = await w.boot();
      const { estimateId, planHash } = await importWithClaudeEstimator(first, w);
      await writeFile(w.claudeScriptPath, JSON.stringify({ "single-call": { output: estimateOutput(planHash), delayMs: { "single-call": 5_000 } }));
      first.startPump(50);
      await until(() => estimateRun(first)?.body.state === "accepted", 60_000, "the single call to be accepted", 50);
      w.die(first);
      const second = await w.boot();
      expect(second.store.dispatchBlocked).toBe(false);
      second.startPump(50);
      await until(() => readEstimateRecord(second.store, "g", estimateId).state !== "running", 90_000, "the estimate to settle after the restart", 50);
      expect(readEstimateRecord(second.store, "g", estimateId)).toMatchObject({ state: "ready", output: estimateOutput(planHash) });
      expect(estimateRun(second)!.body.state).toBe("settled-restartable");
    } finally { await w.teardown(); }
  });
});
```

- [ ] **Step 7: 跑 E2、E3**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ORCA_CCLOOP_BIN="$SCRATCH/ccloop-bin/dist/cli.js" ./node_modules/.bin/vitest run tests/control/estimateE2E.test.ts > "$SCRATCH/o4-e2e.txt" 2>&1; echo rc=$?
```
Expected: rc=0，2 passed，0 skipped。（E3 在 Step 4 之前的红预言：`expected true to be false`（`dispatchBlocked`）——在变异 M-O4d 里量。）

- [ ] **Step 8: 提交**

```bash
cd /Users/biran/code/skills/loop/Orca && git add src/control/driverHandoff.ts src/control/recovery.ts tests/control/fixtures/ccloopWorld.ts tests/control/driverEstimateHandoff.test.ts tests/control/estimateE2E.test.ts && git commit -F - <<'EOF'
feat(control): stop, restart and recover an estimate run without touching the target repository

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**（独立 clone；E2E 那几条要带 `ORCA_CCLOOP_BIN`，且**不在**被当作 `ORCA_CCLOOP_BIN` 的那份 ccloop clone 里改任何东西）：
- M-O4a：`handoffRunIds` 删掉估算子句 ⇒ 红在 H4 且仅它（被 blocked 的估算 run 不在 `driverRunIds` 里，别处都还能靠 `driverRunIds` 访问到）。
- M-O4b：`deliverAndCollect` 删掉 `run.phase === "estimate"` 那行 ⇒ 红在 H1、H3、H4（请求不是 `settled-restartable`），E2 同红。
- M-O4c：`restartRun` 的条件改回 `if (run.drive !== undefined)` ⇒ 红在 H2 且仅它（`cleanupError` 非空）。
- M-O4d：`recovery.ts` 删掉 `||isEstimateRun(store,runId)` ⇒ 红在 Task 0 两条与 E3（`dispatchBlocked` 为 true）。
- M-O4e（跨 Task，O3 的 F6 守卫）：`stepCEstimate` 的 `commitTerminal` 删掉 `openRequestOf` 复查 ⇒ 红在 H3 且仅它（估算 `ready`、请求永不结算）。

---

### Task O5: E1 端到端 — 导入 ⇒ 估算 ready ⇒ 应用一条建议 ⇒ confirm ⇒ start

**Files:**
- Modify: `tests/control/estimateE2E.test.ts`（只追加 E1）

**Interfaces:**
- Consumes: O1–O4 全部；ccloop 计划最后一笔的 clone；F15 的 fake claude 约定（`"single-call"` 条目、marker 的 `maxOutputTokensEnv`、正常完成 usage 12＋3）。
- Produces: 无新接口。Task 0 第 3 项：服务层与 HTTP 层的真 store 判据已有（见上），E1 补的是「驱动环跑出来的估算」这一条。

- [ ] **Step 1: 写判据**（追加进 `estimateE2E.test.ts` 的 describe 末尾）

```ts
  it("E1: an imported plan's estimate runs to ready, one suggestion is applied as the model's, and the group starts", async () => {
    const w = await world(TASKS, CODEX, { claudeScript: {}, declaredContextWindowTokens: 1_000_000 });
    try {
      const worktreesBefore = w.worktrees();
      const runtime = await w.boot();
      const { estimateId, planHash } = await importWithClaudeEstimator(runtime, w);
      await writeFile(w.claudeScriptPath, JSON.stringify({ "single-call": { output: estimateOutput(planHash) } }));
      runtime.startPump(50);
      try {
        await until(() => readEstimateRecord(runtime.store, "g", estimateId).state !== "running" && readEstimateRecord(runtime.store, "g", estimateId).state !== "queued", 90_000, "the estimate to settle", 50);
      } catch (error) {
        // Spec §1 and §8.4: what a stuck estimate costs the person is a refused start -- report that, not only a timeout.
        const confirmed = await confirmSoft(runtime, "stuck-confirm");
        const started = await runtime.service.start(raw(runtime, "stuck-start", "start", {}));
        throw new Error(`${String(error)}; estimate ${readEstimateRecord(runtime.store, "g", estimateId).state}; confirm ${"error" in confirmed ? confirmed.error.code : "confirmed"}; start answered ${"error" in started ? started.error.code : "started"}`);
      }
      expect(readEstimateRecord(runtime.store, "g", estimateId)).toMatchObject({ state: "ready", output: estimateOutput(planHash) });
      const run = estimateRun(runtime)!;
      expect(run.body).toMatchObject({ state: "settled-restartable", unknown: { work: false }, drive: { workspacePath: null } });
      // F15: fake claude's result usage, 12 input + 3 output, booked as ccloop reported it.
      expect(run.body.cumulative.work.tokens).toBe(15);
      // What the fake claude CLI received: one call, tools off, the frozen output cap in its environment (F15).
      expect(w.argv("claude")).toHaveLength(1);
      const argv = w.argv("claude")[0]!;
      expect(argv[argv.indexOf("--tools") + 1]).toBe("");
      expect(JSON.parse(readFileSync(w.claudeMarker, "utf8")).maxOutputTokensEnv).toBe("64000");
      expect(w.worktrees()).toEqual(worktreesBefore);

      // Apply one suggestion as the model's (Web spec §5.5): only the work tokens of task a.
      const applied = runtime.service.editProposal(raw(runtime, "apply", "proposal-edit", {
        baseProposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion,
        operations: [{ target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" }, value: SUGGESTED_WORK.tokens, provenance: "model", estimateId }],
      }));
      expect("error" in applied ? applied.error : applied.result.kind).toBe("proposal-edited");
      const work = readBudgetProposal(runtime.store, "g").allocations.find((a) => a.ownerKind === "task" && a.ownerId === "a" && a.bucket === "work")!;
      expect(work.amount.tokens).toBe(180_000);
      expect(work.fieldProvenance.tokens).toEqual({ provenance: "model", estimateId });

      const confirmed = await confirmSoft(runtime, "confirm");
      expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
      const started = await runtime.service.start(raw(runtime, "start", "start", {}));
      expect("error" in started ? started.error.code : "started").toBe("started");
      await until(() => JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body)).status === "done", 120_000, "task a to land", 50);
      expect(w.show("a.txt")).toBe("A");
    } finally { await w.teardown(); }
  });
```

（`"error" in started ? started.error.code` —— 若 `CommandErrorBodyV1` 的错误在 `.error.code`，照既有 `startGroup` 的写法；实施时以 tsc 为准。`w.show` 返回 `trim()` 过的内容，所以是 `"A"`。）

- [ ] **Step 2: 跑**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ORCA_CCLOOP_BIN="$SCRATCH/ccloop-bin/dist/cli.js" ./node_modules/.bin/vitest run tests/control/estimateE2E.test.ts > "$SCRATCH/o5-e1.txt" 2>&1; echo rc=$?
```
Expected: rc=0，3 passed（E1–E3），0 skipped。E1 在 O3 之前的红由 M-O3a 量（下）。

- [ ] **Step 3: 提交**

```bash
cd /Users/biran/code/skills/loop/Orca && git add tests/control/estimateE2E.test.ts && git commit -F - <<'EOF'
test(control): an estimate runs end to end under real ccloop and fake claude, and its advice reaches the proposal

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**：
- M-O5a（= spec §8.4 点名、跨 Task）：在 Orca 的独立 clone 里套 M-O3a（`driverRunIds` 不收估算）⇒ E1 红，报错串含 `start answered estimate-in-flight`（且 `confirm confirmed`）。**这就是今天卡死的实测**，原文进台账。
- M-O5b：Orca 独立 clone 里把 A2e 的 `maxOutputTokens: contract.maxOutputTokens` 改为 `1` ⇒ E1 红在 `maxOutputTokensEnv` 为 `"1"`，且仅这一句（1 仍是合法的正整数，调用照常完成）。

---

### Task O6: 面板「应用建议」— `suggestedOperations` 与 BudgetEditor 的按钮

**Files:**
- Modify: `web/src/BudgetEditor.tsx`
- Create: `web/tests/budgetSuggestions.test.tsx`

**Interfaces:**
- Consumes: 服务端不改（`proposal-edit` 已收 `provenance:"model"`＋`estimateId`，`verifyModelField` 逐字段核）；组视图 `estimates[].output` 已下发；`controlTypes.ts` 不改（`ProposalOperationV1.estimateId?` 已有，`webParity` 不受影响）。
- Produces：`export type SuggestionScope = { kind: "field"; target: ProposalTargetV1 } | { kind: "row"; ownerKind: "task" | "goal-review"; ownerId: string; bucket: "work" | "handoff" | "review" } | { kind: "all" }`；`export function adviceOf(view: GroupViewV1): { estimateId: string; output: BudgetEstimateV1 } | null`；`export function suggestedOperations(view: GroupViewV1, scope: SuggestionScope): ProposalOperationV1[]`。
- UI 约束（handoff §4.0.a、§6.19）：只改 Task control 分区内的 BudgetEditor；四个分区挂载方式、`styles.css`、`orca panel` 的 ready 行一律不碰；不加 CSS（新按钮沿用既有 `button` 的两套主题 token）；**任一显示条件不满足时 DOM 与今天逐字相同**（判据量 `innerHTML`）。

- [ ] **Step 1: 写失败的判据** — `web/tests/budgetSuggestions.test.tsx`

```tsx
// @vitest-environment jsdom
/**
 * Single-call estimate spec §7 (human ruling S3): the model's suggestions are applied per field, per row or all at
 * once, each as one proposal-edit whose operations carry provenance "model" and the estimate's id. Only the newest
 * estimate (by version) advises, only when it is ready and for this plan, and only while the proposal is editable.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEditor, adviceOf, suggestedOperations } from "../src/BudgetEditor.js";
import type { Amount, ControlConfigV1, EstimateViewV1, GroupViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const human = { provenance: "human", estimateId: null } as const;
const provenance = { tokens: human, activeMs: human, attempts: human, sessions: human };
const system = { provenance: "system", estimateId: null } as const;
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-26T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const PLAN = "a".repeat(64);
const suggestion = {
  schema: "budget-estimate-v1" as const, planHash: PLAN,
  // work: tokens equal (3000), activeMs and attempts differ, sessions equal; handoff all equal; review tokens differ.
  tasks: [{ taskId: "a", complexity: "M" as const, confidence: "high" as const, work: { tokens: 3_000, activeMs: 45_000, attempts: 2, sessions: 1 }, handoff: amount(300), rationale: "one module to touch", assumptions: ["tests exist", "the API is stable"] }],
  goalReviewReserve: { tokens: 1_500, activeMs: 10_000, attempts: 1, sessions: 1 }, groupRationale: "a single small change",
};
const estimate = (over: Partial<EstimateViewV1> = {}): EstimateViewV1 => ({
  estimateId: "est-2", estimateVersion: 2, state: "ready", profile: { profileId: "all", profileHash: "b".repeat(64) }, mode: "soft",
  requestHash: "c".repeat(64), outputHash: "d".repeat(64), output: suggestion, reasonCode: null, ...over,
});
const view = (over: Partial<GroupViewV1> = {}): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1,
  summary: { groupId: "g", state: "draft", commandRevision: 3, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: PLAN, goal: "Ship", successConditions: ["passes"] },
  proposal: { state: "editable", proposalVersion: 2, planHash: PLAN, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
  ledger: { groupLimit: amount(90_000), used: amount(0), committedRemaining: amount(4_300), explicitUnallocatedReserve: amount(6_000), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [
    { ownerKind: "task", ownerId: "a", bucket: "work", state: "draft-encumbered", amount: amount(3_000), fieldProvenance: provenance },
    { ownerKind: "task", ownerId: "a", bucket: "handoff", state: "draft-encumbered", amount: amount(300), fieldProvenance: provenance },
    { ownerKind: "goal-review", ownerId: "g:goal-review", bucket: "review", state: "draft-encumbered", amount: amount(1_000), fieldProvenance: provenance },
    { ownerKind: "reserve", ownerId: "g:reserve", bucket: "reserve", state: "draft-encumbered", amount: amount(6_000), fieldProvenance: { tokens: system, activeMs: system, attempts: system, sessions: system } },
  ],
  workItems: [{ taskId: "a", status: "draft", dependencyTaskIds: [], targetVersion: 1, configHash: null, originalContractHash: "e".repeat(64), derivedContractHash: null, currentRunId: null, pendingRunId: null, lineageRunIds: [] }],
  estimates: [estimate()], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
  ...over,
});
const op = (target: object, value: number) => ({ target, value, provenance: "model", estimateId: "est-2" });
const ALL = [
  op({ scope: "task", taskId: "a", allocation: "work", dimension: "activeMs" }, 45_000),
  op({ scope: "task", taskId: "a", allocation: "work", dimension: "attempts" }, 2),
  op({ scope: "goal-review", dimension: "tokens" }, 1_500),
];

afterEach(cleanup);

describe("suggestedOperations (single-call estimate spec §7)", () => {
  it("offers every field whose suggestion differs, and nothing whose suggestion is the value already there", () => {
    expect(suggestedOperations(view(), { kind: "all" })).toEqual(ALL);
    expect(suggestedOperations(view(), { kind: "row", ownerKind: "task", ownerId: "a", bucket: "work" })).toEqual(ALL.slice(0, 2));
    expect(suggestedOperations(view(), { kind: "row", ownerKind: "task", ownerId: "a", bucket: "handoff" })).toEqual([]);
    expect(suggestedOperations(view(), { kind: "field", target: { scope: "goal-review", dimension: "tokens" } })).toEqual([ALL[2]]);
    expect(suggestedOperations(view(), { kind: "field", target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" } })).toEqual([]);
  });

  it("offers nothing unless the newest estimate is ready, for this plan, and the proposal is editable", () => {
    expect(suggestedOperations(view({ estimates: [estimate({ output: { ...suggestion, planHash: "f".repeat(64) } })] }), { kind: "all" })).toEqual([]);
    expect(suggestedOperations(view({ proposal: { ...view().proposal, state: "confirmed" } }), { kind: "all" })).toEqual([]);
    // Newest by version, not by list order (the view lists estimates by id): a newer running one silences an older ready one...
    expect(suggestedOperations(view({ estimates: [estimate({ estimateId: "est-1", estimateVersion: 3, state: "running", output: null, outputHash: null }), estimate()] }), { kind: "all" })).toEqual([]);
    // ...and the newest ready one advises even when it is listed first.
    expect(adviceOf(view({ estimates: [estimate(), estimate({ estimateId: "est-9", estimateVersion: 1, output: { ...suggestion, groupRationale: "older" } })] }))?.estimateId).toBe("est-2");
  });
});

describe("the budget editor's suggestion controls (single-call estimate spec §7)", () => {
  it("renders exactly today's editor when no estimate may advise", () => {
    const today = render(<BudgetEditor view={view({ estimates: [] })} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.innerHTML;
    cleanup();
    for (const unusable of [view({ estimates: [estimate({ output: { ...suggestion, planHash: "f".repeat(64) } })] }), view({ estimates: [estimate({ state: "failed", output: null, outputHash: null, reasonCode: "estimate-output-invalid" })] })]) {
      expect(render(<BudgetEditor view={unusable} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />).container.innerHTML).toBe(today);
      cleanup();
    }
  });

  it("sends one proposal-edit per control: a field, a row, and all", () => {
    const onCommand = vi.fn();
    render(<BudgetEditor view={view()} config={config} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} />);
    const edit = (operations: unknown[]) => ({ verb: "proposal-edit", groupId: "g", expectedRevision: 3, payload: { baseProposalVersion: 2, operations } });
    fireEvent.click(screen.getByRole("button", { name: "use 45000 for a work activeMs" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply row a work" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply all suggestions" }));
    expect(onCommand.mock.calls.map((call) => call[0])).toEqual([edit([ALL[0]]), edit(ALL.slice(0, 2)), edit(ALL)]);
    // No control for a field or a row that has nothing to change.
    expect(screen.queryByRole("button", { name: "use 3000 for a work tokens" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply row a handoff" })).toBeNull();
  });

  it("shows the model's reasons read-only under the table", () => {
    render(<BudgetEditor view={view()} config={config} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    const details = screen.getByText("Estimate rationale (est-2)").closest("details")!;
    expect(details.textContent).toContain("a single small change");
    expect(details.textContent).toContain("a · M · confidence high · one module to touch");
    expect(details.textContent).toContain("the API is stable");
    expect(details.querySelectorAll("input, button")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑，确认红**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca/web && ../node_modules/.bin/vitest run tests/budgetSuggestions.test.tsx > "$SCRATCH/o6-red.txt" 2>&1; echo rc=$?
```
Expected: rc=1；两条纯函数判据红在 `suggestedOperations is not a function`／`adviceOf is not a function`；`renders exactly today's editor…` **今天绿**（没有任何新控件）——它由 M-O6d 补红证；按钮判据红在 `Unable to find an accessible element with the role "button" and name "use 45000 for a work activeMs"`；rationale 红在 `Unable to find an element with the text: Estimate rationale (est-2)`。

- [ ] **Step 3: 实现** — `web/src/BudgetEditor.tsx`

类型 import 加 `AllocationViewV1, BudgetEstimateV1`。`editedOperations` 之后加：

```ts
/** Single-call estimate spec §7: what one "apply" control covers. */
export type SuggestionScope =
  | { kind: "field"; target: ProposalTargetV1 }
  | { kind: "row"; ownerKind: "task" | "goal-review"; ownerId: string; bucket: "work" | "handoff" | "review" }
  | { kind: "all" };

/**
 * The estimate that may advise this proposal, or null: the newest by version (the view lists estimates by id, drafter
 * finding F12), and only when it is ready, for this plan, and the proposal is still editable. Anything else and the
 * editor is exactly what it was before suggestions existed.
 */
export function adviceOf(view: GroupViewV1): { estimateId: string; output: BudgetEstimateV1 } | null {
  if (view.proposal.state !== "editable") return null;
  let newest: GroupViewV1["estimates"][number] | null = null;
  for (const estimate of view.estimates) if (newest === null || estimate.estimateVersion > newest.estimateVersion) newest = estimate;
  if (newest === null || newest.state !== "ready" || newest.output === null || newest.output.planHash !== view.plan.planHash) return null;
  return { estimateId: newest.estimateId, output: newest.output };
}

function suggestedAmount(output: BudgetEstimateV1, allocation: AllocationViewV1): Amount | null {
  if (allocation.ownerKind === "goal-review" && allocation.bucket === "review") return output.goalReviewReserve;
  if (allocation.ownerKind !== "task" || (allocation.bucket !== "work" && allocation.bucket !== "handoff")) return null;
  return output.tasks.find((task) => task.taskId === allocation.ownerId)?.[allocation.bucket] ?? null;
}

/**
 * The only place that decides which suggestions a control sends (the editedOperations of the model's advice): each
 * field in `scope` whose suggested value differs from the proposal's, as provenance "model" with the estimate's id --
 * the exact number the server re-checks (verifyModelField). A field already at its suggestion sends nothing.
 */
export function suggestedOperations(view: GroupViewV1, scope: SuggestionScope): ProposalOperationV1[] {
  const advice = adviceOf(view);
  if (advice === null) return [];
  const groupId = view.summary.groupId;
  const operations: ProposalOperationV1[] = [];
  for (const allocation of view.allocations) {
    const suggested = suggestedAmount(advice.output, allocation);
    if (suggested === null) continue;
    if (scope.kind === "row" && (allocation.ownerKind !== scope.ownerKind || allocation.ownerId !== scope.ownerId || allocation.bucket !== scope.bucket)) continue;
    for (const dimension of DIMENSIONS) {
      const target = targetOf(view, allocation.ownerId, allocation.bucket, dimension);
      if (target === null) continue;
      if (scope.kind === "field" && budgetFieldKey(groupId, target) !== budgetFieldKey(groupId, scope.target)) continue;
      if (suggested[dimension] === allocation.amount[dimension]) continue;
      operations.push({ target, value: suggested[dimension], provenance: "model", estimateId: advice.estimateId });
    }
  }
  return operations;
}
```

组件内（`const estimator = …` 之后）：

```tsx
  const advice = adviceOf(view);
  const allSuggested = suggestedOperations(view, { kind: "all" });
  // Spec §7: applying a suggestion is its own command, never a draft; the server re-checks every value.
  const applySuggestions = (operations: ProposalOperationV1[]): void => {
    if (operations.length === 0) return;
    onCommand({ verb: "proposal-edit", groupId, expectedRevision: view.summary.commandRevision, payload: { baseProposalVersion: view.proposal.proposalVersion, operations } });
  };
```
表头：`<tr>…{DIMENSIONS.map(…)}{advice !== null && <th>suggestion</th>}</tr>`。每一行：在 `DIMENSIONS.map` 的单元格里把按钮放在 `<label>` **之后**（仍在 `<td>` 内）：

```tsx
                const [fieldOperation] = suggestedOperations(view, { kind: "field", target });
                return (
                  <td key={dimension}>
                    <label>
                      {/* unchanged: sr-only span, input, provenance */}
                    </label>
                    {fieldOperation !== undefined && (
                      <button type="button" aria-label={`use ${fieldOperation.value} for ${allocation.ownerId} ${allocation.bucket} ${dimension}`}
                        onClick={() => applySuggestions([fieldOperation])}>use {fieldOperation.value}</button>
                    )}
                  </td>
                );
```
行尾（`DIMENSIONS.map` 之后）：

```tsx
              {advice !== null && (() => {
                const row = allocation.ownerKind === "task" || allocation.ownerKind === "goal-review"
                  ? suggestedOperations(view, { kind: "row", ownerKind: allocation.ownerKind, ownerId: allocation.ownerId, bucket: allocation.bucket as "work" | "handoff" | "review" })
                  : [];
                return <td>{row.length > 0 && <button type="button" aria-label={`Apply row ${allocation.ownerId} ${allocation.bucket}`} onClick={() => applySuggestions(row)}>Apply row</button>}</td>;
              })()}
```
`</table>` 之后：

```tsx
      {allSuggested.length > 0 && <button type="button" onClick={() => applySuggestions(allSuggested)}>Apply all suggestions</button>}
      {advice !== null && (
        <details>
          <summary>Estimate rationale ({advice.estimateId})</summary>
          <p>{advice.output.groupRationale}</p>
          <ul>
            {advice.output.tasks.map((task) => (
              <li key={task.taskId}>
                {task.taskId} · {task.complexity} · confidence {task.confidence} · {task.rationale}
                <ul>{task.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
              </li>
            ))}
          </ul>
        </details>
      )}
```
（`<label>` 内部原样不动；`fieldOperation` 不存在时该 `<td>` 的 DOM 与今天逐字相同。）

- [ ] **Step 4: 跑，确认绿（含 web 既有判据与类型）**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca/web && ../node_modules/.bin/vitest run tests/budgetSuggestions.test.tsx tests/confirmSelection.test.tsx tests/controlPanel.test.tsx tests/shell.test.tsx tests/styles.test.ts tests/contrast.test.ts > "$SCRATCH/o6-green.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca/web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > "$SCRATCH/o6-tsc.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/panel/webParity.test.ts > "$SCRATCH/o6-parity.txt" 2>&1; echo rc=$?
```
Expected: rc=0 三次。

- [ ] **Step 5: 提交**

```bash
cd /Users/biran/code/skills/loop/Orca && git add web/src/BudgetEditor.tsx web/tests/budgetSuggestions.test.tsx && git commit -F - <<'EOF'
feat(web): apply the model's suggestions per field, per row or all at once, and show its reasons

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**（独立 clone，先绿基线）：
- M-O6a：删掉 `if (suggested[dimension] === allocation.amount[dimension]) continue;` ⇒ 红在 `offers every field whose suggestion differs…`（`toEqual(ALL)` 多出等值项）与 `sends one proposal-edit per control…`（字面量载荷不符），且仅这两条。
- M-O6b：`adviceOf` 删掉 `newest.output.planHash !== view.plan.planHash` ⇒ 红在 `offers nothing unless…`（首句）与 `renders exactly today's editor…`（第一种 unusable），且仅这两条。
- M-O6c：`adviceOf` 改回 `view.estimates.at(-1)` ⇒ 红在 `offers nothing unless…`（最后两句）且仅它。
- M-O6d：表头的 `{advice !== null && <th>suggestion</th>}` 改成无条件渲染 ⇒ 红在 `renders exactly today's editor…` 且仅它。
- M-O6e：删掉 `if (view.proposal.state !== "editable") return null;` ⇒ 红在 `offers nothing unless…`（confirmed 那句）且仅它。

---

### Task O7: 验收脚本 `--scenario estimate`（claude；先 `--fake-claude`）

**Files:**
- Modify: `scripts/live-driver-acceptance.ts`

**Interfaces:**
- Consumes: O1–O5；ccloop clone；F15（fake claude 的 `"single-call"` 条目）。
- Produces: `--scenario estimate`：只接 `--claude`／`--fake-claude`；profile 声明 `contextWindowTokens: 1_000_000`；operator 偏好在导入**之前**设（估算槽在导入时冻结），claude `contextWindow` 缺省为 1M；新增 checks `estimateQueued`、`estimateReady`、`estimateUsageBooked`、`estimateToolsOff`、`startAllowed`；`ledgerMatchesCcloop`／`everyCallHasUsage`／`providerCalls` 在本场景把估算那次调用单列为 `role: "estimate"`。

- [ ] **Step 1: 改脚本**（逐处；别的场景行为一字不变）

1. 头注释 usage 行的 `[--scenario single|conflict|deadline]` 改为 `[--scenario single|conflict|deadline|estimate]`，并在 deadline 那段之后加：

```ts
// --scenario estimate (claude kinds only; single-call estimate spec §8.6): the estimator runs as one ccloop single
// call. The profile declares claude's 1M window and the operator's preferences are set BEFORE the import, so the
// import's estimator slot is claude 1M and the estimate queues; under --fake-claude the fake's single-call answer is
// written after the import (the plan hash is known then) and before the pump starts. Checks: the estimate is ready,
// start is not refused (estimate-in-flight is what a stuck estimate costs), and its usage is booked.
```
2. 场景校验：`if (scenario !== "single" && scenario !== "conflict" && scenario !== "deadline" && scenario !== "estimate") throw new Error("--scenario is single, conflict, deadline or estimate");`，其后加 `if (scenario === "estimate" && kind !== "claude") throw new Error("--scenario estimate needs --claude or --fake-claude");`。
3. `contextWindow`：`const contextWindow = args["context-window"] === undefined ? (scenario === "estimate" ? 1_000_000 : undefined) : Number(args["context-window"]);`，校验之后加 `if (scenario === "estimate" && contextWindow !== 1_000_000) throw new Error("--scenario estimate needs the 1M window (ccloop reports contextWindowTokens only for it)");`。
4. 脚本文件：`scenario === "single"` 分支改为 `scenario === "single" || scenario === "estimate"`；`tasks` 的三元同样把 `estimate` 归入 single（`answer.txt`）；`checks.landedBytes` 的 `scenario === "single"` 同样改为 `(scenario === "single" || scenario === "estimate")`。
5. profile 的 `contextWindowTokens: null` 改为 `contextWindowTokens: scenario === "estimate" ? 1_000_000 : null`（注释 `// estimate: the window claude 1M answers, so the estimate is not blocked-capability.`）。
6. 偏好与导入：把 `const preferences = …; if ("error" in preferences) throw …` 两句包成 `const setPreferences = async () => { … };`，然后：

```ts
  if (scenario === "estimate") await setPreferences();
  const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId, planId: "plan" }));
  summary.imported = imported;
  if (scenario !== "estimate") await setPreferences();
  if (scenario === "estimate") {
    const result = (imported as { result?: { estimateId?: string; estimateState?: string } }).result;
    checks.estimateQueued = result?.estimateState === "queued";
    estimateId = result?.estimateId ?? null;
    const planHash = readArchivedPlan(runtime.store, "g").planHash;
    if (fakeClaude) {
      const answer = { schema: "budget-estimate-v1", planHash,
        tasks: [{ taskId: "a", complexity: "S", confidence: "high", work: { tokens: taskTokens, activeMs, attempts: taskAttempts, sessions: taskAttempts }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, rationale: "one file with one line", assumptions: ["answer.txt does not exist yet"] }],
        goalReviewReserve: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 }, groupRationale: "a single one-line task" };
      await writeFile(scriptPath, JSON.stringify({ a: { files: { "answer.txt": "42\n" } }, "single-call": { output: answer } }));
    }
    runtime.startPump(200);
    const settleBy = Date.now() + deadlineMs;
    while (estimateId !== null && ["queued", "running"].includes(readEstimateRecord(runtime.store, "g", estimateId).state) && Date.now() < settleBy) await new Promise((r) => setTimeout(r, 200));
    const record = estimateId === null ? null : readEstimateRecord(runtime.store, "g", estimateId);
    summary.estimate = record;
    checks.estimateReady = record?.state === "ready";
  }
```
（在 `let observedPath…` 旁声明 `let estimateId: string | null = null;`；import 加 `readEstimateRecord`。`startPump` 之后再调一次返回 `false`，无害。）
7. start：`if ("error" in started) throw …` 改为

```ts
  if (scenario === "estimate") { checks.startAllowed = !("error" in started); summary.started = "error" in started ? started.error : "started"; }
  if ("error" in started) { if (scenario !== "estimate") throw new Error(`start refused: ${JSON.stringify(started.error)}`); }
  else runtime.startPump(200);
```
（`estimate` 场景 start 被拒时不再推进，`settle` 等待会因 `settledAll` 为假而超时——改成：`let settle = !(scenario === "estimate" && checks.startAllowed === false);`。）
8. 调用归属：`calls` 的两个 `map` 里 `role` 的计算改为 `role: estimateSourceDir !== null && file.startsWith(`${estimateSourceDir}/`) ? "estimate" : file.includes("/reconcile-") ? "reconcile" : "worker"`，其中在 `const runs = workRuns(runtime);` 之后加

```ts
const estimateRow = runtime.store.db.prepare("SELECT body FROM runs WHERE group_id='g' AND json_extract(body,'$.phase')='estimate'").get();
const estimateBody = estimateRow === undefined ? null : JSON.parse(String(estimateRow.body)) as { runId: string; drive?: { sourceDir: string }; unknown: { work: boolean }; cumulative: { work: { tokens: number } } };
const estimateSourceDir = estimateBody?.drive?.sourceDir ?? null;
```
（`calls` 的定义要挪到这几行之后。）
9. 估算专属 checks（`if (scenario === "deadline") {…}` 之后）：

```ts
if (scenario === "estimate") {
  // The usage ccloop reported for the estimate run, as Orca booked it: known, positive, equal to ccloop's last event.
  const events = estimateBody === null ? [] : runtime.store.db.prepare("SELECT body FROM usage_events WHERE run_id=? ORDER BY seq").all(estimateBody.runId)
    .map((row) => JSON.parse(String(row.body)) as { bucket: string; cumulative: { tokens: number } | null }).filter((event) => event.bucket === "work");
  summary.estimateUsage = events;
  const booked = estimateBody?.cumulative.work.tokens ?? null;
  checks.estimateUsageBooked = estimateBody !== null && estimateBody.unknown.work === false && booked !== null && booked > 0
    && events.length > 0 && events.at(-1)!.cumulative?.tokens === booked;
  // Tools off, as the claude CLI received it (the tee's argv files, the agent's own record).
  const argvs = existsSync(claudeRaw) ? readdirSync(claudeRaw).filter((name) => name.endsWith(".argv.json")).map((name) => JSON.parse(readFileSync(join(claudeRaw, name), "utf8")) as string[]) : [];
  checks.estimateToolsOff = argvs.some((argv) => { const i = argv.indexOf("--tools"); return i >= 0 && argv[i + 1] === ""; });
}
```
10. 汇总类 checks 在本场景排除估算那次：`checks.everyCallHasUsage` 的 `calls` 改为 `calls.filter((call) => call.role !== "estimate")`（仅 `scenario === "estimate"` 时过滤，其它场景 `calls` 里没有 `estimate` 角色，结果不变）；`checks.ledgerMatchesCcloop = scenario === "estimate" ? ledger.used.tokens === calls.filter((call) => call.role !== "estimate").reduce((sum, call) => sum + (call.total ?? 0), 0) + (estimateBody?.cumulative.work.tokens ?? 0) : ledger.used.tokens === ccloopTotal;`；`providerCalls` 已只看 `role === "worker"`，不变。

- [ ] **Step 2: 类型检查**

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/o7-tsc.txt" 2>&1; echo rc=$?
```
Expected: rc=0。

- [ ] **Step 3: 先跑 `--fake-claude`**（需要 ccloop clone；`--output` 必须是不存在的新目录）

```bash
: "${SCRATCH:?set SCRATCH first}"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/tsx scripts/live-driver-acceptance.ts --ccloop-bin "$SCRATCH/ccloop-bin/dist/cli.js" --output "$SCRATCH/accept-estimate-fake" --fake-claude --scenario estimate --task-tokens 150000 --group-tokens 800000 > "$SCRATCH/o7-fake.txt" 2>&1; echo rc=$?
```
Expected: rc=0；输出 JSON 的 `"failed": []`；整份读 `"$SCRATCH/accept-estimate-fake/summary.json"`，核 `checks.estimateQueued/estimateReady/estimateUsageBooked/estimateToolsOff/startAllowed` 全为 `true`、`orcaHomeUntouched` 为 `true`。再跑一次既有 `--fake-claude --scenario single` 证明别的场景没被带坏（rc=0，`failed: []`）。真 claude 付费跑归 A 线，**每次问人**，本计划不跑。

- [ ] **Step 4: 提交**

```bash
cd /Users/biran/code/skills/loop/Orca && git add scripts/live-driver-acceptance.ts && git commit -F - <<'EOF'
test(scripts): a live estimate scenario for claude, run first against the fake

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**（Orca 独立 clone 套 M-O3a，`ORCA_CCLOOP_BIN` 仍指那份未变异的 ccloop clone）：
- M-O7a：脚本退出码 1，`failed` 恰为 `["estimateReady", "startAllowed", "estimateUsageBooked", "estimateToolsOff", …]` 中由这条变异导致的那些——**预言只写两条必红：`estimateReady` 与 `startAllowed`**（其余是否红取决于 ccloop 是否被调用，实测后照录，不预言）。

---

## 叫不出名字 / 需要控制器补的判据

- `workspaceOf` 在 `stepA2`／`cleanupPredecessor`／`stepE` 的三处守卫：对 work run 不可达、估算 run 不经过 ⇒ 登记为类型守卫，无判据。
- 冻结下「调用已完成、输出也在」的 H3 只在单元层（synthetic ccloop）量；真 ccloop 上要造这个时序得靠 ccloop fake 的「写完输出后再等 handoff」模式，本草稿没有这个模式名（F15 之外），**E2E 层未覆盖**。
- E1 的 `cumulative.work.tokens === 15`、`maxOutputTokensEnv === "64000"`、`--tools ""` 三句依赖 ccloop 席的 fake 定稿（F15）。
- O7 的 `estimateToolsOff` 在真 claude 下同样读 tee 的 argv，属同一依赖。


---

# Final — 控制器自己做

- [ ] **变异总表**：把 Part A、Part B 每个 Task 末尾的 Mutation 行汇成一张表，逐条在单独的 `git clone --local`（不是 `ORCA_CCLOOP_BIN` 那份）里做：先跑绿基线，落变异（`shasum -a 256` 前后比），跑点名判据看到红，还原（`git diff`／`git diff --cached` 字节数为 0）。结果（每条的判据名、红在哪条断言、行号）追加进台账。
- [ ] **两仓干净门**（spec §8.5）：ccloop 新 clone（软链 `node_modules`、`npm run build`、`cd` 进 clone、HOME 与四个 XDG 根改道）跑全量 json reporter ＋ `node scripts/check-known-reds.mjs` RC 0、typecheck／build RC 0；Orca 新 clone 先 `npm run build --workspace web`、夹具表 fake codex `integration`、`ORCA_CCLOOP_BIN` 指 ccloop 最后一笔的 clone build，跑全量、web 套件、`verify:panel`，真 `~/.orca` 前后 `stat`。每次记 `uptime`；红了先按 handoff 的 flake 规则判。
- [ ] **验收脚本 fake 跑**：`--fake-claude --scenario estimate` 跑绿，summary 进台账。真 claude 付费跑不做（归 A 线，每次问人）。
- [ ] **台账收口**：全部 `Ruling:`、S6 改写名单（`REWRITTEN` 行）、夹具改动、变异表、门的原始报数、挂账。
- [ ] **三份 handoff**：Orca 滚动 §三／§4.0／§九；ccloop、ccmem 的「Orca 那条线」整节替换，不追加；都不写当前哈希。
