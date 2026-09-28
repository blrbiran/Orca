# Task 标签 ＋ 内部进度（goal.md N8 ＋ N3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** plan 里的每个 task 可带多个标签（系统词 ＋ `custom:` 自定义），人在面板上随时可改（命令 `set-task-labels`，任何组状态都能改、不动预算提案）；面板上组级给「已完成 task 数／总数」，task 级给 ccloop 报的阶段、第几次尝试（ccloop 同一份快照）、token 已用占比（未知就是「未知」，绝不给 0），点开一个 task 能看到标签编辑器、进度、历次 run 与逐件 evidence。

**Architecture:** 新文件 `src/control/labels.ts` 是标签的唯一定义（输入口查词表，存储层只查格式）。plan 解析器排序去重，存档 plan 只在非空时写 `labels`（无标签 plan 的字节与 `planHash` 不变）。work item body 加 `labelsOverride`／`labelsVersion` 覆盖层，生效标签只在 `effectiveTaskLabels` 一处算。ccloop `collect` 新增 `progress`（读 `run/loop-state.json`，校验形状）；Orca 端 `progress` 可选接收，`collectInto` 在用量循环之后**新读** run 再存，投影层把 `status` 映射成 `step`。视图新字段在线上 schema 里可选、服务端总是给出。Web 加标签列、筛选、详情面板、进度列、导航完成度。

**Tech Stack:** TypeScript、zod、vitest（Orca 与 ccloop）、React 19 ＋ @testing-library/react（Orca `web/`，jsdom）、node:sqlite。

**Spec:** Orca `docs/superpowers/specs/2026-09-28-labels-and-progress-design.md`（先读全文；**§8 R1–R19 优先于上文**）。台账：Orca `.superpowers/sdd/2026-09-29-labels-progress-and-backlog/progress.md`（只追加）。

> 起草者：Orca 控制器会话 `2724716d` 派出的起草子 agent（Claude Opus 5.5），2026-09-29。只读探查 ＋ 在 scratchpad 跑了一个只读的 hash 探针（见 F12），未改两仓任何文件。
> 读过：spec 全文、两仓 `CLAUDE.md`、上一份计划 `2026-09-27-single-call-estimate.md` 的头部与 Task 1，以及下文每处引用的源码与判据。
> 行号一律「measured 2026-09-29 at Orca `084f15f` ／ ccloop `b1c383e`，引用前现测」。

## Drafter findings

下列是**真实代码与 spec 对不上**、或 spec 没定而本计划必须定的地方。每条给证据与本计划的处理；都是可逆选择（Rule 1 第 2 档），控制器可推翻，推翻哪条就改哪个 Task。

| # | 发现 | 证据 | 本计划的处理 |
|---|---|---|---|
| F1 | spec §2.1 说 `labels.ts`「CLI 与 Web 共用」，但 `web/` 不能 import `src/`（浏览器包不能带服务端模块图） | `tests/panel/webParity.test.ts:67-75`（task 8 ruling K2）；`web/` 里没有任何对 `src/` 的 import | 服务端（plan 解析器 ＋ Web 命令）共用 `labels.ts`；浏览器在 `web/src/controlTypes.ts` 放词表镜像 `WEB_SYSTEM_LABELS`，由 `webParity` 新增一条运行时判据逐项比对（Task 7） |
| F2 | R8 写 raw payload `labels: z.array(z.string()).max(16)`，R15 又说 16 个上限**在去重之后**数 —— 17 个含一个重复的输入，前者 400、后者该收 | spec §8 R8 与 R15 原文 | 以 R15 为准：raw schema 只设宽上限 `.max(64)` 防超大请求；16 在 `apply` 里去重后数，拒为 `labels-invalid:count:<n>`（Task 4，变异 M4h 量它） |
| F3 | R4 要求「经真 port ＋ `fake-ccloop-control.mjs` 走一遍」，R5 又说 fake 二进制「一处都不改」 | spec §8 R4、R5；`tests/control/fixtures/fake-ccloop-control.mjs:53` 的 collect 应答没有 progress | 以 R4 为准、守 R5 的意图：给 fake 加**一个可选旋钮** `config.progress`，缺省时输出逐字节不变；台账记为夹具改动（Task 5） |
| F4 | R11 写 grant ＝ used ＋ remaining；run body 本来就存 `grant`，且两者只在未超支时相等（`remaining = max(grant − cumulative, 0)`） | `src/panel/controlViews.ts:474-481` `validAccounting` | 直接用 `run.grant[bucket].tokens`；超支时 R11 本来就给 `null`，两种写法在给数的区间里等价 |
| F5 | `readGroupSummary` 今天不读 work item；完成度要读。若严格解析，一条坏 work item 会让整张摘要列表 `recovery-blocked`，并改掉组视图里既有判据断言的报错文本（`readControlGroup` 先调摘要、后调 `workViews`） | `controlViews.ts:245-266`、`617-656` | 完成度**宽松地**读（读不了的算未完成），放在摘要既有检查之后；坏 work item 仍由 `workViews` 以原文报 `work-item-invalid:*` |
| F6 | spec 的 work item `progress` 没说「有当前 run 但 ccloop 还没报过」怎么表示（旧 run 也没有 progress 键，R1） | spec §4.1、§8 R1 | `progress` 为 `null` 当且仅当没有当前 run；否则是 `{ runId, step, attempt, tokens, lastTransitionAt }`，其中来自 ccloop 的三项在没报过时各自为 `null` |
| F7 | 「组级 `completion` ＋ 摘要 `GroupSummaryV1` 也加同一个字段」 | spec §4.1 | 只加在 `groupSummarySchema`：组视图的 `summary` 就是它，一处计算、两处看到（P5 两处一致由构造保证，判据仍两处都量） |
| F8 | 存储层「长度上限」没给数 | spec §2.1 | `MAX_STORED_LABEL_CODE_POINTS = 64`（> `custom:` ＋ 32），故意比输入宽，以后输入规则改了也不会让旧标签读不出来 |
| F9 | 孤立代理不能出现在拒绝消息里：命令结果以 `canonicalBytes` 存盘，它会抛 | `src/control/canonicalJson.ts:8-26`；`commandLedger.ts:232` | 含孤立代理的项拒为 `labels-invalid:lone-surrogate`，不回显原文 |
| F10 | spec 写 UI 显示「未知」「阶段结束时上报」；面板 UI 全是英文 | `web/src/ControlGroupView.tsx`、`ControlPanel.tsx` 全文 | 按 Rule 11 用 `unknown`／`(reported at phase end)`；含义不变 |
| F11 | 「编辑草稿只在命令成功后才清」：`ControlGroupView` 看不到命令结果；现有 `BudgetEditor` 的草稿从不自动清 | `web/src/App.tsx:275-295` `sendControl`；`web/src/BudgetEditor.tsx:183-192` | 草稿存 `drafts[labels:<group>:<task>]`；`App.sendControl` 在 `set-task-labels` 得到 2xx 时清这一键，4xx／不确定都不清（Task 7） |
| F12 | L1 要「改动前硬编码的值」 | 探针：scratchpad `plan-probe/hash.ts` 用 `normalizeControlPlan` 复刻 `tests/control/planImport.test.ts` 的 `setup()` 夹具，`./node_modules/.bin/tsx <probe> > out.txt` | 实测（Orca `084f15f`）：`planHash = e38685e8b39330ab91ccbbc73c6bc60cb432e627e4811e1854b73bc13de27c5f`，规范字节 2251（UTF-8 字节数）。Task 0 在未改动的树上重测，不等就停 |
| F13 | R12 的退路条件：「会改到既有判据的断言」 | `rtk proxy grep -rn 'control-plan-rejected' tests web/tests` 只命中 `tests/control/planImport.test.ts:372`（`toMatchObject` 只比 code）；没有判据断言 `malformed` 的 detail | 走 R12 主路径（detail 带 malformed 消息），不退路；台账记一行 |
| F14 | `webFixture` 的 plan 任务不能带标签 | `tests/control/fixtures/web.ts:27`、`:67` | 夹具加可选 `labels`（缺省时写出的 plan 逐字节不变）；台账记为夹具改动 |
| F15 | R2 的伪代码「`current.progress = …`」每次都写：R5 下假 port 不答 `progress`，那样每个 run 都会多出 `progress:null` 并推进 `changeSeq`，还会改动既有判据观测到的计数 | `tests/control/fixtures/driverPort.ts:137-153` | 只在 `report.progress !== undefined` 时写；「run 没有 progress 键、应答为 null」不算变化（缺键读作 null，R1），不写 |
| F16 | E2E 需要带 progress 的 ccloop build；夹具表 `$SCRATCH/agents/agents.json` 的 fake codex 指向旧副本 `$SCRATCH/ccbin` | 该表 `command[1]` ＝ `…/scratchpad/ccbin/tests/fixtures/fake-codex.mjs` | 新 clone `$SCRATCH/ccbin-lp`（ccloop Task 6 之后）作 `ORCA_CCLOOP_BIN`；`ORCA_AGENTS_TABLE` 仍用原夹具表（E2E 的 world 自建表，只从 `dirname(ORCA_CCLOOP_BIN)` 取 fake）。旧 `ccbin` 用来在 Task 8 先看 E2E **红** |
| F17 | 新错误码的 HTTP 状态 spec 没给 | spec §8 R7 | `labels-version-conflict` → 409（与其他 `*-version-conflict` 同组），`labels-invalid` → 422（与 `duplicate-proposal-target` 同组） |
| F18 | R11 的 bucket 规则（handoff 阶段看 handoff bucket）在组视图上很难造：handoff 阶段的 run 要求有对应 handoff request 行 | `controlViews.ts:571-577` | 把投影抽成导出的纯函数 `progressOfRun`，bucket 规则在单元层量（Task 5） |

---

## Global Constraints

**顺序与推送**
- 先落 Orca（Task 1–5 ＋ 7：接受可选 `progress`，此时 ccloop 不发，行为不变），再落 ccloop（Task 6：开始发），最后 Task 8（E2E 与门）。
- ⚠️ **推送顺序和平时相反：先推 Orca，再推 ccloop**（spec §3.3）。反过来，旧 Orca 会以 `control-response-invalid` 拒收带 `progress` 的应答。这条写进 handoff 的 awaitingHuman，作为事实，不催人。
- 两仓只落本地提交；**绝不 push**，不开／删分支，不建／删 worktree（Orca Rule 15、ccloop Rule 13）。若别的 agent 正在 main 上干活，照 memory「多 agent 时用 worktree 新分支」由控制器决定落在哪。
- 提交信息用 `git commit -F -`，结尾两行（逐字）：
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN`
- 提交前先把 `git diff` 重定向到文件整份读回（全局 CLAUDE.md：Always show diff before committing）。git 一律 `/usr/bin/git`。提交命令**不** source `lp-env.sh`（那里改道了 HOME，git 会找不到身份）。

**证据纪律**
- 验证跑一律 `> "$SCRATCH/lp-<名>.txt" 2>&1; echo rc=$?`，再用 Read **整份读回**，核 vitest 第一行 `RUN` 指向的路径。**不许** `| tail`／`| grep`／`| head`（Rule 14）。
- 行号、字节数、测试条数引用前现测；字节数连口径一起报。
- 每条跑判据前 `source` 前置脚本 `lp-env.sh`（Task 0 生成）：`TMPDIR` 是**短路径真目录**（`mktemp -d /private/tmp/cl-XXXX`，不是软链、不在长 scratchpad 路径下；tsx 的 socket 路径上限 104 字节），HOME 与四个 XDG 根改道，`ECC_GATEGUARD=off DISABLE_OMC=1`。
- 主树只跑本 Task 点名的判据文件与 typecheck；**主树不跑全量、不 build**。

**变异**
- 变异只在 scratchpad 下的 `git clone --local` 副本里做，主树全程零触碰（Orca Rule 15、ccloop Rule 17）。
  `SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad`
- 副本没有 `node_modules`：ccloop 副本软链 ccloop 的 `node_modules` 并 `npm run build`；Orca 副本**同时软链**根与 `web/` 两个 `node_modules`，跑面板相关判据前 `npm run build --workspace web`。
- 每组变异先跑出**绿基线**；用 `$SCRATCH/lp-mutate.mjs`（Task 0 生成，锚点必须恰好出现一次）落变异，`shasum -a 256` 前后比，不等才算落上；看到点名判据红；用主树文件 `cat` 回副本还原，`git diff`／`git diff --cached` 重定向到文件后 `stat -f %z` 为 0。
- `cp`、`rm` 在这台机器上被别名成交互式：复制用 `cat a > b`，删除用 `/bin/rm -rf <字面路径>`（不许带变量或通配）。

**E2E 与夹具**
- Orca E2E 需要 `ORCA_CCLOOP_BIN`（一份**干净** ccloop clone 的 `dist/cli.js`，**绝不**是变异副本）与 `ORCA_AGENTS_TABLE`（`$SCRATCH/agents/agents.json`，fake codex `integration` 模式）。
- 已知 flake（红了先按单文件重跑三次再判）：Orca `tests/panel/controlShutdown.test.ts`、`tests/control/driverRecovery.test.ts`、`tests/control/handoffE2E.test.ts` 的 H5、负载下的 `tests/control/executionDriverE2E.test.ts`、`tests/control/driverSettle.test.ts`、gateCheck K13；ccloop 的稳定红 stopProof 由 `node scripts/check-known-reds.mjs <json>` 判。
- Rule 17：判据只写 `mkdtemp` 临时目录；E2E 用 `relocateHome`；真 `~/.orca` 前后 `stat` 相同。

**判据与文字**
- 散文中文（docs、台账、handoff）；代码与代码注释英文。注释写「为什么」并点名 spec 节／R 号。
- 既有判据**只加不改**。本轮人的授权见下一节；即使在授权内，每处改动也要按「文件 ＋ 测试名」记进台账。点名清单以外的既有判据红了 ⇒ 停下报控制器。

## 本轮人的授权（原话，摘自台账 §1）

- 「spec 通过。」
- 「授权改 ccloop tests/control/agentsControl.test.ts 那两处 toEqual => 授权。其他这次spec实现必要的判据修改我也授权。」
  —— 即：ccloop `tests/control/agentsControl.test.ts` 两处 `toEqual({ events: [], candidate: null, terminal: null })` 改为含 `progress: null`；其他「这次 spec 实现必要的」既有判据修改也在授权内，但**每一处仍须按文件 ＋ 测试名列进台账**，且优先只加不改。
- 「这一轮执行过程中如果有问题，先按你的建议执行（不要再找我）。执行完在最后阶段报给我审核。」
- ⚠️ 只限本会话。付费调用、推送、删数据、杀进程不在授权内。

**本计划预计触碰的既有判据／夹具（Rule 15(a) 预先登记）：**

| 仓 | 文件 | 性质 | 测试名 |
|---|---|---|---|
| ccloop | `tests/control/agentsControl.test.ts` | **REWRITTEN**（人已指名） | `reads the table only for capabilities and accept: a table broken after accept blocks neither inspect nor collect`；`keeps inspect and collect working after the table is deleted, while capabilities still refuses it` |
| Orca | `tests/panel/webParity.test.ts` | 只加（import、一条 `it`、两个编译期函数、数组两项） | 无既有判据改动 |
| Orca | `tests/control/fixtures/web.ts` | 夹具加可选字段（F14） | — |
| Orca | `tests/control/fixtures/fake-ccloop-control.mjs` | 夹具加可选旋钮（F3） | — |
| Orca | `tests/scheduler/planFile.test.ts`、`tests/scheduler/planReport.test.ts`、`tests/control/planImport.test.ts`、`tests/control/ccloopPort.test.ts` | 只在文件末尾追加新 `describe` ＋ 必要的 import 行 | — |
| ccloop | `tests/control/collect.test.ts` | 只追加新 `describe` ＋ import 行 | — |

## Review Focus

1. **无标签 plan 的存档字节与 `planHash` 逐字节不变**（L1，F12 的实测值）：`labels` 只在非空时写，绝不 `.default([])`，旧组不出 `recovery-blocked`（Task 2）。
2. **`collectInto` 用用量循环之后新读的 run 存 progress**（R2）：`cumulative`／`group.used` 不回滚、不重复计入；只在变了时推进 `changeSeq`（R3，Task 5）。
3. **`tokens` 未知或超支时是 `null`，绝不是 0**（R11），按 run 的 bucket 判；收到用量前的 0／grant 是真 0（Task 5、7）。
4. **`set-task-labels` 不看组状态、不碰 proposal**（L-2、L4），词表在 `apply` 里查、被拒入台账且点名（R8），16 在去重之后数（R15、F2）（Task 4）。
5. **兼容与顺序**：Orca 的 `progress` 可选、旧 run 无 `progress` 键照样可读（R1、R5），ccloop 总是发；推送先 Orca 后 ccloop（Task 5、6）。

## File Structure

**Orca**
| 文件 | 动作 | 职责 |
|---|---|---|
| `src/control/labels.ts` | 新建 | 词表、输入规范化、存储 schema、work item 标签状态、生效标签（唯一一处） |
| `src/scheduler/planFile.ts` | 改 | `planTaskSchema.labels`；`readSchedulerControlPlanSource` 显式复制 `labels`；malformed 消息进 detail（R12） |
| `src/scheduler/planReport.ts` | 改 | task 行后显示标签 |
| `src/control/planImport.ts` | 改 | `normalizeControlPlan` 只在非空时写 `labels` |
| `src/control/webProtocol.ts` | 改 | 存档 plan `labels`；视图可选字段；`set-task-labels` 动词／payload／结果；`workItemProgressSchema` |
| `src/control/errors.ts` | 改 | `labels-version-conflict` 409、`labels-invalid` 422 |
| `src/control/webService.ts` | 改 | `setTaskLabels` |
| `src/panel/controlApi.ts` | 改 | POST `/api/control/groups/:groupId/tasks/:taskId/labels` ＋ 分派 |
| `src/panel/controlViews.ts` | 改 | 摘要完成度；work item 标签与进度；`persistedRunSchema.progress`；`progressOfRun` |
| `src/control/schema.ts` | 改 | `runProgressSchema` |
| `src/control/executionPort.ts` | 改 | `ExecutionReport.progress?` |
| `src/control/ccloopPort.ts` | 改 | `collectionSchema.progress` 可选；返回对象带 `progress` |
| `src/control/executionDriver.ts` | 改 | `collectInto` 在用量之后新读并存 progress |
| `web/src/controlTypes.ts`、`web/src/controlApi.ts` | 改 | 镜像类型、词表、动作与路由、逐件下载 |
| `web/src/TaskDetail.tsx` | 新建 | 标签芯片、进度文字、详情面板（编辑器／进度／run 与 evidence） |
| `web/src/ControlGroupView.tsx`、`web/src/ControlPanel.tsx`、`web/src/App.tsx`、`web/src/styles.css` | 改 | 标签列、筛选、进度列、导航完成度、成功后清草稿、样式 |
| `tests/control/labels.test.ts`、`tests/control/taskLabels.test.ts`、`tests/control/driverProgress.test.ts`、`tests/control/progressE2E.test.ts`、`tests/panel/taskLabelsApi.test.ts`、`web/tests/taskLabels.test.tsx`、`web/tests/taskLabelsDraft.test.tsx` | 新建 | 本轮判据 |

**ccloop**
| 文件 | 动作 | 职责 |
|---|---|---|
| `src/control/collect.ts` | 改 | `readProgress`（校验形状），`CollectionV1.progress` |
| `src/control/command.ts` | 改 | strict 响应 schema 加 `progress` |
| `tests/control/collect.test.ts` | 追加 | P1、R17 |
| `tests/control/agentsControl.test.ts` | 两处改写 | 人已授权 |

## 执行顺序

Task 0（控制器）→ Task 1 → 2 → 3 → 4 → 5 → 7（全在 Orca）→ Task 6（ccloop）→ Task 8（E2E、两仓门）→ Final（控制器：变异总表、台账收口、handoff）。Task 7 不依赖 Task 6，可在 6 之前做。

---

### Task 0（控制器）：前置脚本、变异工具、基线重测、台账

**Files:** Create（scratchpad，不进仓）：`$SCRATCH/lp-env.sh`、`$SCRATCH/lp-mutate.mjs`；Append：Orca `.superpowers/sdd/2026-09-29-labels-progress-and-backlog/progress.md`。

- [ ] **Step 1: 建短 TMPDIR 与假 HOME，写前置脚本**

```bash
mktemp -d /private/tmp/cl-XXXX > /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/lp-tmpdir.txt 2>&1; echo rc=$?
mktemp -d /private/tmp/cl-h-XXXX > /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/lp-home.txt 2>&1; echo rc=$?
```
读回两个文件，把其中的**字面路径**（下面记作 `<T>`、`<H>`）写进前置脚本：

```bash
cat > /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/lp-env.sh <<'EOF'
export SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad
export TMPDIR=<T>
export HOME=<H>
export XDG_CONFIG_HOME="$HOME/.config" XDG_CACHE_HOME="$HOME/.cache" XDG_DATA_HOME="$HOME/.local/share" XDG_STATE_HOME="$HOME/.local/state"
export ECC_GATEGUARD=off DISABLE_OMC=1
EOF
```
下文每个跑判据的块都以 `. /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/lp-env.sh` 开头（下文简写为 `. "$LPENV"`，执行时写全路径）。

- [ ] **Step 2: 写变异工具**

```bash
cat > /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/lp-mutate.mjs <<'EOF'
// usage: node lp-mutate.mjs <file> <anchor-file> <replacement-file>
// Replaces the anchor, which must occur exactly once, so a mutation can never land on the wrong line or silently miss.
import { readFileSync, writeFileSync } from "node:fs";
const [file, anchorPath, replacementPath] = process.argv.slice(2);
const text = readFileSync(file, "utf8");
const anchor = readFileSync(anchorPath, "utf8"), replacement = readFileSync(replacementPath, "utf8");
const at = text.indexOf(anchor);
if (at < 0 || text.indexOf(anchor, at + 1) >= 0) { console.error(`anchor must occur exactly once in ${file}`); process.exit(3); }
writeFileSync(file, text.slice(0, at) + replacement + text.slice(at + anchor.length));
console.log(`mutated ${file}`);
EOF
```
每条变异：把「锚点」与「替换」各写成一个文件（`cat > "$SCRATCH/lp-m-anchor.txt" <<'EOF'` …），`node "$SCRATCH/lp-mutate.mjs" <副本文件> <锚点文件> <替换文件>`。下文各 Task 的 Mutation 行只写「锚点 → 替换」。

- [ ] **Step 3: 在未改动的主树上重测 F12 的 L1 值**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/tsx "$SCRATCH/plan-probe/hash.ts" > "$SCRATCH/lp-t0-hash.txt" 2>&1; echo rc=$?
/usr/bin/git -C /Users/biran/code/skills/loop/Orca log -1 --format='%h %s' > "$SCRATCH/lp-t0-head.txt" 2>&1; echo rc=$?
```
Expected：rc=0；`{"planHash":"e38685e8b39330ab91ccbbc73c6bc60cb432e627e4811e1854b73bc13de27c5f","byteLength":2251}`。**不等就停**，报控制器（Task 2 的硬编码值以现测为准并记台账）。探针文件 `$SCRATCH/plan-probe/hash.ts` 由起草者留下，内容是 `planImport.test.ts` `setup()` 的 plan 经 `normalizeControlPlan` 规范化后的 `sha256Canonical` 与规范字节长。

