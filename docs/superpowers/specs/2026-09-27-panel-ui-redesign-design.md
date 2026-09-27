# 面板 UI 重做：层次、分区、可审的决策列表

> 归属：会话 `a50f4d80`（2026-09-27），分支 `ui/panel-redesign`，基于 main 上主题行
> `docs(plan): task-by-task implementation of the claude stream-usage spec` 那一笔。
> 设计经人在同一会话里逐段批准（布局、主题、范围、改写判据），本文是那三段的落盘。

## 0. 为什么做

人在本地起面板（`orca panel`）实测后的两条反馈，原话：

1. 「UI 完全没有层次」—— 面板是无样式的裸 HTML：Chains、Task control、决策列表、Metrics、决策详情纵向堆成一页。
2. 「Unreviewed high-tier decisions 这部分的列表中的按钮我根本看不懂具体要做什么决策（看不到内容，且也没有用于决策/改已有决策的地方）」

对第 2 条的现场判别（读人保存的页面 HTML）：
- 详情**其实存在**，但渲染在整页最末尾（100 多行列表与整段 metrics 之后），人没看到 —— 这是**布局问题**。
- 列表行只有 `projectKey / id / at / kind / scope / verdict` —— 这是 **panel spec §1.5 ／ §4.2 的有意设计**（见 §2）。
- 「改已有决策」：面板**只能记 correction，不能改台账**（panel spec §2.1，安全边界）。页面对此一句解释都没有。

## 1. 人裁（本会话）

| # | 裁决 | 原话／选项 |
|---|---|---|
| U1 | 决策列表**显示 `question` 摘要** | 选「列表显示问题摘要」（而非推荐的「守 spec，只改布局」） |
| U2 | 布局：**左侧导航 ＋ 分区页**；决策区为左列表＋右详情 | 选「左侧导航+分区页」 |
| U3 | 主题：**跟随系统深／浅**，可手动切换 | 选「跟随系统深/浅」 |
| U4 | 授权改写 §6.1 列出的四条既有判据 | 「授权改写那三条判据」＋「授权改写」（后两条） |
| U5 | 在 git worktree 里做 | 「你是不是可以起一个git worktree去改UI的部分」 |

## 2. U1 推翻了什么（必须说清）

panel spec（`2026-09-09-panel-design.md`）§1.5 实测 89% 的 `question` 装着推理，§4.2 据此规定列表**不得**带 `question` 或其任何派生：
否则人能从列表读完理由，而 reviews 表记他「从未 opened」。

**U1 之后仍成立的：**
- `reviewed` 仍是覆盖率唯一的分子，仍然只能由刻意动作（Agree／Correct）产生 —— U1 不影响它。
- 面板仍只能记、不能闭环（§2.1 不动）。

**U1 之后不再成立的：**
- *** **`opened` 不再近似「读过理由」**。*** 它本来就是噪声（§4.2），现在更弱：人可以从列表读完 question 而不产生任何 `opened`。
  ⇒ 任何把 `opened` 当成「看过」的读法都是错的；本文不新增任何消费 `opened` 的地方。

记法：`2026-09-09-panel-design.md` 末尾追加具名 ERRATUM（原文逐字保留）；`src/panel/listProjection.ts` 的注释块末尾追加具名 ERRATUM。

## 3. 范围

**做：**
1. 外壳：左侧固定导航（Decisions ／ Chains ／ Task control ／ Metrics），每项带计数或告警点；导航底部显示 `by`、epoch、dispatch 状态、主题切换。
2. 样式体系：一份纯 CSS `web/src/styles.css`，token 取自 openclaw `ui/src/styles/base.css`（深色为主，浅色取其暖纸色）。**不加任何依赖。**
3. Decisions 区：筛选条（kind／scope／repo）＋列表（徽章＋两行截断的 question）＋详情（分块）＋动作说明。
4. 后端：列表行加 `question`。
5. 其余各区**只换样式与包裹结构**：可见文字、按钮名、`aria-label`、`data-*`、`data-testid` 一律不变（既有判据靠它们定位）。
6. 🔴 **决策区也有必须保留的锚点**（`web/tests/appSelection.test.tsx`、`App.test.tsx`、`decisionDetail.test.tsx` 靠它们）：
   标题文字 `Unreviewed high-tier decisions`；选择器 `.decision-list li button`（每行一个 button）；按钮名 `Agree`、`Correct`；
   `form.correction-form`、`textarea[name="because"]`、`input[name="chose_instead"]`、`data-testid="decision-*"`／`alternative-*`；loading 文案里的 `orca panel`。

**不做：** 控制面逻辑、新 API（`question` 除外）、面板写台账、组件库、路由库。

## 4. 后端

