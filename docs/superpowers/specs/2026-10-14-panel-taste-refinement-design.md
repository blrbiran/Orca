# Orca 面板精修（impeccable critique 之后）—— 设计

> 会话 62660548（2026-10-13/14），分支 `ui/panel-taste`，从 main `cfb7728` 拉出。
> 只动 `web/`；`src/panel` 等服务端一行不改（人裁 R4）。

## 1. 由来与人裁

impeccable `critique`（dual-agent）＋ `audit`，对 9 个分区 × 深浅 × 1440/390 截图与源码评审：
Nielsen **18/40（Poor 上沿）**，audit **14/20**，认知负荷 7/8 项不过。原始材料在该会话 scratchpad
（`assessment-A.md`／`assessment-B.md`／`assessment-C-audit.md`），快照存 `.impeccable/critique/`。

人裁（原话摘要，2026-10-14）：
- **R1** 四条 P1 全做。
- **R2** 范围 P1 + P2（P3 不做）。
- **R3** 白天模式做成暖中性色温；**黑夜模式不能用暖中性** —— agent 建议：中性石墨，极轻冷调（chroma ≤ 0.012），人未否决。
- **R4** 服务端（静态文件头等）不动。

## 2. 方向：精修，不重做

保留现有结构与被 `contrast.test.ts` 钉住的分层方法；修的是结构与语义，不是换视觉世界。

## 3. 要解决的问题（编号沿用 critique）

| # | 问题 | 做法 |
|---|---|---|
| P1-1 | 提示框颜色跟 ARIA role 走（`role=status` 一律绿、`role=alert` 一律红） | role 只管语义；**默认中性**；颜色只由显式 `data-tone="info|ok|warn|danger"` 给。静态配置说明「未配置执行端口」由 `alert` 改 `note`＋`warn` |
| P1-2 | 外壳挤压内容：390×844 内容区 278px、200% 缩放 105px、320×256 32px；红色通知带每页 90px | ≤760px 解除 100dvh 锁高、页面自然滚动；导航单行横滚；窄屏隐藏页脚与项目说明；通知改暖色低调样式并加「全部知道了」 |
| P1-3 | 审 115 条决策又慢又险：两个主按钮、无键盘、无进度、同意后停在原地 | 只有「同意」是主按钮；纠正表单加小标题、按钮降为次要；同意成功且该行离开列表后自动跳下一条；j/k/a/c 快捷键（仅 Decisions 分区、输入框内不触发）；「本次已审 n」计数 |
| P1-4 | Overview 劣化复制 Decisions：115 条按 ID 列出、空「进展」撑成高塔、卡套卡、整条队列 `aria-live` | 决策行最多 3 条 ＋「查看全部 n 条决策」链到 `#decisions`（只在 `Overview.tsx` 截断，模型不变）；两栏顶对齐、去掉内层卡片；去掉队列的 `aria-live` |
| P2-5 | Metrics 是文字墙：同一说明重复 3 次、正文引 spec 章节、零值占整标题、390px 表格撑破 | 三个比率做成卡片、说明收进 `<details>`；三个计数挤成一行「数据健康」；表格包 `.table-scroll`；说明文案去掉 spec 引用 |
| P2-6 | 页面拼法不一致：标题层级平（14/14/16）、主按钮泛滥、永远禁用的按钮占位 | 字号阶梯 14/18/22；`button[type=submit]` 不再自动是主按钮，只有 `.btn-primary`；禁用的项目按钮在不可编辑时隐藏（说明文字保留）；任务控制的会话行降为元数据样式 |
| P2-7 | 术语中英混杂、同物两名 | zh 角色名「所有者／成员」；Chains 中文统一叫「链」；记忆分区缺 ccmem 时不再显示半英文服务端原文 |

## 4. 颜色（数值已按 `contrast.test.ts` 同一公式实测）