- [ ] **Step 4: 台账追加**（§2 执行记录下，带会话、日期、当时 HEAD 主题行）：本计划路径；F1–F18 各一行 `Ruling:`（控制器替人定，待人审）；「本计划预计触碰的既有判据／夹具」整表；Step 3 的实测值与命令。

---
### Task 1: `src/control/labels.ts` —— 词表、输入规范化、存储 schema、生效标签（Orca）

**Files:**
- Create: `src/control/labels.ts`
- Test (new): `tests/control/labels.test.ts`

**Interfaces:**
- Consumes: `ControlError`（`src/control/errors.ts:270`，用既有码 `recovery-blocked`）；`safeInteger`（`src/control/schema.ts:2`）。
- Produces（Task 2–5、7 依赖）:
  - `export const SYSTEM_LABELS: readonly ["feature","bug","refactor","test","doc","design","investigate","perf","security","chore"]`
  - `export const CUSTOM_LABEL_PREFIX = "custom:"`、`MAX_TASK_LABELS = 16`、`MAX_CUSTOM_LABEL_CODE_POINTS = 32`、`MAX_STORED_LABEL_CODE_POINTS = 64`
  - `export type LabelCheck = { ok: true; labels: string[] } | { ok: false; detail: string }`
  - `export function normalizeInputLabels(raw: readonly string[]): LabelCheck`
  - `export const inputLabelsSchema: z.ZodEffects<z.ZodArray<z.ZodString>, string[], string[]>`（失败消息 `labels-invalid:<detail>`）
  - `export const storedLabelsSchema`（0–16 个）、`export const nonEmptyStoredLabelsSchema`（1–16 个）
  - `export interface TaskLabelState { override: string[] | null; version: number }`
  - `export function readTaskLabelState(workBody: unknown): TaskLabelState`（格式坏 ⇒ `ControlError("recovery-blocked", "work-item-labels-invalid")`）
  - `export function effectiveTaskLabels(state: TaskLabelState, planLabels: readonly string[] | undefined): { labels: string[]; provenance: "plan" | "operator" }`

- [ ] **Step 1: 写判据** —— 新建 `tests/control/labels.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import {
  CUSTOM_LABEL_PREFIX,
  MAX_TASK_LABELS,
  SYSTEM_LABELS,
  effectiveTaskLabels,
  inputLabelsSchema,
  nonEmptyStoredLabelsSchema,
  normalizeInputLabels,
  readTaskLabelState,
  storedLabelsSchema,
} from "../../src/control/labels.js";

/**
 * Labels and progress spec §2.1, §2.4, §2.5, criteria L2, L3, L5 and §8 R15. The Mutation lines of plan Task 1 name
 * the production line each `it` goes red on.
 */
describe("the label vocabulary and the input door (spec §2.1, §8 R15)", () => {
  it("is G11's ten system words, and a custom label carries the lower-case custom: prefix", () => {
    expect([...SYSTEM_LABELS]).toEqual(["feature", "bug", "refactor", "test", "doc", "design", "investigate", "perf", "security", "chore"]);
    expect(CUSTOM_LABEL_PREFIX).toBe("custom:");
    expect(MAX_TASK_LABELS).toBe(16);
  });

  it("L3: deduplicates and sorts by UTF-16 code unit, never by locale", () => {
    // 'Z' (0x5a) sorts before 'a' (0x61) by code unit; localeCompare would put custom:alpha first.
    expect(normalizeInputLabels(["test", "bug", "custom:Zeta", "custom:alpha", "bug"]))
      .toEqual({ ok: true, labels: ["bug", "custom:Zeta", "custom:alpha", "test"] });
  });

  it("L3: refuses a bare word outside the vocabulary and names it, case-sensitively", () => {
    expect(normalizeInputLabels(["bug", "urgent"])).toEqual({ ok: false, detail: "urgent" });
    expect(normalizeInputLabels(["Feature"])).toEqual({ ok: false, detail: "Feature" });
    expect(normalizeInputLabels(["Custom:x"])).toEqual({ ok: false, detail: "Custom:x" });
  });

  it("L3: accepts a Chinese custom label and stores every custom label NFC-normalized", () => {
    expect(normalizeInputLabels(["custom:前端"])).toEqual({ ok: true, labels: ["custom:前端"] });
    // "e" + U+0301 (NFD) and U+00E9 (NFC) are one label after normalization.
    expect(normalizeInputLabels(["custom:café", "custom:café"])).toEqual({ ok: true, labels: ["custom:café"] });
  });

  it("L3: counts a custom label in NFC code points, without the prefix", () => {
    expect(normalizeInputLabels([`custom:${"😀".repeat(32)}`]).ok).toBe(true); // 32 code points, 64 code units
    expect(normalizeInputLabels([`custom:${"a".repeat(33)}`])).toEqual({ ok: false, detail: `custom:${"a".repeat(33)}` });
    expect(normalizeInputLabels(["custom:"])).toEqual({ ok: false, detail: "custom:" });
  });

  it("L3: refuses whitespace, a control character and a lone surrogate -- the last without echoing it", () => {
    expect(normalizeInputLabels(["custom:a b"])).toEqual({ ok: false, detail: "custom:a b" });
    expect(normalizeInputLabels(["custom:a\u0007"])).toEqual({ ok: false, detail: "custom:a\u0007" });
    expect(normalizeInputLabels(["custom:\ud800"])).toEqual({ ok: false, detail: "lone-surrogate" });
  });

  it("L3: refuses a 17th distinct label, counting after deduplication", () => {
    const sixteen = [...SYSTEM_LABELS, ...Array.from({ length: 6 }, (_, i) => `custom:c${i}`)];
    expect(normalizeInputLabels(sixteen)).toMatchObject({ ok: true });
    expect(normalizeInputLabels([...sixteen, "custom:c16"])).toEqual({ ok: false, detail: "count:17" });
    expect(normalizeInputLabels([...sixteen, "bug"])).toMatchObject({ ok: true });
  });

  it("L3: the plan file's schema normalizes, and names a refused label in its message", () => {
    expect(inputLabelsSchema.parse(["test", "bug", "bug"])).toEqual(["bug", "test"]);
    const refused = inputLabelsSchema.safeParse(["bug", "Feature"]);
    expect(refused.success).toBe(false);
    if (!refused.success) expect(refused.error.issues[0]!.message).toBe("labels-invalid:Feature");
  });
});

describe("storage checks format only (spec §2.1, human ruling L-6)", () => {
  it("L2: keeps reading a word the vocabulary no longer has", () => {
    expect(storedLabelsSchema.parse(["bug", "zz-retired-word"])).toEqual(["bug", "zz-retired-word"]);
  });

  it("refuses an unsorted, duplicated, empty, over-long or over-many list; the archive's form refuses []", () => {
    expect(storedLabelsSchema.safeParse(["test", "bug"]).success).toBe(false);
    expect(storedLabelsSchema.safeParse(["bug", "bug"]).success).toBe(false);
    expect(storedLabelsSchema.safeParse([""]).success).toBe(false);
    expect(storedLabelsSchema.safeParse(["x".repeat(65)]).success).toBe(false);
    expect(storedLabelsSchema.safeParse(Array.from({ length: 17 }, (_, i) => `l${String(i).padStart(2, "0")}`)).success).toBe(false);
    expect(storedLabelsSchema.parse([])).toEqual([]);
    expect(nonEmptyStoredLabelsSchema.safeParse([]).success).toBe(false);
  });
});

describe("a task's effective labels (spec §2.4, §2.5, criterion L5)", () => {
  it("reads a work item written before labels existed as no override at version 0", () => {
    expect(readTaskLabelState({ kind: "task", status: "draft" })).toEqual({ override: null, version: 0 });
    expect(readTaskLabelState({ labelsOverride: ["bug"], labelsVersion: 3 })).toEqual({ override: ["bug"], version: 3 });
  });

  it("blocks a work item whose label fields are not the stored format", () => {
    expect(() => readTaskLabelState({ labelsOverride: ["test", "bug"], labelsVersion: 1 })).toThrow(ControlError);
    expect(() => readTaskLabelState({ labelsOverride: null, labelsVersion: -1 })).toThrow("recovery-blocked:work-item-labels-invalid");
  });

  it("L5: an override wins, an empty override is the person clearing them, no override falls back to the plan", () => {
    expect(effectiveTaskLabels({ override: ["perf"], version: 1 }, ["bug"])).toEqual({ labels: ["perf"], provenance: "operator" });
    expect(effectiveTaskLabels({ override: [], version: 2 }, ["bug"])).toEqual({ labels: [], provenance: "operator" });
    expect(effectiveTaskLabels({ override: null, version: 3 }, ["bug"])).toEqual({ labels: ["bug"], provenance: "plan" });
    expect(effectiveTaskLabels({ override: null, version: 0 }, undefined)).toEqual({ labels: [], provenance: "plan" });
  });
});
```

- [ ] **Step 2: 跑，确认红**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/labels.test.ts > "$SCRATCH/lp-t1-red.txt" 2>&1; echo rc=$?
```
Expected：rc=1，失败原因是 `Failed to resolve import "../../src/control/labels.js"`（整文件加载失败 ⇒ 这一步只证明文件存在前是红的，真正的判据力由 Mutation 行证明）。

- [ ] **Step 3: 实现** —— 新建 `src/control/labels.ts`：

```ts
import { z } from "zod";
import { ControlError } from "./errors.js";
import { safeInteger } from "./schema.js";

/**
 * Task labels (labels and progress spec §2.1; human rulings L-1, L-6, G11; §8 R15). Two kinds:
 *
 * - system labels: a bare word from G11's closed vocabulary. Only these are ever consumed by code (the later §3.3
 *   loop choice, metrics by label).
 * - custom labels: `custom:` plus 1-32 code points after NFC, any script, no whitespace or control character. Shown and
 *   filtered on, never consumed.
 *
 * The vocabulary is checked at the two INPUT doors only (the plan file and the set-task-labels command). Storage checks
 * format only (L-6), so a word dropped from the vocabulary later leaves every group that used it readable.
 */
export const SYSTEM_LABELS = ["feature", "bug", "refactor", "test", "doc", "design", "investigate", "perf", "security", "chore"] as const;
export type SystemLabel = (typeof SYSTEM_LABELS)[number];
export const CUSTOM_LABEL_PREFIX = "custom:";
export const MAX_TASK_LABELS = 16;
export const MAX_CUSTOM_LABEL_CODE_POINTS = 32;
/** Plan drafter finding F8: storage's own cap, looser than input on purpose, so no input rule change orphans a stored label. */
export const MAX_STORED_LABEL_CODE_POINTS = 64;

const SYSTEM = new Set<string>(SYSTEM_LABELS);
const LONE_SURROGATE = /\p{Cs}/u;
const WHITESPACE_OR_CONTROL = /[\s\p{Cc}]/u;
const codePoints = (value: string): number => [...value].length;

export type LabelCheck = { ok: true; labels: string[] } | { ok: false; detail: string };

/** One input label, normalized, or the detail that names why it is refused. */
function checkLabel(raw: string): { label: string } | { detail: string } {
  // Never echoed (plan finding F9): canonicalBytes refuses a lone surrogate, and a refusal's message is stored canonically.
  if (LONE_SURROGATE.test(raw)) return { detail: "lone-surrogate" };
  if (raw.startsWith(CUSTOM_LABEL_PREFIX)) {
    const body = raw.slice(CUSTOM_LABEL_PREFIX.length).normalize("NFC");
    const length = codePoints(body);
    if (length < 1 || length > MAX_CUSTOM_LABEL_CODE_POINTS || WHITESPACE_OR_CONTROL.test(body)) return { detail: raw };
    return { label: `${CUSTOM_LABEL_PREFIX}${body}` };
  }
  // Case-sensitive (R15): "Feature" is not a vocabulary word, and "Custom:x" is neither the prefix nor a word.
  return SYSTEM.has(raw) ? { label: raw } : { detail: raw };
}

/**
 * The input doors' one rule (spec §2.1, §8 R15): each label checked and normalized, then deduplicated, then at most
 * 16 counted after deduplication, then sorted by UTF-16 code unit (the default sort, never localeCompare).
 */
export function normalizeInputLabels(raw: readonly string[]): LabelCheck {
  const labels = new Set<string>();
  for (const item of raw) {
    const checked = checkLabel(item);
    if ("detail" in checked) return { ok: false, detail: checked.detail };
    labels.add(checked.label);
  }
  if (labels.size > MAX_TASK_LABELS) return { ok: false, detail: `count:${labels.size}` };
  return { ok: true, labels: [...labels].sort() };
}

/** The plan file's door (spec §2.2): any order, duplicates allowed, normalized here; a refusal names the label. */
export const inputLabelsSchema = z.array(z.string()).transform((raw, ctx) => {
  const checked = normalizeInputLabels(raw);
  if (checked.ok) return checked.labels;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: `labels-invalid:${checked.detail}` });
  return z.NEVER;
});

const storedLabelSchema = z
  .string()
  .min(1)
  .refine((value) => !LONE_SURROGATE.test(value) && codePoints(value) <= MAX_STORED_LABEL_CODE_POINTS, { message: "stored-label-format" });

function sortedUnique(values: readonly string[], ctx: z.RefinementCtx): void {
  for (let index = 1; index < values.length; index += 1) {
    if (!(values[index - 1]! < values[index]!)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "labels-not-sorted-unique" });
  }
}

/** Storage (L-6): format only -- non-empty, bounded, sorted by code unit, unique, at most 16. Never the vocabulary. */
export const storedLabelsSchema = z.array(storedLabelSchema).max(MAX_TASK_LABELS).superRefine(sortedUnique);
/** The archived plan's `labels` (spec §2.3): present only when non-empty, so a label-free plan's bytes never change. */
export const nonEmptyStoredLabelsSchema = z.array(storedLabelSchema).min(1).max(MAX_TASK_LABELS).superRefine(sortedUnique);

/** A work item's operator layer (spec §2.4): absent keys read as no override at version 0 -- no migration. */
export interface TaskLabelState { override: string[] | null; version: number }
const taskLabelFieldsSchema = z
  .object({ labelsOverride: storedLabelsSchema.nullable().optional(), labelsVersion: safeInteger.optional() })
  .passthrough();

export function readTaskLabelState(workBody: unknown): TaskLabelState {
  const parsed = taskLabelFieldsSchema.safeParse(workBody);
  if (!parsed.success) throw new ControlError("recovery-blocked", "work-item-labels-invalid");
  return { override: parsed.data.labelsOverride ?? null, version: parsed.data.labelsVersion ?? 0 };
}

/**
 * The one place a task's labels are decided (spec §2.5): an override wins -- even `[]`, which is the person clearing
 * them and differs from having no override -- otherwise the archived plan's labels, or none.
 */
export function effectiveTaskLabels(
  state: TaskLabelState,
  planLabels: readonly string[] | undefined,
): { labels: string[]; provenance: "plan" | "operator" } {
  return state.override !== null
    ? { labels: [...state.override], provenance: "operator" }
    : { labels: [...(planLabels ?? [])], provenance: "plan" };
}
```

- [ ] **Step 4: 跑，确认绿 ＋ 类型检查**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/labels.test.ts > "$SCRATCH/lp-t1-green.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/lp-t1-tsc.txt" 2>&1; echo rc=$?
```
Expected：两个 rc=0；绿的文件里 13 passed、0 skipped（条数现测后记台账）。

- [ ] **Step 5: 提交**

```bash
cd /Users/biran/code/skills/loop/Orca && /usr/bin/git diff > /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/lp-t1-diff.txt 2>&1; /usr/bin/git status --short > /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/2724716d-d4b9-4fc7-a599-3712b4236e0d/scratchpad/lp-t1-status.txt 2>&1; echo rc=$?
```
读回两个文件（只应有两个新文件）后：

```bash
cd /Users/biran/code/skills/loop/Orca && /usr/bin/git add src/control/labels.ts tests/control/labels.test.ts && /usr/bin/git commit -F - <<'EOF'
feat(control): one definition of task labels -- the vocabulary at the input doors, format only in storage

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**（Orca 变异副本，先跑绿基线；每条只改一处，点名判据必须红）：
- M1a 锚点 `return SYSTEM.has(raw) ? { label: raw } : { detail: raw };` → `return { label: raw };` ⇒ `L3: refuses a bare word outside the vocabulary and names it, case-sensitively` 红。
- M1b 锚点 `.normalize("NFC")` → 删掉 ⇒ `L3: accepts a Chinese custom label and stores every custom label NFC-normalized` 红。
- M1c 锚点 `if (labels.size > MAX_TASK_LABELS)` → `if (false)` ⇒ `L3: refuses a 17th distinct label, counting after deduplication` 红。
- M1d 同锚点 → `if (raw.length > MAX_TASK_LABELS)`（去重前数）⇒ 同一条红（`[...sixteen, "bug"]` 被拒）。
- M1e 锚点 `[...labels].sort()` → `[...labels].sort((a, b) => a.localeCompare(b))` ⇒ `L3: deduplicates and sorts by UTF-16 code unit, never by locale` 红。
- M1f 锚点 `!LONE_SURROGATE.test(value) && codePoints(value) <= MAX_STORED_LABEL_CODE_POINTS` → 追加 ` && (SYSTEM.has(value) || value.startsWith(CUSTOM_LABEL_PREFIX))` ⇒ `L2: keeps reading a word the vocabulary no longer has` 红。
- M1g 锚点 `return state.override !== null` → `return state.override !== null && state.override.length > 0` ⇒ `L5: an override wins, …` 红。
- M1h 锚点 `const codePoints = (value: string): number => [...value].length;` → `… => value.length;` ⇒ `L3: counts a custom label in NFC code points, without the prefix` 红。
- M1i 锚点 `|| WHITESPACE_OR_CONTROL.test(body)` → 删掉 ⇒ `L3: refuses whitespace, …` 红。
- M1j 锚点 `if (LONE_SURROGATE.test(raw)) return { detail: "lone-surrogate" };` → 删掉 ⇒ 同一条红。

---
### Task 2: plan 文件的标签、`orca plan` 报告、存档规范化、Web 导入点名（Orca；spec §2.2、§2.3、§8 R12）

**Files:**
- Modify: `src/scheduler/planFile.ts`（`PlanTask` 11–18、`SchedulerControlPlanSource` 35–49、`planTaskSchema` 109–117、`readSchedulerControlPlanSource` 240 与 257–268）
- Modify: `src/scheduler/planReport.ts`（task 行 158）
- Modify: `src/control/webProtocol.ts`（`controlPlanSchema` task 对象 420–432）
- Modify: `src/control/planImport.ts`（`normalizeControlPlan` 的 task 映射 120–127）
- Test（只追加）: `tests/scheduler/planFile.test.ts`、`tests/scheduler/planReport.test.ts`、`tests/control/planImport.test.ts`、`tests/control/labels.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `inputLabelsSchema`、`nonEmptyStoredLabelsSchema`。
- Produces: `PlanTask.labels?: string[]`（已排序去重）；`SchedulerControlPlanSource["tasks"][number].labels?: string[]`（只在非空时出现）；`ControlPlanV1["tasks"][number].labels?: string[]`（非空）；导入被拒的 detail 形如 `malformed:<zod path>: <message>`。

- [ ] **Step 1: 写判据**

(a) `tests/scheduler/planFile.test.ts`：第 2 行之后追加一行 import，文件末尾追加一个 describe：

```ts
import { SYSTEM_LABELS } from "../../src/control/labels.js";
```

```ts
describe("plan task labels (labels and progress spec §2.2, criterion L3)", () => {
  it("normalizes a task's labels: any order and duplicates in, sorted and deduplicated out", () => {
    const r = loadPlan({ ...OK, tasks: [{ ...OK.tasks[0], labels: ["test", "custom:前端", "bug", "bug"] }] }, "main");
    if (!("plan" in r)) throw new Error(JSON.stringify(r.rejections));
    expect(r.plan.tasks[0]!.labels).toEqual(["bug", "custom:前端", "test"]);
  });

  it("refuses the whole plan as malformed for a bare word outside the vocabulary, naming it", () => {
    const r = loadPlan({ ...OK, tasks: [{ ...OK.tasks[0], labels: ["bug", "Feature"] }] }, "main");
    expect(codes(r)).toEqual(["malformed"]);
    expect("rejections" in r && r.rejections[0]!.message).toBe("tasks.0.labels: labels-invalid:Feature");
  });

  it("refuses a 17th distinct label", () => {
    const labels = [...SYSTEM_LABELS, ...Array.from({ length: 7 }, (_, i) => `custom:c${i}`)];
    const r = loadPlan({ ...OK, tasks: [{ ...OK.tasks[0], labels }] }, "main");
    expect("rejections" in r && r.rejections[0]!.message).toBe("tasks.0.labels: labels-invalid:count:17");
  });
});
```

(b) `tests/scheduler/planReport.test.ts` 文件末尾追加：

```ts
describe("task labels in the report (labels and progress spec §2.2, criterion L6)", () => {
  it("prints a task's labels on its own line, and leaves a label-free task's line as it was", () => {
    const labelled: PlanFile = { ...p, tasks: [{ ...p.tasks[0]!, labels: ["bug", "custom:前端"] }, p.tasks[1]!, p.tasks[2]!] };
    const lines = renderPlanReport(g, labelled, pf, { verbose: false, base: BASE }).split("\n");
    expect(lines).toContain("  T1: [bug, custom:前端]");
    expect(lines).toContain("  T2:");
  });
});
```

(c) `tests/control/planImport.test.ts` 文件末尾追加（用本文件自己的 `setup()`、`command()`，都已在作用域内）：