- `src/panel/decisionSource.ts` 新增 `loadQuestions(repoPath): Promise<Map<string, string>>`：复用 `ledgerFiles` ＋ `readLedgerLeniently`，
  只收 `ev: "decision"` 且 `question` 为非空字符串的行；同 id 出现多次时**先读到的那条赢** ——
  与 `loadDecisionRow`（按同一文件序返回第一条匹配）一致，否则列表摘要与点开后的详情可能是两条不同的决策。
- `src/panel/listProjection.ts`：
  ```ts
  export type DecisionListRow = Pick<DecisionObservation, (typeof LIST_FIELDS)[number]> & { question: string | null };
  export function projectForList(decision: DecisionObservation, question: string | null): DecisionListRow;
  ```
  `LIST_FIELDS` 仍是那六个 observation 字段（它的 `satisfies keyof DecisionObservation` 约束不动）；`question` 是单独的一个键。
- `src/panel/api.ts` 的 `/api/todo` 与 `/api/decisions`：按 `observations.repos` 每个仓库读一次 `loadQuestions`，行里 `question = map.get(id) ?? null`。
  读失败（`ledgerFiles` 已吞掉 readdir 错误；真正会抛的是 `readLedgerLeniently` 读单个文件）⇒ 每个仓库整体 try/catch，该仓库所有行 `question: null`，**不让列表失败**：列表是待办，不能因为摘要读不到而整页消失。
- `web/src/types.ts`：`WEB_LIST_FIELDS` 不变；`DecisionListRow` 同步加 `question: string | null`（`webParity` 的编译期互赋值检查会核它）。

## 5. 前端

### 5.1 文件

| 文件 | 职责 |
|---|---|
| `styles.css` 🆕 | token（颜色／字号／间距／圆角／阴影）、深浅两套、基础元素、通用类 `.btn` `.pill` `.card` `.callout` `.stat` `.field` |
| `theme.ts` 🆕 | `readTheme()`／`writeTheme()`：`"system" \| "light" \| "dark"`，存 `localStorage`，读写全包 try/catch，失败回 `"system"`；在 `<html>` 上设 `data-theme` |
| `Shell.tsx` 🆕 | 纯组件：侧栏＋内容区。入参：当前分区、各区徽标、`by`／epoch／dispatch 文本。徽标：Decisions ＝ 未审总数（不随筛选变）；Chains ＝ 有 `running` 的链时一个点；Task control 告警点 ＝ 以下任一成立：port 未配置、`refetchRequired`、恢复阻塞数 > 0、`control.refusal` 非空 |
| `sections.ts` 🆕 | 分区枚举与 URL hash 的互转（`#decisions` 默认；未知 hash ⇒ decisions） |
| `DecisionsView.tsx` 🆕 | 纯组件：筛选条＋`DecisionList`＋`DecisionDetail`（或空态「选一条决策查看内容」） |
| `DecisionList.tsx` | 行：kind／scope 徽章、repo、日期（本地短格式）、question 两行截断（`null` ⇒「(no question recorded)」）；选中行高亮 |
| `DecisionDetail.tsx` | 分块：Question ／ Chose ／ Because ／ Rejected alternatives；动作区见 §5.2 |
| `PanelHome.tsx` | **删除**，职责由 `DecisionsView` 接；`MetricsView` 移到 Metrics 区 |
| `App.tsx` | 新增 state：当前分区（与 hash 同步）、筛选条件；其余 fetch／轮询／命令逻辑不动。Chain 横幅（`bannersFor`）渲染在内容区顶部、**不属于任何分区** —— 人停在别的区也要看得见 |
| `main.tsx` | import `styles.css`，启动时应用主题 |
| 其余组件 | 只加 className、调整包裹 |

🔴 **分区切换：四个区始终挂载，非当前区只由 `styles.css` 的类隐藏（`.section:not([data-active="true"]) { display: none }`），不卸载、不用 `hidden` 属性。**
理由（现测）：`web/tests/agentPreviewRefresh.test.tsx` 渲染整个 `<App />` 后按 role 找 Task control 的按钮；
卸载或 `hidden` 会让它在默认分区（decisions）下找不到，而 `getByRole` 本身会跳过带 `hidden` 的元素；卸载还会丢 `ChainPanel` 自己的 `repoKey` state。
测试环境不加载 CSS ⇒ 既有判据看到的 DOM 与今天相同。⚠️ **这意味着既有判据不验证分区可见性** —— 可见性由 §6.2 的 `Shell`／`sections` 判据钉（断言当前区的 `data-active="true"`、其余为 `"false"`）。

⚠️ `staticFiles.ts` 按精确文件名伺服、不拼路径 ⇒ vite 产出的 `index.css` 必须能作为一个键被找到。`vite.config.ts` 的 `assetFileNames: "[name].[ext]"` 已覆盖；实施时**现测** `web/dist/` 里的文件名与面板实际伺服（curl 拿 200）。

### 5.2 决策动作的说明文字（写死在 UI 上）

