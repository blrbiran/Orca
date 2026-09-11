# E3 面板计划 —— 实施前只读扫描

> 扫描对象：`docs/superpowers/plans/2026-09-10-panel-e3.md`（下称「计划」，2970 行）。
> 权威依据：`docs/superpowers/specs/2026-09-09-panel-design.md`（下称「spec」）。
> 本文档只报告**已读到**的内容；凡未核实之处逐条声明「未核实」，不假装干净。
> 行号均为计划文件（除非另注明「spec」或 `src/...`）里 `Read` 工具报的绝对行号。

---

## 0. 覆盖声明（先说清楚查过什么、没查什么）

**查过、且对照了实际源码**：`src/corrections/record.ts`、`correct.ts`、`fields.ts`、`schema.ts`、`args.ts`、`store.ts`（片段）、`rejection.ts`（片段）；
`src/metrics/collect.ts`（片段）、`compute.ts`（片段）、`highTier.ts`（签名）、`rejection.ts`（片段）、`types.ts`（字段名片段）。

**没有查过**（明确声明，不代表干净）：`src/panel/` 目录本身（**尚不存在**，计划是要新建它，所以无源码可核）；
`src/corrections/gitState.ts`、`originalDecision.ts`、`projectKey.ts`、`storeLock.ts` 的完整实现（只读过被引用的片段/签名）；
`src/metrics/discover.ts` 的完整实现（只读了 `DiscoverOptions` 接口）；`src/ledger/*`；`tests/corrections/harness.ts`；
`.decisions/orca-dev-ad1e30c6.jsonl` 的实际内容（§8 前置状态"已落地"未现测复核，只信计划自陈）；
`web/` 目录（不存在）；`scripts/verify-scheduler.mjs`、`scripts/check-claude-md-lines.mjs` 等 verify 链上的既有脚本。
**变异总表与 Self-Review 里的"红/绿"结论全部是计划自己的推演，未执行，未验证。**

---

## 1. 任务对之间共享文件/接口的一致性

按共享的工件（而非机械穷举 C(10,2) 对）组织；每个工件下列出涉及的任务对与其内容，注明是否一致。

