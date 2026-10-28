# Orca 面板 UI 重做 —— handoff（UI 这一批专用）

> ✅ **第一批（§〇–§五）已由人 merge 进 main（2026-09-27）；结论已并回 `docs/handoff/handoff.md` §三、§四 4.0.a、§6.19、§9.0d —— 以那里为准。**
> ✅ 第二批（§六）已合入 main。
> ✅ 第三批（§七，精修）已由人合入 main 并 push（合并提交主题行 `Merge branch 'ui/panel-taste'`）；稳定结论已并入 `handoff.md` §五 5.2.6、§六 6.7。
> ✅ 第三批第二轮（§七.二）已由人合入 main 并 push（合并提交主题行 `Merge branch 'ui/panel-taste'`，2026-10-14）。
> ✅ 第二轮与 §七.三 已由人视觉验收、合并并 push（会话 `fb98aa31`）。
> ✅ §七.四 已由人复验、合并并 push（之后人删了分支与 worktree）。
> ✅ §七.五（深色框过暗；j/k 是 Vimium 吞键）已由人复验、合并并 push（会话 `9b012714`，2026-10-16 现测：`git merge-base --is-ancestor ui/panel-taste main` RC 0，`origin/main` 与本地 main 一致）。
> ✅ §七.六（组件层重做＋六个候选主题，会话 `e236bbe4`，2026-10-28）已由 agent `--ff-only` 合入 main 并装上；**等人看完全部主题说留哪些**。
> ✅ §七.七（Radix＋Tailwind v4 全量迁移＋主题重做＋测试者 UI 项，会话 `a9f9d6de`，2026-10-28／29）已由 agent `--ff-only` 合入 main 并装上；**等人看**（待人项见该节末）。§七.六 的「等人选主题」被本节的主题重做取代。
> ⚪ **当前没有在飞的 UI 工作、没有待合并的 UI 提交。** 下一轮从 §〇.一 开始。（人要求后续问题继续追加在本文）

> **读者是下一个 agent。** 这一批 UI 改动的交接写在本文，**不写进 `docs/handoff/handoff.md`**；
> 等 UI 基本 ready、由人决定合并时，再把本文的结论并回 `handoff.md`。
> ⚠️ **本文不写任何当前 HEAD 或哈希** —— 提交本文这个动作本身就会移动 HEAD，别的 agent 也在同时推进 `main`。
> 要指代某一笔，引**提交主题行**（`git log --grep` 找得回）；要指代材料，引**路径**。

---

## 〇、先跑这些，以输出为准

```bash
git -C /Users/biran/code/skills/orca/Orca worktree list      # 找当前 UI 分支的 worktree（第三批：ui/panel-taste）
git -C <worktree> log --oneline main..<分支>                  # 这一批的全部提交
git -C <worktree> status --porcelain                          # 期望只有 ?? node_modules 与 ?? web/node_modules（两个软链，永不提交）
```

🔴 **别的 agent 在 `main` 与主工作树 `/Users/biran/code/skills/orca/Orca` 上干活**（仓库 2026-10-13 从 `loop/` 搬到 `orca/`，下文旧批次里的 `loop/` 路径同理替换）。UI 工作一律只在 worktree 的
UI 分支上做；主工作树里不跑 build／测试、不提交、不 checkout。合并、push、删 worktree／分支都归人（CLAUDE.md Rule 15）。

⚠️ 自第三批起 worktree 固定在 `/Users/biran/code/skills/orca/Orca-wt/ui-taste`（分支 `ui/panel-taste`），不在 scratchpad，重启不丢。
（第一、二批的 worktree 在 scratchpad 下，早已不在；旧批次里的 `ui/panel-redesign`／`ui/panel-contrast` 只剩历史意义。）

## 〇.一、下一轮怎么开始（会话 `9b012714` 写，2026-10-16）

1. **先查分支与 worktree 还在不在**（人每轮合并后可能删）：`git -C /Users/biran/code/skills/orca/Orca worktree list`、`git -C /Users/biran/code/skills/orca/Orca branch --list 'ui/*'`。
   - 都不在 ⇒ 从主仓库 `git worktree add ../Orca-wt/ui-taste -b ui/panel-taste main`（只新建，不删任何东西），再软链两个 `node_modules`（指向主工作树的 `node_modules`、`web/node_modules`）。
   - 都在且 `git log main..ui/panel-taste` 为空 ⇒ 在 worktree 里 `git merge --ff-only main` 跟上 main（会话 `9b012714` 做过，闸门未拦）。
2. **改 UI 前读** `web/DESIGN.md`（token、data-tone、只有 `.btn-primary` 填色、分区始终挂载、深色分层往亮里走：页面 `--bg` < 卡片 `--card` < 框 `--well` < 输入框 `--field`；**深色下除页面本身外任何框都不许用 `--bg`** —— 人裁，`contrast.test.ts` 钉着）。
3. **判据纪律**：既有判据不改写（要改先找人逐条授权）；新判据先看到红；变异只在 `git clone --local --branch ui/panel-taste` 副本里做，还原看 `git diff`／`--cached` 字节 0／0。
4. **验证**（在干净 clone 上跑，别和编辑并发）：`npm run typecheck`、`npm run build --workspace web`、`npm run --ws check`，再加根测试 `npx vitest run tests/metrics tests/panel/scanPanelText.test.ts`（带空格的字符串字面量会被当成未翻译文案）。按路径 `git add`；新 DOM 测试文件第一行 `// @vitest-environment jsdom`。看到红先查 `docs/handoff/known-load-flakes.md`。
5. **真浏览器**：改道面板（HOME、四个 XDG 根、`ORCA_CONTROL_DIR`／`ORCA_CORRECTIONS_DIR`／`ORCA_PANEL_DIR` 全指向 scratchpad；`unset ORCA_AGENTS_TABLE ORCA_CCMEM_BIN ORCA_CCLOOP_BIN ORCA_SYNCSKILL_BIN`；数据仓库用主仓库的 `git clone --local`），在 worktree 里
   `./node_modules/.bin/tsx src/cli.ts panel run --by tester --port 7793 --repo orca=<数据 clone> --control-state-dir <控制目录>`。
   首次登录读 `<控制目录>/initial-password`，随后强制改密码。**重新 build 后必须重启面板**（启动时缓存 `web/dist`）。截图前等 ≥6 s。前后 `ls -laR ~/.orca` 比对，真数据不许被写。
6. 🔴 **人说「快捷键没反应」先排除浏览器扩展**：人的 Chrome 装了 Vimium，它吞 j/k 等单字母键；先在无扩展的 headless Chromium 里复现，再考虑改代码（§七.五）。
7. 合并、push、删分支／worktree 归人（Tier 0 闸门会拦 agent），列进 awaitingHuman。

---

## 一、这一批是什么（唯一真相源：下面三份，**别重新推导**）