```ts
describe("plan task labels through the import (labels and progress spec §2.3, criteria L1, L2, L3; §8 R12)", () => {
  // Measured before labels existed (plan drafter finding F12, Orca 084f15f; plan Task 0 re-measures it): the archived
  // plan of this file's label-free fixture. A label-free plan must archive to exactly these bytes for as long as it exists.
  const LABEL_FREE_PLAN_HASH = "e38685e8b39330ab91ccbbc73c6bc60cb432e627e4811e1854b73bc13de27c5f";
  const LABEL_FREE_PLAN_BYTES = 2251;

  it("L1: archives a label-free plan to the bytes and planHash it had before labels existed", async () => {
    const h = await setup();
    try {
      const imported = importControlPlan(h.deps, command());
      if ("error" in imported) throw new Error(imported.error.code);
      const archived = readArchivedPlan(h.store, "g");
      expect(archived.planHash).toBe(LABEL_FREE_PLAN_HASH);
      expect(Buffer.byteLength(archived.canonicalJson, "utf8")).toBe(LABEL_FREE_PLAN_BYTES);
      expect(archived.plan.tasks.every(task => !("labels" in task))).toBe(true);
    } finally { await h.dispose(); }
  });

  it("L1: an empty labels list archives exactly like no labels at all", async () => {
    const h = await setup();
    try {
      await writeFile(h.planPath, JSON.stringify({ ...h.plan, tasks: h.plan.tasks.map(task => ({ ...task, labels: [] })) }));
      const imported = importControlPlan(h.deps, command());
      if ("error" in imported) throw new Error(imported.error.code);
      expect(readArchivedPlan(h.store, "g").planHash).toBe(LABEL_FREE_PLAN_HASH);
    } finally { await h.dispose(); }
  });

  it("L1/L2: archives a task's labels sorted and deduplicated, and reads the archive back", async () => {
    const h = await setup();
    try {
      await writeFile(h.planPath, JSON.stringify({ ...h.plan, tasks: [{ ...h.plan.tasks[0], labels: ["test", "custom:前端", "bug", "bug"] }, h.plan.tasks[1]] }));
      const imported = importControlPlan(h.deps, command());
      if ("error" in imported) throw new Error(imported.error.code);
      const archived = readArchivedPlan(h.store, "g");
      expect(archived.plan.tasks.find(task => task.taskId === "b")!.labels).toEqual(["bug", "custom:前端", "test"]);
      expect(archived.plan.tasks.find(task => task.taskId === "a")).not.toHaveProperty("labels");
      expect(archived.planHash).not.toBe(LABEL_FREE_PLAN_HASH);
    } finally { await h.dispose(); }
  });

  it("L3/R12: refuses a bare word outside the vocabulary on the Web import too, naming it in the detail", async () => {
    const h = await setup();
    try {
      await writeFile(h.planPath, JSON.stringify({ ...h.plan, tasks: [{ ...h.plan.tasks[0], labels: ["Feature"] }, h.plan.tasks[1]] }));
      expect(importControlPlan(h.deps, command())).toMatchObject({
        error: { code: "control-plan-rejected", message: "control-plan-rejected:malformed:tasks.0.labels: labels-invalid:Feature" },
      });
    } finally { await h.dispose(); }
  });
});
```
（`setup()` 的 plan 里 `tasks[0]` 是 `b`、`tasks[1]` 是 `a`：`tests/control/planImport.test.ts:67-73`。）

(d) `tests/control/labels.test.ts` 顶部 import 追加 `import { canonicalBytes } from "../../src/control/canonicalJson.js";` 与 `import { controlPlanSchema } from "../../src/control/webProtocol.js";`，文件末尾追加：

```ts
describe("the archived plan keeps a label the vocabulary no longer has (criterion L2, spec §2.3)", () => {
  it("parses and re-encodes it byte for byte, and refuses an archived empty list", () => {
    const plan = {
      schema: "orca-control-plan-v1", repoId: "repo", planId: "plan", goal: "ship", successConditions: ["pass"],
      tasks: [{ taskId: "a", dependencyTaskIds: [], targetVersion: 1, labels: ["zz-retired-word"], originalContractHash: "a".repeat(64), originalContractCanonicalJson: "{}" }],
    };
    const bytes = canonicalBytes(plan);
    expect(canonicalBytes(controlPlanSchema.parse(JSON.parse(bytes.toString("utf8"))))).toEqual(bytes);
    expect(controlPlanSchema.safeParse({ ...plan, tasks: [{ ...plan.tasks[0], labels: [] }] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑，确认红**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/scheduler/planFile.test.ts tests/scheduler/planReport.test.ts tests/control/planImport.test.ts tests/control/labels.test.ts > "$SCRATCH/lp-t2-red.txt" 2>&1; echo rc=$?
```
Expected：rc=1。红的恰好是新加的：planFile 三条（`labels` 被 strict schema 当未知键拒成 `malformed`，消息不对）、planReport 一条（`PlanTask` 没有 `labels` 的类型错误在 vitest 下不拦，行里没有标签）、planImport 的 `archives a task's labels…` 与 `L3/R12…`（`L1: archives a label-free plan…` 此时应**已绿**——它钉的是改动前的值；`an empty labels list…` 红，因为 `labels: []` 被 strict schema 拒）、labels 的 L2 一条（`labels` 不是存档 plan 的键）。既有判据全绿。与此不符就停。

- [ ] **Step 3: 实现**

(a) `src/scheduler/planFile.ts`：
- import 区（第 7 行之后）加：`import { inputLabelsSchema } from "../control/labels.js";`
- `PlanTask`（11–18）在 `agent?` 之后加：
```ts
  /** Labels and progress spec §2.2: sorted and deduplicated by the parser; absent when the plan names none. */
  labels?: string[];
```
- `SchedulerControlPlanSource.tasks` 元素（40–48）在 `agent?: PartialSelection;` 之后加 `labels?: string[];`
- `planTaskSchema`（109–117）在 `agent:` 那行之后加：
```ts
    // Labels and progress spec §2.2: the vocabulary is checked here, at the input door; any order and duplicates in.
    labels: inputLabelsSchema.optional(),
```
- 第 240 行替换为：
```ts
  // Labels and progress spec §8 R12: a malformed plan's message -- which names a refused label -- travels in the detail.
  if ("rejections" in loaded) return sourceRejected(loaded.rejections.map(item => item.code === "malformed" ? `malformed:${item.message}` : item.code).join(","));
```
- 257–268 的 task 映射里，`...(task.agent ? { agent: task.agent } : {}),` 之后加（这张显式字段表漏掉就被静默丢掉，spec §2.2）：
```ts
        ...(task.labels && task.labels.length > 0 ? { labels: [...task.labels] } : {}),
```

(b) `src/scheduler/planReport.ts` 第 158 行 `lines.push(`  ${task.taskId}:`);` 替换为：
```ts
    // Labels and progress spec §2.2: a task's labels ride on its own line of the report a human approves a round from.
    const labels = task.labels ?? [];
    lines.push(labels.length > 0 ? `  ${task.taskId}: [${labels.join(", ")}]` : `  ${task.taskId}:`);
```

(c) `src/control/webProtocol.ts`：第 2 行之后加 `import { nonEmptyStoredLabelsSchema } from "./labels.js";`；`controlPlanSchema` 的 task 对象（427 行 `agent:` 之后）加：
```ts
          // Labels and progress spec §2.3: optional, format only, never empty -- a label-free plan's archive bytes and
          // planHash stay what they were. Never `.default([])`: every archive re-parses to its own bytes (queries.ts,
          // executionSnapshot.ts, estimator.ts), and a default would turn every older group recovery-blocked.
          labels: nonEmptyStoredLabelsSchema.optional(),
```

(d) `src/control/planImport.ts` 第 124 行 `...(task.agent ? { agent: task.agent } : {}),` 之后加：
```ts
      // Spec §2.3: written only when non-empty, like `agent`; never `labels: undefined` (canonicalBytes refuses it).
      ...(task.labels && task.labels.length > 0 ? { labels: [...task.labels] } : {}),
```

- [ ] **Step 4: 跑，确认绿 ＋ 类型检查**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/scheduler/planFile.test.ts tests/scheduler/planReport.test.ts tests/control/planImport.test.ts tests/control/labels.test.ts tests/control/webProtocol.test.ts tests/control/estimator.test.ts tests/control/executionSnapshot.test.ts > "$SCRATCH/lp-t2-green.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/lp-t2-tsc.txt" 2>&1; echo rc=$?
```
Expected：两个 rc=0，0 skipped。

- [ ] **Step 5: 提交**（先 `git diff`／`git status --short` 重定向到 `$SCRATCH/lp-t2-diff.txt`／`lp-t2-status.txt` 读回）

```bash
cd /Users/biran/code/skills/loop/Orca && /usr/bin/git add src/scheduler/planFile.ts src/scheduler/planReport.ts src/control/webProtocol.ts src/control/planImport.ts tests/scheduler/planFile.test.ts tests/scheduler/planReport.test.ts tests/control/planImport.test.ts tests/control/labels.test.ts && /usr/bin/git commit -F - <<'EOF'
feat(plan): task labels in the plan file, the orca plan report and the archived plan, whose label-free bytes stay the same

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

- [ ] **Step 6: 台账**：一行「R12 走主路径」（F13 的 grep 命令与结果）；「只加」清单里的四个文件与各自新增的 `it` 名。

**Mutation**:
- M2a `planImport.ts` 锚点 `...(task.labels && task.labels.length > 0 ? { labels: [...task.labels] } : {}),` → `labels: task.labels ?? [],` ⇒ `L1: archives a label-free plan to the bytes and planHash it had before labels existed` 红（导入被拒）。
- M2b `planFile.ts` 映射里同一锚点 → 删掉 ⇒ `L1/L2: archives a task's labels sorted and deduplicated, and reads the archive back` 红。
- M2c `planFile.ts` 锚点 `item.code === "malformed" ? \`malformed:${item.message}\` : item.code` → `item.code` ⇒ `L3/R12: refuses a bare word …` 红。
- M2d `planReport.ts` 锚点 `labels.length > 0 ? \`  ${task.taskId}: [${labels.join(", ")}]\` : ` → 删掉 ⇒ `prints a task's labels on its own line, …` 红。
- M2e `webProtocol.ts` 锚点 `labels: nonEmptyStoredLabelsSchema.optional(),` → `labels: storedLabelsSchema.default([]),`（同时在 import 行把 `nonEmptyStoredLabelsSchema` 换成 `storedLabelsSchema`，第二次调用 lp-mutate）⇒ `L1: archives a label-free plan…` 红（存档多出 `labels: []`，hash 变）。
- M2f `planFile.ts` 锚点 `labels: inputLabelsSchema.optional(),` → `labels: z.array(z.string()).optional(),` ⇒ `refuses the whole plan as malformed for a bare word outside the vocabulary, naming it` 红。

---
### Task 3: work item 的生效标签与组完成度进投影（Orca；spec §2.4、§2.5、§4.1；§8 R14、R19）

**Files:**
- Modify: `src/control/webProtocol.ts`（`groupSummarySchema` 854–865、`workItemViewSchema` 900–916）
- Modify: `src/panel/controlViews.ts`（`readGroupSummary` 245–266、`workViews` 407–458）
- Modify（夹具，F14）: `tests/control/fixtures/web.ts`（`WebFixtureTask` 27、plan 任务 67）
- Test (new): `tests/control/taskLabels.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `readTaskLabelState`、`effectiveTaskLabels`、`storedLabelsSchema`；Task 2 的 `ControlPlanV1` task `labels`。
- Produces（线上可选、服务端总是给出，R19）:
  - `GroupSummaryV1.completion?: { done: number; total: number }`
  - `WorkItemViewV1.labels?: string[]`、`labelsProvenance?: "plan" | "operator"`、`labelsVersion?: number`
  - `WebFixtureTask.labels?: string[]`

- [ ] **Step 1: 夹具加可选 `labels`**（F14；缺省时写出的 plan 与今天逐字节相同）
  - `tests/control/fixtures/web.ts:27` 的接口改为在 `agent?: PartialSelection` 之后加 `; labels?: string[]`，并在上一行注释下追加一行：`// Labels and progress plan Task 3 (finding F14): a task may carry plan labels; absent, the plan file is unchanged.`
  - 第 67 行 `planTasks.push({ … ...(task.agent ? { agent: task.agent } : {}) });` 的对象末尾加 `, ...(task.labels ? { labels: task.labels } : {})`。

- [ ] **Step 2: 写判据** —— 新建 `tests/control/taskLabels.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { readControlGroup, readControlSummary } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Labels and progress spec §2.4, §2.5, §4.1 and §8 R14, R19 (plan Task 3); the set-task-labels criteria are appended
 * by plan Task 4. The Mutation lines of those Tasks name the production line each `it` goes red on.
 */
type Fixture = Awaited<ReturnType<typeof webFixture>>;
const view = (h: Fixture) => readControlGroup(h.store, "epoch", "g");
const itemOf = (h: Fixture, taskId = "a") => view(h).workItems.find((item) => item.taskId === taskId)!;
const workBody = (h: Fixture, taskId: string): Record<string, unknown> =>
  JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
const writeWork = (h: Fixture, taskId: string, patch: Record<string, unknown>): void => {
  h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...workBody(h, taskId), ...patch }), taskId);
};

describe("labels in the group view (spec §4.1, criteria L5, R19)", () => {
  it("R19: the server always gives every work item its labels, provenance and version, and every summary its completion", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }, { taskId: "b", labels: ["bug"] }]);
    try {
      const group = view(h);
      for (const item of group.workItems) {
        expect(item.labels).toBeDefined();
        expect(item.labelsProvenance).toBeDefined();
        expect(item.labelsVersion).toBeDefined();
      }
      expect(group.summary.completion).toEqual({ done: 0, total: 2 });
      expect(readControlSummary(h.store, "epoch", null).groups[0]!.completion).toEqual({ done: 0, total: 2 });
    } finally { await h.dispose(); }
  });

  it("L5: shows the plan's labels until an override exists, and an empty override as the person clearing them", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["custom:前端", "bug"] }]);
    try {
      expect(itemOf(h)).toMatchObject({ labels: ["bug", "custom:前端"], labelsProvenance: "plan", labelsVersion: 0 });
      writeWork(h, "a", { labelsOverride: [], labelsVersion: 1 });
      expect(itemOf(h)).toMatchObject({ labels: [], labelsProvenance: "operator", labelsVersion: 1 });
      writeWork(h, "a", { labelsOverride: null, labelsVersion: 2 });
      expect(itemOf(h)).toMatchObject({ labels: ["bug", "custom:前端"], labelsProvenance: "plan", labelsVersion: 2 });
    } finally { await h.dispose(); }
  });
});

describe("group completion (spec §4.1, criterion P5, §8 R14)", () => {
  it("P5: counts only completed tasks, out of the plan's task count, the same in the summary and the group view", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }, { taskId: "d" }, { taskId: "e" }]);
    try {
      writeWork(h, "a", { status: "done" });
      writeWork(h, "b", { status: "blocked" });
      writeWork(h, "c", { status: "held" });
      writeWork(h, "d", { status: "continuing" });
      // R14: a handoff work item is a work_items row too, and is not one of the plan's tasks.
      h.store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES ('g','handoff-a',1,?)")
        .run(JSON.stringify({ workItemId: "handoff-a", taskId: "a", kind: "handoff", status: "done" }));
      const completion = { done: 1, total: 5 };
      expect(view(h).summary.completion).toEqual(completion);
      expect(readControlSummary(h.store, "epoch", null).groups.find((group) => group.groupId === "g")!.completion).toEqual(completion);
      expect(view(h).workItems.map((item) => item.status)).toEqual(["completed", "blocked", "held", "continuing", "draft"]);
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 3: 跑，确认红**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/taskLabels.test.ts > "$SCRATCH/lp-t3-red.txt" 2>&1; echo rc=$?
```
Expected：rc=1，三条都红（`labels`／`completion` 为 `undefined`）。

- [ ] **Step 4: 实现**

(a) `src/control/webProtocol.ts`：第 2 行的 labels import 改为 `import { nonEmptyStoredLabelsSchema, storedLabelsSchema } from "./labels.js";`。
`groupSummarySchema`（854–865）在 `recoveryBlockerCount: safeInteger,` 之后加：
```ts
    // Labels and progress spec §4.1 (§8 R14, R19): tasks done out of the plan's tasks. Optional on the wire so older
    // fixtures still parse; the server always gives it. The group view's `summary` is this same object (finding F7).
    completion: z.object({ done: safeInteger, total: safeInteger }).strict().optional(),
```
`workItemViewSchema`（900–916）在 `lineageRunIds: sortedIdArraySchema,` 之后加：
```ts
    // Labels and progress spec §2.5, §4.1 (§8 R19): the task's effective labels, where they came from, and the version a
    // set-task-labels must name. Optional on the wire; the server always gives them.
    labels: storedLabelsSchema.optional(),
    labelsProvenance: z.enum(["plan", "operator"]).optional(),
    labelsVersion: safeInteger.optional(),
```

(b) `src/panel/controlViews.ts`：
- import 区加 `import { effectiveTaskLabels, readTaskLabelState } from "../control/labels.js";`
- 在 `readGroupSummary` 之前加：
```ts
/**
 * Labels and progress spec §4.1 (§8 R14): `done` is the plan tasks whose work item the view shows as `completed` (stored
 * `done`, or already `completed`); `total` is the archived plan's task count, never the work_items rows (a handoff has
 * one too). Lenient on purpose (plan finding F5): a work item this cannot read counts as not done, and the group view's
 * workViews names it exactly as before; a summary list must not go dark over one bad row.
 */
function taskCompletion(store: ControlStore, groupId: string, plan: ReturnType<typeof readArchivedPlan>["plan"]): { done: number; total: number } {
  let done = 0;
  for (const task of plan.tasks) {
    const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(groupId, task.taskId);
    let status: unknown = null;
    try { status = row === undefined ? null : (JSON.parse(String(row.body)) as { status?: unknown }).status; } catch { status = null; }
    if (status === "done" || status === "completed") done += 1;
  }
  return { done, total: plan.tasks.length };
}
```
- `readGroupSummary`：第 247 行 `readArchivedPlan(store, groupId);` 改为 `const archived = readArchivedPlan(store, groupId);`；`summary` 对象（253–262）在 `recoveryBlockerCount: blockers.length,` 之后加 `completion: taskCompletion(store, groupId, archived.plan),`（放在所有既有检查之后，报错优先级不变）。
- `workViews` 的返回对象（449–456）：在 `const status = …`（448）之后加
```ts
    // Spec §2.5: the one computation of a task's labels (labels.ts), from the work item's layer and the archived plan.
    const labelState = readTaskLabelState(body);
    const effective = effectiveTaskLabels(labelState, task.labels);
```
  并在返回对象的 `lineageRunIds: sortedUnique(lineage),` 之后加 `labels: effective.labels, labelsProvenance: effective.provenance, labelsVersion: labelState.version,`。

- [ ] **Step 5: 跑，确认绿（含读视图的既有判据）＋ 类型检查**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/taskLabels.test.ts tests/control/webProtocol.test.ts tests/panel/controlReadApi.test.ts tests/control/webContinuation.test.ts tests/control/webMutations.test.ts tests/control/planImport.test.ts > "$SCRATCH/lp-t3-green.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/lp-t3-tsc.txt" 2>&1; echo rc=$?
```
Expected：两个 rc=0，0 skipped。`controlReadApi` 里断言报错文本的判据（如 `recovery-blocked:stop-intent-missing`）不变——若红，按 F5 查完成度是否在既有检查之前抛了，停下报控制器。

- [ ] **Step 6: 提交**（先 diff／status 读回）

```bash
cd /Users/biran/code/skills/loop/Orca && /usr/bin/git add src/control/webProtocol.ts src/panel/controlViews.ts tests/control/fixtures/web.ts tests/control/taskLabels.test.ts && /usr/bin/git commit -F - <<'EOF'
feat(panel): each work item's effective labels and each group's completed tasks out of its plan

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

- [ ] **Step 7: 台账**：夹具改动 `tests/control/fixtures/web.ts`（`WebFixtureTask.labels`，F14）。

**Mutation**:
- M3a 锚点 `if (status === "done" || status === "completed") done += 1;` → `if (status === "done" || status === "completed" || status === "blocked") done += 1;` ⇒ `P5: counts only completed tasks, …` 红。
- M3b 锚点 `return { done, total: plan.tasks.length };` → `return { done, total: Number(store.db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE group_id=?").get(groupId)!.n) };` ⇒ P5 红（total 6）。
- M3c 锚点 `labels: effective.labels, labelsProvenance: effective.provenance, labelsVersion: labelState.version,` → 删掉 ⇒ `R19: the server always gives …` 红。
- M3d 锚点 `completion: taskCompletion(store, groupId, archived.plan),` → 删掉 ⇒ R19 红。
- M3e 锚点 `const effective = effectiveTaskLabels(labelState, task.labels);` → `const effective = effectiveTaskLabels({ override: null, version: 0 }, task.labels);` ⇒ `L5: shows the plan's labels until an override exists, …` 红。

---
### Task 4: `set-task-labels` 命令，服务端全链路（Orca；spec §3.1；§8 R6–R9、R15、R16）

**Files:**
- Modify: `src/control/errors.ts`（409 段 32–69、422 段 73–133）
- Modify: `src/control/webProtocol.ts`（`commandVerbSchema` 566–583；payload schema 放在 716 之后；raw union 734–753；effective union 755–789；`commandResultSchema` 1129–1220；类型导出 1308 附近）
- Modify: `src/control/webService.ts`（类型 30–34；新方法放在 `setLimit`（494–511）之后、类的 `}`（512）之前）
- Modify: `src/panel/controlApi.ts`（路由表 249–296、分派 304–321）
- Test（追加）: `tests/control/taskLabels.test.ts`；Test (new): `tests/panel/taskLabelsApi.test.ts`

**Interfaces:**
- Consumes: Task 1 `normalizeInputLabels`、`readTaskLabelState`、`effectiveTaskLabels`；`readArchivedPlan`（`webService.ts:14` 已 import）；`same`（`webService.ts:46`）。
- Produces:
  - 动词 `"set-task-labels"`；target `{ kind: "task", groupId, taskId }`（R8）；`expectedRevision` 是组的 commandRevision（R6）
  - `export const setTaskLabelsPayloadSchema`：`{ labels: string[] (≤64 项) | null, baseLabelsVersion: safeInteger }` strict；`export type SetTaskLabelsPayload`
  - 结果 `{ kind: "task-labels-set", taskId: string, labelsVersion: number }`
  - 错误码 `labels-version-conflict`（409）、`labels-invalid`（422，detail ＝ 被拒的那一项，或 `count:<n>`、`lone-surrogate`）
  - `export type SetTaskLabelsCommand`；`WebControlService.setTaskLabels(command: SetTaskLabelsCommand): WebCommandResult`
  - 路由 `POST /api/control/groups/:groupId/tasks/:taskId/labels`（R9）
  - ⚠️ R6 的既有后果照写：成功推进组的 `commandRevision` 与 `changeSeq`，同组其他在飞命令的 `expectedRevision` 随之过期（所有命令的既有行为）。

- [ ] **Step 1: 写判据**

(a) `tests/control/taskLabels.test.ts`：顶部 import 追加
```ts
import { SYSTEM_LABELS } from "../../src/control/labels.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";
```
文件末尾追加：