| 工件 | 产出方（行号） | 消费方（行号） | 一致？ | 说明 |
|---|---|---|---|---|
| `src/panel/rejection.ts` / `PanelRejection` | Task 1 建（L388-417，定义 `PanelExitCode`、`NO_VIEWER_IDENTITY`） | Task 2（L773 `reviewsLock.ts` 导入 `PanelRejection` 抛 `REVIEWS_STORE_BUSY`）；Task 3（Files: "Modify: rejection.ts（加两个码）" L1024）；Task 4/5/6/7 各自 `throw new PanelRejection(...)` | **部分不一致** | Task 3 的 Interfaces 声称"Produces: `EXTERNAL_BIND_NOT_CONFIRMED`、`TOKEN_REQUIRED`"（L1030），但 Task 3 正文只在 `bindGuard.ts`（L1183）定义了 `EXTERNAL_BIND_NOT_CONFIRMED`；`TOKEN_REQUIRED` 实际是在 **Task 5 的 `api.ts`**（L1903, `export const TOKEN_REQUIRED = "token-required";`）里现场定义的，从未被加进 `rejection.ts`。Task 3 声称产出、Files 表也没把 `TOKEN_REQUIRED` 列进 Task 5 的新增导出。见 §3 defect 1。 |
| Task 1 `startPanelFromArgs`（stub，L488-503，`server.ts`） | Task 1（`throw new PanelRejection("not-implemented", ...)`，L502） | Task 3 **整份替换**（L1221-1223: "整份替换 Task 1 那个最小实现"） | ✅ 一致（计划自己声明是替换，不是增量） | 需注意 Task 1 提交（L552-581）会把这个 stub 提交进 git 历史；Task 3 提交是另一次提交整份覆盖，属正常演进，非冲突。 |
| `PanelOptions`（`server.ts`） | Task 3 定义（L1237-1247：`by, bind, port, confirmedExternal, correctionsDir, root?, repos, distDir?`） | Task 5 `ApiDeps.opts: PanelOptions`（L1897）；Task 6/7 通过 `deps.opts.by`、`deps.opts.correctionsDir` 读取（L2223, L2373, L2388）；Self-Review 自称"Task 5/6/7 都只读它的字段 ✅"（L2807） | ✅ 字段名一致 | 已核对 `repos: Array<{projectKey,path}>` 与 `src/metrics/discover.ts` 的 `DiscoverOptions.repos: ReadonlyArray<{projectKey,path}>` 字段名一致（类型可变/只读的差异不影响解构读取）。 |
| `ReviewsWriter` / `ReviewRow` / `readReviews`（`reviewsStore.ts`） | Task 2 定义（L830-914） | Task 3 `createPanelServer` 里 `new ReviewsWriter(opts.correctionsDir)`（L1313）；Task 5 `api.ts` 导入 `readReviews`、`ReviewsWriter` 类型（L1890-1891），`currentMetrics`/`/api/metrics` 用 `readReviews(deps.opts.correctionsDir)`（L1964）；Task 6 用 `readReviews(store)` 判据（L2118, L2130）；Task 7 `deps.reviews.append(...)`（L2400） | ✅ 字段名一致（`decisionId/projectKey/action/by/at`） | 一致。但 Task 2 的 `key()` 函数用空字符串当分隔符（`UNIT_SEPARATOR = ""`，L839），是一个潜在的字段边界坍缩缺陷（见 §3 defect 4），不是任务间不一致，但会影响 Task 5/6/7 依赖的去重语义。 |
| `StaticFiles` / `loadStaticFiles`（`staticFiles.ts`） | Task 4 定义（L1543-1637） | Task 3 `createPanelServer` 提前 import 并调用（L1234, L1315：`await loadStaticFiles(opts.distDir, token)`）；Task 5 `buildApi` 用 `deps.statics.get(name)`（L1944） | ✅ 接口签名一致；⚠️ 前向引用已被计划自己登记 | Self-Review 第 3 项自陈（L2809-2811）："Task 3 的实现里 `loadStaticFiles` 是前向引用"，并声明 Task 3 判据不测 `createPanelServer`、真进程判据 `it.skip` 到 Task 5 打开。**该登记本身准确**，但见 §3 defect 2（`it.skip` 位置的引用变量 `throwawayStore` 未定义）。 |
| `LIST_FIELDS` / `DecisionListRow` / `projectForList`（`listProjection.ts`） | Task 6 定义（L2069-2084） | Task 8 `DecisionList` 只渲染 `LIST_FIELDS` 里的字段（L2607）；变异表 L-3b（L2735, L2242） | **一致性有已登记但未解决的缺口** | 处置节「登记而不修」第 3 条（L2923-2927）明确指出：`web/` 是独立 workspace，`web/tsconfig.json` 的 `include` 不覆盖 `src/panel/listProjection.ts`，前端**拿不到**这个常量，Task 8 实际会长出第二份字段清单，而"没有一条变异能同时够到两边"。**这是一处任务间接口共享声明与可达性相悖的真实冲突**：Task 6 产出的 `LIST_FIELDS` 在 TypeScript 的 module graph 意义上对 Task 8 不可达，但 Task 8 的 Files 表（L2461-2463）和判据描述都当作它能被复用。见 §5 三选一之一。 |
| `detailUrl(projectKey, decisionId)`（`listProjection.ts` 或就近） | Task 6 定义（L2046-2047） | Task 6 自己的判据（L2129, L2143）；Task 9 的 `verify-panel.mjs`（Interfaces 处声明"判据与 `verify-panel.mjs` 都用它拼 URL，不许各拼各的"，L2035） | **未核实** | `detailUrl` 定义代码块（L2044-2048）没有写在哪个文件里（不像其它导出都标了文件名）；Task 6 的 Files 表（L2023-2026）里没有一个文件名明显对应它应该导出的位置（`listProjection.ts` 只字面导出了 `LIST_FIELDS`/`DecisionListRow`/`projectForList`，没提 `detailUrl`）。`verify-panel.mjs` 是 Task 9 才建的纯 Node 脚本，如果 `detailUrl` 被放进 `src/panel/*.ts`（TS，走 tsx/vitest 的模块解析），`verify-panel.mjs`（不经 tsx 编译、直接 `node scripts/verify-panel.mjs`，见 L2666 上下文）能不能 `import` 到它取决于该脚本的运行方式，计划完全没有交代。**登记为未核实的潜在断裂点**，不下红/绿结论。 |
| `recordNewCorrection`（`src/corrections/record.ts`，既有源码） | 已存在（非本计划产出） | Task 7 Consumes 列出（L2267）；Task 7 handler 调用（L2395） | **不一致 —— 见 H1** | 详见 §4。计划 Consumes 里从未出现 `correctionRowFrom`；Task 7 的行字面量在 L2374-2389 自建，不经过任何"同一构造点" seam 之外的公共函数。 |
| `package.json` `verify` 脚本 / `workspaces` | Task 1 首次写入（L237-267）；Task 9 再次修改（L2701-2706："... && npm run verify:panel && npm run --ws check"，`verify:panel` 脚本新增） | Task 1 自己的判据 `workspace.test.ts`（断言 `root.scripts.verify` 包含 `"npm run --ws check"`，L209）；Task 9 disposition 表（L2884: "二席 C1... ✅ Task 9 Step 3 加 `npm run build --workspace web`"） | **需要执行时核对顺序** | Task 1 写的 `verify` 字符串（L250）结尾是 `"... && npm run verify:scheduler && npm run --ws check"`；Task 9 Step 3（L2704）给出的新字符串是 `"... && npm run verify:scheduler && npm run build --workspace web && npm run verify:panel && npm run --ws check"`。两处字面量不是同一个字符串，Task 9 需要**编辑**而不是**追加**（计划没有写"用 Edit 替换 Task 1 写的哪一段"，只给了目标态）。这是可执行的但要求执行者自己做 diff，不是天然衔接——**登记，不算缺陷，但要求执行者别机械 append**。 |
| `web/package.json` `check` 脚本 / `npm run --ws check` | Task 1 建（L282-299："check": "tsc --noEmit -p tsconfig.json && vitest run"） | Task 1 判据 L207-212（断言 `web.scripts.check` 是字符串）；Task 8 Step 4（L2613-2614: `npm run --ws check`） | ✅ 一致 | 无冲突。 |
| `verify:panel` 依赖 `web/dist` | Task 9 新增（L2666-2715） | 依赖 Task 4 的 `loadStaticFiles`（读 `web/dist`）与 Task 1 的 `web/vite.config.ts`（`build.assetsDir`, L331-341） | ✅ 已被外审 C1 揪出并修（disposition L2884），计划正文（L2708-2712）也做了显式代价登记 | 一致，且计划自己交代了「为什么之前会卡死在 `panel-dist-missing`」。 |

