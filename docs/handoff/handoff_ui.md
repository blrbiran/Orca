# Orca 面板 UI 重做 —— handoff（UI 这一批专用）

> **读者是下一个 agent。** 这一批 UI 改动的交接写在本文，**不写进 `docs/handoff/handoff.md`**；
> 等 UI 基本 ready、由人决定合并时，再把本文的结论并回 `handoff.md`。
> ⚠️ **本文不写任何当前 HEAD 或哈希** —— 提交本文这个动作本身就会移动 HEAD，别的 agent 也在同时推进 `main`。
> 要指代某一笔，引**提交主题行**（`git log --grep` 找得回）；要指代材料，引**路径**。

---

## 〇、先跑这些，以输出为准

```bash
git -C /Users/biran/code/skills/loop/Orca worktree list      # 找 ui/panel-redesign 的 worktree 在哪
git -C <worktree> log --oneline main..ui/panel-redesign       # 这一批的全部提交
git -C <worktree> status --porcelain                          # 期望只有 ?? node_modules 与 ?? web/node_modules（两个软链，永不提交）
```

🔴 **别的 agent 在 `main` 与主工作树 `/Users/biran/code/skills/loop/Orca` 上干活。** 本批一律只在 worktree 的
`ui/panel-redesign` 分支上做；主工作树里不跑 build／测试、不提交、不 checkout。合并、push、删 worktree／分支都归人（CLAUDE.md Rule 15）。

⚠️ worktree 目录建在会话 scratchpad（`/private/tmp/...`）下，**重启会丢目录，提交不会丢**（在主仓库的对象库里）。
目录没了就从主仓库 `git worktree add <新路径> ui/panel-redesign`，并把新路径告诉人；`git worktree prune` 不归你。

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