| 材料 | 路径（worktree 内） |
|---|---|
| spec（人逐段批准，含人裁 U1–U5） | `docs/superpowers/specs/2026-09-27-panel-ui-redesign-design.md` |
| 实施计划（Task 0–6 ＋ Review Focus） | `docs/superpowers/plans/2026-09-27-panel-ui-redesign.md` |
| 执行台账（每个 Task 的现测、全部 `Ruling:`、变异、终审发现） | `.superpowers/sdd/2026-09-27-panel-ui-redesign/progress.md`（目录 gitignore 为 `*`，新增要 `git add -f`） |
| 被推翻的旧规定 | `docs/superpowers/specs/2026-09-09-panel-design.md` 末尾追加的 ERRATUM（§4.2 列表不带 question —— 被人裁 U1 推翻，原文逐字保留） |

**人裁（原话在 spec §1）**：U1 列表显示 question 摘要（人看过「守 spec 只改布局」的推荐后仍选了它）；U2 左侧导航＋分区页、决策区左列表右详情；
U3 主题跟随系统深浅、可手动切；U4 授权改写四条既有判据（名单在计划 Global Constraints）；U5 在 git worktree 里做。

**做出来的东西**（按提交主题行找，别数笔数）：
- `feat(panel): carry each decision's question on list rows (ruling U1)` —— `/api/todo`、`/api/decisions` 每行带 `question`（台账没有／读不了 ⇒ `null`，列表不失败）。
- `feat(web): add the token stylesheet and a per-browser theme preference (ruling U3)`
- `feat(web): add the sidebar shell and hash-addressed sections (ruling U2)`
- `feat(web): split the decisions pane into a filtered list and an explained detail (rulings U1, U2)` —— `PanelHome` 已删，意图由 `DecisionsView` 接。
- `feat(web): assemble the panel inside the shell with every section mounted (ruling U2)`
- `fix(web): keep a spent filter value visible and put radio and checkbox labels back on one row` —— 终审的两条 Important。

🔴 **最承重的一条设计约束**：四个分区**始终挂载**，非当前区只由 `styles.css` 的
`.section-pane:not([data-active="true"]) { display: none }` 隐藏 —— **不许卸载、不许用 `hidden` 属性**。
变异实测：改成「只渲染当前区」⇒ `agentPreviewRefresh` ＋ `controlCommandRecovery` 共 **16 条既有判据红**（它们从默认的 Decisions 区按 role 找 Task control 的按钮）。
⚠️ 反面：**jsdom 不加载 CSS ⇒ 既有判据不验证分区可见性**，可见性由 `web/tests/shell.test.tsx` 钉 `data-active`、`web/tests/styles.test.ts` 钉那条 CSS 规则。

---

## 二、现测结果（只抄工具给出的数；命令与环境见台账 Task 0 / Task 6 行）

- 分支 Task 5 那一笔之上：typecheck RC 0；web build RC 0（`web/dist` 平铺：`index.html`／`index.css`／`index.js`）；`npm run --ws check` RC 0；
  `npm run verify:panel` RC 0（step 0–14 全 PASS，真 `~/.orca` 在它的判据里前后不变）。
- 根 vitest（同一环境）：221 文件／2007 条，2005 过，红 2 条 ＝ `gateCheck K12` ＋ `driverRecovery "drives a retried run…"` —— **都在基线红名单里**。
- 🔴 **基线红名单**（干净基线提交、同一环境，2003 条红 4）：`gateCheck` K12、K13（HOME 改道相关）、`driverRecovery`、`controlShutdown`（已知负载 flake）。
  `driverLanding` 两条也按负载 flake 处理（单跑时红的是另一条、都顶着 5 s）。**看见红先对这张名单，再单文件重跑。**
- 终审修复之后：web 24 文件／131 条全过。
- 真面板目测（数据目录改道）：`/`、`/index.js`、`/index.css` 均 200；`/api/todo` 115 行、全带 question；深浅两套截图在该会话 scratchpad 的 `shots/`（会话级目录，可能已不在）。
  控制台里的 422 是「无执行端口」（旧面板同样），404 是 `favicon.ico`。

**测试环境怎么搭**（worktree 在 scratchpad，旁边没有 ccloop ⇒ 不搭这个，scheduler 一类判据会以 ccloop bin 缺失成片红）：
1. `git clone --local /Users/biran/code/skills/loop/ccloop <scratch>/ccloop-clone`，软链 `node_modules`，`npm run build`；
2. 夹具表：0700 目录里的 0600 `agents.json`，`{"schema":"ccloop-agents-table-v1","installations":{"codex":{"kind":"codex","command":[<node>,"<ccloop-clone>/tests/fixtures/fake-codex.mjs","integration","<dir>/marker.json"],"version":"9.9.9-fake","configDir":null,"timeoutMs":120000,"killGraceMs":5000,"sandbox":"workspace-write","budgetMode":"soft"}}}`（🔴 模式必须是 `integration`）；
3. `export ORCA_CCLOOP_BIN=<ccloop-clone>/dist/cli.js ORCA_AGENTS_TABLE=<表> ECC_GATEGUARD=off DISABLE_OMC=1`，HOME 与四个 XDG 根改道到 scratchpad；
4. worktree／clone 里先 `npm run build --workspace web`（不 build ⇒ `panel-dist-missing` 假红）。
变异一律在 `git clone --local --branch ui/panel-redesign` 的副本里做，worktree 零触碰。

---

## 三、替人做的裁定（全部在台账 `Ruling:` 行，这里只列会影响下一步的）

1. **`question` 两侧必填**（`question: string | null`）。曾因未授权改测试字面量而暂设可选；人在会话 f8281a60 授权后收紧（见第四节）。
   ⚠️ 教训仍有效：共享类型只在一侧放宽会被 `webParity` 的互赋值检查打红 —— 两侧要一起动。
2. **跳过了 `orca level` hook 的 `checkpoint write --repo /Users/biran/code/skills/loop/Orca`**：它会往主工作树提交，而人放开了本会话的上下文限制。本会话因此没有 `.orca/checkpoints` 记录，状态在台账与本文。
3. 分区在 DOM 里的顺序是 chains／tasks／decisions／metrics（与导航顺序不同）；只有一个可见，无可观测影响。
4. 其余组件**一行没改**，样式全靠 `styles.css`；唯一的代码抽取是 `ChainPanel.tsx` 的横幅原样变成导出的 `ChainBanners`，App 在内容区顶部渲染它、给 `ChainPanel` 传 `banners={[]}`。

---

## 四、下一步