**未逐对列出但同样成立的接口**（因体量原因合并说明，均已读到定义与至少一处消费，未见冲突）：`mintToken`/`tokenMatches`（Task 3 → Task 3 自身判据 + Task 5 `token.ts` import L1894）；`assertBindAllowed`（Task 3 → Task 3 判据 + Task 5 `createPanelServer` L1310）；`computePanelCoverage`/`PanelCoverage`（Task 5 → Task 5 判据 + Task 8 `MetricsView` props，L2467, L2584）。

---

## 2. 每个 Task 自身的一致性（判据 vs 代码、创建 vs 修改、🆕/⚠️ 处置是否落地）

| Task | 检查 | 结论 | 行号 |
|---|---|---|---|
| **Task 0** | 只跑现测命令，不写代码/判据，内部无冲突 | ✅ 自洽 | L119-152 |
| **Task 1** | Files 表只列 `src/panel/rejection.ts` 为 Create；判据/实现/提交信息三者字段名一致（`PanelRejection`, `NO_VIEWER_IDENTITY`, `runPanel`） | ✅ 自洽 | L158-586 |
| **Task 2** | Interfaces 声明 `ReviewsWriter { constructor(dir); load(); append(row): Promise<"written"\|"duplicate"> }`（L605）与实现（L876-914）字段/方法名一致；但 `key()` 用 `UNIT_SEPARATOR=""` 连接三个字符串字段（L839-841），命名与实际行为不符（"分隔符"实际是空字符串，起不到分隔作用） | **⚠️ 自洽但含缺陷** | L594-1014；缺陷见 §3-4 |
| **Task 3** | `security.test.ts` 在 L1114 使用 `throwawayStore` 变量，但该测试文件（L1040-1140，从 `import` 到 `describe` 结尾）里**从未声明** `throwawayStore`。这是测试代码里的未定义引用，会在 `vitest` 收集阶段就报 `ReferenceError`，不是"判据红"而是"判据装不起来" | **🔴 不自洽（真缺陷）** | L1105-1119，尤其 L1114 |
| **Task 3** | Step 6（L1355-1364）登记"最后那条走真进程的判据... 先 `it.skip` 掉... Task 5 结束时打开"，Task 5 Step 5-6（L1988-1994）确实有"这个文件必须为空才算 Task 5 完成"的判据。🆕/⚠️ 处置落地检查：外审并未单独点名这处 `it.skip` 机制本身，但**处置节第三节第5条**（L2931-2934）指出这条 grep 闸门"漏掉 `test.skip`/`it.todo`/`describe.todo`/`xit`/`xdescribe`，vitest 对 skipped/todo 退出码是 0"——**这条登记要求 Task 5 补一档真判据（`tests/panel/noSkips.test.ts`），但 Task 5 正文（L1988-1994）仍然只有原来那条 grep 检查，没有改成登记要求的新测试文件** | **🔴 处置未落地** | 处置 L2931-2934 vs Task 5 正文 L1988-1994（未更新） |
| **Task 4** | Step1 fixture（`beforeEach`，L1452-1462）只建了 `index.html`/`index.js`/`index.css`/一个符号链接 `linked.txt`，**没有建 `subdir/` 目录**；但 Step5 变异说明（L1663-1665）与提交信息（L1698-1701）都写"`./index.js` 与 `subdir/index.js` 会命中"。`subdir/index.js` 在 fixture 里不存在，S-12 变异（把 Map 换成磁盘拼路径读）下 `readFileSync(join(dir,"subdir/index.js"))` 同样会 ENOENT，返回 `undefined`，与未变异时的期望值相同——**不会命中，这条判据在这个名字上不可能红**。**处置节第9条**（L2944-2946）已经点名"S-12 的理由举了夹具里不存在的 `subdir/index.js`"并声称"三条都在上文就地更正了"；变异总表本身也已经改口（L2746: "夹具没造 `subdir/`；真正命中的是 `./index.js`、`index.js/` 与 `linked.txt`"）——**但 Task 4 正文（L1663-1669, L1698-1701）没有跟着改，仍然保留错误陈述** | **🔴 处置未落地（Task 4 正文与变异总表、disposition 三处互相矛盾）** | L1452-1462（fixture）vs L1663-1669、L1698-1701（正文未改）vs L2746（表已改）vs L2944-2946（disposition 声称已改但未改） |
| **Task 5** | Files 表（L1713-1716）写"Modify: `src/panel/rejection.ts`"，但 Task 5 正文没有任何一步真的编辑 `rejection.ts`；`TOKEN_REQUIRED` 反而在 `api.ts` 里现场 `export const`（L1903）。这与 Task 3 Interfaces 宣称"Produces: `TOKEN_REQUIRED`"（L1030）叠加，构成同一个常量被两处"声称产出"、真正只在第三处（`api.ts`）落地的局面 | **🔴 Files 表与实现不一致** | L1713-1716 vs L1903；关联 Task 3 L1030（见 §1 首行、§3 defect 1） |
| **Task 5** | `MetricsView` 判据用的 fixture（L2495-2516）与 Task 5 无关（属 Task 8），但 Task 5 自己的 `it("passes E2's report through field for field...")`（L1749-1753）只有注释、无断言体，Self-Review 第 2 项（L2799-2803）已自陈这是"判据要点，执行时逐条写全"的已知取舍，**已登记不掩饰** | ✅ 空判据但已被计划自己承认，不算隐藏缺陷 | L1749-1753 vs L2799-2803（已登记） |
| **Task 6** | Files 表（L2023-2026）只列 `src/panel/listProjection.ts`（Create）与 `src/panel/api.ts`（Modify），**没有列 `src/panel/decisionSource.ts`**；但正文紧接着说"实现放 `src/panel/decisionSource.ts`，走 E2 的 `readLedgerLeniently`，不新写一个解析器"（L2233-2235）。这是"创建的文件"与"后文提到要创建的文件"不一致的直接例子 | **🔴 Files 表遗漏一个 Create 文件** | L2023-2026 vs L2233-2235 |
| **Task 6** | 判据描述里已经自我更正过一次真实缺陷（"deep-equal 对着 `projectForList` 自己的输出比"的重言式，L2094-2103）并给出修法，属于**计划自己发现并在同一处修好**，非遗留冲突 | ✅ 已自洽修复 | L2093-2110 |
| **Task 7** | Interfaces "Produces: `POST /api/corrections`、`POST /api/reviews`"（L2269），但整个 Task 7 正文（Step1 判据 L2271-2365、Step2 实现 L2367-2426、Step3-4 变异 L2428-2445）**只出现 `app.post("/api/corrections", ...)`**（L2370）。`POST /api/reviews`（对应 UI 上「同意／无需改动」按钮、以及判据 `writes reviewed when... the person clicks agreed`，L2357）**从未被实现**；`deps.reviews.append({/* action: "reviewed", awaited on purpose */})`（L2400）只是 `/api/corrections` 成功路径里的注释占位，不是独立端点 | **🔴 声明产出的端点未实现（真缺陷）** | L2266-2269 vs 全 Task 7 正文；具体断点 L2357（判据提到"点同意"）、L2400（占位注释） |
| **Task 7** | Step2 行字面量（L2374-2389）自己 `as CorrectionRow` 拼装，`at: new Date().toISOString()`（L2387），未调用任何"唯一构造点"之外声明的公共函数（除 `recordNewCorrection` 本身） | **🔴 与 H1 冲突** | 详见 §4 |
| **Task 8** | fixture 注释（L2480-2487）明确写"真实形状（`src/metrics/types.ts`）没有 `overall` 字段——正确字段是 `rate_excluding_stale`"，并解释为什么用真实类型而非 `as never`；但两屏之后 `MetricsView.tsx` 的示例实现（L2588）写的是 `formatRate(report.correction_rate.overall.rate)`——**用了自己刚刚否定掉的字段名**。已用 `grep` 对照 `src/metrics/types.ts` 确认：该文件里没有任何 `overall` 出现，真实字段是 `rate_excluding_stale`（`types.ts:91/99/117`） | **🔴 Task 8 正文自我矛盾（真缺陷）** | L2480-2487（否定 `overall`）vs L2588（使用 `overall`）；已核对 `src/metrics/types.ts:91,99,117` 无 `overall` |
| **Task 8** | 处置节第三节第 3 条（`LIST_FIELDS` 前端不可达，L2923-2927）要求"Task 8 实施时二选一并写明"，但 Task 8 正文（L2449-2635）**没有出现任何关于这个二选一的文字** | **🔴 处置未落地** | 处置 L2923-2927 vs Task 8 正文（未提及） |
| **Task 9** | Step1（L2644-2665）补 Task 2 登记的缺口，判据与 Task 2 是否打架的问题（`mkdtemp` 目录本来就是 0700）计划自己交代了要先现测再定判据写法（L2659-2664），**是一处显式的"决定权留给执行者"，已登记**，不是缺陷 | ✅ 已登记的待定点 | L2644-2665 |
| **Task 9** | `verify-panel.mjs` 逐字实现 spec §7 那串 12 步（L2666-2699）与 spec §7 原文（spec L306-323）逐条对照：步骤数、顺序、断言点一致 | ✅ 一致 | 计划 L2670-2690 vs spec L306-323 |