- **深色（中性石墨）**：`--bg #0e0f11` `--card #1b1c1f` `--bg-elevated #1f2125` `--bg-hover #282a2f`
  `--border #393b41` `--border-strong #4b4e55` `--text #d6d7da` `--text-strong #f7f7f8` `--muted #a6a8ae`；accent 不变。
  实测：card/bg 1.13、border/card 1.52、border/bg 1.71、选中行/card 1.47、muted/选中行 4.86 —— 现有门槛全过。
- **浅色（暖纸）**：`--bg #f6f4ef` `--card #fffdf9` `--bg-elevated #fffdf9` `--bg-hover #eeeae2`
  `--border #e3ddd1` `--border-strong #cfc7b8` `--text #3d3830` `--text-strong #1c1915` `--muted #6a645a`。
  实测：text/card 11.44、muted/hover 4.88、muted/选中行 5.04、on-accent/accent 5.17。
- 浅色今天没有判据 ⇒ 新增一条与深色同形的浅色判据；两个浅色块（`[data-theme="light"]` 与 `prefers-color-scheme`）必须**逐字相同**，也钉一条。

## 5. 约束

- 既有判据**一条不改写**。实施中若发现非改不可 ⇒ 停下升人（先例：U4 授权）。
- 四个分区始终挂载、只由 `.section-pane:not([data-active="true"]) { display: none }` 隐藏 —— 不动。
- `styles.test.ts` 按「选择器首次出现」切片：新规则不得以被测选择器结尾、放在原规则之前；主题块内不得出现 `}`。
- 新 i18n key 必须 en/zh 同时加（`i18nKeys`），且 zh 不能与 en 相同（`i18nPseudo` 只查不同的），用 `t()`。

## 6. 不做（显式）

撤销（需服务端接口，R4）；花费上限挪到设置（会改写约 20 条 usagePanel 判据）；Overview 改顶部状态带（`detailNavigation`／`overviewApp` 钉着「Progress」区域里的单个按钮）；P3 全部。

## 7. 独立审查后的修订（同会话，spec 提交前；本节覆盖上文冲突处）

独立 reviewer 报告（会话 scratchpad `spec-review.md`）：Blocking 4 / Important 8 / Minor 9。采纳如下：

- **P1-1 改为：`role=status`／`note` 默认中性；`role=alert` 无 `data-tone` 时仍为红**（真错误约 25 处不该变灰）。只有显式 `data-tone` 的才换色；静态配置「未配置执行端口」改 `note`＋`warn`。
  任务控制导航上的红点（`Shell.tsx` `controlAlert` 含「无执行端口」）**不改**：`shell.test.tsx` 钉着，属改写既有判据 ⇒ 列入 awaitingHuman。
- **P1-3 加防误触**：按住（`event.repeat`）或该决策已有在途请求时 `a` 不发送。撤销仍不做（客户端延时发送会改变「点同意即记录」的语义，不在本轮）。
- **P2-5 改为：说明不折叠**。`MetricsView.tsx:7-15` 注释与 `metricsView.test.tsx:101` 写明说明须紧贴数字（Rule 7：既有契约有明文与判据，胜出）。只做卡片版式、紧凑说明样式、表格横滚、文案去 spec 引用。
- **P2-6 补**：需求／链／计划卡／导入计划的主提交按钮显式 `btn-primary`；浅色 accent 改 `#1d4ed8`（`#2563eb` 在 hover 行上 4.31 < 4.5；新值 hover 5.59、白字 6.70）。
- **补做（audit C 的 P2，均仅 web）**：跳到正文的链接（按钮实现，不改 hash 路由）；`@media (pointer: coarse)` 触控目标 ≥ 44px；矮屏（`max-height: 560px`）同样解除锁高。
- **手机端不隐藏项目说明**（禁用按钮隐藏后，说明是唯一解释）。
- **产出 `web/DESIGN.md`**（impeccable 的设计系统文档，钉 token／语气／字号／按钮规则）。
- **仍不做，补登理由**：统一标题层级（会改写 `metricsNotes.test.tsx:52`、`decisionsI18n`/`decisionsStatusFilter` 的 h1 断言）；bundle 压缩与缓存头（服务端，R4）；Overview 顶部状态带（见 §6）。