### 已由人拍板并落地（会话 f8281a60，详情在台账 `## Follow-up (session f8281a60…)`）
- ready 提示行：写在 **stderr**（`orca-panel: open <url> in a browser …`），stdout 仍只有那一行机读行；判据 `tests/panel/readyHint.test.ts`。🔴 **ready 行本身不能改**：`scripts/verify-panel.ts` 的正则与 `tests/panel/endToEnd.test.ts` 钉着它，`controlShutdown` 按子串等它。提交 `feat(panel): tell the person at the terminal to open the url…`。
- 真 `~/.orca`（`reviews.jsonl` ＋ `control/orca-e0c92460/`，整个目录只有这两样）已由人同意删除 —— 实际是 `mv` 到 `~/.Trash/orca-real-data-2026-09-27`，可恢复。
- 延后 Minor a–d 已修（提交 `fix(web): local list dates, a note on a detail whose row left the list…`）：列表日期改为浏览器本地 `YYYY-MM-DD`（`localDay`）；详情区在其行被筛选挡住／已不在列表时显示 `HIDDEN_BY_FILTER`／`NOT_IN_LIST`；Task control 的组按钮有选中样式；`DecisionDetail.tsx` 追加 ERRATUM。
- 现测（干净 clone，提交 a–d 那一笔，`testenv.sh` 同 §二）：web build／typecheck／`--ws check`（web 24 文件／134 条）／`verify:panel`（step 0–14 PASS）均 RC 0；根 vitest 222 文件／2008 条，红 1 ＝ `controlShutdown` "a real SIGTERM…"（基线红名单内；退出码 143；单文件重跑 3 次 7/7 绿）。真 `~/.orca` 前后都不存在。

- Minor e 已修（人授权改两处测试字面量）：`question` 两侧必填；`projectForList` 改为展开进带类型的字面量（原先 `Record`＋`as` 让编译器看不见漏写）。提交 `fix(panel): make a list row's question required on both sides…`。第三节第 1 条已就地改写。

### awaitingHuman（都归人）
- 🔴 **合并进 `main`（人已定：用 merge；agent 被 Tier 0 闸门拦下，由人在自己终端做，push 也由人）**：
  `cd /Users/biran/code/skills/loop/Orca && git pull --ff-only && git merge --no-ff ui/panel-redesign`。
  会话 f8281a60 的预演（只读 `git merge-tree`，无冲突；把合并树摊进 clone 跑全量）：typecheck／web build／`--ws check`／`verify:panel` RC 0，根 vitest 222 文件／2009 条全过。
  合并后：本文结论并回 `docs/handoff/handoff.md`（在 main 上单独一笔）；worktree 与分支删不删归人。
- **视觉验收**（可在合并前或后）。
- 四条被改写的既有判据**尚未人审**（名单在计划 Global Constraints，每条旁有 `REWRITTEN … U1 … U4 … a50f4d80` 注释）。

## 五、方法论（本批新踩的，下次直接用）

1. 🔴 **在 worktree 里改代码时，别同时在同一树上跑全量** —— 本批第一次基线就因为和编辑并发而作废（`todo (e)` 的红是自己造成的）。基线要在**干净 clone** 上跑。
2. 🔴 **按子串做锚点的替换会误中更深缩进的同形行**（`"      ))}\n"` 是 `"              ))}\n"` 的后缀）。截取代码块用**整行相等**匹配。
3. **「改既有判据」之前先看它在新行为下真的红** —— 本批两条后端判据先跑出红（同文件其余 12 条绿），再改写；这是改写必要性的证据。
4. **类型层面的变化也会波及未授权的测试文件**（字面量、互赋值检查）—— 动共享类型前先 `tsc` 两侧，再决定是改类型还是请人授权改测试。
5. **jsdom 不加载 CSS** —— 任何「只靠 CSS 实现」的行为，都要有一条直接读样式表的判据（`web/tests/styles.test.ts` 的形状）。

---

## Suggested skills

| skill | 什么时候用 |
|---|---|
| `superpowers:verification-before-completion` | 每次要说「绿了／做完了」之前（与 CLAUDE.md Rule 12/14 同形） |
| `superpowers:receiving-code-review` | 人审完回来有意见时；评审员的主张要自己复核 |
| `superpowers:systematic-debugging` | 出现不在基线红名单里的红时，先用它 |
| `superpowers:test-driven-development` | 修延后的 Minor 时：先写会红的判据 |
| `superpowers:finishing-a-development-branch` | 人决定合并时（合并本身人来做） |
| `superpowers:brainstorming` | UI 下一轮有新需求（例如 Chains／Task control 区的交互改造）时 —— 本批只换了样式，没动它们的交互 |

---

## 六、第二批：深色对比度 ＋ kind 重要性（分支 `ui/panel-contrast`，会话 `f8281a60`，2026-09-27）

**worktree**：从 main（主题行 `docs(handoff): fold the panel UI redesign's conclusions into handoff.md…` 那一笔）拉的新分支 `ui/panel-contrast`，目录在会话 `f8281a60` 的 scratchpad 下（`git worktree list` 查；重启会丢目录，提交不会丢）。
**状态自查**：`git log --oneline main..ui/panel-contrast` 非空 ⇒ 还没合；为空 ⇒ 已合，本节只剩历史意义。人要求合并，agent 的 `git merge --no-ff` 被 Tier 0 闸门拦下（不重试）⇒ 由人执行（命令见下）。

**人的输入（视觉验收）**：深色模式对比度差，#decisions 尤甚；参考 `/Users/biran/code/skills/writing/md2publish-skills` 的模板；kind 下拉框按重要性排序并带图标／颜色。

**人裁**：
- 重要性三档（「错了多难挽回」）：🔴 `reconcile`、`abandon` ＞ 🟠 `interface`、`dependency`、`boundary` ＞ 🟡 `criteria`、`scheduling`（档内按此序）。只是 UI 序，`KIND_TIER` 里七个仍全是 high。
- 授权改写 `web/tests/decisionsView.test.tsx` 的 "keeps showing a filter value that no longer matches any row"：只改期望的选项文字（`boundary` → `🟠 boundary`），意图不变。

**做了什么**（按主题行找）：
- `fix(web): step the dark surfaces lighter…` —— 只改深色 token：卡 < 浮层 < hover < 边线逐级往亮里走、选中行底 12%→22%、正文与次要文字各提亮一档。判据 `web/tests/contrast.test.ts` 直接读 `styles.css` 的深色 `:root` token、按 WCAG 公式算比值（jsdom 不渲染样式，只能这样量）。改前实测：边线／卡 **1.08**、卡／底 **1.08**、选中行／卡 **1.21**、次要文字／选中行 **4.29**；正文从来不是瓶颈（9.29）。
- `feat(web): order the kind filter by importance…` —— `web/src/kindRank.ts`（`Record<DecisionKind, …>`，新 kind 不分档即编译失败）；kind 下拉框按档排序、选项文字带 🔴🟠🟡（原生 `<option>` 在 macOS 上不认 CSS 颜色，只能走文字）；列表行 kind 徽章带 `data-level`，CSS `::before` 画同色圆点（`--kind-1..3`，深浅各一套）。scope／repo 两个下拉框不变。
- `fix(web): give the primary button a dark label…` —— 第一次修完截图才看到：深色下 Agree 是白字叠浅蓝 **2.54:1**。加 `--on-accent`（深色 `#0b1220`、浅色 `#ffffff`），判据加一条。
- 🔴 **这些深色值被 `contrast.test.ts` 钉着，别往暗里调** —— md2publish `docs/theme-design-lessons.md` 规则 7／10 的原话：「暗色主题上，分层靠往亮里走，往暗里走会一起糊进背景；文字对比度不是这里的瓶颈，量错了对象就会连修两轮」。借的是这条方法与 midnight-study「面板比底亮一档、边线再亮一档」的结构，**没抄它的色值**（它自己卡／底 1.10、边线／卡 1.34，低于本判据门槛）。