---

## 3. 一个代码评审者会判为缺陷的地方（汇总，含上文已列出的）

1. **同一个常量声称在两处产出、实际只在第三处落地**：`TOKEN_REQUIRED`。Task 3 Interfaces 声称"Produces"（L1030），Task 5 Files 表声称"Modify: rejection.ts"（L1713-1716）但实际把它 `export const` 在 `api.ts`（L1903）。这正是 `fields.ts` 自己讲的"两处定义会让任何变异都打不红"的那个形状——`CORRECTION_FIELDS` 那段注释（`fields.ts:17-20`）字面警告的就是这类问题，计划的 disposition 第9条（L2944-2946）也引用了这个类比，但只改了"归属说法"，没有改成单一定义点。
2. **测试代码引用未声明变量**：`tests/panel/security.test.ts` 用到 `throwawayStore`（L1114），整份给出的测试文件文本里没有这个变量的声明。这不是"判据是空的"，是判据**编译/收集阶段就会炸**——比空判据更严重，因为它会让同一个 `describe` 块里其它本来正确的判据也无法运行（vitest 遇到顶层 `ReferenceError` 通常会让整个文件失败）。
3. **`opened` 计入两次 review 记录后 `it("... on time even when reviews lock is held")` 判据以外的第二个 review 端点从未实现**：`POST /api/reviews`（L2269）声称产出但整章找不到实现，"点同意"这一条 UI 能力实际上落空，覆盖率承重信号 `reviewed` 的两条产生路径（"记 correction"或"显式点同意"，spec §4.2，spec L207）里**第二条在本计划里没有代码**。
4. **`UNIT_SEPARATOR` 名不副实、值为空字符串**：`src/panel/reviewsStore.ts` 的 `key()` 函数（L839-841）
   ```
   const UNIT_SEPARATOR = "";
   const key = (row) => [row.decisionId, row.by, row.action].join(UNIT_SEPARATOR);
   ```
   用空字符串"连接"三个自由格式字符串字段（`decisionId`、`by` 都是人可控输入），存在跨字段边界坍缩的可能（例如 `decisionId="orca-1/1"` + `by=""` + `action="opened"` 与 `decisionId="orca-1/"` + `by="1"` + `action="opened"` 会算出同一个 key，虽然目前的字段格式使这种巧合概率很低，但常量名字"UNIT_SEPARATOR"暗示原意是要用一个真正的分隔符——ASCII unit separator `\x1f`——却被写成空字符串，起不到分隔作用）。判据里没有一条测试这种边界坍缩，变异表里也没有对应条目。