- **Agree** —— 「Mark reviewed: I read this and it needs no change. Counts toward review coverage.」
- **Correct**（表单**始终展开**，不折叠 —— `appSelection.test.tsx` 与 `decisionDetail.test.tsx` 断言详情一出现 `textarea[name="because"]` 就在）——
  - kind 每项一句：`wrong`「the choice was wrong」／`not_my_taste`「defensible, but not what I would choose」／`stale`「it was right then, no longer true」
  - 表单下方固定一句：「This records a correction; it does not edit the ledger. To change the decision itself, close it with `orca correct --close` or let the fix agent do it.」
- 成功后：状态行（现有行为）。**不自动选中下一条** —— 那会替人发一次 `GET /api/decision`，写一条人没打开过的 `opened`。
- 列表头：`N of M`（N ＝ 筛选后，M ＝ 未审总数）。

### 5.3 视觉

- token 取 openclaw（深：`--bg #0e1015`、`--card #161920`、`--border #1e2028`、`--text #bcbcc0`、`--text-strong #f4f4f5`、`--muted #8b8b94`；
  状态 `--ok #22c55e`、`--warn #f59e0b`、`--danger #f87171`、`--info #60a5fa` 及 8% 的 `-subtle`；浅：`--bg #faf9f7`、`--card #fff`、`--text #403c35`、`--muted #6e6960`）。
  **强调色不用 openclaw 的珊瑚红**（会与 danger 混淆），用 `--info` 系蓝色。
- 字号 12／13／14／16，间距 4 的倍数，圆角 6／10，侧栏宽 240px；窄屏（<760px）侧栏变顶部横条，决策区上下排。
- 字体：系统字体栈（不从外网取字体 —— 面板可能在无网环境里跑）。

## 6. 测试

### 6.1 改写的既有判据（U4）

| 判据 | 改成什么 |
|---|---|
| `tests/panel/decisionsApi.test.ts` › `returns list rows DEEP-EQUAL to the frozen projection, not merely lacking a summary` | 期望值 ＝ 六字段 ＋ 从夹具台账**独立读出**的 `question`（不调用 `projectForList`／`loadQuestions`，避免同义反复），仍 `toStrictEqual` |
| `tests/panel/todo.test.ts` › `(e) answers with exactly the unreviewed high-tier decision, deep-equal to its LIST_FIELDS projection, and records nothing` | 同上；「records nothing」一半不动 |
| `web/tests/decisionList.test.tsx` › `renders only the list fields, never an extra field on the row` | question **出现**；另放一个非 question 的多余字段，断言它**不出现**（保住「不 spread」那一半） |
| `web/tests/panelHome.test.tsx` › `shows the todo rows' ids, with the todo heading before the metrics heading` | 移到 `DecisionsView`／`sections` 的判据：默认分区（空 hash、未知 hash）是 decisions，且决策区渲染出待办行 id。原意「第一屏是人欠的待办」保留 |

每条改写后在判据旁注释写明：编码的是本文 U1／U2，人在会话 `a50f4d80` 授权（U4）。
`tests/panel/webParity.test.ts` 不改（两边一起变，集合仍相等）。

### 6.2 新判据（每条都要在 `git clone --local` 副本里被看见红）

| 判据 | 打红它的变异 |
|---|---|
| `loadQuestions`：缺失／非字符串 ⇒ 不进表；重复 id 与 `loadDecisionRow` 同规则 | 去掉类型检查；改成另一种重复规则 |
| `/api/todo` 行带 `question`；某仓库台账不可读 ⇒ 行仍在、`question: null` | 删掉拼接那行；让读失败向上抛 |
| `Shell`：未审数显示；Task control 告警点对 §5.1 的四个条件各自出现、全不成立时不出现；当前区 `data-active="true"`、其余 `"false"` | 删告警点的任一条件；把 `data-active` 恒置 true |
| `sections`：hash ↔ 分区互转，未知 ⇒ decisions | 未知 hash 映到别的区 |
| `theme`：storage 抛错 ⇒ `"system"`；非法值 ⇒ `"system"` | 去掉 try/catch |
| `DecisionDetail`：Correct 表单下方有「does not edit the ledger」那句 | 删那句 |

### 6.3 成功判据（Rule 4）

在 worktree 里，输出重定向到文件、整份读回：

```
npm run typecheck && ./node_modules/.bin/vitest run && npm run build --workspace web && npm run --ws check && npm run verify:panel
```

全部 RC 0 ⇒ 过。另：起一个数据目录改道的面板，`curl` 拿 `/`、`/index.js`、`/index.css` 均 200；深浅两套各截一张图给人目测（视觉验收归人）。

## 7. 已知边界

1. U1 让 `opened` 更弱（§2），本文不修补它。
2. 列表每次请求都读一遍各仓库台账的全部 decision 行；今天本仓库约一百多条，不做缓存（Rule 2）。若将来变慢再说。
3. 合并进 `main`、删 worktree 与分支 —— 都归人（Rule 15）。