**现测**（干净 clone，分支尖端＝主题行 `fix(web): give the primary button a dark label…`，env 同 §二）：web build／typecheck／`--ws check`（web 26 文件／142 条）／`verify:panel`（15 PASS）RC 0；根 vitest 222 文件／2009 条，红 2 ＝ `driverRecovery` "drives a retried run…"（5 s 超时）＋ `controlShutdown` SIGTERM（143），都在已登记 flake 名单；`uptime` load 5.8 时两文件单跑 3 次 14/14 绿。
- 变异（新 clone，`web` 全套）：Mc1–Mc4 把 border／accent-subtle／card／muted 改回旧值 → 对比度判据各红；Mk1 改 reconcile 的序、Mk2 去掉标记、Mk3 去掉 `data-level`、Mk4 删 level 2 的 CSS、Mk5 不传 `order`、Mk6 把 boundary 降档 → 各自判据红。clone diff 0 字节。`on-accent` 那条先以 `#ffffff` 实测红在 2.54，再改值。
- 真面板目测（`--port 7789`，`ORCA_CORRECTIONS_DIR`／`ORCA_CONTROL_DIR` 改道到 scratchpad）：深浅两套截图在会话 scratchpad 的 `shots/`；kind 选项实际顺序与色点在两套主题下都对；无 pageerror。

**⚠️ 发现（非本分支造成）**：真 `~/.orca` 又出现了（`reviews.jsonl` 840B ＋ `control/`）—— 人删除之后，端口 7777 上人自己起的面板在视觉验收时写的（多半还是 `ORCA_*` 变量没 `export`）。人的数据，未动（Rule 17）；本分支的目测面板前后没改它（`ls -la` 前后相同）。

**awaitingHuman**：
- 对第二批做视觉验收（要看新样式，需要重新 `npm run build --workspace web` 再起面板）。
- 🔴 合并 `ui/panel-contrast` 进 main、push —— 人做：`cd /Users/biran/code/skills/loop/Orca && git pull --ff-only && git merge --no-ff ui/panel-contrast && git push`。
  main 在分支之后被别的 agent 推进过（只动 `docs/handoff/handoff.md`），`--ff-only` 不成；只读 `git merge-tree --write-tree main ui/panel-contrast` 无冲突，合并结果的代码与上面全量验过的树相同。另一个 agent 在等这次合并。
- 真 `~/.orca` 新写入的数据留不留。
- 未钉住的一处：`contrast.test.ts` 只量深色块；浅色的 `--on-accent`（白字叠 `#2563eb`，约 5.17）没有判据。


---

## 七、第三批：impeccable 评审后的精修（分支 `ui/panel-taste`，会话 `62660548`，2026-10-13/14）

**worktree**：`/Users/biran/code/skills/orca/Orca-wt/ui-taste`（不在 scratchpad，重启不丢），从 main 主题行 `feat(web): give the panel the DoWhiz favicon` 那一笔拉出。
**状态**：第三批已合入 main；这个分支此后的提交属于第二轮，状态自查见 §七.二。合并、push、删 worktree／分支归人（Rule 15）。

**唯一真相源（别重新推导）**
| 材料 | 路径（worktree 内） |
|---|---|
| spec（§7 = 独立审查后的修订，覆盖前文） | `docs/superpowers/specs/2026-10-14-panel-taste-refinement-design.md` |
| 计划（Task 1–9，含 Global Constraints／Review Focus） | `docs/superpowers/plans/2026-10-14-panel-taste-refinement.md` |
| 执行台账（每个任务的审查、修复轮、全部 `Ruling:`、deferred minor） | `.superpowers/sdd/2026-10-14-panel-taste-refinement/progress.md`（`git add -f`） |
| 终审报告（含 20 条 deferred minor 的分拣表） | 同目录 `final-review.md` |
| `web/DESIGN.md` | 主题 token、语气（data-tone）、字号、主按钮、布局规则 —— 以后改 UI 先读它 |

**人裁（会话 62660548）**：四条 P1 + P2 全做、P3 不做；浅色暖中性；深色**不许暖**（agent 建议中性石墨，人未否）；服务端不动；评审／实施用 impeccable（主）＋ taste-skill 的 redesign/minimalist（辅）。

**做了什么**（按主题行找，`git log main..ui/panel-taste`）：
- token：浅色暖纸、深色中性石墨、浅色 accent `#1d4ed8`；`web/tests/lightTheme.test.ts` 新钉浅色对比度与两个浅色块逐字相同。
- 语气：`role=status/note` 默认中性，**无 `data-tone` 的 `role=alert` 仍红**；颜色只由 `data-tone="info|ok|warn|danger"` 给；「未配置执行端口」改 `note`＋warn。
- 外壳：≤760px 宽或 ≤560px 高整页滚动；导航单行横滚（`minmax(0,1fr)` 防撑宽）；页脚隐藏、项目说明保留；通知暖色＋「全部知道了」；跳到正文（按钮，不碰 hash 路由）；`pointer: coarse` 44px。
- 审阅：同意成功且行离开列表后自动跳下一条；j/k/a/c（只在 Decisions、焦点在 body 或 Decisions 区内、非输入框、非按住、无在途、已记录的同意不再发）；「本次已审 n」。
- Overview：决策最多 3 条＋「查看全部 n 条决策」；去掉卡套卡与整列 `aria-live`。
- Metrics：三张比率卡片、说明常显（依既有契约不折叠）、数据健康一行、用量表横滚；**只改了 zh 说明**。
- 模板：字号 14/18/22；只有 `.btn-primary` 填色（各视图主操作显式标）；永不可用的项目按钮隐藏；中文角色名 所有者/成员、Chains 统一叫「链」、缺 ccmem 不再回显英文原句。