5. **Task 8 的示例实现代码引用一个 fixture 注释刚刚明确否定的字段名**（`overall`，见 §2 Task 8 行），这在实施时如果被逐字照抄会直接 `tsc` 报错，而不是"红一条判据"——错误发生在类型检查阶段，属于计划文本自相矛盾产出的死代码。
6. **`S-12` 变异说明里点名的 `subdir/index.js`"会命中"是假的**（fixture 没建这个文件，变异体依然会返回 `undefined`），已经被计划自己在变异总表（L2746）和 disposition 第9条（L2944-2946）承认是错的，但 Task 4 正文本身三处（L1663-1665、L1669、L1698-1701）都没有跟着改——**如果执行者只读 Task 4 正文（不读到 2970 行外的变异总表和 disposition），会照着一条不会红的判据理由去写"预言"，实施时验证会发现预言与实测不符，但不知道原因已经被记录过**。
7. **`detailUrl` 的归属文件未声明**（见 §1），如果 Task 9 的 `verify-panel.mjs` 需要跟 TS 源码共用这个函数但两者的运行时/模块系统不同，会在 Task 9 实施时才暴露。

---

## 4. H1 影响到的位置（correctionRowFrom 改为 record.ts 导出、now 可注入）

**当前实际源码状态**（已读，非计划文本）：`src/corrections/record.ts` 目前只导出 `recordNewCorrection`（含 `now` 无关，接收已构造好的 `CorrectionRow`），**没有 `correctionRowFrom` 这个导出**。`correctionRowFrom` 目前是 `src/corrections/correct.ts` 里一个**未导出**的模块内函数（`correct.ts:67-80`），签名是 `(parsed, projectKey) => CorrectionRow`，内部直接 `at: new Date().toISOString()`（`correct.ts:77`），不接受任何时钟注入；`correct(argv)`（`correct.ts:82`）本身也没有 `opts` 参数。H1 描述的重构**尚未发生**。

