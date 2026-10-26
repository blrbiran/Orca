# 面板小缺口批（2026-10-26）

会话 `a98b77d2`，基于 `main` 的 `19bdd8ba`，工作树 `../Orca-wt/loop-doc-checks`，分支 `fix/loop-acceptance-document-checks`。

## 为什么不按原定的两条做

原提案的两条登记缺口经代码核对**都已修完**，本轮不再动：

- `scheduleListView`／`schedule-remove` 的损坏行隔离：`src/control/schedules/store.ts` 的 `listLiveSchedules` 逐行 try/catch、`markRemovedUnparsed` 不解析就标记；`tests/control/scheduleModel.test.ts:257`、`:274` 分别钉住两个行为。修复提交 `87413212`。
- 已停／已完成 run 的 `lastError`：`tests/flow/boundaryPause.test.ts:191`、`:203` 钉住 stop 与 finish 都清；修复提交 `dff06016`（主题行 `fix(flow): one lane per run, and a terminal run stops showing its last error`）。

同批排除的其它登记项及理由：

- `Web BudgetEditor 不显示 handoffControl／handoffExecution`：`web/src/BudgetEditor.tsx:434` 已经对阻断派活的 profile 具名两个值（`0f68801c`），登记句过期。
- 看板「run 无开始时间戳故无耗时」：`flow_runs` 表**没有**时间列（`src/flow/store.ts:27` 的 INSERT 列清单），补耗时要加 schema，不属于小缺口。
- 看板「写集冲突／已并入 main／已 push」：前者 kanban spec 明确不做预测；后两者要跑 git 查询进板卡轮询，不属于小批。
- H7 的带后缀错误码、overview needs-you 复用 §13 拒绝句：都是**接受的偏差**（handoff §五），不改。

## 唯一的任务：loop 卡片的验收计数要算上文档检查

出处：loop plans spec `2026-09-30-loop-plans-design.md` §13 as-built 末条——「The panel card's "Acceptance: N check commands" still counts the task's own checks only; the document checks are named in the plan's discipline line.」handoff §八 loop 行同句。

事实：design v2/v3 与 investigate v2/v3 的 recipe `documentChecks: true`（`src/control/loopPlans.ts:69,73`），展开后的 `verification.requiredChecks` = 每个 target path 一条 `documentCheck` + 用户 checks（同文件 `:290`）。面板只数 `inputs.checks.length`（`web/src/LoopPlanCard.tsx:55`、`:250`），所以卡片报的条数少于 ccloop 实际会跑的条数。

### 改动

1. 视图新增 `documentChecks: boolean`：
   - `src/panel/controlViews.ts:870` 一带，从 `loopPlanDefinition(...)` 的 `plan.documentChecks` 取值。
   - `src/control/webProtocol.ts:1685` 的 `loopPlanViewSchema` 加 `documentChecks: z.boolean()`（严格 schema，服务端每条视图都带）。
2. Web 类型 `web/src/controlTypes.ts:954` 加 `documentChecks?: boolean`（可选，字面夹具不必改；缺省按 false）。
3. `web/src/LoopPlanCard.tsx`：
   - `loopSummaryLines` 的验收条数 = `inputs.checks.length + (documentChecks ? inputs.targetPaths.length : 0)`。
   - 折叠区的 summary 用同一个总数；列表里用户 checks 之后追加一条说明：每个 target path 另有一条存在性检查（只描述，不搬 `documentCheck` 的命令文本）。
4. 文案：`web/src/locales/en.ts`、`zh.ts` 各加一条 `loopPlan.documentChecks`（英文 `Plus {{count}} existence check(s), one per target path: each must exist and be non-empty.`；中文 `另有 {{count}} 条文档存在性检查：每个目标路径都要存在且非空。`）。
5. spec：不改原文，按 Rule 13 在 `2026-09-30-loop-plans-design.md` 末尾**追加**一节，记明本条 as-built 被替换、新行为与提交主题行。
6. handoff：`docs/handoff/handoff.md:483` 删去已修的半句；三条件同时成立——(a) 让它过期的是本轮提交主题行，(b) 结论活在 spec 新节，(c) 不留假陈述。

### 判据（先看见红）

- `tests/control/loopPlanViewFields.test.ts`：字段清单加 `documentChecks`；design/investigate v3 视图为 `true`，standard/bugfix 为 `false`。
- `tests/control/loopPlanView.test.ts:24` 的 `toEqual` 补 `documentChecks: false`（bugfix）。
- `web/tests/loopSummary.test.tsx`：`viewOf` 依 plan 与 version 给出 `documentChecks`（design/investigate v≥2 为真），更新 ROWS 中 design/investigate v2 的验收条数与新增一条说明行；新增一条 design v2 的显式断言（1 个用户 check + 1 个 target path ⇒ 2）。
- `web/tests/loopPlanCard.test.tsx`：新增一条 design v2 卡片的折叠区断言（summary 数为 2，列表含存在性检查说明）。

### 命名变异（只在 `git clone --local` 副本里做，主工作树零触碰）

- M1 `count-ignores-doc-checks`：验收条数去掉文档检查项 ⇒ `loopSummary` 的 design 行红。
- M2 `view-drops-document-checks`：`controlViews` 不写 `documentChecks` ⇒ `loopPlanViewFields` 红。
- M3 `card-hides-doc-note`：不渲染存在性检查说明 ⇒ `loopPlanCard` 新断言红。
- 还原证明：`git diff` 与 `git diff --cached` 字节数为 0。

### 门

- `npm test`（按改动选测试；Rule 18），`typecheck`，`web build`，`npm run --ws check`。
- 不做全量 `npm run verify`（无发版 tag）。
- 门里发现 main 上已有一条**确定性**失败（不是并发）：`web/tests/schedules.test.tsx` 的导入用例在 Node 22.13.1 下必红——jsdom 的 `File.arrayBuffer()` 返回其 realm 的 `ArrayBuffer`，Node 的 `SubtleCrypto` brand check 拒收。`sha256Hex` 改喂本 realm 的 `Uint8Array` 视图后 39/39 绿；单独提交，不计入本批范围。
- 另有两条 main 既有红，各自单独提交：`tests/service/command.test.ts` 的 skill 字面量停在 75f17f14 之前（skill 已把 `status|logs` 并入同一句）；`web/tests/projectSwitcher.test.tsx` C 在 Requirements 表单挂载前就读 select（已登记的 web 时序 flake，改为 `waitFor`）。
- 最终门：根 578 文件 1 红（5036 过／35 跳过），web 159 文件 1 红（1454 过）。两条红是 `known-load-flakes.md` 已登记的同形状负载 flake（`startForm` ECONNRESET、`memoryLayout` scroll 时序）；单文件各连跑 3 次 3/3 绿（负载 14–17），按判别规则不判回归。

### awaitingHuman

- 只剩 push。
- 按人 2026-10-27 的指令：已 ff 合入 `main`、根与 web 重建后 `panel restart`（7777 应答 200，新构建含 `documentChecks` 与存在性检查文案）、worktree 与分支已清。