**现测**（干净 clone，分支尖端＝主题行 `fix(web): final verification — …`；命令与日志在台账 Task 9 段）：typecheck／web build／`--ws check`（web 123 文件／1050 条）／`verify:panel` RC 0；根 vitest 的红全部是负载超时（单跑全绿：gateCheck、driverRecovery、**driverRequirementSplit、retryTask、settleUnknownUsage —— 后三个不在旧基线 flake 名单，补登**）＋ `taskResultPaired`（**在 main 基线 cfb7728 上同样红**：硬编码 ccloop 路径，环境性、既有）。impeccable 检测器 `[]`；真浏览器 390／320px 无横向溢出（20/20）；真 `~/.orca` 前后不变。
- 方法：每任务 TDD＋变异（clone 内，0 字节还原）＋独立任务审查；全分支终审（opus）＋一次集中修复＋验证后修复，各带范围复审。

**⚠️ 本批踩到的（下次直接用）**
1. 🔴 **en 的 metrics 说明与服务端句子逐字一致**，被根测试 `tests/metrics/noteCodes.test.ts` 钉着 —— 只跑 `--ws check` 看不见它；改 web 文案后要跑根测试。
2. 🔴 **根测试 `scanPanelText` 会把 web 源码里带空格的字符串字面量当作未翻译文案**（如后代选择器）—— 同样只在根套件里出现。
3. 🔴 **worktree 里软链的 `node_modules` 会被 `git add` 扫进去**（`node_modules/` 带斜杠不匹配软链）；已在根 `.gitignore` 加 `/node_modules`、`/web/node_modules`。一律按路径 stage。
4. jsdom 不实现 `isContentEditable`、不把 `contentEditable=` 反射成属性；新测试文件要 `// @vitest-environment jsdom`（web 默认 node）；locale 是具名导出。
5. 子 agent 在本机删 clone（`rm -rf`）会被闸门拦 —— 留下的干净 clone 由人删（删除命令已给人）。

**第三批原 awaitingHuman 的去向（人在会话 `1f3cceb2` 答复）**：合并＋push 已由人完成（合并时 `UsageSettlement.tsx` 冲突两边都留；main 新文案 zh `owner 不计量放行` 与 `zhTerms` 冲突，人选改成 `所有者不计量放行` 并授权改写 `settleUnknownUsage.test.tsx` 两处字面量）；三条判据改写已授权并在第二轮做完；「撤销同意」人说暂不做；终审 minor 人选了 A 组 9 条进第二轮，B 组 11 条留在 `final-review.md` 不做。

---

## 七.二、第三批第二轮（分支 `ui/panel-taste`，会话 `1f3cceb2`，2026-10-14）

**状态**：已由人合入 main 并 push（会话 `fb98aa31` 现测：`git log main..ui/panel-taste` 为空，分支尖端 `docs(handoff): cite the round-2 measurements…` 是 main 的祖先）。此后本分支的提交属于第二轮之后的跟进。

**唯一真相源**
| 材料 | 路径（worktree 内） |
|---|---|
| spec（§6＝独立审查后的修订、§7＝真浏览器里发现的 H1-b，均覆盖前文） | `docs/superpowers/specs/2026-10-14-panel-taste-round2-design.md` |
| 计划（Task 1–12，Task 9 撤回） | `docs/superpowers/plans/2026-10-14-panel-taste-round2.md` |
| 台账（每个任务的审查、全部 `Ruling:`、deferred minor、终审分拣、验证日志位置） | `.superpowers/sdd/2026-10-14-panel-taste-round2/progress.md` |

**做了什么**（按主题行找，`git log main..ui/panel-taste`）：
- 「无执行端口」不再点亮任务控制的红点（`controlAlert` 去掉该条件；无端口面板 agents 读的 422 `control-port-unconfigured` 不再记成面板 refusal，代理选择区仍显示原因）。
- 英文 metrics 两句说明去掉 spec 引用：服务端 `src/metrics/compute.ts`、web `en.ts`、金样 `tests/fixtures/metrics/golden.json` 一起改（CLI 的 JSON 与纯文本输出措辞随之变）。
- 「数据健康」行：标题下只写数字（删了三个 `*Count` key）。
- Overview「查看全部 n 条决策」点击时把 Decisions 重置为未审、无筛选、无选中。
- 依赖图类别色 `--cat-idle`／`--cat-done` 改从各自块的 `--muted`／`--accent` 取底色。
- 「全部知道了」：运行中禁用全部知道按钮、成功清掉旧 refusal、网络失败显示 refusal 并恢复按钮。
- 触屏：复选框／单选保持原生尺寸、快捷键提示隐藏（第二个 `@media (pointer: coarse)` 块，第一个块逐字未动）；`DESIGN.md` 加了触屏一行。
- 两列的用量组表不再在手机上被撑宽横滚（`table-narrow`）。
- 新判据：各提示位置的 `data-tone`（`web/tests/toneSites.test.tsx`）、非 ccmem-missing 的记忆不可用码显示完整 Refusal。
- 被改写的既有判据（每行带 `REWRITTEN (human authorisation, session 1f3cceb2)`）：`shell.test.tsx` 三处（当前第 21、25、33 行的注释）、`metricsNotes.test.tsx` 57–59、`noteCodes.test.ts` 只加一条；`golden.json` 四处句子（agent 裁定 R-a，见下）。

**现测**（干净 clone；命令与日志见台账 `Task 11` 段）：typecheck／web build／`--ws check`（124 文件／1073 条）／`verify:panel` RC 0（观测提交：主题行 `test(web): pin each notice site's tone and the generic memory refusal`；Task 12 那笔：`agentPreviewRefresh` 14/14（台账目录 `logs/task-12-green5.log`），其 `--ws check` 2 条红为负载超时（`logs/task-12-check3.log`），两文件单跑 15/15（`logs/task-12-rerun.log`））。根 vitest 28 红＝18 条 5 s 超时（5 个文件单跑各 3/3 绿，`integrationKeep` 新登记进 `known-load-flakes.md`）＋ `taskResultPaired` ×2（基线）＋ `ompSkillsE2E`（分支与 main 基线都红，真 ccloop 环境性）。真浏览器（改道面板、无端口、深浅＋390px 触屏，18 次加载无 pageerror、`scrollWidth − clientWidth` 均为 0（会话 `1f3cceb2` scratchpad `shots/round2/measure.json`，由 `shots.py` 产出，观测于 Task 10 那笔；Task 12 那笔重拍同样为空））：加载 6 s 后红点灭、无告警；触屏下按钮 44px、提示隐藏。真 `~/.orca` 前后不变。
- 方法：spec 独立审查（0 Critical／4 Important，全部采纳）→ 计划 → 每任务实施子代理＋独立任务审查＋clone 内变异（字节 0/0 还原）→ 全分支 opus 终审（代码可合；3 条文档 Important 已修）。