计划文本里，每一处"构造 correction 行"或依赖 `at` 不可注入这个事实的地方：

| 行号 | 内容 | H1 后如何变化 |
|---|---|---|
| L2266-2269 | Task 7 Interfaces "Consumes: `recordNewCorrection`（`src/corrections/record.ts`）、`projectKeyOf`、`CorrectRejection`、`CORRECTION_ALREADY_RECORDED`" —— **不包含 `correctionRowFrom`** | H1 落地后，Task 7 必须把 `correctionRowFrom` 加入 Consumes，并改为消费 `src/corrections/record.ts` 而不是自己拼字面量 |
| L2276-2301 | Task 7 判据里一段很长的注释，解释为什么"面板与 CLI 必须产出同一个 correction id"这条 spec §2.3 原话判据**"永远打不红"**：论据是"`at` 是 `CORRECTION_FIELDS` 第六项，两个进程各戳各的 `new Date()`，两个 id 永远不同；而绕过 seam 自己拼字面量反而会算出**相同**的 id（因为 `deriveCorrectionId` 是纯函数），所以判据无论有没有变异都是红的" | H1 让 `now` 可注入后，这整段论证的前提（`at` 不可注入）不再成立——判据可以用同一个注入的 `now` 让面板与 CLI 走同一条 `correctionRowFrom`，此时"同一份输入产出同一个 id"重新变得**可判且可被变异反证**。这段注释与它推导出的"落点作废，换判据"的结论都需要重写 |
| L2373-2389 | Task 7 `POST /api/corrections` 实现，自己拼 `row` 字面量（`projectKey, decisionId, kind, chose_instead(透传), because, at: new Date().toISOString(), by`），再传给 `recordNewCorrection` | H1 后应改为调用 `correctionRowFrom(input, now)` 构造 `row`（`now` 来自请求处理时可控的时钟），而不是手拼字面量——这正是 spec §2.3"面板与 CLI 都走同一个构造点"的字面要求，当前写法只共享了 `recordNewCorrection`（校验+落盘那一半），没有共享"从输入到行"这一半 |
| L2432-2434（变异表 C-13） | "C-13｜7｜共用 correction seam｜面板不走 seam，自己拼一份行 ＋ 自己算 id｜🔴 红在 `answers a row the seam would refuse with the seam's OWN named refusal` 且仅它。⚠️ 原落点（比对两个 correction id）已作废" | H1 后"原落点"可以复活：一旦 `correctionRowFrom` 可从 `record.ts` 导入且 `now` 可控，"同一输入产出同一 id"重新是可执行、可被 C-13 变异反证的判据，不必永久降级成"只钉 seam 的具名拒绝" |
| L2748（变异总表复述同一条） | "13｜C-13｜7｜共用 correction seam｜🆕 红在...且仅它。⚠️ **原落点（比对两个 correction id）已作废**——`at` 进 id 派生且不可注入，那条判据无变异时也永远红" | 同上，这一行的"已作废"结论是 H1 之前成立、H1 之后不再成立的时间敏感断言 |
| L2913-2918（处置节"登记而不修"第1条） | "🔴 `at` 不可注入，是一条真缺口，需另拿具名授权。spec §2.3 加粗的判据原文是『面板与 CLI 对同一份输入必须产出同一个 correction id』——今天做不到...要真正满足它，必须把 `at`（以及 `projectKey`）的戳法搬进 seam 一侧并做成可注入——那是改既有生产代码，⚠️ 需人另拿一次具名授权，本轮没有。本轮的替代判据钉的是 seam 专属的拒绝，不是 spec §2.3 的原话。这是一处已知的降级，登记。" | **这正是 H1 已经拿到的那次授权**（"a pre-task now makes `correctionRowFrom`...an export...and `correct(argv, opts: {now?})`"）。这条登记项在 H1 落地后**应被撤销并替换**：Task 7 应当改回钉 spec §2.3 的原话判据（面板与 CLI 对同一输入产出同一 id，用注入的 `now` 让两侧可比），而不是继续停留在"降级、登记、等人拍板"的状态。这是本次扫描里 H1 影响面最大的一处 |
| `src/corrections/record.ts:38-46`（源码 ERRATUM 注释，非计划文本） | 承认"两个 id 字面量不可复现，因为 `at` 不可注入"，把这个当作已知限制记录 | 该注释本身没有被计划引用，但它佐证了"`at` 不可注入"在 H1 之前是源码层面已知且被记录的限制；H1 解决它之后，这条 ERRATUM 的"at 不可注入"部分也可能需要跟进（不在本次扫描任务范围内，仅提示） |