```ts
const codeOf = (answer: unknown): string | undefined => (answer as { error?: { code: string } }).error?.code;

describe("set-task-labels (spec §3.1, criteria L3, L4; §8 R6-R8, R15, R16)", () => {
  it("L4: sets, clears and reverts a task's labels as three different results, each moving labelsVersion", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug"] }]);
    try {
      const service = new WebControlService(h.deps);
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["perf", "custom:前端"], baseLabelsVersion: 0 })))
        .toMatchObject({ verb: "set-task-labels", result: { kind: "task-labels-set", taskId: "a", labelsVersion: 1 } });
      expect(itemOf(h)).toMatchObject({ labels: ["custom:前端", "perf"], labelsProvenance: "operator", labelsVersion: 1 });
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: [], baseLabelsVersion: 1 }))).toMatchObject({ result: { labelsVersion: 2 } });
      expect(itemOf(h)).toMatchObject({ labels: [], labelsProvenance: "operator", labelsVersion: 2 });
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: null, baseLabelsVersion: 2 }))).toMatchObject({ result: { labelsVersion: 3 } });
      expect(itemOf(h)).toMatchObject({ labels: ["bug"], labelsProvenance: "plan", labelsVersion: 3 });
    } finally { await h.dispose(); }
  });

  it("L4/R16: is a no-op when the result equals the labels in effect, or when there is no override to revert", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", labels: ["bug"] }, { taskId: "b" }]);
    try {
      const service = new WebControlService(h.deps);
      expect(codeOf(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["bug", "bug"], baseLabelsVersion: 0 })))).toBe("no-op-command");
      expect(codeOf(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: null, baseLabelsVersion: 0 })))).toBe("no-op-command");
      // A task the plan gave no labels: [] is exactly what is in effect.
      expect(codeOf(service.setTaskLabels(h.taskCommand("set-task-labels", "b", { labels: [], baseLabelsVersion: 0 })))).toBe("no-op-command");
      expect(itemOf(h, "a").labelsVersion).toBe(0);
      expect(itemOf(h, "b").labelsVersion).toBe(0);
    } finally { await h.dispose(); }
  });

  it("L4/R6: refuses a stale labelsVersion under a fresh revision, and a stale revision before it looks at labels", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const service = new WebControlService(h.deps);
      const staleRevision = h.taskCommand("set-task-labels", "a", { labels: ["perf"], baseLabelsVersion: 0 });
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["bug"], baseLabelsVersion: 0 }))).toMatchObject({ result: { labelsVersion: 1 } });
      expect(codeOf(service.setTaskLabels(staleRevision))).toBe("revision-conflict");
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["perf"], baseLabelsVersion: 0 })))
        .toMatchObject({ error: { code: "labels-version-conflict", retryable: false } });
      expect(itemOf(h)).toMatchObject({ labels: ["bug"], labelsVersion: 1 });
    } finally { await h.dispose(); }
  });

  it("L3: refuses a word outside the vocabulary and a 17th distinct label by name; counts after deduplication; stores NFC", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const service = new WebControlService(h.deps);
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["Feature"], baseLabelsVersion: 0 })))
        .toMatchObject({ error: { code: "labels-invalid", message: "labels-invalid:Feature" } });
      const sixteen = [...SYSTEM_LABELS, ...Array.from({ length: 6 }, (_, i) => `custom:c${i}`)];
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: [...sixteen, "custom:c16"], baseLabelsVersion: 0 })))
        .toMatchObject({ error: { code: "labels-invalid", message: "labels-invalid:count:17" } });
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: [...sixteen, "bug"], baseLabelsVersion: 0 })))
        .toMatchObject({ result: { labelsVersion: 1 } });
      expect(service.setTaskLabels(h.taskCommand("set-task-labels", "a", { labels: ["custom:café"], baseLabelsVersion: 1 })))
        .toMatchObject({ result: { labelsVersion: 2 } });
      expect(itemOf(h).labels).toEqual(["custom:café"]);
    } finally { await h.dispose(); }
  });

  it("refuses a missing task and a work item that is not a task as work-not-found", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const service = new WebControlService(h.deps);
      h.store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES ('g','handoff-a',1,?)")
        .run(JSON.stringify({ workItemId: "handoff-a", taskId: "a", kind: "handoff", status: "draft" }));
      expect(codeOf(service.setTaskLabels(h.taskCommand("set-task-labels", "missing", { labels: ["bug"], baseLabelsVersion: 0 })))).toBe("work-not-found");
      expect(codeOf(service.setTaskLabels(h.taskCommand("set-task-labels", "handoff-a", { labels: ["bug"], baseLabelsVersion: 0 })))).toBe("work-not-found");
    } finally { await h.dispose(); }
  });

  it("L4: replays the same commandId to the same stored answer, and applies it once", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }]);
    try {
      const service = new WebControlService(h.deps);
      const once = h.taskCommand("set-task-labels", "a", { labels: ["bug"], baseLabelsVersion: 0 });
      const first = service.setTaskLabels(once);
      expect(service.setTaskLabels(once)).toEqual(first);
      expect(itemOf(h).labelsVersion).toBe(1);
    } finally { await h.dispose(); }
  });

  it("L4: works on a confirmed group and on a running one, never touching the proposal (human ruling L-2)", async () => {
    const t = await driverHarness([{ taskId: "a", labels: ["bug"] }]);
    try {
      const before = readBudgetProposal(t.h.store, "g");
      expect(before.state).toBe("confirmed");
      expect(t.service.setTaskLabels(t.h.taskCommand("set-task-labels", "a", { labels: ["perf"], baseLabelsVersion: 0 }))).toMatchObject({ result: { labelsVersion: 1 } });
      await t.claim();
      expect(readControlGroup(t.h.store, "epoch", "g").summary.state).toBe("running");
      expect(t.service.setTaskLabels(t.h.taskCommand("set-task-labels", "a", { labels: ["perf", "test"], baseLabelsVersion: 1 }))).toMatchObject({ result: { labelsVersion: 2 } });
      const after = readBudgetProposal(t.h.store, "g");
      expect(after.proposalVersion).toBe(before.proposalVersion);
      expect(after.state).toBe("confirmed");
      expect(readControlGroup(t.h.store, "epoch", "g").workItems[0]).toMatchObject({ labels: ["perf", "test"], labelsVersion: 2 });
    } finally { await t.h.dispose(); }
  });
});
```

(b) 新建 `tests/panel/taskLabelsApi.test.ts`（不许出现任何 skip 写法：`tests/panel/noSkips.test.ts` 会扫它）：

```ts
/**
 * Labels and progress spec §3.1 and §8 R7-R9 over a real Panel: the one new POST route, a vocabulary refusal that is
 * ledgered (not a malformed request), and a wrong-shaped payload that never reaches the ledger.
 */
import { afterAll, describe, expect, it } from "vitest";
import { SYSTEM_LABELS } from "../../src/control/labels.js";
import { commandLookupSchema, commandSuccessSchema } from "../../src/control/webProtocol.js";
import { GROUP, command, createHarness, get, json, revision, view } from "./fixtures/controlPanel.js";

const h = createHarness();
afterAll(async () => { await h.dispose(); });

const LABELS = `/api/control/groups/${GROUP}/tasks/a/labels`;

async function importedPanel(epoch: string) {
  const panel = await h.boot(epoch, await h.workspace());
  const answer = await command(panel, "/api/control/groups/import-plan", {
    commandId: `${epoch}-import`, expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" },
  });
  expect(answer.status).toBe(201);
  return panel;
}

describe("the set-task-labels route (spec §3.1, §8 R7-R9)", () => {
  it("R9: sets a task's labels over POST /tasks/:taskId/labels, moving the group's revision once", async () => {
    const panel = await importedPanel("epoch-labels-set");
    const before = await view(panel);
    const answer = await command(panel, LABELS, {
      commandId: "labels-1", expectedRevision: before.summary.commandRevision, payload: { labels: ["custom:前端", "bug"], baseLabelsVersion: 0 },
    });
    expect(answer.status).toBe(200);
    expect(commandSuccessSchema.parse(answer.body)).toMatchObject({
      verb: "set-task-labels", target: { kind: "task", groupId: GROUP, taskId: "a" }, result: { kind: "task-labels-set", taskId: "a", labelsVersion: 1 },
    });
    const after = await view(panel);
    expect(after.summary.commandRevision).toBe(before.summary.commandRevision + 1);
    expect(after.changeSeq).toBeGreaterThan(before.changeSeq);
    expect(after.workItems[0]).toMatchObject({ labels: ["bug", "custom:前端"], labelsProvenance: "operator", labelsVersion: 1 });
    await panel.close();
  });

  it("R8: refuses a 17th distinct label as a ledgered labels-invalid naming the count, not as a malformed request", async () => {
    const panel = await importedPanel("epoch-labels-invalid");
    const labels = [...SYSTEM_LABELS, ...Array.from({ length: 7 }, (_, i) => `custom:c${i}`)];
    const answer = await command(panel, LABELS, { commandId: "labels-17", expectedRevision: await revision(panel), payload: { labels, baseLabelsVersion: 0 } });
    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ error: { code: "labels-invalid", message: "labels-invalid:count:17" } });
    const lookup = commandLookupSchema.parse(await json(await get(panel, `/api/control/groups/${GROUP}/commands/labels-17`)));
    expect(lookup).toMatchObject({ originalStatus: 422, body: { error: { code: "labels-invalid" } } });
    await panel.close();
  });

  it("R8: a payload of the wrong shape is refused before the ledger, as control-non-json-payload", async () => {
    const panel = await importedPanel("epoch-labels-shape");
    const answer = await command(panel, LABELS, { commandId: "labels-shape", expectedRevision: await revision(panel), payload: { labels: [1], baseLabelsVersion: 0 } });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: { code: "control-non-json-payload" } });
    await panel.close();
  });
});
```

- [ ] **Step 2: 跑，确认红**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/taskLabels.test.ts tests/panel/taskLabelsApi.test.ts > "$SCRATCH/lp-t4-red.txt" 2>&1; echo rc=$?
```
Expected：rc=1；Task 3 的三条仍绿；新加的七条红在 `service.setTaskLabels is not a function` 或 `rawAuthorityCommandSchema` 拒掉未知动词；HTTP 三条红在 404 `route-not-found`（第三条当前也是 404，不是 400）。

- [ ] **Step 3: 实现**

(a) `src/control/errors.ts`：409 段在 `"landing-branch-conflict": 409,` **之前**加
```ts
  // Labels and progress spec §3.1 (§8 R7): the task's labels moved since the person read them (plan finding F17).
  "labels-version-conflict": 409,
```
422 段在 `"landing-not-confirmed": 422,` **之前**加
```ts
  // Labels and progress spec §3.1 (§8 R8): an input label the vocabulary or the format refuses; the detail names it.
  "labels-invalid": 422,
```

(b) `src/control/webProtocol.ts`：
- `commandVerbSchema` 末项 `"proposal-set-agent",` 之后加 `"set-task-labels",`。
- 716 行（`setAgentPreferencesPayloadSchema`）之后加：
```ts
// Labels and progress spec §3.1 (§8 R8, R16): shape only -- a list of strings, or null to drop the operator layer. The
// vocabulary, prefix, NFC and the 16-label cap are checked in apply, so a refusal is ledgered and names the label. The
// raw cap (64) only bounds the request: 16 is counted after deduplication (R15; plan finding F2).
export const setTaskLabelsPayloadSchema = z
  .object({ labels: z.array(z.string()).max(64).nullable(), baseLabelsVersion: safeInteger })
  .strict();
```
- raw union（753 行 `]);` 之前）加：
```ts
  z.object({ ...rawCommandFields, verb: z.literal("set-task-labels"), target: taskCommandTargetSchema, payload: setTaskLabelsPayloadSchema }).strict(),
```
- effective union（789 行 `]);` 之前）加：
```ts
  z.object({ ...effectiveCommandFields, verb: z.literal("set-task-labels"), target: taskCommandTargetSchema, payload: setTaskLabelsPayloadSchema }).strict(),
```
- `commandResultSchema` 在 `z.object({ kind: z.literal("agent-preferences-set"), … }).strict(),`（1174）之后加：
```ts
  z.object({ kind: z.literal("task-labels-set"), taskId: idSchema, labelsVersion: positiveSafeInteger }).strict(),
```
- 类型区（1308 行 `ProposalSetAgentPayload` 之后）加 `export type SetTaskLabelsPayload = z.infer<typeof setTaskLabelsPayloadSchema>;`

(c) `src/control/webService.ts`：
- import 区加 `import { effectiveTaskLabels, normalizeInputLabels, readTaskLabelState } from "./labels.js";`
- 第 34 行之后加 `export type SetTaskLabelsCommand = Extract<RawAuthorityCommandV1, { verb: "set-task-labels" }>;`
- `setLimit` 结束（511 行 `}`）之后、类的 `}` 之前加：
```ts
  /**
   * Labels and progress spec §3.1 (§8 R6-R8, R16; human ruling L-2): replace or clear a task's operator label layer.
   * Any group state, no proposal change, no re-confirmation: labels are not budget authority. Checked in the spec's
   * order -- the work item, the labels version, the labels themselves, then no-op -- and the vocabulary here, not in the
   * payload schema, so a refusal is ledgered and names the label (R8).
   */
  setTaskLabels(command: SetTaskLabelsCommand): WebCommandResult {
    return this.mutate(() => applyWebCommand(this.store, {
      rawCommand: command, expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
      apply: context => {
        const id = groupId(command), taskId = command.target.taskId;
        readWebGroup(this.store, id);
        const row = this.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(id, taskId);
        const work = row ? JSON.parse(String(row.body)) as Record<string, unknown> : null;
        if (!work || work.kind !== "task") throw new ControlError("work-not-found");
        const state = readTaskLabelState(work);
        if (command.payload.baseLabelsVersion !== state.version) throw new ControlError("labels-version-conflict");
        let next: string[] | null = null;
        if (command.payload.labels === null) {
          if (state.override === null) throw new ControlError("no-op-command");
        } else {
          const checked = normalizeInputLabels(command.payload.labels);
          if (!checked.ok) throw new ControlError("labels-invalid", checked.detail);
          const planTask = readArchivedPlan(this.store, id).plan.tasks.find(task => task.taskId === taskId);
          if (same(checked.labels, effectiveTaskLabels(state, planTask?.labels).labels)) throw new ControlError("no-op-command");
          next = checked.labels;
        }
        if (state.version === Number.MAX_SAFE_INTEGER) throw new ControlError("numeric-overflow");
        work.labelsOverride = next; work.labelsVersion = state.version + 1;
        this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, taskId);
        return success(context, { kind: "task-labels-set", taskId, labelsVersion: state.version + 1 });
      },
    }).body);
  }
```

(d) `src/panel/controlApi.ts`：路由表在 `proposal-set-agent` 那行（295）之后加：
```ts
    // Labels and progress spec §8 R9: the one new route; the ledger key is the group's, as for continue-task.
    {
      path: "/api/control/groups/:groupId/tasks/:taskId/labels",
      verb: "set-task-labels",
      target: (params) => {
        const groupId = idSchema.parse(params.groupId);
        return { groupId, target: { kind: "task", groupId, taskId: idSchema.parse(params.taskId) } };
      },
    },
```
分派在 `case "proposal-set-agent": …`（319）之后加 `case "set-task-labels": service.setTaskLabels(command); break;`

- [ ] **Step 4: 跑，确认绿（含命令与错误分类的既有判据）＋ 类型检查**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/taskLabels.test.ts tests/panel/taskLabelsApi.test.ts tests/control/errorClassification.test.ts tests/control/webProtocol.test.ts tests/control/commandLedger.test.ts tests/panel/controlApi.test.ts tests/panel/noSkips.test.ts tests/panel/controlMount.test.ts > "$SCRATCH/lp-t4-green.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/lp-t4-tsc.txt" 2>&1; echo rc=$?
```
Expected：两个 rc=0，0 skipped。`npm run typecheck` 此时会因 `tests/panel/webParity.test.ts` 的 `CommandSuccessV1` 双向赋值报错（服务端多了动词与结果，Web 镜像还没有）⇒ **本 Task 同时**给 `web/src/controlTypes.ts` 的 `CommandSuccessV1` 加上 Task 7 Step 3(a) 里的 `verb` 一项与 `result` 一项（只这两处；其余 Web 改动留在 Task 7），再跑 typecheck 到 rc=0，并把该文件加进本 Task 的提交。

- [ ] **Step 5: 提交**（先 diff／status 读回）