**⚠️ 本轮踩到的**
1. 🔴 **`scanPanelText` 是根测试 `tests/panel/scanPanelText.test.ts`**，不在 web 套件里（本轮一度误记成 `web/tests/i18nPseudo.test.tsx`，已更正）。
2. 🔴 **orca gate 连 clone 里的 `git merge` 也拦**（按分支名 main 判）⇒ 预演合并用只读 `git merge-tree --write-tree` 摊进 clone 跑。
3. 截图前要等页面稳定 ≥ 6 s：加载头几秒「server reset required」「projection refetch required」会点亮红点，1.2 s 就截图会误判。
4. 新面板首次登录强制改密码（`POST /api/auth/password`，带 `x-orca-csrf`）；复制别处的控制目录会 `control-host-mismatch`，要新建。
5. `cp` 在本机是 `cp -i` 别名：覆盖文件用 `/bin/cp -f`，否则静默不覆盖（本轮合并时差点把冲突标记 stage 进去）。

**awaitingHuman**
- 🔴 视觉验收第二轮（合并与 push 人已做完；稳定结论已在 Task 11 并入 `handoff.md` 5.2.6 与已知缺口）。
- agent 裁定 R-a（金样随 H2 改）与 A7 取消（需求页不加第二个主按钮）：人在会话 `fb98aa31` 追认。
- 登记项的去向见 §七.三。
- 本会话留下的 clone（都是干净副本，删除归人）：会话 `1f3cceb2` 的 scratchpad 下 `final/`、`base/`、`mut-t1`、`mut-t1b`、`mut-t2`、`mut-t3`、`mut-t4`、`mut-t5`、`mut-t6`、`mut-t7`、`mut-t10`、`mut-t12`。
- Rule 6：主控会话上下文超过 T1（orca level hook 报 420,331／T1 330,000，会话后段），人已说本会话不考虑上下文；已记台账。

---

## 七.三、第二轮之后的跟进（分支 `ui/panel-taste`，会话 `fb98aa31`，2026-10-14）

**人裁**：R-a、A7 取消均追认；B1、B3 授权按 agent 建议做；B2（加载头 3–5 s 的红色「server reset required」）**不改**，保留规格行为。

**做了什么**（按主题行找，`git log main..ui/panel-taste`）：
- `fix(web): stop a projection refetch from lighting the red tasks dot` —— `refetchRequired` 移出 `ControlAlertInput`（同 I2 的做法）。改写 `web/tests/shell.test.tsx`：`quiet` 去掉该键、refetch 那行改期望 `false`（类型断言传入以示被忽略）、describe 标题 five → four，每处带 `REWRITTEN (human authorisation, session fb98aa31)`。
- `fix(web): make a single notice Dismiss fail loudly and exclude Dismiss all` —— `dismiss()` 与 `dismissAll` 同用 `dismissing` 守卫＋try/catch/finally；`web/tests/authGate.test.tsx` 只新增两条。
- `handoff.md` 5.2.6 的红点例外只剩 B2；已知缺口删掉单条 Dismiss 那条。

**现测**（`git clone --local --branch ui/panel-taste` 的干净副本，尖端＝主题行 `fix(web): make a single notice Dismiss fail…`，load 8.06）：先红后绿各见过（shell 第 41 行；authGate 新两条）。变异 M1（恢复改前 `Shell.tsx`／`App.tsx`）→ `shell.test.tsx:41` 红；M2（`dismiss()` 不置守卫）→ `authGate.test.tsx:402` 红；M3（去掉 catch）→ `authGate.test.tsx:382` 红；还原后 `git diff`／`--cached` 0／0 字节。typecheck／web build／`--ws check`（124 文件／1076 条全过）／根 `tests/metrics` ＋ `tests/panel/scanPanelText.test.ts`（68 条全过）均 RC 0。日志在会话 `fb98aa31` scratchpad 的 `vlogs/`、`m1-3.log`。未跑 `verify:panel` 与根全量（只动了 web）。

**awaitingHuman**
- 🔴 视觉验收（第二轮＋本节两处）；然后人合并本分支进 main 并 push（Tier 0）。`handoff.md` 的两处改动与 main 上同段上下文逐行相同（会话 `fb98aa31` 比对），预期无冲突。
- 本会话的变异 clone：会话 `fb98aa31` scratchpad 下 `mut/`（干净，删除归人）。

---

## 七.四、视觉验收的两处问题（分支 `ui/panel-taste`，会话 `fb98aa31`，2026-10-14）

⚠️ 人合并 §七.三 后删了旧分支与 worktree；本节的分支是从 main（主题行 `Merge branch 'ui/panel-taste'`，含 §七.三）**重建的同名分支**，worktree 仍在 `/Users/biran/code/skills/orca/Orca-wt/ui-taste`。

**人的输入**：深色模式下输入框太深；Decisions 页的 `j / k / a / c` 不生效；其他暂未见明显问题。

**根因与修法**（按主题行找，`git log main..ui/panel-taste`）：
- 输入框：`input, select, textarea` 的底色是 `--bg`（最暗的页面层），比所在卡片还暗。新增 `--field`：深色 = `--bg-elevated`，两个浅色块 = `--bg`（浅色不变）。`fix(web): lift dark form fields above the card they sit on`；`DESIGN.md` 加一行。
- 快捷键：真浏览器复现 —— 点侧边栏「Decisions」后焦点留在该导航链接上，既非 body 也不在 Decisions 区内，被 M6 守卫（`App.tsx` 的 review-key effect）整体丢弃；blur 到 body 后 `j` 正常。修法：只多放行 Decisions 自己的导航链接，其他导航链接仍忽略。`fix(web): honour j/k/a/c while focus is on the Decisions nav link` ＋ `fix(web): split the review-key focus check so scanPanelText sees no prose`（复合选择器里的空格被根测试 `scanPanelText` 当成未翻译文案 —— §七「踩到的」第 2 条的同一个坑）。
- 未验证的另一可能：中文输入法开着时按键 `key` 为 `Process`，快捷键同样不响应。本次没改；人复验时若仍不生效，先切到英文输入。

**现测**（干净 clone，尖端＝主题行 `fix(web): split the review-key focus check…`，load 25.6）：新判据先红后绿（contrast、lightTheme、reviewApp 各自新增，均为新增、未改写既有判据）。变异 MF1（深色 `--field` 改回 `--bg`）→ `contrast.test.ts:84` 红；MF2（输入规则改回 `var(--bg)`）→ `:80` 红；MF3（浅色 `--field` 改 elevated）→ `lightTheme.test.ts:43,98` 红；MK1（去掉导航链接放行）→ `reviewApp.test.tsx:257` 红；MK2（放宽到任意 `.nav-item`）→ `:267` 红；还原 0／0 字节。typecheck／web build／`--ws check`（124 文件／1082 条）／根 `tests/metrics` ＋ `scanPanelText`（68 条）RC 0。日志：会话 `fb98aa31` scratchpad `vlogs3/`。
真浏览器（改道面板、无端口、数据为 main 的 clone，`keys.py`）：点导航后焦点在 `A.nav-item`，按 `j` 打开第一行；深色下筛选框底色 rgb(31,33,37) 叠在 rgb(14,15,17) 上，浅色仍为 rgb(246,244,239)；无 pageerror。