**未核实**：计划里是否还有其它隐藏引用"`at` 不可注入"这个前提的地方（例如变异总表"五条错的红数预言"一节 L2903 的 "C-13｜1 条｜落点作废，换判据"，属于同一条的第三次复述，已计入上表，不再单列）。已用 `grep -n "correctionRowFrom\|at.*not.*inject\|不可注入"` 式检索（人工通读代替，未跑自动 grep 覆盖全文——**声明：本节的定位靠通读 2970 行原文加针对性 grep 交叉验证，没有对"at 不可注入"做全文机器搜索，可能有遗漏**）。

**H2 核实结果**：处置节"登记而不修"第2条（L2919-2922）——"spec §3.1 有一处未登记的错误...它写着『与 `schema.ts` 拒绝为 `wrong`/`stale` 强制 `chose_instead` 同构』，而现测 `schema.ts:70-78` 强制的是 `not_my_taste`"。已对照 spec 原文第145行与 `src/corrections/schema.ts:70-78`（实际读到的是 70-78 行的 `superRefine`，只在 `kind === "not_my_taste"` 时要求 `chose_instead`）：spec 原文逐字是"（与 `schema.ts` **拒绝**为 `wrong`/`stale` **强制** `chose_instead` 同构）"——即 spec 说的是"schema.ts **不**为 wrong/stale 强制 chose_instead"，这与实测的"schema.ts 只为 not_my_taste 强制"完全一致（wrong/stale 确实没被强制）。**计划这条"登记而不修"项把 spec 的"拒绝…强制"（不强制）误读成了"强制"，从而错误地指控 spec 有错。按会话事实 H2，此项应从处置节删除或改写为"无错误，误读已撤销"**，不需要人拍板。

---

## 5. Task 5／Task 8 的三处"留到实施时再定"

以下三处是处置节"登记而不修"里明确写出、要求执行者在实施时二选一/补判据的点，逐条摘录原文（不改写）：

**(1) `as_of` 时钟注入（Task 5）**——L2928-2930：