```bash
cd /Users/biran/code/skills/loop/Orca && /usr/bin/git add src/control/errors.ts src/control/webProtocol.ts src/control/webService.ts src/panel/controlApi.ts web/src/controlTypes.ts tests/control/taskLabels.test.ts tests/panel/taskLabelsApi.test.ts && /usr/bin/git commit -F - <<'EOF'
feat(control): set-task-labels -- any group state, no proposal change, a ledgered refusal that names the label

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

**Mutation**:
- M4a 锚点 `readWebGroup(this.store, id);\n        const row` → `prestart(readWebGroup(this.store, id));\n        const row` ⇒ `L4: works on a confirmed group and on a running one, …` 红（`grant-amendment-unsupported`）。
- M4b 锚点 `this.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify(work), id, taskId);\n        return success(context, { kind: "task-labels-set"` → 在 UPDATE 之后插入 `{ const proposal = readBudgetProposal(this.store, id); proposal.proposalVersion += 1; saveWebAuthority(this.store, readWebGroup(this.store, id), proposal); }` ⇒ 同一条红（`proposalVersion` 变了）。
- M4c 锚点 `if (command.payload.baseLabelsVersion !== state.version) throw new ControlError("labels-version-conflict");` → 删掉 ⇒ `L4/R6: refuses a stale labelsVersion …` 红。
- M4d 锚点 `effectiveTaskLabels(state, planTask?.labels).labels` → `(state.override ?? [])` ⇒ `L4/R16: is a no-op when …` 红（设成 plan 的 `["bug"]` 被当成改动）。
- M4e 锚点 `if (state.override === null) throw new ControlError("no-op-command");` → 删掉 ⇒ 同一条红。
- M4f 锚点 `path: "/api/control/groups/:groupId/tasks/:taskId/labels",` → `path: "/api/control/groups/:groupId/tasks/:taskId/labels-disabled",` ⇒ `R9: sets a task's labels over POST …` 红（404）。
- M4g 锚点 `labels: z.array(z.string()).max(64).nullable()` → `labels: inputLabelsSchema.nullable()`（并在 webProtocol 的 labels import 里加 `inputLabelsSchema`）⇒ `R8: refuses a 17th distinct label as a ledgered labels-invalid…` 红（变成 400）。
- M4h 同锚点 → `labels: z.array(z.string()).max(16).nullable()` ⇒ `L3: refuses a word outside the vocabulary …; counts after deduplication; …` 红（`[...sixteen, "bug"]` 在 schema 层就被拒，`applyWebCommand` 抛 ZodError）。
- 编译期（登记，不是运行时判据）：删掉 `errors.ts` 的两行，`npm run typecheck` 失败（`KnownControlErrorCode` 封闭）。

---
### Task 5: Orca 接受并存下 ccloop 的 `progress`，投影成 `step`／尝试／tokens（Orca；spec §2.6、§3.2–§3.4、§4.1；§8 R1–R5、R10、R11、R18）

**Files:**
- Modify: `src/control/schema.ts`（在 `candidateSchema`（56–60）之后加 `runProgressSchema`）
- Modify: `src/control/executionPort.ts`（`ExecutionReport` 11–14）
- Modify: `src/control/ccloopPort.ts`（`collectionSchema` 27、`collect` 117）
- Modify: `src/control/executionDriver.ts`（`collectInto` 400–422，用量循环 413–416 之后）
- Modify: `src/control/webProtocol.ts`（新 `workItemProgressSchema`；`workItemViewSchema` 加 `progress`）
- Modify: `src/panel/controlViews.ts`（`persistedRunSchema` 114–158；新 `progressOfRun`／`currentProgress`；`workViews` 返回对象）
- Modify（夹具旋钮，F3）: `tests/control/fixtures/fake-ccloop-control.mjs:53`
- Test（追加）: `tests/control/ccloopPort.test.ts`；Test (new): `tests/control/driverProgress.test.ts`

**Interfaces:**
- Produces:
  - `export const runProgressSchema`（strict：`status` ∈ `queued|planning|executing|verifying|succeeded|blocked_waiting_human|exhausted|cancelled|failed`，`currentAttempt`、`attemptsUsed`、`attemptsRemaining` 为 safeInteger，`lastTransitionAt` 非空字符串）；`export type RunProgress`
  - `ExecutionReport.progress?: RunProgress | null`（**可选**，R5：既有假 port 一处不改）
  - run body 的 `progress?: RunProgress | null`（旧 run 无此键，R1）
  - `export const workItemProgressSchema`／`export type WorkItemProgressV1 = { runId: string; step: "queued"|"plan"|"execute"|"verify"|"succeeded"|"blocked_waiting_human"|"exhausted"|"cancelled"|"failed"|null; attempt: { current: number; max: number } | null; tokens: { used: number; grant: number } | null; lastTransitionAt: string | null }`
  - `WorkItemViewV1.progress?: WorkItemProgressV1 | null`（服务端总是给出；没有当前 run 时 `null`，F6）
  - `export function progressOfRun(run): WorkItemProgressV1`（`controlViews.ts`，纯函数，F18）

- [ ] **Step 1: 夹具旋钮**（F3）—— `tests/control/fixtures/fake-ccloop-control.mjs` 第 53 行之前加注释、第 53 行的对象末尾加展开：
```js
// Labels and progress plan Task 5 (finding F3): an optional `progress` knob; absent, the answer is byte for byte what it was.
else if (method === "collect") value = { events:config.collectRef?[{runId:payload.input.claim.runId,generation:payload.input.claim.generation,eventSeq:1,bucket:"work",cumulative:null,source:config.collectRef}]:[],candidate:null,terminal:null,...(config.progress !== undefined ? { progress:config.progress } : {}) };
```

- [ ] **Step 2: 写判据**

(a) `tests/control/ccloopPort.test.ts` 末尾追加（用本文件的 `fixture()`，`:12-22`）：

```ts
describe("collect's progress through the real port (labels and progress spec §3.2, criterion P2; §8 R4)",()=>{
  const progress={status:"executing",currentAttempt:1,attemptsUsed:1,attemptsRemaining:2,lastTransitionAt:"2026-09-29T00:00:00.000Z"};
  it("passes ccloop's progress through, and reads an answer without one as null",async()=>{
    const answered=await fixture("ok",{progress});
    expect((await answered.port.collect(answered.envelope,0)).progress).toEqual(progress);
    const older=await fixture();
    expect((await older.port.collect(older.envelope,0)).progress).toBeNull();
  });
  it("refuses the whole answer when progress has the wrong shape",async()=>{
    const unknownStatus=await fixture("ok",{progress:{...progress,status:"thinking"}});
    await expect(unknownStatus.port.collect(unknownStatus.envelope,0)).rejects.toThrow("control-response-invalid");
    const missingField=await fixture("ok",{progress:{status:"executing"}});
    await expect(missingField.port.collect(missingField.envelope,0)).rejects.toThrow("control-response-invalid");
  });
});
```

(b) 新建 `tests/control/driverProgress.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { collectInto, readDriverRun } from "../../src/control/executionDriver.js";
import { readProjectionState } from "../../src/control/projectionJournal.js";
import type { RunProgress } from "../../src/control/schema.js";
import { progressOfRun, readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Labels and progress spec §2.6, §3.4, §4.1 and §8 R1-R3, R5, R10, R11, R18 (plan Task 5). The synthetic ccloop
 * (fixtures/driverPort.ts) is left exactly as it is (R5): `answerProgress` wraps its collect to add a progress answer.
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const progress = (status: RunProgress["status"], over: Partial<RunProgress> = {}): RunProgress => ({
  status, currentAttempt: 1, attemptsUsed: 1, attemptsRemaining: 2, lastTransitionAt: "2026-09-29T00:00:00.000Z", ...over,
});
function answerProgress(t: Harness, next: () => RunProgress | null | undefined): void {
  const collect = t.fake.port.collect.bind(t.fake.port);
  t.fake.port.collect = async (envelope, afterSeq) => {
    const report = await collect(envelope, afterSeq);
    const value = next();
    return value === undefined ? report : { ...report, progress: value };
  };
}
/** Drives a claimed run to `accepted` (one driver step per round), leaving collection to the criterion. */
async function accepted(t: Harness): Promise<string> {
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "accepted");
  return runId;
}
const groupBody = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const changeSeq = (t: Harness): number => readProjectionState(t.h.store).changeSeq;
const item = (t: Harness) => readControlGroup(t.h.store, "epoch", "g").workItems[0]!;
function patchRun(t: Harness, runId: string, patch: (body: Record<string, any>) => void): void {
  const body = t.body(runId);
  patch(body);
  t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
}
const amount = (tokens: number) => ({ tokens, activeMs: 0, attempts: 0, sessions: 0 });

describe("collectInto stores ccloop's progress (spec §3.4, §8 R2, R3, R5)", () => {
  it("R2: books exactly the usage of a collect without progress, and nothing twice", async () => {
    const plain = await driverHarness([{ taskId: "a" }]);
    const withProgress = await driverHarness([{ taskId: "a" }]);
    try {
      answerProgress(withProgress, () => progress("executing"));
      const plainRun = await accepted(plain), progressRun = await accepted(withProgress);
      await collectInto(plain.deps, readDriverRun(plain.h.store, plainRun));
      await collectInto(withProgress.deps, readDriverRun(withProgress.h.store, progressRun));
      const expected = plain.body(plainRun), actual = withProgress.body(progressRun);
      expect(actual.progress).toEqual(progress("executing"));
      expect(actual.cumulative.work.tokens).toBe(10);
      expect(actual.cumulative).toEqual(expected.cumulative);
      expect(actual.remaining).toEqual(expected.remaining);
      expect(actual.highWater).toBe(expected.highWater);
      expect(groupBody(withProgress).used).toEqual(groupBody(plain).used);
      await collectInto(withProgress.deps, readDriverRun(withProgress.h.store, progressRun));
      expect(withProgress.body(progressRun).cumulative).toEqual(expected.cumulative);
      expect(groupBody(withProgress).used).toEqual(groupBody(plain).used);
    } finally { await plain.h.dispose(); await withProgress.h.dispose(); }
  });

  it("P3: writes progress only when it changed, and each change moves changeSeq exactly once", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      let answer: RunProgress | null = progress("planning");
      answerProgress(t, () => answer);
      const runId = await accepted(t);
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      const settled = changeSeq(t);
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(changeSeq(t)).toBe(settled);
      answer = progress("executing", { lastTransitionAt: "2026-09-29T00:00:01.000Z" });
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(changeSeq(t)).toBe(settled + 1);
      expect(t.body(runId).progress).toEqual(answer);
    } finally { await t.h.dispose(); }
  });

  it("P3/R1: a null answer over a run that never had progress is not a change; a port with no progress field writes nothing", async () => {
    for (const answer of [null, undefined] as const) {
      const t = await driverHarness([{ taskId: "a" }]);
      try {
        answerProgress(t, () => answer);
        const runId = await accepted(t);
        await collectInto(t.deps, readDriverRun(t.h.store, runId));
        const settled = changeSeq(t);
        await collectInto(t.deps, readDriverRun(t.h.store, runId));
        expect(changeSeq(t)).toBe(settled);
        expect("progress" in t.body(runId)).toBe(false);
      } finally { await t.h.dispose(); }
    }
  });
});

describe("a work item's progress in the group view (spec §4.1, criterion P4; §8 R1, R10, R11, R18, R19)", () => {
  it("R1/R10/R19: none without a run; a run from before progress existed reads, with nothing ccloop said yet", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      expect(item(t).progress).toBeNull();
      const runId = await t.claim();
      expect("progress" in t.body(runId)).toBe(false);
      expect(item(t).progress).toEqual({ runId, step: null, attempt: null, tokens: { used: 0, grant: t.body(runId).grant.work.tokens }, lastTransitionAt: null });
    } finally { await t.h.dispose(); }
  });

  it("R18: maps ccloop's status to the step and takes both attempt numbers from ccloop's one snapshot", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const runId = await t.claim();
      const steps = [["queued", "queued"], ["planning", "plan"], ["executing", "execute"], ["verifying", "verify"], ["succeeded", "succeeded"],
        ["blocked_waiting_human", "blocked_waiting_human"], ["exhausted", "exhausted"], ["cancelled", "cancelled"], ["failed", "failed"]] as const;
      for (const [status, step] of steps) {
        patchRun(t, runId, (body) => { body.progress = progress(status, { currentAttempt: 5, attemptsUsed: 40, attemptsRemaining: 30 }); });
        expect(item(t).progress).toMatchObject({ runId, step, attempt: { current: 5, max: 70 }, lastTransitionAt: "2026-09-29T00:00:00.000Z" });
      }
    } finally { await t.h.dispose(); }
  });

  it("R11: tokens are null -- never 0 -- when the run's usage is unknown or it overran", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const runId = await t.claim();
      const grant = t.body(runId).grant.work.tokens;
      expect(item(t).progress?.tokens).toEqual({ used: 0, grant });
      patchRun(t, runId, (body) => { body.unknown.work = true; });
      expect(item(t).progress?.tokens).toBeNull();
      patchRun(t, runId, (body) => { body.unknown.work = false; body.breaches = [1]; });
      expect(item(t).progress?.tokens).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("R11: counts a handoff-phase run in its handoff bucket", () => {
    const run = { runId: "run-h", phase: "handoff" as const, grant: { work: amount(100), handoff: amount(10) }, cumulative: { work: amount(40), handoff: amount(3) },
      unknown: { work: true, handoff: false }, breaches: [] as number[], progress: null };
    expect(progressOfRun(run).tokens).toEqual({ used: 3, grant: 10 });
    expect(progressOfRun({ ...run, unknown: { work: false, handoff: true } }).tokens).toBeNull();
  });
});
```

- [ ] **Step 3: 跑，确认红**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/ccloopPort.test.ts tests/control/driverProgress.test.ts > "$SCRATCH/lp-t5-red.txt" 2>&1; echo rc=$?
```
Expected：rc=1。ccloopPort 新两条红（strict `collectionSchema` 拒 `progress` 键 ⇒ 第一条抛 `control-response-invalid`；第二条的「older 读作 null」也拿不到 `null`）；driverProgress 整文件因 `progressOfRun` 未导出而加载失败。既有 ccloopPort 判据全绿。

- [ ] **Step 4: 实现**

(a) `src/control/schema.ts`，`candidateSchema` 之后：
```ts
// Labels and progress spec §2.6 / §3.2 (§8 R17): ccloop's latest loop-state snapshot as collect answers it -- the status,
// every step and terminal included, the attempt numbers from that same snapshot, and when it last moved.
export const runProgressSchema=z.object({status:z.enum(["queued","planning","executing","verifying","succeeded","blocked_waiting_human","exhausted","cancelled","failed"]),currentAttempt:safeInteger,attemptsUsed:safeInteger,attemptsRemaining:safeInteger,lastTransitionAt:z.string().min(1)}).strict();
export type RunProgress=z.infer<typeof runProgressSchema>;
```

(b) `src/control/executionPort.ts`：第 1 行后加 `import type { RunProgress } from "./schema.js";`；`ExecutionReport` 的 `terminal:…|null;` 之后加：
```ts
 /** Labels and progress spec §3.2 (§8 R5): optional so the synthetic ports need no edit; absent reads as null. */
 progress?:RunProgress|null;
```

(c) `src/control/ccloopPort.ts`：第 10 行 import 加 `runProgressSchema`；第 27 行改为
```ts
// Labels and progress spec §3.2 (§8 R4, R5): progress is optional, so an Orca landed before ccloop emits it still reads
// every answer (push Orca first); its shape is strict, so a wrong one refuses the whole answer.
const collectionSchema=z.object({events:z.array(eventSchema),candidate:candidateSchema.nullable(),terminal:terminalSchema.nullable(),progress:runProgressSchema.nullable().optional()}).strict();
```
第 117 行返回对象里，`terminal:…:null` 之后加 `,progress:response.progress??null`（R4：逐字段复制的返回对象不加就被静默丢掉）。

(d) `src/control/executionDriver.ts`，`collectInto` 的用量循环（413–416）之后、`const candidate = report.candidate;` 之前：
```ts
  // Labels and progress spec §3.4 (§8 R2, R3): the latest progress, stored on a FRESH read after the usage above --
  // `run` here predates recordUsage, and saving it would roll cumulative, remaining and highWater back. saveDriverRun
  // writes (and moves changeSeq) only when the body changed. A port that answered no progress field writes nothing, and
  // a null answer over a run that never had progress is no change (absent reads as null, R1; plan finding F15).
  if (report.progress !== undefined) {
    const progress = report.progress;
    write(deps, () => {
      const current = readDriverRun(store, runId);
      if (current.progress === undefined && progress === null) return;
      current.progress = progress;
      saveDriverRun(store, current);
    });
  }
```

(e) `src/control/webProtocol.ts`：在 `workItemViewSchema` 之前加
```ts
// Labels and progress spec §4.1 (§8 R10, R11, R18; plan finding F6): the current run's progress. Step, attempt and
// lastTransitionAt are ccloop's, null until it reported any; tokens are the run's booked tokens out of its grant, null
// when unknown or overrun -- never 0 for "unknown".
export const workItemProgressSchema = z
  .object({
    runId: idSchema,
    step: z.enum(["queued", "plan", "execute", "verify", "succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"]).nullable(),
    attempt: z.object({ current: safeInteger, max: safeInteger }).strict().nullable(),
    tokens: z.object({ used: safeInteger, grant: safeInteger }).strict().nullable(),
    lastTransitionAt: nonemptyString.nullable(),
  })
  .strict();
```
`workItemViewSchema` 在 Task 3 加的 `labelsVersion` 之后加：
```ts
    // §8 R19: optional on the wire, always given by the server; null when the task has no current run.
    progress: workItemProgressSchema.nullable().optional(),
```
类型区加 `export type WorkItemProgressV1 = z.infer<typeof workItemProgressSchema>;`

(f) `src/panel/controlViews.ts`：
- 第 14 行 schema import 加 `runProgressSchema, type RunProgress`；webProtocol import 加 `type WorkItemProgressV1`。
- `persistedRunSchema`（`drive:` 那行之前）加：
```ts
  // Labels and progress spec §2.6 (§8 R1): ccloop's latest progress; a run written before it existed has no key and
  // reads as null. Never back-filled.
  progress: runProgressSchema.nullable().optional(),
```
- 在 `workViews` 之前加：
```ts
/** Labels and progress spec §4.1 (§8 R18): ccloop's status as the step the panel shows. */
const STEP_OF = {
  queued: "queued", planning: "plan", executing: "execute", verifying: "verify",
  succeeded: "succeeded", blocked_waiting_human: "blocked_waiting_human", exhausted: "exhausted", cancelled: "cancelled", failed: "failed",
} as const satisfies Record<RunProgress["status"], NonNullable<WorkItemProgressV1["step"]>>;

/**
 * Labels and progress spec §4.1 (§8 R11, R18): one run's progress as its work item shows it. The attempt's two numbers
 * come from ccloop's one snapshot and are never mixed with Orca's grant. Tokens are judged per run, in the run's own
 * bucket: null when that bucket's usage is unknown or the run overran; before the first usage event they are 0 of the
 * grant, a real 0 -- ccloop reports usage at phase end (the UI says so).
 */
export function progressOfRun(
  run: Pick<z.infer<typeof persistedRunSchema>, "runId" | "phase" | "grant" | "cumulative" | "unknown" | "breaches" | "progress">,
): WorkItemProgressV1 {
  const bucket = run.phase === "handoff" ? "handoff" : "work";
  const reported = run.progress ?? null;
  return {
    runId: run.runId,
    step: reported === null ? null : STEP_OF[reported.status],
    attempt: reported === null ? null : { current: reported.currentAttempt, max: reported.attemptsUsed + reported.attemptsRemaining },
    tokens: run.unknown[bucket] || run.breaches.length > 0 ? null : { used: run.cumulative[bucket].tokens, grant: run.grant[bucket].tokens },
    lastTransitionAt: reported?.lastTransitionAt ?? null,
  };
}

/**
 * §8 R10: the current run is the work item's currentRunId -- the view has already proved it is the task's newest run by
 * rowid -- or none. No "last of lineageRunIds" fallback: lineage is sorted by id, not by age.
 */
function currentProgress(runs: ReadonlyArray<Record<string, unknown>>, currentRunId: string | null): WorkItemProgressV1 | null {
  if (currentRunId === null) return null;
  const row = runs.find((run) => String(run.id) === currentRunId);
  if (!row) return blocked(`work-item-current-run:${currentRunId}`);
  // Same detail as runViews' own parse, so a bad run body is reported exactly as before.
  return progressOfRun(parseStored(persistedRunSchema, row.body, `run-invalid:${currentRunId}`));
}
```
- `workViews` 返回对象里 Task 3 加的 `labelsVersion: labelState.version,` 之后加 `progress: currentProgress(runs, body.currentRunId ?? null),`

- [ ] **Step 5: 跑，确认绿（含驱动与视图的既有判据）＋ 类型检查**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/control/ccloopPort.test.ts tests/control/driverProgress.test.ts tests/control/executionDriver.test.ts tests/control/driverHandoff.test.ts tests/control/driverEstimate.test.ts tests/control/singleCallWire.test.ts tests/control/taskLabels.test.ts tests/control/webProtocol.test.ts tests/panel/controlReadApi.test.ts > "$SCRATCH/lp-t5-green.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/lp-t5-tsc.txt" 2>&1; echo rc=$?
```
Expected：两个 rc=0，0 skipped。（`webParity` 的 `WorkItemViewV1` 双向赋值此时仍通过：服务端新字段是可选的。）

- [ ] **Step 6: 提交**（先 diff／status 读回）

```bash
cd /Users/biran/code/skills/loop/Orca && /usr/bin/git add src/control/schema.ts src/control/executionPort.ts src/control/ccloopPort.ts src/control/executionDriver.ts src/control/webProtocol.ts src/panel/controlViews.ts tests/control/fixtures/fake-ccloop-control.mjs tests/control/ccloopPort.test.ts tests/control/driverProgress.test.ts && /usr/bin/git commit -F - <<'EOF'
feat(control): accept ccloop's optional collect progress, store it on a fresh read, and show each task's step, attempt and tokens

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

- [ ] **Step 7: 台账**：夹具改动 `fake-ccloop-control.mjs`（F3）；R5 的执行情况（既有假 port 零改动）。

**Mutation**:
- M5a `ccloopPort.ts` 锚点 `,progress:response.progress??null` → 删掉 ⇒ `passes ccloop's progress through, …` 红。
- M5b 锚点 `progress:runProgressSchema.nullable().optional()` → `progress:runProgressSchema.nullable()` ⇒ 同一条红（旧应答被整份拒）。
- M5c 同锚点 → `progress:z.unknown().optional()` ⇒ `refuses the whole answer when progress has the wrong shape` 红。
- M5d `executionDriver.ts` 锚点 `const current = readDriverRun(store, runId);\n      if (current.progress === undefined && progress === null) return;` → `const current = run;\n      if (current.progress === undefined && progress === null) return;` ⇒ `R2: books exactly the usage …` 红（cumulative 回滚到 0）。
- M5e（R3 ①，两次调用 lp-mutate）锚点 `      current.progress = progress;\n      saveDriverRun(store, current);` → `      current.progress = progress;\n      store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(current), runId); recordProjectionChange(store, [current.groupId]);`；并在 import 区加 `import { recordProjectionChange } from "./projectionJournal.js";` ⇒ `P3: writes progress only when it changed, …` 红。
- M5f（R3 ②）锚点 `      current.progress = progress;\n` → 删掉 ⇒ 同一条红（也让 R2 的 `actual.progress` 红）。
- M5g 锚点 `if (current.progress === undefined && progress === null) return;` → 删掉 ⇒ `P3/R1: a null answer over a run …` 红。
- M5h `controlViews.ts` 锚点 `progress: runProgressSchema.nullable().optional(),` → `progress: runProgressSchema.nullable(),` ⇒ `R1/R10/R19: none without a run; …` 红（旧 run 被 `run-invalid` 挡成 recovery-blocked）。
- M5i 锚点 `run.unknown[bucket] || run.breaches.length > 0 ? null :` → `run.unknown[bucket] || run.breaches.length > 0 ? { used: 0, grant: run.grant[bucket].tokens } :` ⇒ `R11: tokens are null -- never 0 -- …` 红（spec P4 的点名变异）。
- M5j 锚点 `const bucket = run.phase === "handoff" ? "handoff" : "work";` → `const bucket = "work" as const;` ⇒ `R11: counts a handoff-phase run in its handoff bucket` 红。
- M5k 锚点 `executing: "execute"` → `executing: "plan"` ⇒ `R18: maps ccloop's status …` 红。
- M5l 锚点 `max: reported.attemptsUsed + reported.attemptsRemaining` → `max: run.grant[bucket].attempts` ⇒ 同一条红。
- M5m 锚点 `if (currentRunId === null) return null;` → `return null;` ⇒ `R11: tokens are null …` 红（`item(t).progress?.tokens` 首个断言拿到 undefined）。

---
### Task 6: ccloop `collect` 发 `progress`（ccloop；spec §3.2；§8 R17、R19）

仓 `/Users/biran/code/skills/loop/ccloop`。**先确认 Orca Task 5 已提交**（Orca 能收可选 `progress`），再开始本 Task。ccloop 的铁律照旧：Rule 13（控制器不许 push）、Rule 15（改既有判据须人指名、整条改写、写明编码哪条人裁）、Rule 16、Rule 17（变异只在副本）、Rule 18（不替人宣布）。

**Files:**
- Modify: `src/control/collect.ts`（`CollectionV1` 13–17；`safe` 19 之后加 schema 与 `readProgress`；`collectExecution` 返回 41–45）
- Modify: `src/control/command.ts`（`collectionSchema` 129–141）
- Test（追加）: `tests/control/collect.test.ts`
- Test（人已授权的改写）: `tests/control/agentsControl.test.ts:180`、`:197`

**Interfaces:**
- Produces: `export interface ProgressV1 { status: RunStatus; currentAttempt: number; attemptsUsed: number; attemptsRemaining: number; lastTransitionAt: string }`；`CollectionV1.progress: ProgressV1 | null`（**总是**给出；运行中与终态都填；没有 `run/loop-state.json` 时 `null`）；`loop-state.json` 不是 JSON 或缺字段／枚举外 ⇒ `ControlProtocolError("control-terminal-invalid")`（R17）。
- Consumes: 与 Orca `runProgressSchema`（Task 5）字段逐一相同（`status` 九值、三个非负安全整数、非空 `lastTransitionAt`）。

- [ ] **Step 0: 台账**：在 Orca 台账追加「ccloop Rule 15(a) 指名」一行：文件 `tests/control/agentsControl.test.ts`，测试名 `reads the table only for capabilities and accept: a table broken after accept blocks neither inspect nor collect` 与 `keeps inspect and collect working after the table is deleted, while capabilities still refuses it`，人裁原话「授权改 ccloop tests/control/agentsControl.test.ts 那两处 toEqual => 授权。」。

- [ ] **Step 1: 写判据** —— `tests/control/collect.test.ts`：import 区加 `import { runControlCommand } from "../../src/control/command.js";`，文件末尾追加：

```ts
function loopState(status: string, over: Record<string, unknown> = {}) {
  return {
    status, currentAttempt: 1, attemptsUsed: 1, lastTransitionAt: "2026-09-29T00:00:00.000Z", waitingOnHuman: false, stopReason: null,
    budgetSnapshot: { attemptsRemaining: 2, timeRemainingMs: 1_000, tokenBudgetRemaining: 1_000 }, recentFailures: [], ...over,
  };
}

async function writeLoopState(root: string, value: unknown): Promise<void> {
  await mkdir(join(root, "run"), { recursive: true });
  await writeFile(join(root, "run", "loop-state.json"), typeof value === "string" ? value : JSON.stringify(value));
}

// Orca labels and progress spec §3.2, criterion P1, §8 R17 (Orca plan 2026-09-29-labels-and-progress Task 6).
describe("collect's progress", () => {
  it("P1: answers the loop's progress while it runs, both attempt numbers from the same snapshot", async () => {
    const f = await fixture();
    await writeLoopState(f.root, loopState("executing", { currentAttempt: 2, attemptsUsed: 2, budgetSnapshot: { attemptsRemaining: 1, timeRemainingMs: 1, tokenBudgetRemaining: 1 } }));
    expect((await collectExecution(f.envelope, 0)).progress).toEqual({
      status: "executing", currentAttempt: 2, attemptsUsed: 2, attemptsRemaining: 1, lastTransitionAt: "2026-09-29T00:00:00.000Z",
    });
  });

  it("P1: answers it once the loop ended too, and null before the loop wrote any state", async () => {
    const f = await fixture();
    expect((await collectExecution(f.envelope, 0)).progress).toBeNull();
    await writeLoopState(f.root, loopState("succeeded"));
    expect((await collectExecution(f.envelope, 0)).progress).toMatchObject({ status: "succeeded", attemptsRemaining: 2 });
  });

  it("R17: refuses a loop state that is not JSON, lacks a field progress takes, or names an unknown status", async () => {
    const f = await fixture();
    await writeLoopState(f.root, "{ not json");
    await expect(collectExecution(f.envelope, 0)).rejects.toThrow("control-terminal-invalid");
    const { budgetSnapshot: _dropped, ...withoutBudget } = loopState("executing");
    await writeLoopState(f.root, withoutBudget);
    await expect(collectExecution(f.envelope, 0)).rejects.toThrow("control-terminal-invalid");
    await writeLoopState(f.root, loopState("thinking"));
    await expect(collectExecution(f.envelope, 0)).rejects.toThrow("control-terminal-invalid");
  });

  it("P1: the control command's own strict response schema lets the progress through", async () => {
    const f = await fixture();
    await writeLoopState(f.root, loopState("verifying"));
    // A table path with nothing at it passes the shape check; collect never reads the table (spec §4.2, I4).
    const collected = await runControlCommand(["collect", "--agents", join(f.root, "agents.json")], JSON.stringify({ input: f.envelope, afterSeq: 0 }));
    expect(collected.code, collected.stderr).toBe(0);
    expect(JSON.parse(collected.stdout)).toMatchObject({ events: [], candidate: null, terminal: null, progress: { status: "verifying" } });
  });
});
```

- [ ] **Step 2: 人已授权的两处改写** —— `tests/control/agentsControl.test.ts` 第 180 行与第 197 行各自整行替换（第 197 行注释里的「broken after accept」改为「deleted after accept」）：

```ts
    // Human authorization (Orca session 2724716d, 2026-09-29: "授权改 ccloop tests/control/agentsControl.test.ts 那两处
    // toEqual => 授权。"), ccloop Rule 15 (a)-(c): rewritten whole, not loosened. Orca labels and progress spec §3.2 /
    // §8 R19 makes collect always answer `progress`, and no loop has written a state here, so it is null. What this
    // encodes is unchanged: a table broken after accept does not stop collect from answering the run in full.
    expect(JSON.parse(collected.stdout)).toEqual({ events: [], candidate: null, terminal: null, progress: null });
```

- [ ] **Step 3: 跑，确认红**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/ccloop && ./node_modules/.bin/vitest run tests/control/collect.test.ts tests/control/agentsControl.test.ts > "$SCRATCH/lp-t6-red.txt" 2>&1; echo rc=$?
```
Expected：rc=1；collect 的四条新判据红（`progress` 为 `undefined`）；agentsControl 的两条改写红（多了 `progress: null` 期望）。既有判据全绿。第一行 `RUN` 必须指向 ccloop 路径。

- [ ] **Step 4: 实现**

(a) `src/control/collect.ts`：
- 第 4 行改为 `import type { RunState, RunStatus } from "../state/types.js";`
- `CollectionV1`（13–17）之前加 `ProgressV1`，并在 `terminal` 之后加字段：
```ts
/** Orca labels and progress spec §3.2 (2026-09-28): the loop's latest state, as Orca shows a task's step. */
export interface ProgressV1 {
  status: RunStatus;
  currentAttempt: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  lastTransitionAt: string;
}
```
```ts
  /** Running or terminal alike; null before the loop wrote any state. */
  progress: ProgressV1 | null;
```
- 第 19 行 `const safe = …` 之后加：
```ts
// Orca labels and progress spec §8 R17: loop-state.json is checked for the fields progress takes, never cast.
const loopStateProgressSchema = z.object({
  status: z.enum(["queued", "planning", "executing", "verifying", "succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"]),
  currentAttempt: safe,
  attemptsUsed: safe,
  lastTransitionAt: z.string().min(1),
  budgetSnapshot: z.object({ attemptsRemaining: safe }).passthrough(),
}).passthrough();

/**
 * Orca labels and progress spec §3.2: the progress collect answers on every call, for a loop still running and for one
 * that ended alike. No loop-state.json (ENOENT) is null; one that is not JSON, or lacks a field progress takes, is
 * control-terminal-invalid -- the code readTerminal already answers for a broken loop state.
 */
async function readProgress(sourceDir: string): Promise<ProgressV1 | null> {
  const target = join(sourceDir, "run", "loop-state.json");
  let state: unknown;
  try {
    state = JSON.parse((await readPrivateFile(sourceDir, target)).toString("utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new ControlProtocolError("control-terminal-invalid");
    throw error;
  }
  const parsed = loopStateProgressSchema.safeParse(state);
  if (!parsed.success) throw new ControlProtocolError("control-terminal-invalid");
  const { status, currentAttempt, attemptsUsed, lastTransitionAt, budgetSnapshot } = parsed.data;
  return { status, currentAttempt, attemptsUsed, attemptsRemaining: budgetSnapshot.attemptsRemaining, lastTransitionAt };
}
```
- `collectExecution` 的返回对象，`terminal: …,` 之后加 `progress: await readProgress(input.work.sourceDir),`

(b) `src/control/command.ts` 的 `collectionSchema`，`terminal: terminalSchema.nullable(),` 之后加：
```ts
  // Orca labels and progress spec §3.2: ccloop answers progress on every collect (null before any loop state). Strict,
  // like the rest of this schema, so ccloop does not refuse its own answer.
  progress: z.object({
    status: z.enum(["queued", "planning", "executing", "verifying", "succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"]),
    currentAttempt: safeInteger,
    attemptsUsed: safeInteger,
    attemptsRemaining: safeInteger,
    lastTransitionAt: z.string().min(1),
  }).strict().nullable(),
```

- [ ] **Step 5: 跑，确认绿（含读 collect 的既有判据）＋ 类型检查**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/ccloop && ./node_modules/.bin/vitest run tests/control/collect.test.ts tests/control/agentsControl.test.ts tests/control/singleCall.test.ts tests/control/handoff.test.ts tests/control/handoffDeadlineUsage.test.ts tests/control/claudeHandoffDeadlineUsage.test.ts tests/control/phasesCompleted.test.ts tests/control/handoffEnteredPhases.test.ts tests/control/command.test.ts tests/control/protocol.test.ts > "$SCRATCH/lp-t6-green.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/ccloop && npm run typecheck > "$SCRATCH/lp-t6-tsc.txt" 2>&1; echo rc=$?
```
Expected：两个 rc=0，0 skipped。`endToEnd.test.ts`／`claudeEndToEnd.test.ts` 依赖 `dist/`，主树不 build，**这里有意不跑**，由 Task 8 的 ccloop 门在 clone 里跑。

- [ ] **Step 6: 提交**（先 `git diff`／`git status --short` 重定向到 `$SCRATCH/lp-t6-diff.txt`／`lp-t6-status.txt` 读回）

```bash
cd /Users/biran/code/skills/loop/ccloop && /usr/bin/git add src/control/collect.ts src/control/command.ts tests/control/collect.test.ts tests/control/agentsControl.test.ts && /usr/bin/git commit -F - <<'EOF'
feat(control): collect answers the loop's progress, running or terminal, from a checked loop-state.json

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

- [ ] **Step 7: 建 E2E 用的干净 ccloop build**（F16；只作 `ORCA_CCLOOP_BIN`，**永不变异**）。先确认 `$SCRATCH/ccbin-lp` 不存在，存在就停。

```bash
. "$LPENV"
/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop "$SCRATCH/ccbin-lp" > "$SCRATCH/lp-ccbin-clone.txt" 2>&1; echo rc=$?
ln -s /Users/biran/code/skills/loop/ccloop/node_modules "$SCRATCH/ccbin-lp/node_modules"
cd "$SCRATCH/ccbin-lp" && npm run build > "$SCRATCH/lp-ccbin-build.txt" 2>&1; echo rc=$?
/usr/bin/git -C "$SCRATCH/ccbin-lp" log -1 --format='%h %s' > "$SCRATCH/lp-ccbin-head.txt" 2>&1; echo rc=$?
```
Expected：三个 rc=0；`lp-ccbin-head.txt` 的主题行是 Step 6 那一笔。

- [ ] **Step 8: 台账**：`REWRITTEN: ccloop:tests/control/agentsControl.test.ts > <两条测试名> — 人的授权原话 — 现在编码：表坏／表删后 collect 仍完整作答，且 progress 为 null`；「只加」`tests/control/collect.test.ts` 的四条新测试名；`ccbin-lp` 的主题行。

**Mutation**（ccloop 变异副本 `$SCRATCH/mut-ccloop`，软链 `node_modules`；**不是** `ccbin-lp`）:
- M6a 锚点 `const { status, currentAttempt, attemptsUsed, lastTransitionAt, budgetSnapshot } = parsed.data;` → 其后追加一行 `if (!["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"].includes(status)) return null;`（只在终态填）⇒ `P1: answers the loop's progress while it runs, …` 红（spec P1 的点名变异）。
- M6b `command.ts` 锚点 `  }).strict().nullable(),\n});`（progress 那段的结尾）→ 把整段 `progress: z.object({ … }).strict().nullable(),` 删掉（锚点取整段）⇒ `P1: the control command's own strict response schema lets the progress through` 红，agentsControl 两条也红。
- M6c 锚点 `budgetSnapshot: z.object({ attemptsRemaining: safe }).passthrough(),` → `budgetSnapshot: z.object({ attemptsRemaining: safe }).passthrough().optional(),`，并把 `attemptsRemaining: budgetSnapshot.attemptsRemaining` 换成 `attemptsRemaining: budgetSnapshot?.attemptsRemaining ?? 0` ⇒ `R17: refuses a loop state …` 红。
- M6d 锚点 `if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;\n    if (error instanceof SyntaxError) throw new ControlProtocolError("control-terminal-invalid");\n    throw error;\n  }\n  const parsed = loopStateProgressSchema` 中的第一行 → 删掉 ⇒ `P1: answers it once the loop ended too, and null before …` 红。

---
### Task 7: Web —— 标签列、筛选、进度列、详情面板（编辑器／进度／run 与 evidence）、导航完成度（Orca；spec §4.2、§5.3）

**Files:**
- Modify: `web/src/controlTypes.ts`（`GroupSummaryV1` 44–53、`WorkItemViewV1` 74–90、`CommandSuccessV1` 250–275（Task 4 已加 verb 与 result）、文件末尾）
- Modify: `web/src/controlApi.ts`（import 13–37、`ControlAction` 185–196、`controlCommandPath` 199–229、新 `downloadEvidenceArtifact`）
- Create: `web/src/TaskDetail.tsx`
- Modify: `web/src/ControlGroupView.tsx`（import 10–18、组件开头 55–62、Work items 段 90–106）
- Modify: `web/src/ControlPanel.tsx`（导航 131–137）
- Modify: `web/src/App.tsx`（import 区、`sendControl` 275–295）
- Modify: `web/src/styles.css`（文件末尾）
- Modify（只加）: `tests/panel/webParity.test.ts`
- Test (new): `web/tests/taskLabels.test.tsx`、`web/tests/taskLabelsDraft.test.tsx`

**Interfaces:**
- Consumes: 服务端 `GroupViewV1`／`GroupSummaryV1`／`WorkItemViewV1` 的新可选字段（Task 3、5），`SetTaskLabelsPayload`（Task 4），`SYSTEM_LABELS`、`CUSTOM_LABEL_PREFIX`（Task 1），GET `/api/control/runs/:runId/evidence` 与 `…/evidence/:artifactId`（既有）。
- Produces（Web）:
  - `export const WEB_SYSTEM_LABELS`（与 `SYSTEM_LABELS` 同一列表，webParity 运行时比对，F1）、`export const CUSTOM_LABEL_PREFIX = "custom:"`
  - `export type WorkItemProgressV1`、`export type SetTaskLabelsPayloadV1 = { labels: string[] | null; baseLabelsVersion: number }`
  - `ControlAction` 新成员 `{ verb: "set-task-labels"; groupId: string; taskId: string; expectedRevision: number; payload: SetTaskLabelsPayloadV1 }`，路由 `/api/control/groups/<g>/tasks/<t>/labels`
  - `export async function downloadEvidenceArtifact(entry: EvidenceManifestV1["entries"][number]): Promise<void>`
  - `TaskDetail.tsx`：`labelsDraftKey(groupId, taskId)`、`LabelChips`、`progressText(progress)`、`EvidenceList`、`TaskDetail`
  - 草稿键 `labels:<groupId>:<taskId>`，值是 JSON 数组；`App.sendControl` 在 `set-task-labels` 答 2xx 时清它（F11）

- [ ] **Step 1: 写判据**

(a) 新建 `web/tests/taskLabels.test.tsx`：

```tsx
// @vitest-environment jsdom
/**
 * Labels and progress spec §4.2 and §5.3 (Orca plan 2026-09-29 Task 7): the work item table's labels and progress
 * columns, the label filter, the task detail panel (label editor, progress, runs and their evidence), the group nav's
 * completion, and the two label styles. The plan's Mutation lines name the production line each `it` goes red on.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { controlCommandPath, type ControlAction } from "../src/controlApi.js";
import type {
  Amount, ControlConfigV1, ControlSummaryV1, EvidenceManifestV1, GroupViewV1, RecoveryViewV1, RunViewV1, WorkItemViewV1,
} from "../src/controlTypes.js";
import { progressText } from "../src/TaskDetail.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const workItem = (over: Partial<WorkItemViewV1>): WorkItemViewV1 => ({
  taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
  derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], ...over,
});
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], ...over,
});
const view = (workItems: WorkItemViewV1[], runs: RunViewV1[] = []): GroupViewV1 => ({
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4,
  summary: { groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 },
  graphVersion: 1, plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [], workItems, estimates: [], runs, checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
});

/** ControlGroupView over the page's own draft store, so a criterion sees drafts the way App keeps them. */
function Stateful(props: { view: GroupViewV1; onCommand: (action: ControlAction) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const onDraft = (key: string, text: string): void => setDrafts((current) => {
    const next = { ...current };
    if (text === "") delete next[key]; else next[key] = text;
    return next;
  });
  return <ControlGroupView view={props.view} config={config} uncertain={[]} drafts={drafts} onDraft={onDraft} onCommand={props.onCommand} />;
}
/** The task ids of the rows on screen (each row's task cell is its detail toggle). */
const rows = (): Array<string | null> => screen.getAllByRole("button", { expanded: false }).map((button) => button.textContent);

afterEach(cleanup);

describe("labels and progress in the work item table (spec §4.2)", () => {
  it("shows a system label and a custom label with different classes", () => {
    render(<Stateful view={view([workItem({ labels: ["bug", "custom:前端"] })])} onCommand={vi.fn()} />);
    const chips = [...document.querySelectorAll("td span.label")].map((chip) => [chip.textContent, chip.className]);
    expect(chips).toEqual([["bug", "label label-system"], ["custom:前端", "label label-custom"]]);
  });

  it("filters work items by label, any of the checked ones", () => {
    render(<Stateful view={view([workItem({ taskId: "a", labels: ["bug"] }), workItem({ taskId: "b", labels: ["custom:x"] }), workItem({ taskId: "c", labels: [] })])} onCommand={vi.fn()} />);
    expect(rows()).toEqual(["a", "b", "c"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "bug" }));
    expect(rows()).toEqual(["a"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "custom:x" }));
    expect(rows()).toEqual(["a", "b"]);
  });

  it("says unknown when the run's usage is unknown -- never a percentage -- and notes that usage arrives at phase end", () => {
    expect(progressText({ runId: "r", step: "execute", attempt: { current: 1, max: 3 }, tokens: null, lastTransitionAt: null })).toBe("execute · attempt 1/3 · tokens unknown");
    expect(progressText({ runId: "r", step: null, attempt: null, tokens: { used: 0, grant: 200 }, lastTransitionAt: null })).toBe("not reported yet · attempt unknown · tokens 0% (reported at phase end)");
    expect(progressText({ runId: "r", step: "verify", attempt: { current: 2, max: 2 }, tokens: { used: 50, grant: 200 }, lastTransitionAt: null })).toBe("verify · attempt 2/2 · tokens 25% (reported at phase end)");
    expect(progressText(null)).toBe("no run");
    render(<Stateful view={view([workItem({ progress: { runId: "run-a", step: "execute", attempt: { current: 1, max: 3 }, tokens: null, lastTransitionAt: null } })])} onCommand={vi.fn()} />);
    expect(screen.getByText("execute · attempt 1/3 · tokens unknown")).toBeTruthy();
  });
});

describe("the task detail panel (spec §4.2)", () => {
  it("sends the draft labels with the labelsVersion they were read at, and restores the plan's labels with null", () => {
    const onCommand = vi.fn();
    render(<Stateful view={view([workItem({ labels: ["bug"], labelsProvenance: "plan", labelsVersion: 4 })])} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    fireEvent.change(screen.getByRole("combobox", { name: "System label" }), { target: { value: "perf" } });
    fireEvent.click(screen.getByRole("button", { name: "Add system label" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Custom label" }), { target: { value: "前端" } });
    fireEvent.click(screen.getByRole("button", { name: "Add custom label" }));
    fireEvent.click(screen.getByRole("button", { name: "Save labels" }));
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "set-task-labels", groupId: "g", taskId: "a", expectedRevision: 6, payload: { labels: ["bug", "custom:前端", "perf"], baseLabelsVersion: 4 } });
    fireEvent.click(screen.getByRole("button", { name: "Restore plan labels" }));
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "set-task-labels", groupId: "g", taskId: "a", expectedRevision: 6, payload: { labels: null, baseLabelsVersion: 4 } });
    expect(controlCommandPath(onCommand.mock.calls[0]![0] as ControlAction)).toBe("/api/control/groups/g/tasks/a/labels");
  });

  describe("a run's evidence, piece by piece", () => {
    const TOKEN = "token-injected-by-staticFiles";
    const manifest: EvidenceManifestV1 = {
      schema: "orca-run-evidence-v1", runId: "run-a",
      entries: [
        { evidenceId: "ev-1", kind: "usage", sha256: "9".repeat(64), byteLength: 12, downloadUrl: "/api/control/runs/run-a/evidence/ev-1" },
        { evidenceId: "ev-2", kind: "handoff", sha256: "8".repeat(64), byteLength: 7, downloadUrl: "/api/control/runs/run-a/evidence/ev-2" },
      ],
    };
    let requests: Array<{ url: string; token: string | undefined }>;
    let downloads: string[];
    beforeEach(() => {
      requests = []; downloads = [];
      window.__ORCA_TOKEN__ = TOKEN;
      URL.createObjectURL = vi.fn(() => "blob:evidence");
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement): void {
        downloads.push(this.getAttribute("download") ?? "");
      });
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        requests.push({ url, token: (init?.headers as Record<string, string> | undefined)?.["x-orca-token"] });
        if (url === "/api/control/runs/run-a/evidence") return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
        return new Response("bytes", { status: 200, headers: { "content-type": "application/octet-stream" } });
      }) as typeof fetch;
    });
    afterEach(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      vi.restoreAllMocks();
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
      Reflect.deleteProperty(window, "__ORCA_TOKEN__");
    });

    it("lists the manifest's entries and downloads one through the panel token", async () => {
      render(<Stateful view={view([workItem({ currentRunId: "run-a", lineageRunIds: ["run-a"] })], [run({})])} onCommand={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "a" }));
      fireEvent.click(screen.getByRole("button", { name: "List evidence of run-a" }));
      const list = await screen.findByRole("list", { name: "Evidence of run-a" });
      expect(within(list).getAllByRole("listitem").map((entry) => entry.textContent)).toEqual(["ev-1 · usage · 12 bytes Download ev-1", "ev-2 · handoff · 7 bytes Download ev-2"]);
      fireEvent.click(within(list).getByRole("button", { name: "Download ev-2" }));
      await vi.waitFor(() => expect(downloads).toEqual(["ev-2"]));
      expect(requests).toEqual([{ url: "/api/control/runs/run-a/evidence", token: TOKEN }, { url: "/api/control/runs/run-a/evidence/ev-2", token: TOKEN }]);
    });
  });
});

describe("the group nav's completion (spec §4.2)", () => {
  it("shows each group's done/total", () => {
    const summary: ControlSummaryV1 = {
      schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false,
      groups: [{ groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0, completion: { done: 1, total: 2 } }],
    };
    const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
    render(<ControlPanel config={config} summary={summary} recovery={recovery} groups={{}} selected={null} drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} onSelect={vi.fn()} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByRole("button", { name: "g · running · 1/2 done" })).toBeTruthy();
  });
});

describe("styles.css tells the two label kinds apart (spec §4.2)", () => {
  it("gives system and custom labels different rules", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
    const rule = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      if (at === -1) throw new Error(`no rule for ${selector}`);
      return css.slice(at, css.indexOf("}", at));
    };
    expect(rule(".label-system")).toContain("background: var(--accent-subtle)");
    expect(rule(".label-custom")).toContain("border: 1px dashed var(--border-strong)");
  });
});
```

(b) 新建 `web/tests/taskLabelsDraft.test.tsx`（整页；fetch 桩的写法照 `web/tests/controlCommandRecovery.test.tsx:95-110`）：

```tsx
// @vitest-environment jsdom
/**
 * Labels and progress spec §4.2 (plan finding F11): a label draft is the person's own data. The page keeps it through a
 * refusal -- which it shows by code, like any refusal -- and clears it only once the set-task-labels command succeeded.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import type { Amount, ControlConfigV1, ControlSummaryV1, GroupViewV1, RecoveryViewV1 } from "../src/controlTypes.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const capability = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;
const config: ControlConfigV1 = {
  schema: "orca-control-config-v1", epoch: "epoch-a", repositories: [{ repoId: "orca", displayName: "Orca" }],
  plans: [{ planId: "plan-demo", repoId: "orca", displayName: "Demo plan" }],
  profiles: [{ profileId: "all", profileHash: "b".repeat(64), allowedWorkKinds: ["task", "budget-estimate", "handoff", "goal-review"], contextTokenizer: null, workMaxOutputTokens: 1000, declared: capability, observed: capability, observedAt: "2026-09-29T00:00:00.000Z", probeFailureCode: null }],
  defaults: { estimatorProfileId: "all", estimatorProfileHash: "b".repeat(64), estimateMode: "soft" }, executionPort: "configured", errorCatalog: [],
};
const summary: ControlSummaryV1 = {
  schema: "orca-control-summary-v1", epoch: "epoch-a", changeSeq: 4, resetRequired: false, dispatchBlocked: false,
  groups: [{ groupId: "g", state: "running", commandRevision: 6, projectionSeq: 4, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 }],
};
const recovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: false, blockers: [] };
const groupView: GroupViewV1 = {
  schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 4, summary: summary.groups[0]!, graphVersion: 1,
  plan: { repoId: "orca", planId: "plan-demo", planHash: "a".repeat(64), goal: "Ship", successConditions: ["done"] },
  proposal: { state: "confirmed", proposalVersion: 2, planHash: "a".repeat(64), budgetMode: "soft", contextPolicy: { handoffAtContextTokens: null }, profiles: {
    estimator: { profileId: "all", profileHash: "b".repeat(64) }, worker: { profileId: "all", profileHash: "b".repeat(64) },
    handoff: { profileId: "all", profileHash: "b".repeat(64) }, goalReview: { profileId: "all", profileHash: "b".repeat(64) } }, executionSnapshotHash: "c".repeat(64) },
  ledger: { groupLimit: amount(9_000_000), used: amount(10), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(5_999_990), budgetDeficit: amount(0), usageUnknown: false },
  allocations: [],
  workItems: [{ taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64), derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], labels: [], labelsProvenance: "plan", labelsVersion: 0, progress: null }],
  estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
};
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LABELS = "/api/control/groups/g/tasks/a/labels";

let answers: Array<{ status: number; body: unknown }>;
let posted: unknown[];

beforeEach(() => {
  answers = []; posted = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "/api/todo") return jsonResponse({ rows: [] });
    // Copied verbatim from web/tests/controlCommandRecovery.test.tsx:100 (the page reads the metrics on load).
    if (url === "/api/metrics") return jsonResponse({ report: { as_of: "2026-09-21T00:00:00.000Z", as_of_mode: "wall_clock", repos: [], correction_rate: { numerator_corrections_excluding_stale: 0, denominator_decisions: 0, rate_excluding_stale: null, corrections_total_including_stale: 0, by_decision_kind: [], buckets: [], caveats: [] }, repair_rate: { numerator_overturned: 0, denominator_corrections_including_stale: 0, rate: null, stale_only: { numerator_overturned: 0, denominator_corrections: 0, rate: null, known_bias: "" }, buckets: [], caveats: [] }, backlog: { open_corrections: 0, oldest_age_ms: null, oldest_correction_id: null, by_correction_kind: [] }, breakdown_by_correction_kind_including_stale: [], review_coverage: { available: false, reason: "none" }, unresolved_decisions: [], unkeyable_repos: [], malformed_lines: [] }, panel_review_coverage: { reviewed_high_tier: 0, high_tier_total: 0, rate: 0, caveat: "" } });
    if (url === "/api/chains") return jsonResponse({ repos: [] });
    if (url === "/api/control/config") return jsonResponse(config);
    if (url.startsWith("/api/control/summary")) return jsonResponse(summary);
    if (url === "/api/control/recovery") return jsonResponse(recovery);
    if (url === "/api/control/groups/g") return jsonResponse(groupView);
    if (url === LABELS && init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      const next = answers.shift()!;
      return jsonResponse(next.body, next.status);
    }
    // The agent reads, the workspace read and the preview are not what this criterion is about.
    if (url.startsWith("/api/control/")) return jsonResponse({ error: { code: "route-not-found", message: "not served here", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("the label draft survives a refusal and is cleared by a success (spec §4.2)", () => {
  it("keeps the draft through a refusal, shows the refusal's code, and clears it once the command succeeded", async () => {
    answers = [
      { status: 422, body: { error: { code: "labels-invalid", message: "labels-invalid:count:17", commandRevision: 6, evidenceIds: [], retryable: false } } },
      { status: 200, body: { schema: "orca-command-success-v1", commandId: "x", actorId: "operator", verb: "set-task-labels", target: { kind: "task", groupId: "g", taskId: "a" }, commandRevision: 7, projectionSeq: 5, effectivePayloadHash: "1".repeat(64), authorityCommandHash: "2".repeat(64), result: { kind: "task-labels-set", taskId: "a", labelsVersion: 1 } } },
    ];
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^g · running/ }));
    fireEvent.click(await screen.findByRole("button", { name: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "Add system label" })); // the select starts on "feature"
    fireEvent.click(screen.getByRole("button", { name: "Save labels" }));
    await screen.findByText(/labels-invalid/);
    expect(screen.getByText(/unsaved draft/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove feature" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save labels" }));
    await waitFor(() => expect(screen.queryByText(/unsaved draft/)).toBeNull());
    expect(screen.queryByRole("button", { name: "Remove feature" })).toBeNull();
    expect(posted).toEqual([
      expect.objectContaining({ expectedRevision: 6, payload: { labels: ["feature"], baseLabelsVersion: 0 } }),
      expect.objectContaining({ expectedRevision: 6, payload: { labels: ["feature"], baseLabelsVersion: 0 } }),
    ]);
  });
});
```
（`/api/metrics` 的应答体逐字取自 `web/tests/controlCommandRecovery.test.tsx:100`，measured at `084f15f`。）

(c) `tests/panel/webParity.test.ts`（只加）：
- 在第 40 行的服务端类型 import 列表里加 `SetTaskLabelsPayload as ServerSetTaskLabelsPayload,`；在第 65 行的 Web 类型 import 列表里加 `SetTaskLabelsPayloadV1 as WebSetTaskLabelsPayloadV1,`；第 15 行之后加两行 import：
```ts
import { CUSTOM_LABEL_PREFIX, SYSTEM_LABELS } from "../../src/control/labels.js";
import { CUSTOM_LABEL_PREFIX as WEB_CUSTOM_LABEL_PREFIX, WEB_SYSTEM_LABELS } from "../../web/src/controlTypes.js";
```
- 第一个 describe（81–96）里、第 95 行之后加：
```ts
  // Labels and progress spec §2.1 (plan finding F1): the editor's system-label select offers exactly the vocabulary the
  // server's input doors accept -- a missing word cannot be chosen, an extra one would be refused as labels-invalid.
  it("WEB_SYSTEM_LABELS is the same list as SYSTEM_LABELS, and the custom prefix is the same", () => {
    expect([...WEB_SYSTEM_LABELS]).toEqual([...SYSTEM_LABELS]);
    expect(WEB_CUSTOM_LABEL_PREFIX).toBe(CUSTOM_LABEL_PREFIX);
  });
```
- 第 191 行之后加两个编译期函数，数组（196–251）末项之后加两项：
```ts
// Labels and progress spec §3.1: the set-task-labels command's payload.
function setTaskLabelsServerToWeb(x: ServerSetTaskLabelsPayload): WebSetTaskLabelsPayloadV1 { return x; }
function setTaskLabelsWebToServer(x: WebSetTaskLabelsPayloadV1): ServerSetTaskLabelsPayload { return x; }
```
```ts
  setTaskLabelsServerToWeb,
  setTaskLabelsWebToServer,
```

- [ ] **Step 2: 跑，确认红**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca/web && ../node_modules/.bin/vitest run tests/taskLabels.test.tsx tests/taskLabelsDraft.test.tsx > "$SCRATCH/lp-t7-red.txt" 2>&1; echo rc=$?
```
Expected：rc=1，两个文件都因 `../src/TaskDetail.js` 不存在或缺元素而红。

- [ ] **Step 3: 实现**

(a) `web/src/controlTypes.ts`：
- `GroupSummaryV1`（44–53）在 `recoveryBlockerCount: number;` 之后加：
```ts
  /** Labels and progress spec §4.1: tasks done out of the plan's tasks. Optional so literal fixtures need no edit. */
  completion?: { done: number; total: number };
```
- `WorkItemViewV1`（74–90）在 `lineageRunIds: string[];` 之后加：
```ts
  // Labels and progress spec §4.1 (§8 R19): optional here so literal fixtures need no edit; the server always sends them.
  labels?: string[];
  labelsProvenance?: "plan" | "operator";
  labelsVersion?: number;
  progress?: WorkItemProgressV1 | null;
```
- 文件末尾加：
```ts
/** Labels and progress spec §2.1: G11's system words -- a mirror of src/control/labels.ts, compared by webParity (finding F1). */
export const WEB_SYSTEM_LABELS = ["feature", "bug", "refactor", "test", "doc", "design", "investigate", "perf", "security", "chore"] as const;
export const CUSTOM_LABEL_PREFIX = "custom:";
/** Spec §4.1 (§8 R10, R11, R18): the current run's step, attempt and tokens; null fields are "not reported" or "unknown". */
export type WorkItemProgressV1 = {
  runId: string;
  step: "queued" | "plan" | "execute" | "verify" | "succeeded" | "blocked_waiting_human" | "exhausted" | "cancelled" | "failed" | null;
  attempt: { current: number; max: number } | null;
  tokens: { used: number; grant: number } | null;
  lastTransitionAt: string | null;
};
/** Spec §3.1 (§8 R16): replace the task's operator labels, or null to go back to the plan's. */
export type SetTaskLabelsPayloadV1 = { labels: string[] | null; baseLabelsVersion: number };
```
- （Task 4 已加）`CommandSuccessV1.verb` 末尾的 `| "set-task-labels"` 与 `result` 的 `| { kind: "task-labels-set"; taskId: string; labelsVersion: number }`。

(b) `web/src/controlApi.ts`：
- import 列表加 `SetTaskLabelsPayloadV1,`
- `ControlAction`（196 行 `recovery-retry` 那一项之后）加
```ts
  | { verb: "set-task-labels"; groupId: string; taskId: string; expectedRevision: number; payload: SetTaskLabelsPayloadV1 }
```
- `controlCommandPath` 的 `case "recovery-retry":` 之前加
```ts
    case "set-task-labels":
      return `${group}/tasks/${segment(action.taskId)}/labels`;
```
- `saveEvidenceManifest`（117–125）之后加：
```ts
/**
 * Labels and progress spec §4.2: one piece of a run's evidence, fetched with the panel token (the route answers to the
 * header only, like the manifest) and offered as a download named after its evidence id.
 */
export async function downloadEvidenceArtifact(entry: EvidenceManifestV1["entries"][number]): Promise<void> {
  let res: Response;
  try {
    res = await fetch(entry.downloadUrl, { headers: { "x-orca-token": panelToken() } });
  } catch (err) {
    throw new ControlRequestError(refusalOf(`GET ${entry.downloadUrl}`, null, undefined, err instanceof Error ? err.message : "no answer"));
  }
  if (!res.ok) throw new ControlRequestError(refusalOf(`GET ${entry.downloadUrl}`, res.status, await res.json().catch(() => undefined), `answered ${res.status}`));
  const url = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = entry.evidenceId;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

(c) 新建 `web/src/TaskDetail.tsx`：

```tsx
/**
 * Labels and progress spec §4.2: one task, opened from the group's work item table -- its labels and an editor for them,
 * its progress, and every run it had with that run's evidence, piece by piece.
 *
 * The editor keeps what the person chose as a draft (the page's `drafts`, one key per task) and sends it with the
 * labelsVersion it was read at. The draft is the person's own data: the page clears it only when the command succeeded
 * (App.tsx, plan finding F11), so a refusal -- shown by its code like every other refusal -- leaves it where it was.
 */
import { useState } from "react";
import type { JSX } from "react";
import { controlFailureFrom, downloadEvidenceArtifact, fetchRunEvidence, type ControlAction } from "./controlApi.js";
import { CUSTOM_LABEL_PREFIX, WEB_SYSTEM_LABELS } from "./controlTypes.js";
import type { EvidenceManifestV1, GroupViewV1, WorkItemProgressV1, WorkItemViewV1 } from "./controlTypes.js";

export const labelsDraftKey = (groupId: string, taskId: string): string => `labels:${groupId}:${taskId}`;

/** A system label and a custom one look different (spec §4.2); the class is the whole difference. */
export function LabelChips(props: { labels: string[] | undefined }): JSX.Element {
  const labels = props.labels ?? [];
  if (labels.length === 0) return <>none</>;
  return (
    <>
      {labels.map((label) => (
        <span key={label} className={label.startsWith(CUSTOM_LABEL_PREFIX) ? "label label-custom" : "label label-system"}>{label}</span>
      ))}
    </>
  );
}

/**
 * Spec §4.1/§4.2 (§8 R11, R18): step · attempt n/max · tokens. Unknown usage says "unknown", never a percentage; a known
 * number is annotated, because ccloop reports usage only when a phase ends (finding F10: the panel speaks English).
 */
export function progressText(progress: WorkItemProgressV1 | null | undefined): string {
  if (progress === undefined || progress === null) return "no run";
  const step = progress.step ?? "not reported yet";
  const attempt = progress.attempt === null ? "attempt unknown" : `attempt ${progress.attempt.current}/${progress.attempt.max}`;
  const tokens = progress.tokens === null
    ? "tokens unknown"
    : progress.tokens.grant === 0
      ? `tokens ${progress.tokens.used} of 0`
      : `tokens ${Math.floor((progress.tokens.used * 100) / progress.tokens.grant)}% (reported at phase end)`;
  return `${step} · ${attempt} · ${tokens}`;
}

function draftLabels(drafts: Record<string, string>, key: string): string[] | null {
  const raw = drafts[key];
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((label) => typeof label === "string") ? parsed : null;
  } catch {
    return null;
  }
}

/** One run's evidence manifest, listed on demand; each piece is downloaded through the token-carrying client. */
export function EvidenceList(props: { runId: string }): JSX.Element {
  const [manifest, setManifest] = useState<EvidenceManifestV1 | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const load = async (): Promise<void> => {
    setRefusal(null);
    try { setManifest(await fetchRunEvidence(props.runId)); } catch (err) { setRefusal(controlFailureFrom(err).code); }
  };
  const download = async (entry: EvidenceManifestV1["entries"][number]): Promise<void> => {
    setRefusal(null);
    try { await downloadEvidenceArtifact(entry); } catch (err) { setRefusal(controlFailureFrom(err).code); }
  };
  return (
    <>
      <button type="button" onClick={() => void load()}>List evidence of {props.runId}</button>
      {refusal !== null && <span role="alert">{`evidence refused · ${refusal}`}</span>}
      {manifest !== null && (manifest.entries.length === 0 ? <span> no evidence</span> : (
        <ul aria-label={`Evidence of ${props.runId}`}>
          {manifest.entries.map((entry) => (
            <li key={entry.evidenceId}>
              {entry.evidenceId} · {entry.kind} · {entry.byteLength} bytes{" "}
              <button type="button" onClick={() => void download(entry)}>Download {entry.evidenceId}</button>
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}

export interface TaskDetailProps {
  view: GroupViewV1;
  item: WorkItemViewV1;
  drafts: Record<string, string>;
  onDraft: (key: string, text: string) => void;
  onCommand: (action: ControlAction) => void;
}

export function TaskDetail(props: TaskDetailProps): JSX.Element {
  const { view, item, drafts, onDraft, onCommand } = props;
  const groupId = view.summary.groupId;
  const key = labelsDraftKey(groupId, item.taskId);
  const draft = draftLabels(drafts, key);
  const labels = draft ?? item.labels ?? [];
  const [system, setSystem] = useState<string>(WEB_SYSTEM_LABELS[0]);
  const [custom, setCustom] = useState("");
  // Sorted by code unit like the server (spec §8 R15), so what is sent is what will be shown back.
  const setDraft = (next: string[]): void => onDraft(key, JSON.stringify([...new Set(next)].sort()));
  const send = (next: string[] | null): void => onCommand({
    verb: "set-task-labels", groupId, taskId: item.taskId, expectedRevision: view.summary.commandRevision,
    payload: { labels: next, baseLabelsVersion: item.labelsVersion ?? 0 },
  });
  const addCustom = (): void => {
    const text = custom.trim();
    if (text === "") return;
    setDraft([...labels, text.startsWith(CUSTOM_LABEL_PREFIX) ? text : `${CUSTOM_LABEL_PREFIX}${text}`]);
    setCustom("");
  };
  const runs = view.runs.filter((run) => run.taskId === item.taskId);
  return (
    <section aria-label={`Task ${item.taskId}`}>
      <h4>Task {item.taskId}</h4>
      <p>
        labels from {item.labelsProvenance ?? "plan"} · version {item.labelsVersion ?? 0}
        {draft !== null ? " · unsaved draft" : ""}
      </p>
      <ul aria-label={`Labels of ${item.taskId}`}>
        {labels.map((label) => (
          <li key={label}>
            <LabelChips labels={[label]} />{" "}
            <button type="button" onClick={() => setDraft(labels.filter((other) => other !== label))}>Remove {label}</button>
          </li>
        ))}
      </ul>
      <select aria-label="System label" value={system} onChange={(event) => setSystem(event.target.value)}>
        {WEB_SYSTEM_LABELS.map((word) => <option key={word} value={word}>{word}</option>)}
      </select>
      <button type="button" onClick={() => setDraft([...labels, system])}>Add system label</button>
      <input aria-label="Custom label" value={custom} onChange={(event) => setCustom(event.target.value)} />
      <button type="button" onClick={addCustom}>Add custom label</button>
      <button type="button" disabled={draft === null} onClick={() => send(labels)}>Save labels</button>
      <button type="button" onClick={() => send(null)}>Restore plan labels</button>
      <p>
        progress: {progressText(item.progress)}
        {item.progress?.lastTransitionAt ? ` · last transition ${item.progress.lastTransitionAt}` : ""}
      </p>
      <h5>Runs of {item.taskId}</h5>
      {runs.length === 0 ? <p>none</p> : (
        <ul>
          {runs.map((run) => (
            <li key={run.runId}>
              {run.runId} · {run.phase} · {run.state} <EvidenceList runId={run.runId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

(d) `web/src/ControlGroupView.tsx`：
- import 区：第 10 行后加 `import { useState } from "react";`，并加 `import { LabelChips, TaskDetail, progressText } from "./TaskDetail.js";`
- 组件里第 62 行（`selections` 定义）之后加：
```tsx
  // Labels and progress spec §4.2: the label filter (any of) and the open task live in page memory only.
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const allLabels = [...new Set(view.workItems.flatMap((item) => item.labels ?? []))].sort();
  const shownItems = labelFilter.length === 0
    ? view.workItems
    : view.workItems.filter((item) => (item.labels ?? []).some((label) => labelFilter.includes(label)));
  const toggleFilter = (label: string): void =>
    setLabelFilter((current) => (current.includes(label) ? current.filter((other) => other !== label) : [...current, label]));
  const openItem = view.workItems.find((item) => item.taskId === openTask);
```
- Work items 段（90–106）整段替换为：
```tsx
      <h3>Work items</h3>
      {allLabels.length > 0 && (
        <fieldset aria-label="Filter work items by label">
          <legend>labels (any of)</legend>
          {allLabels.map((label) => (
            <label key={label}>
              <input type="checkbox" checked={labelFilter.includes(label)} onChange={() => toggleFilter(label)} />
              {label}
            </label>
          ))}
        </fieldset>
      )}
      <table>
        <thead>
          <tr><th>task</th><th>status</th><th>labels</th><th>progress</th><th>run</th><th>pending</th><th>depends on</th></tr>
        </thead>
        <tbody>
          {shownItems.map((item) => (
            <tr key={item.taskId}>
              <td>
                <button type="button" aria-expanded={openTask === item.taskId} onClick={() => setOpenTask(openTask === item.taskId ? null : item.taskId)}>
                  {item.taskId}
                </button>
              </td>
              <td>{item.status}</td>
              <td><LabelChips labels={item.labels} /></td>
              <td>{progressText(item.progress)}</td>
              <td>{item.currentRunId ?? "none"}</td>
              <td>{item.pendingRunId ?? "none"}</td>
              <td>{item.dependencyTaskIds.join(", ") || "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {openItem !== undefined && <TaskDetail view={view} item={openItem} drafts={drafts} onDraft={onDraft} onCommand={onCommand} />}
```
  （`rows()` 判据用 `expanded: false` 取行：详情展开的那一行是 `true`，所以判据只在没有展开时数行。）

(e) `web/src/ControlPanel.tsx` 第 134 行（`{group.stopState !== null …}`）之前加：
```tsx
            {group.completion !== undefined ? ` · ${group.completion.done}/${group.completion.total} done` : ""}
```

(f) `web/src/App.tsx`：import 区加 `import { labelsDraftKey } from "./TaskDetail.js";`；`sendControl` 里第 286 行 `dispatchControl({ type: "command-resolved", value: command });` 之后加：
```ts
    // Labels and progress spec §4.2 (plan finding F11): a label draft is the person's own data -- cleared only once this
    // command succeeded; a refusal (and an uncertain answer, above) leaves it for them.
    if (answer.status < 400 && action.verb === "set-task-labels") dispatchControl({ type: "draft", key: labelsDraftKey(action.groupId, action.taskId), text: "" });
```

(g) `web/src/styles.css` 末尾：
```css
/* Labels and progress spec §4.2: a system label and a custom label look different. */
.label { display: inline-block; margin-right: 4px; padding: 0 6px; border-radius: var(--radius-sm); font-size: var(--text-xs); }
.label-system {
  background: var(--accent-subtle);
  color: var(--text-strong);
}
.label-custom {
  border: 1px dashed var(--border-strong);
  color: var(--text);
}
```

- [ ] **Step 4: 跑，确认绿（含 Web 既有判据）＋ 两处类型检查**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca/web && ../node_modules/.bin/vitest run > "$SCRATCH/lp-t7-web.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca/web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > "$SCRATCH/lp-t7-web-tsc.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && ./node_modules/.bin/vitest run tests/panel/webParity.test.ts tests/panel/noSkips.test.ts > "$SCRATCH/lp-t7-parity.txt" 2>&1; echo rc=$?
cd /Users/biran/code/skills/loop/Orca && npm run typecheck > "$SCRATCH/lp-t7-tsc.txt" 2>&1; echo rc=$?
```
Expected：四个 rc=0，0 skipped。`web/` 的全部既有判据（含 `evidenceLink`、`driverRetry`、`controlPanel`、`controlCommandRecovery`、`styles`、`contrast`）必须照绿；红了就停，不许改它们。（`web/` 的判据只有数十个文件、跑得快，这里跑整套 web 不违反「主树不跑全量」——那条指根的全量。）

- [ ] **Step 5: 提交**（先 diff／status 读回）

```bash
cd /Users/biran/code/skills/loop/Orca && /usr/bin/git add web/src/controlTypes.ts web/src/controlApi.ts web/src/TaskDetail.tsx web/src/ControlGroupView.tsx web/src/ControlPanel.tsx web/src/App.tsx web/src/styles.css web/tests/taskLabels.test.tsx web/tests/taskLabelsDraft.test.tsx tests/panel/webParity.test.ts && /usr/bin/git commit -F - <<'EOF'
feat(web): task labels and progress on the panel -- a label column and filter, a task detail editor, evidence per run, completion in the nav

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

- [ ] **Step 6: 台账**：`tests/panel/webParity.test.ts` 的「只加」清单（新 `it` 名、两个函数、数组两项）。

**Mutation**（Orca 变异副本，同时软链两个 `node_modules`）:
- M7a `App.tsx` 锚点 `if (answer.status < 400 && action.verb === "set-task-labels") dispatchControl(` 这一行 → 删掉 ⇒ `keeps the draft through a refusal, …` 红（成功后草稿还在）。
- M7b 同锚点 → `if (action.verb === "set-task-labels") dispatchControl(`，并把整行移到 `const answer = await sendControlCommand(…)` 之后 ⇒ 同一条红（拒绝后草稿丢了）。
- M7c `ControlGroupView.tsx` 锚点 `(item.labels ?? []).some((label) => labelFilter.includes(label))` → `labelFilter.every((label) => (item.labels ?? []).includes(label))` ⇒ `filters work items by label, any of the checked ones` 红。
- M7d `TaskDetail.tsx` 锚点 `label.startsWith(CUSTOM_LABEL_PREFIX) ? "label label-custom" : "label label-system"` → `"label label-system"` ⇒ `shows a system label and a custom label with different classes` 红。
- M7e 锚点 `? "tokens unknown"` → `? "tokens 0%"` ⇒ `says unknown when the run's usage is unknown -- …` 红。
- M7f 锚点 `payload: { labels: next, baseLabelsVersion: item.labelsVersion ?? 0 },` → `payload: { labels: next, baseLabelsVersion: 0 },` ⇒ `sends the draft labels with the labelsVersion they were read at, …` 红。
- M7g `ControlPanel.tsx` 锚点 `{group.completion !== undefined ? \` · ${group.completion.done}/${group.completion.total} done\` : ""}` → 删掉 ⇒ `shows each group's done/total` 红。
- M7h `controlApi.ts` 锚点 `return \`${group}/tasks/${segment(action.taskId)}/labels\`;` → `return \`${group}/labels\`;` ⇒ `sends the draft labels …` 红（路由断言）。
- M7i 锚点 `res = await fetch(entry.downloadUrl, { headers: { "x-orca-token": panelToken() } });` → `res = await fetch(entry.downloadUrl);` ⇒ `lists the manifest's entries and downloads one through the panel token` 红。
- M7j `styles.css` 锚点 `  border: 1px dashed var(--border-strong);` → 删掉 ⇒ `gives system and custom labels different rules` 红。
- M7k `controlTypes.ts` 锚点 `"security", "chore"] as const;`（WEB_SYSTEM_LABELS 那行的结尾）→ `"security"] as const;` ⇒ `WEB_SYSTEM_LABELS is the same list as SYSTEM_LABELS, …` 红。

---
### Task 8: 真 ccloop 的单 task E2E（看到 `execute`、结束 1/1）＋ 两仓收尾门（spec §5.2 E2E、§5.4；§8 R13）

**Files:**
- Test (new): `tests/control/progressE2E.test.ts`（放在 `executionDriverE2E.test.ts` 旁的新文件，只加不改；R13）

**Interfaces:**
- Consumes: `tests/control/fixtures/ccloopWorld.ts` 的 `ccloopWorlds`、`startGroup`、`until`、`noBlocked`、`workRuns`、`realBinary`（`:31`、`:80`、`:221`、`:252`、`:261`、`:248`）；fake codex 的 `delayMs.execute`（`ScriptEntry`，`:62`）；Task 3 的 `summary.completion`、Task 5 的 `workItems[].progress.step`；Task 6 的 ccloop 发 progress（`$SCRATCH/ccbin-lp`）。

- [ ] **Step 1: 写判据** —— 新建 `tests/control/progressE2E.test.ts`：

```ts
import { afterAll, describe, expect, it } from "vitest";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ccloopWorlds, noBlocked, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Labels and progress spec §5.2 E2E and §8 R13, against the real ccloop build (ORCA_CCLOOP_BIN, which must contain the
 * ccloop change that makes collect answer `progress`) and its scripted fake codex. One task whose execute phase sleeps
 * long enough for several driver rounds: the group view must show the `execute` step while it runs, and 1/1 once the
 * task settles. The skip below only fires with no binary configured; the gate (plan Task 8 Step 5) proves from the JSON
 * reporter that this criterion ran and passed rather than skipped.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-progress-e2e-", epochPrefix: "epoch-progress-" });
afterAll(removeRoots);

const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;

describe.skipIf(!realBinary)("task progress against real ccloop (labels and progress spec §5.2)", { timeout: 300_000 }, () => {
  relocateHome("orca-progress-e2e-home-");

  it("P-E2E: a single task shows the execute step while ccloop executes, and the group reads 1/1 once it settles", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a.txt"], verifierType: "command" }], { a: { files: { "a.txt": "A\n" }, delayMs: { execute: 4_000 } } });
    const runtime = await w.boot();
    try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      const seen: string[] = [];
      await until(() => {
        noBlocked(runtime);
        const step = readControlGroup(runtime.store, runtime.epoch, "g").workItems[0]!.progress?.step ?? null;
        if (step !== null && seen.at(-1) !== step) seen.push(step);
        return seen.includes("execute");
      }, 120_000, "the execute step to be observed", 50);
      await until(() => { noBlocked(runtime); return workStatus(runtime, "a") === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 180_000, "the task to settle");
      const view = readControlGroup(runtime.store, runtime.epoch, "g");
      expect(view.summary.completion).toEqual({ done: 1, total: 1 });
      expect(view.workItems[0]!.progress?.step).toBe("succeeded");
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
```

- [ ] **Step 2: 先看它红** —— 用本轮之前的 ccloop build（`$SCRATCH/ccbin`，不发 progress）跑：

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ORCA_CCLOOP_BIN="$SCRATCH/ccbin/dist/cli.js" ORCA_AGENTS_TABLE="$SCRATCH/agents/agents.json" ./node_modules/.bin/vitest run tests/control/progressE2E.test.ts > "$SCRATCH/lp-t8-red.txt" 2>&1; echo rc=$?
```
Expected：rc=1，红在 `timed out waiting for the execute step to be observed`（不是 skipped，不是模块加载失败）。

- [ ] **Step 3: 用新 build 看它绿，并从 JSON 报告断言它不是 skipped（R13）**

```bash
. "$LPENV"
cd /Users/biran/code/skills/loop/Orca && ORCA_CCLOOP_BIN="$SCRATCH/ccbin-lp/dist/cli.js" ORCA_AGENTS_TABLE="$SCRATCH/agents/agents.json" ./node_modules/.bin/vitest run tests/control/progressE2E.test.ts --reporter=json --outputFile="$SCRATCH/lp-t8-e2e.json" > "$SCRATCH/lp-t8-e2e.txt" 2>&1; echo rc=$?
node -e 'const r=require(process.argv[1]);const all=r.testResults.flatMap(f=>f.assertionResults.map(a=>({name:a.fullName,status:a.status})));console.log(JSON.stringify(all,null,1));process.exit(all.length===1&&all[0].status==="passed"?0:1)' "$SCRATCH/lp-t8-e2e.json" > "$SCRATCH/lp-t8-e2e-status.txt" 2>&1; echo rc=$?
```
Expected：两个 rc=0；状态文件里恰好一条，`status: "passed"`。

- [ ] **Step 4: 提交**

```bash
cd /Users/biran/code/skills/loop/Orca && /usr/bin/git add tests/control/progressE2E.test.ts && /usr/bin/git commit -F - <<'EOF'
test(control): against real ccloop, a single task shows its execute step while running and the group reads 1/1 once it settles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PGz7gxavNQANRnQh1F1MgN
EOF
```

- [ ] **Step 5: 两仓收尾门**（spec §5.4 ＋ R13；都在**全新** clone 里，前置 `lp-env.sh`；每步整份读回；每次记 `uptime` 到 `$SCRATCH/lp-gate-uptime.txt` 以便判 flake）

(a) ccloop 门：
```bash
. "$LPENV"
/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop "$SCRATCH/gate-ccloop" > "$SCRATCH/lp-gate-ccloop-clone.txt" 2>&1; echo rc=$?
ln -s /Users/biran/code/skills/loop/ccloop/node_modules "$SCRATCH/gate-ccloop/node_modules"
cd "$SCRATCH/gate-ccloop" && npm run build > "$SCRATCH/lp-gate-ccloop-build.txt" 2>&1; echo rc=$?
cd "$SCRATCH/gate-ccloop" && npm run typecheck > "$SCRATCH/lp-gate-ccloop-tsc.txt" 2>&1; echo rc=$?
cd "$SCRATCH/gate-ccloop" && ./node_modules/.bin/vitest run --reporter=json --outputFile="$SCRATCH/lp-gate-ccloop.json" > "$SCRATCH/lp-gate-ccloop.txt" 2>&1; echo rc=$?
cd "$SCRATCH/gate-ccloop" && node scripts/check-known-reds.mjs "$SCRATCH/lp-gate-ccloop.json" > "$SCRATCH/lp-gate-ccloop-reds.txt" 2>&1; echo rc=$?
cd "$SCRATCH/gate-ccloop" && node scripts/check-tmp-leak.mjs > "$SCRATCH/lp-gate-ccloop-leak.txt" 2>&1; echo rc=$?
```
Expected：build、typecheck、`check-known-reds`、`check-tmp-leak` 都 rc=0（全量那一行的 rc 可为 1，只要失败集合是已知红的子集，由 `check-known-reds` 判）。

(b) Orca 门：
```bash
. "$LPENV"
stat -f '%m %c %i %z' /Users/biran/.orca > "$SCRATCH/lp-gate-orca-home-before.txt" 2>&1; echo rc=$?
/usr/bin/git clone --local /Users/biran/code/skills/loop/Orca "$SCRATCH/gate-orca" > "$SCRATCH/lp-gate-orca-clone.txt" 2>&1; echo rc=$?
ln -s /Users/biran/code/skills/loop/Orca/node_modules "$SCRATCH/gate-orca/node_modules"
ln -s /Users/biran/code/skills/loop/Orca/web/node_modules "$SCRATCH/gate-orca/web/node_modules"
cd "$SCRATCH/gate-orca" && npm run build --workspace web > "$SCRATCH/lp-gate-orca-web-build.txt" 2>&1; echo rc=$?
cd "$SCRATCH/gate-orca" && npm run typecheck > "$SCRATCH/lp-gate-orca-tsc.txt" 2>&1; echo rc=$?
cd "$SCRATCH/gate-orca" && ORCA_CCLOOP_BIN="$SCRATCH/ccbin-lp/dist/cli.js" ORCA_AGENTS_TABLE="$SCRATCH/agents/agents.json" ./node_modules/.bin/vitest run --reporter=json --outputFile="$SCRATCH/lp-gate-orca.json" > "$SCRATCH/lp-gate-orca.txt" 2>&1; echo rc=$?
node -e 'const r=require(process.argv[1]);const all=r.testResults.flatMap(f=>f.assertionResults.map(a=>({file:f.name,name:a.fullName,status:a.status})));const failed=all.filter(a=>a.status==="failed");const notRun=all.filter(a=>a.status!=="passed"&&a.status!=="failed");const e2e=all.filter(a=>a.name.includes("P-E2E"));console.log(JSON.stringify({total:all.length,failed,notRun,e2e},null,1));process.exit(notRun.length===0&&e2e.length===1&&e2e[0].status==="passed"?0:1)' "$SCRATCH/lp-gate-orca.json" > "$SCRATCH/lp-gate-orca-skips.txt" 2>&1; echo rc=$?
cd "$SCRATCH/gate-orca" && npm run --ws check > "$SCRATCH/lp-gate-orca-web-check.txt" 2>&1; echo rc=$?
cd "$SCRATCH/gate-orca" && ORCA_CCLOOP_BIN="$SCRATCH/ccbin-lp/dist/cli.js" ORCA_AGENTS_TABLE="$SCRATCH/agents/agents.json" npm run verify:control > "$SCRATCH/lp-gate-orca-verify-control.txt" 2>&1; echo rc=$?
cd "$SCRATCH/gate-orca" && npm run verify:panel > "$SCRATCH/lp-gate-orca-verify-panel.txt" 2>&1; echo rc=$?
cd "$SCRATCH/gate-orca" && ORCA_CCLOOP_BIN="$SCRATCH/ccbin-lp/dist/cli.js" ORCA_AGENTS_TABLE="$SCRATCH/agents/agents.json" node scripts/check-tmp-leak.mjs > "$SCRATCH/lp-gate-orca-leak.txt" 2>&1; echo rc=$?
stat -f '%m %c %i %z' /Users/biran/.orca > "$SCRATCH/lp-gate-orca-home-after.txt" 2>&1; echo rc=$?
cmp "$SCRATCH/lp-gate-orca-home-before.txt" "$SCRATCH/lp-gate-orca-home-after.txt" > "$SCRATCH/lp-gate-orca-home-cmp.txt" 2>&1; echo rc=$?
```
Expected：web build、typecheck、skip 分析（`notRun` 为空、`P-E2E` 恰好一条且 `passed`）、web check、`verify:control`、`verify:panel`、`check-tmp-leak`、`cmp` 全部 rc=0。全量那行若 rc=1：`failed` 里每一条必须在 Global Constraints 的 flake 名单里，且单文件重跑三次全绿（每次重跑同样重定向读回、记 `uptime`）；名单外的红 ⇒ 停下报控制器。

- [ ] **Step 6: 台账**：两仓门的原始报数（通过／失败文件数与测试数、各 rc）、E2E 的 JSON 状态、flake 重跑记录、`~/.orca` 前后 `stat`。

**Mutation**（E2E 层，spec §5 的「看见红才算」）：
- M8a（Orca 变异副本，`ORCA_CCLOOP_BIN` 仍指 `ccbin-lp`）M5f（不存 progress）⇒ `P-E2E` 红（等不到 `execute`）。
- M8b（ccloop 变异副本 `$SCRATCH/mut-ccloop` 落 M6a 后 `npm run build`，`ORCA_CCLOOP_BIN` 指**这份变异副本**的 `dist/cli.js`，Orca 用主树的已提交代码）⇒ `P-E2E` 红。这是唯一一次允许把变异 build 当 `ORCA_CCLOOP_BIN`：它量的正是那条变异；跑完即弃，不与 `ccbin-lp` 混用。
- M8c（Orca 变异副本）M3d（摘要不给 completion）⇒ `P-E2E` 红在 `completion` 断言。

---

## 叫不出名字 / 只在编译期量的判据

- `errors.ts` 的两个新码：删掉任一行 ⇒ `npm run typecheck` 失败（`KnownControlErrorCode` 封闭，`tests/control/errorClassification.test.ts` 在编译期与运行期都覆盖所有码）；没有专属的运行时判据。
- `webParity` 的 `setTaskLabelsServerToWeb`／`…WebToServer` 与 `CommandSuccessV1` 双向：只在 `npm run typecheck` 量（task 8 ruling K2 的既有方式）。
- 详情面板里 `lastTransitionAt` 的显示文字没有专属判据（投影层由 `R18: maps ccloop's status …` 量到值）。
- single-call 估算 run 的 collect 在 ccloop 侧没有 `loop-state.json` ⇒ `progress: null`：由 ccloop `P1: answers it once the loop ended too, and null before …` 的「无文件即 null」覆盖，没有专门走 single-call 路径的判据。
- 标签变更与其他在飞命令的 `expectedRevision` 互相过期（R6 后果）：`L4/R6: refuses a stale labelsVersion …` 里量了「旧 revision 先撞 revision-conflict」，没有反方向（别的命令被标签推过期）的专属判据——那是所有命令的既有行为。

---

# Final —— 控制器自己做

- [ ] **变异总表**：把各 Task 的 Mutation 行（M1a–M8c）汇成一张表，逐条在单独的 `git clone --local` 副本里做（Orca 副本软链两个 `node_modules`；ccloop 副本软链并 build）：先绿基线，`lp-mutate.mjs` 落变异，`shasum -a 256` 前后不等，点名判据看见红（红在哪条断言、行号照录），`cat` 主树文件回副本还原，`git diff`／`git diff --cached` 重定向后 `stat -f %z` 为 0。代码改过的 Task 之后，之前跑过的变异要重跑（ccloop Rule 17）。结果追加进台账。
- [ ] **台账收口**：全部 `Ruling:`（F1–F18）、REWRITTEN 行（ccloop agentsControl 两条）、夹具改动（`web.ts`、`fake-ccloop-control.mjs`）、只加清单、变异表、两仓门的原始报数。
- [ ] **三份 handoff**：Orca 滚动节、ccloop 与 ccmem 的「Orca 那条线」整节替换（不追加）；都不写当前哈希；awaitingHuman 写一条事实：「本轮两仓各有本地提交；推送顺序须先 Orca 后 ccloop（spec §3.3）」——只陈述，不催（memory「push 由人定时机」）。
- [ ] **清理 scratchpad 里的本轮临时物**：`gate-orca`、`gate-ccloop`、变异副本、`lp-env.sh` 指向的 TMPDIR 与假 HOME —— 先 `/bin/rm -f` 两个 `node_modules` 软链本身，再 `/bin/rm -rf <字面路径>`；`ccbin-lp` 与 `agents/` 留给下一轮（handoff 里写明路径与主题行）。

---

## Self-Review

**Spec 覆盖**（每一条 → Task；§8 优先）：

| spec 条目 | 落在 | 判据 |
|---|---|---|
| §2.1 两类标签、词表、16 个、NFC、`inputLabelsSchema`／`storedLabelsSchema` | T1 | labels.test.ts 全部；M1a–M1j |
| §2.2 plan `labels`、malformed 点名、显式字段表、报告显示 | T2 | planFile L3 三条、planImport L1/L2、planReport L6；M2b、M2d、M2f |
| §2.3 存档 `labels` 可选且非空、只在非空时写、无标签字节与 hash 不变、不许 `.default([])` | T2 | L1 两条（F12 实测值）、labels.test L2；M2a、M2e |
| §2.4 `labelsOverride`／`labelsVersion`，旧记录读作 null／0，不迁移 | T1、T3 | `reads a work item written before labels existed …`、L5 视图 |
| §2.5 生效标签一处算、`[]` 覆盖 ≠ 无覆盖 | T1、T3 | L5 两处；M1g、M3e |
| §2.6 run `progress`，最新一份覆盖 | T5 | P3、R2 |
| §3.1 `set-task-labels` 四步顺序、写入、不查组状态、不碰 proposal、重放 | T4 | L4 六条、L3 一条；M4a–M4e |
| §3.1 Web 同步 ＋ webParity | T4（CommandSuccessV1）、T7 | webParity 新 `it` ＋ 编译期；M7k |
| §3.2 ccloop `progress`（运行中与终态都填、ENOENT 为 null、坏 JSON 报 `control-terminal-invalid`、strict 响应 schema） | T6 | ccloop P1 三条、R17；M6a–M6d |
| §3.2 Orca `collectionSchema.progress` 可选、`ExecutionReport.progress` | T5 | P2 两条；M5a–M5c |
| §3.3 落地与推送顺序 | Global Constraints、执行顺序、Final handoff | —（顺序由计划结构保证；推送归人） |
| §3.4 变了才写、推进 `changeSeq`、存原值、映射在投影层 | T5 | P3 两条；M5e–M5g |
| §4.1 组级 `completion`、摘要同字段 | T3 | P5、R19；M3a、M3b、M3d |
| §4.1 work item 标签三字段、`progress`（step／attempt／tokens／lastTransitionAt） | T3、T5 | L5、R18、R11；M5i–M5m |
| §4.2 标签列样式、进度列、筛选 any-of、导航 done/total、详情面板（编辑器、恢复、草稿、进度、run 与 evidence）、轮询不变 | T7 | web 两个新文件；M7a–M7j（轮询未动：`App.tsx` 只改 `sendControl`） |
| §5.1 L1–L6 | T1、T2、T3、T4 | 见上 |
| §5.2 P1–P5、E2E | T5、T6、T3、T8 | 见上；M8a–M8c |
| §5.3 Web 判据 | T7 | 见上 |
| §5.4 两仓门（全新 clone、HOME/XDG 改道、短 TMPDIR、json reporter、读回、known-reds、tmp-leak、web check、verify:panel、`~/.orca` stat） | T8 Step 5 | 门本身 |
| §6 不做 | —— | 计划未触及：阶段历史、SSE、指标切分、claim 冻结标签、别名表、CLI `--json` |
| §7 既有判据清单 | Global Constraints「预先登记」表 | 台账逐条 |

**§8 R1–R19：**

| R | 处理 | Task／判据 |
|---|---|---|
| R1 `persistedRunSchema.progress` 可选、旧 run 可读 | T5(f) | `R1/R10/R19: none without a run; …`；M5h |
| R2 用量循环之后新读 run 再写 | T5(d) | `R2: books exactly the usage …`；M5d |
| R3 走 `saveDriverRun`，两条新变异 | T5(d) | P3；M5e（①）、M5f（②） |
| R4 port 返回对象带 `progress`，经真 port ＋ fake 走一遍 | T5(c)、Step 1 | P2；M5a（F3） |
| R5 `ExecutionReport.progress` 可选，假 port 不改 | T5(b) | `P3/R1: … a port with no progress field writes nothing`（F15） |
| R6 带 `expectedRevision`，推进 revision 与 changeSeq；版本冲突格用新 revision ＋ 旧版本 | T4 | `L4/R6: …`、HTTP `R9` 量 revision＋changeSeq |
| R7 动词、两个 union、结果、服务方法、路由、错误码分类、Web | T4、T7 | 编译期 ＋ 各判据 |
| R8 词表在 `apply`、target 用 task、payload 只查形状 | T4 | HTTP `R8` 两条；M4g（F2） |
| R9 新 POST 路由、不新增 GET | T4(d) | `R9: sets a task's labels over POST …`；M4f |
| R10 当前 run ＝ `currentRunId`，无兜底 | T5(f) | `R1/R10/R19`；M5m |
| R11 `tokens` 按 run 的 bucket、未知或超支为 null、首条用量前 0／grant | T5(f)、T7 | 两条 R11、`says unknown …`；M5i、M5j、M7e（F4、F18） |
| R12 malformed 消息进 detail | T2(a) | `L3/R12: …`；M2c（F13） |
| R13 E2E 点名、不许静默跳过、门补 env 与 verify:control、json reporter 判 passed | T8 | Step 3、Step 5 的 skip 分析 |
| R14 `done` 按视图映射后的 `completed`、`total` 是 plan 任务数 | T3 | P5（含 handoff 行）；M3a、M3b |
| R15 长度按 NFC code point、不含前缀、code unit 排序、孤立代理、区分大小写、去重后数 | T1、T4 | 各 L3；M1d、M1e、M1h、M4h（F2、F9） |
| R16 revert 写成 `labels: null`、`[]` 与 revert 两种结果用有 plan 标签的 task | T4 | `L4: sets, clears and reverts …`、`L4/R16: …` |
| R17 ccloop 读 loop-state 校验形状、枚举九值 | T6 | `R17: …`；M6c |
| R18 字段名 `step`、`queued` 时 0/max 照实显示 | T5、T7 | `R18: maps ccloop's status …`（含 `queued`）；M5k、M5l |
| R19 新字段线上可选、服务端总是给出，另加判据；agentsControl 两处要人指名 | T3、T5、T6 | `R19: the server always gives …`、`R1/R10/R19`；agentsControl 改写（人已授权） |

**占位符扫描**：全文没有 TBD／「类似 Task N」／「加校验」式空话；每个代码步给了代码；唯一一处取自别的文件的长字面量（metrics 应答体）已逐字嵌入并注明出处行。

**类型一致性**：`RunProgress`（Orca `schema.ts`）与 ccloop `ProgressV1`、ccloop `command.ts` 的 schema 字段逐一相同；`WorkItemProgressV1` 服务端（zod 推导）与 Web 手写两份由 webParity 的 `GroupViewV1` 双向赋值在编译期对齐；`SetTaskLabelsPayload` 同上；`labelsDraftKey` 只在 `TaskDetail.tsx` 定义、`App.tsx` 引用。