**⚠️ 踩到的**：面板在启动时缓存 `web/dist`，重新 build 后**必须重启面板**才会发新 bundle（实测：发出的 `index.js` 比磁盘少 30 字节、不含新选择器，重启后一致）。

**awaitingHuman**
- 🔴 复验这两处，然后合并本分支进 main 并 push（Tier 0，人做）。
- 本会话的 clone 与改道环境（干净副本，删除归人）：会话 `fb98aa31` scratchpad 下 `mut2/`、`mut3/`、`data/`、`v2/`、`viz-env/`。

---

## 七.五、复验：深色下的框太暗；j/k 只滚动（分支 `ui/panel-taste`，会话 `9b012714`，2026-10-15）

⚠️ 人合并 §七.四 后又删了分支与 worktree；本节分支从 main（主题行 `Merge branch 'ui/panel-taste'`）**重建的同名分支**，worktree 仍在 `/Users/biran/code/skills/orca/Orca-wt/ui-taste`。

**人的输入**：深色 metrics 的 Correction rate 框、Project 框、`Agent defaults have not been read.` 提示框等太暗；j/k 只让 Decisions 列表的滚动条动，期望选中的条目跟着切换。
**人裁**：深色模式下**不许有任何框用页面底色**（`--bg` 只给页面本身）。

**根因与修法**（`fix(web): lift dark inset boxes off the page colour onto a --well step`）：
- 5 处框（`.project-control`、`.section-pane section section`、通知框共用规则、`.detail-block`、`.metric-tile`）底色是 `--bg`，比所在卡片还暗。新增 `--well`：深色 `#212327`，两个浅色块 `var(--bg)`（浅色外观不变）。
- 深色 `--field` 随之从 `--bg-elevated` 上调为 `--bg-hover`，保持 卡片 < 框 < 输入框。`DESIGN.md` 的输入框那行改写为两者合一的一行。
- 新判据（只新增，未改写既有判据）：`contrast.test.ts` 新增一条 —— 5 个选择器必须是 `var(--well)`、整份样式表里**只有 `body`** 的底色是 `var(--bg)`、well 比卡片亮且 ≥1.05、边线/well ≥1.4、field 比 well 亮、正文 ≥7、次要 ≥4.5；`lightTheme.test.ts` 新增「两个浅色块 `--well` = `var(--bg)`」。

**j/k：代码没问题，不改** —— 真浏览器（无扩展的 headless Chromium）里点导航后按 j、点行后按 j j j k，选中行序号 0→1、0→1→2→3→2，焦点分别在 `A.nav-item`／`BUTTON.decision-row`。本机 Chrome Default 配置装了 **Vimium**（扩展 id `dbepggeogbaibhgnhhndojpepiihcmeb`），它默认把 j/k 绑成滚动并吞掉按键 —— 与「只动滚动条」吻合。**未在人的 Chrome 里直接验证**；人复验时在 Vimium 里把面板地址加入排除（或临时停用）再试。

**现测**（干净 clone `git clone --local --branch ui/panel-taste`，尖端＝上面那笔，load 22.19）：新判据先红（2 条红、既有 12 条绿）后绿。变异 W1–W5（5 处逐一改回 `var(--bg)`）→ `contrast.test.ts:100` 红；W6（深色 well = `#0e0f11`）→ `:110`；W7（field 改回 elevated）→ `:113`；W8（浅色 well = elevated）→ `lightTheme.test.ts:43` 与新条红；W9（新增一条 `var(--bg)` 规则）→ `contrast.test.ts:103`。还原 `git diff`／`--cached` 0／0 字节。typecheck／web build／`--ws check`（127 文件／1103 条）／根 `tests/metrics` ＋ `scanPanelText`（10 文件／68 条）RC 0。日志：会话 `9b012714` scratchpad `vlogs/`、`mut.log`。
真浏览器（改道面板 `viz2.sh`、无端口、数据为 main 的 clone，`probe.py` → `probe-out.json`）：深色下可见元素里只有 `body` 是 rgb(14,15,17)；metric tile／project／detail-block／通知框 rgb(33,35,39)，卡片 rgb(27,28,31)，输入框 rgb(40,42,47)；浅色框与输入框仍为 rgb(246,244,239)；无 pageerror。真 `~/.orca` 前后不变。

**awaitingHuman**
- ✅ 人已复验（会话 `9b012714`）：深色框「没问题了」；把面板地址加入 Vimium 排除列表后 j/k 正常 —— Vimium 吞键得到确认。
- ✅ 人已合并进 main 并 push，并删了本会话的 clone 与改道环境。分支 `ui/panel-taste` 与 worktree 人保留着；之后已在 worktree 里 `--ff-only` 跟上 main，再提交本次 handoff 更新。

## 七.六、组件层重做＋六个候选主题（会话 `e236bbe4`，2026-10-28；已合入 main 并装上）

**人裁**：「我相信你的判断，风格要统一。你直接按你的判断改。改完之后我统一看。」；「可以多加几个主题让我可选（主题下拉框中可以选，默认随浏览器切换的还是默认 light 和 dark主题），新的主题中动基调」。参考：`/Users/biran/code/skills/UI/library/{primer-css,radix-ui-themes,shadcn-ui-ui,ant-design,mantine,spectrum-css,carbon}`（只读）、impeccable（主）、taste-skill（辅）。台账 `.superpowers/sdd/2026-10-28-session-e236bbe4/progress.md`。

**做了什么**（按主题行找）：
- `feat(web): redo the panel's component layer on one scale`：刻度 token（间距 4/8/12/16/24、圆角 4/6/10、控件高 32／小 26、120 ms 过渡，`prefers-reduced-motion` 关掉）；按钮四态＋焦点环＋`aria-busy`，`.btn-quiet`（charge-retry 的取消），`.btn-danger` 已定义**未接**；表单控件统一（复选／单选保留原生 16px＋accent，强制颜色模式可用）；三处 tab 同一组件；无 tone 的 badge 改中性；表格表头强线、行 hover；内联确认框是 well＋实边，`ChargeRetry` 用 `.confirm-inline data-tone="warn"`；原生 `<dialog>`／菜单浮在 `--shadow-pop` 上；滚动条、选区、光标随主题。390px：组详情工作项表在自己的框里横滚（改前整页溢出 392px），带表头的表最小 40rem（用了 `:has()`）。
- `feat(web): add six selectable candidate themes`：`frost`、`contrast`、`navy`、`ember`、`dusk`、`terminal`。每个主题一个 `:root[data-theme="<id>"]` 块，放在 system-light 块**之后**（钉住的主题压过浏览器偏好），定义浅色块的全部 token 并设 `color-scheme`；`THEME_PREFS` 与 en／zh 名字。`web/tests/themes.test.ts` 对每个主题（含默认两套）循环钉：正文 ≥7、次要文字 ≥4.5（七种表面）、链接、主按钮静止与 hover、焦点环 ≥3、各 tone 与 tone 底上的强文字 ≥4.5、类目色、侧栏计数徽标、层级方向；`contrast` 全 ≥7。默认两套的 `contrast.test.ts`／`lightTheme.test.ts` 阈值没动。
- `feat(web): title the board card's open control with where it leads (tester #49)`。
- 控制器补的两笔：`fix(web): lift an open task's detail as a card instead of an accent side stripe (tester #21)`（impeccable 检测器 `skill/scripts/impeccable detect --json web/src` 唯一一条 `side-tab`；改后 `[]`）；`fix(web): a button after an inline link keeps the 8px gap (group header)`。