> "4. **`as_of` 每次请求都是新挂钟值**（二席 Important 12）：Task 5 的 pass-through 深相等**永远红**。
> ⇒ `PanelOptions` 要加可注入的 `now`（`CollectOptions.now` 已有先例，`collect.ts:63`），
> **或**判据把 `as_of`／`as_of_mode` 剔除后再深相等、并单独钉这两个字段的存在。**Task 5 实施时定死一种。**"

（已核实引用的先例存在：`src/metrics/collect.ts:55-60` 的 `CollectOptions extends DiscoverOptions { correctionsDir: string; now?: () => string }`，行号与计划所引的"63"相差几行但字段确实存在，未见于本次读取范围内的精确第 63 行——**未核实精确到行号，只核实了字段存在**。）

**(2) `LIST_FIELDS` 跨 web workspace 不可达（Task 8）**——L2923-2927：

> "3. **`LIST_FIELDS` 前端拿不到**（二席 Important 10）：`web/` 是独立 workspace，
> `web/tsconfig.json` 的 `include` 只覆盖 `web/` 内部、且 `lib` 是 DOM。
> ⇒ **前端必然长出第二份字段清单**，而**没有一条变异能同时够到两边**。
> ⇒ **Task 8 实施时二选一并写明**：给 `web/package.json` 加 workspace 依赖把常量提到双方可 import 处，
> **或**明确登记前端那份是第二定义并给它自己的 golden。"

（已在 §2 Task 8 行确认：Task 8 正文 L2449-2635 完全没有回应这条要求，二选一尚未在正文里体现。）

**(3) `it.skip` 兜底不住（Task 5）**——L2931-2934：

> "5. **`it.skip` 的兜底兜不住**（二席 C-f，现测）：那条 grep **漏掉** `test.skip`／`it.todo`／`describe.todo`／`xit`／`xdescribe`；
> **vitest 对 skipped/todo 退出码是 0**；本仓库 `scripts/`／`package.json` 里**零个** skip 闸门。
> ⇒ **Task 5 要把它做成一档真判据**（`tests/panel/noSkips.test.ts` 读 `tests/panel/*.ts` 全文断言不含那五种写法），
> **人肉清单项不是判据。**"

（已在 §2 Task 3/Task 5 行确认：Task 5 正文 Step 5-6（L1988-1994）仍是原来的 `grep -rn "it.skip\|describe.skip"` 检查，没有改成要求的 `tests/panel/noSkips.test.ts`。）

---

## 结论摘要（供正文引用）

- **pair 行数**：表格形式列出 10 个共享工件的产出/消费关系（§1），其中 **1 处明确不一致**（`recordNewCorrection`/`correctionRowFrom`，即 H1）、**1 处已登记未解决**（`LIST_FIELDS` 跨 workspace 不可达）、**1 处需执行时核对顺序但非缺陷**（`verify` 脚本字符串替换）、**1 处未核实**（`detailUrl` 归属文件）、其余 6 处一致。
- **task 自身一致性行数**：10 个 Task 逐一检查（§2），发现 **6 处🔴真问题**（Task 3 未定义变量、Task 3/5 处置未落地的 `it.skip` 判据、Task 4 变异理由与 fixture 矛盾且处置未落地、Task 5 Files/实现不一致、Task 6 遗漏 Create 文件、Task 7 声明的端点未实现、Task 8 代码用了被自己否定的字段名、Task 8 处置未落地）；其余为已自洽或已被计划自己承认并登记的取舍。
- **代码评审会判缺陷的点**：共 7 条（§3），含一处会导致测试文件无法收集运行的未定义变量（`throwawayStore`）、一处声明产出但从未实现的端点（`POST /api/reviews`）、一处常量重复声明、一处命名与行为不符的"分隔符"、两处变异理由与 fixture 不符（Task 4/8）、一处未声明归属的跨运行时共享函数。

**三个最严重的冲突（各一行）**：

1. **H1 最应更新却未更新**：Task 7（L2373-2389）仍自己拼 correction 行字面量、不经 `correctionRowFrom`，而处置节 L2913-2918 把"spec §2.3 判据做不到"记成需要人另拿授权的缺口——这次授权（H1）已经给了，但计划正文和判据落点都还停在授权前的状态。
2. **声明产出但从未实现**：Task 7 Interfaces 承诺 `POST /api/reviews`（L2269），全文没有一行实现它，"点同意"这条覆盖率承重路径在代码层面不存在。
3. **测试文件装不起来**：`tests/panel/security.test.ts` 用了未声明的 `throwawayStore`（L1114），会在 vitest 收集阶段整文件失败，不是"判据红"而是"判据跑不起来"，比计划反复强调的"空判据"更隐蔽也更严重。