**现测**：截图 `/private/tmp/orca-e236bbe4/ui/shots/{before,after}/`（改前 68、改后 116；量值 `measure-*.json`；改后 390px 横向溢出全 0、无 pageerror）；隔离面板脚本 `/private/tmp/orca-e236bbe4/ui/scripts/panel.sh`（端口 7795、HOME 与 `ORCA_*` 改道、fake claude／codex）。门见台账。

**待人**：逐个看主题说留哪些（之后删掉不要的主题块、`THEME_PREFS` 项、locale 名字，并改 `themes.test.ts` 的主题清单与 `i18nPseudo.test.tsx` 的枚举计数）。

**残余**：`requirement-next`（`<p data-tone>`）无内边距／圆角；通知条在每个主题都是 `--warn-subtle`（按设计）；`.btn-danger` 未用；没有逐页读 `/UI/library` 源码（刻度取 Radix／Primer 一类的常见值）。


## 七.七、Radix＋Tailwind v4 全量迁移、主题重做、测试者 UI 项（会话 `a9f9d6de`，2026-10-28／29；已合入 main 并装上）

**人裁**（原话在 `.superpowers/sdd/2026-10-28-tester-feedback-round/progress.md`）：先 Radix 再 Tailwind v4 全量迁移，控制器设置页打样、sonnet 子代理分批、控制器逐批复核；字体打包 Inter＋JetBrains Mono；主题新增 4–6 个并同时拉开配色／字体／圆角／密度；「这次批准改写所有必要的判据」。规约 `web/TAILWIND-MIGRATION.md`（§7 末有「done」注）、外观 `web/DESIGN.md`。

**现在的样子**（按主题行找；台账同一节有每批的门、变异、截图路径）：
- 栈：Tailwind v4.3.3 经 `@tailwindcss/vite`；`@layer theme, base, utilities`，preflight 开（`tailwindcss/preflight.css` 与 `styles.css` 都在 `base`，样式表用 `revert` 还原外观依赖的浏览器默认）；颜色／间距／圆角工具类全部读 CSS 变量（`@theme inline`，默认调色板清空），主题块仍是唯一来源；共享类（`badge`、`pill`、`callout`、`detail-block`、`btn-primary`、`btn-quiet`、`led`、`num` 等）是 `index.css` 的 `@utility`；组件的类串在 `web/src/ui/classes.ts`（`scanPanelText` 把组件里的多词字面量当待译文本，所以集中放）；Radix dropdown-menu／dialog 在 `web/src/ui/{Menu,Dialog}.tsx`；**原生 `<select>` 保留**（未换 Radix Select，理由在迁移规约 §3）。
- 自定义变体 `narrow`（窄或矮屏）必须用**块形式**：简写 `@custom-variant narrow (@media a, b);` 会把逗号后半段编成坏选择器（构建 12 条警告、矮宽屏保持桌面布局）。判据 `web/tests/tailwind.test.ts` 真编译一次。
- 测试者项：#79 侧栏「更多」收起 Chains／Memory／Metrics；#74 转录跟随最新（不在底部时出「Follow latest」）；#73/#90 看板卡片 done/total 与相对时间（`title` 是绝对时间）；#76 需求流程阶段指示与「Next」条；#83/#86 文档标题层级（标题 h4 > 小节 h5）；#106 需求页按钮布局（列表的「更多操作」不再压字）；#107 退回原因在面板显示人话说明；#54 拖拽时可放的列虚线强调边（旧规则从没画出来过，被 `.section-pane section[aria-label]` 压住）。
- 主题（`web/src/theme.ts` `THEME_PREFS`；`system`／`light`／`dark` 三块逐字节未动）：新 `rose`、`ink`、`violet`、`lagoon`（仿 Hermes Teal）；重做 `frost`、`navy`、`ember`、`terminal`（全等宽）；`contrast`、`dusk` 保留配色。每个候选同时设字体（打包的 Inter／JetBrains Mono 或系统栈）、三档圆角、密度（`--space-1..5` 整套按 1-2-3-4-6 比例＋控件高 28–36）。没删任何 id（存过的选择不会退回 `system`）。
- 门：最终提交 `npm test` 865 文件（682 根、183 web），web 全绿，根 1 红 `startForm`（已登记，单跑 9/9）；37 个跳过（同样 10 个文件）。构建 0 条 CSS 警告；impeccable 检测器只剩 `fonts.css` 两条 Inter `overused-font`（人裁用 Inter，保留）。截图：`/private/tmp/orca-a9f9d6de/ui/final/shots-after2/`（light／dark／navy／frost／terminal × 390／1280 × 15 视图；390px 横向溢出全 0）；13 个主题 × 4 页的截图在 `/private/tmp/orca-a9f9d6de/ui/themes/shots1/`。

**待人看／待人定**：
1. 真浏览器里逐页、逐主题看一遍；留哪些主题（不要的：删主题块、`THEME_PREFS` 项、locale 名字，并改 `themes.test.ts` 清单与 `i18nPseudo.test.tsx` 的枚举计数）。
2. 控制器／子代理替人定的、可逆的：原生 select 不换 Radix Select；不确定操作框与降级判定 pill 改用 `data-tone="warn"`（边框 warn 混色 55%/34% → 45%）；terminal 主题的 Decisions／Corrections tab 矮 4px（随该主题密度，与设置页 tab 一致）；`.btn`／`.btn-danger` 删除（无人用）；主题块没拆到 `src/themes.css`（可选步，未做）。
3. 口味：`lagoon` 的选中行（琥珀叠青）偏橄榄色，过了选区对比度 ≥1.4。

**残余**：遗留的 px 字面量（`px-[10px]` 一类）不随主题密度变；组详情的 region tab 在种子世界里截不到图（与纠正页 tab 同一串类，那边 0 diff）；`GroupList.tsx` 与 `src/relativeTime.ts` 各有一份「N 分钟前」措辞。
