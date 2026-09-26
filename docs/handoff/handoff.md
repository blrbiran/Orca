# Orca Handoff

> ⚠️ **这份文档是多 agent 共享的，而且【它不该无限膨胀】。**
> *** **本文允许就地改、允许删、允许整节替换**（Rule 13，2026-09-22 由人放宽）。 ***
> 动别的 agent 落下的条目要**同时**满足三条：(a) 指得出**是什么让它过期的**（提交主题行／哪一次实测）；
> (b) 它承载的**结论**在留下来的段落里活着 —— **删的是过程，不是结论**；(c) 不把已知为假的说法带下去。
> **三条里有一条不确定就留着。**
> ⚠️ **放宽的只有本文。** `.superpowers/sdd/**` 与已发布的 spec／注释**仍然一个字不改**，只能追加具名更正。
> ⚠️ **本文不写任何当前哈希**——提交本文这个动作本身就会改 HEAD，而人也会自己推远端。
> 要指代某一笔就**引提交主题行**，要指代材料就**引路径**。

> 📄 **方向性的问题**（我们到底要造什么、某条诉求能不能做、先后怎么排）去读 `docs/handoff/goal.md`。
> **它不是接手材料，每轮交接【不需要】读它。**

---

## 怎么读这份文档

| 你想知道 | 看 |
|---|---|
| 这是个什么东西 | §一 |
| 开工先跑什么 | §二 |
| 现在是什么状态 | §三 |
| 下一件事 | §四 |
| 哪些不要重开 | §五 |
| 干活时别再踩的坑 | §六、§七 |
| 代码／开发树／协议在哪 | §八 |
| 什么在等人 | §九 |

⚠️ *** **本文于 2026-09-22 由 5330 行压缩到现在这个长度**（会话 `da2f5e9a`，提交主题行见 §十一）。 ***
**删掉的是过程日志，不是结论。** 每一轮的原文都在 git 历史里，取回方式见 **§十一**。

---

## 一、Orca 是什么

**系统层**：决定跑哪些任务、怎么排、并行还是串行；持有决策台账工具、索引器、调度器、Web 面板。

| | 角色 |
|---|---|
| **ccloop**（`/Users/biran/code/skills/loop/ccloop`） | **一个工具** —— 把单个任务跑成循环。Orca 的**依赖**，不是 submodule |
| **Orca**（本仓库） | **系统** —— 工头 ＋ 工地记录 ＋ 看板 |
| **ccmem**（`/Users/biran/code/skills/ccmem`） | **记忆层** —— Claude Code 插件，走 CLI/DB 接口，**一个字都不 vendor** |

⚠️ **最容易搞混的一点**：`.decisions/` 台账**既不住 Orca 也不住 ccmem**，它住在**被干活的那个目标仓库**里。
**Orca 装的是工具，不是台账。** ⇒ 由此得出一条接入约束：
*** **Orca 必须能对任意目标仓库工作，不能假设自己在那个仓库里。** ***

**Orca 调用 ccloop，一个任务一个 ccloop run。ccloop 不知道 Orca 存在，也不需要知道。**

---

## 二、先跑这些，以输出为准

```bash
cd /Users/biran/code/skills/loop/Orca
/usr/bin/git ls-remote origin refs/heads/main    # 开工核一次、收尾【必须】再核一次
/usr/bin/git status --short; git log --oneline -5
ls ~/.orca                                        # Rule 17 的开工核对项
node_modules/.bin/tsx src/cli.ts resume           # 从最近的检查点接手
```

⚠️ **判断远端只能 `ls-remote`**，`git status` 的 `ahead N` 是缓存 ref。
⚠️ *** **所有 git 核对一律用 `/usr/bin/git`** *** —— rtk 会改写 git，且骗法有六种（§七.1）。
⚠️ **验证性跑一律重定向到文件再整份读回**，`npm run verify` 整套约四分钟，Bash 给 600000 ms 或放后台。

---

## 三、当前状态

**Orca 有十个子系统**（行数为 2026-09-22 现测，命令
`for d in …; do cat src/$d/*.ts | wc -l; done`，观测锚点＝主题行
`docs(handoff): roll the entry point onto the six rulings and the order they land in` 那一笔；**G1 缝 A 之后未重测**）：

`control` 7280 / `scheduler` 4482 / `panel` 3801 / `corrections` 1529 / `metrics` 1266 /
`chain` 1208 / `ledger` 709 / `gate` 551 / `checkpoint` 523 / `level` 346。

**已经能跑的**：`orca validate`／`plan`／`run`／`correct`／`metrics`／`panel`／`compact-reviews`／
`level`／`checkpoint write`／`resume`／`gate`／`chain`（完整用法 `src/cli.ts` 的 `USAGE`）。
出厂 `orca panel` 会开控制 store、挂 `/api/control`、listen 前跑完 recovery、自带 wake pump、
SIGINT/SIGTERM 每 epoch 恰好写一条 shutdown；`--no-control` 关掉时行为与挂载前逐字节相同。

*** **G1 缝 A 做完了（2026-09-24）**：真 ccloop 的 `capabilities` 答 v2 八字段，Orca 直通对端应答，
`control-capability-unsupported` 那道缺口关了。 *** 细节与诚实的验收表述见 §四。

*** **G1 缝 B（2026-09-25）与执行驱动第一片（2026-09-25，会话 `905e41ce`）都做完了。** *** 细节见 §四 4.0.1。

*** **④ handoff 投递＋续跑＋N 路并行落地＋m5 也做完了（2026-09-25，会话 `e5f56bfe`）。** *** 细节与诚实的验收表述见 §四 4.0；现在的下一件事也在 4.0。

🟡 *** **agent 选择一轮（2026-09-26，会话 `75ec878e`）在飞：T1–T15 做完，T16／波 5 复审／T17／终审未做。** *** 细节与下一步见 §四 4.0。
⚠️ **本轮一次全量门都没跑**（各 Task 只跑聚焦文件＋邻居）⇒ 下面「现行基线」是 ④ 轮的，**已过期**，以 T17 现测为准。

**还不能说的**：*** **「Web 派活可用」仍然不是事实。** *** 能说的只有：**真 codex 下单任务主链跑通过一次**（2026-09-25，会话 `af3dc0d3`，
请求模型 gpt-6-luna，服务层不含 HTTP，n＝1；台账 `.superpowers/sdd/2026-09-25-live-acceptance/progress.md` §5 是唯一可引的表述）。
冲突／解冲突、依赖、崩溃恢复、面板 HTTP、strict 组、④ handoff、⑤ 预估链都没在真 codex 下验过。**驱动环只在 port `configured` 时挂；未配置时行为逐字节同前。**

**④ 轮基线（已被 agent 选择一轮的改动过期，T17 重测前只作对照）**：env ＝ `ORCA_CCLOOP_BIN` 指 **含 C1–C7＋C-3＋D-C7′ 的 ccloop main build**（`git clone --local` 到会话 scratchpad ＋ 软链 `node_modules` ＋ `npm run build`）＋ 指向该 build 的 fake-codex adapter config（`/private/tmp/…`、0600）。
- **观测锚点** ＝ 主题行 `fix(control): keep a blocked run's step through a later error` 那一笔（其后只有一笔 `docs(sdd)`）。全量 `./node_modules/.bin/vitest run --reporter=json`：**1851/1851、0 pending**（文件数本轮没单独记）；`npm run typecheck` RC 0；web build RC 0；`npm run --ws check` RC 0。
- 全套门（Task 10 那一次，锚点＝主题行 `test(control): pin the deadline case to the phase the deadline cut`）：typecheck／web-build／web-test／`verify:control`／`verify:web-control`／`:consumer`／`verify:scheduler`／`verify:panel`／`--ws check`／`check-claude-md-lines`／`check-hooks-path` 全 RC 0；全量与 `verify:chain` 各 RC 1，**唯一的红都是 driverRecovery 那条已登记 flake，单文件重跑 8/8 绿**；`ledger validate` RC 2（允许）。ccloop：typecheck／build RC 0，`check-known-reds` RC 0（唯一红仍是 `stopProof`）。
- 机械判定器不入库：`scratchpad/…/ffix/check-handoff.py`（会话 scratchpad，会被清）。⚠️ 它的 EXPECTED 表**没收** T10b 的 `tests/control/handoffGuards.test.ts`（6 条）——下一轮若要复用，先补。

**上一轮基线（执行驱动轮，已被上一段取代，留作对照）**（只抄工具报数；env ＝ `ORCA_CCLOOP_BIN` 指 **含 C1–C4 的 ccloop main build** ＋ fake-codex adapter config，见 §8.2；
**观测锚点** ＝ 主题行 `test(control): give the real-git settle criteria an explicit timeout` 那一笔；门逐段单跑，门清单见本轮计划 Task 11）：

| 门 | RC | 结果 |
|---|---|---|
| `typecheck` | **0** | 0 错误 |
| 全量 vitest（json） | **0** | 195 文件；**1756/1756**，0 pending／todo；判定器（本轮 12 个新／改判据文件全过）RC 0 |
| `executionDriverE2E` 单跑 | **0** | 无并发负载下连跑 3 次，每次 9/9 |
| `verify:control` | **0** | 54/54 文件；562/562，**0 skipped**（前一笔之上测） |
| `verify:web-control`／`:consumer` | **0** | 18 文件 197/197；5/5 |
| `verify:chain` | **0** | 第二段全套 195 文件、1756/1756 |
| `verify:scheduler`／`verify:panel`／`--ws check`／web build／`check-claude-md-lines`／`check-hooks-path` | **0** | scheduler 51/51、167/167；panel `PASS` 15/15；ws 16/16、75/75 |
| `ledger validate` | **2** | `verify` 脚本本身容忍 2（历史 bound 行） |

⚠️ *** **新登记的负载型 flake**：`tests/control/executionDriverE2E.test.ts` 在重负载（两份 clone 并跑变异）下出现过 5/9（R1 子场景）；无负载单跑 3/3 全绿。
`tests/control/driverSettle.test.ts` 的真 git 场景曾在全量＋并发负载下撞默认 5 s 超时，已给 30 s（主题行见上）。 ***
⇒ **看到这两个文件红：先单文件重跑，绿了就不是回归。**
⚠️ *** **④ 轮新增的负载型 flake（同样规则：单文件重跑绿 ＝ 不是回归）**：`tests/control/driverRecovery.test.ts` 的 "drives a retried run on from where it was blocked, to settled"、`tests/control/driverLanding.test.ts` 两条、`tests/control/handoffE2E.test.ts` 的 G（依赖 30 s 实时窗）、`web/tests/controlCommandRecovery.test.tsx` 的 "drops the id when the lookup returns the command's retained result"（单跑 3/3 绿）。 ***

⚠️ *** **已知 flake（2026-09-24 会话 `ae4061a5` 现测登记，根因未查；2026-09-25 那一轮全套里没出现）**：
`tests/panel/controlShutdown.test.ts` > `a real SIGTERM to a real panel` > `makes it exit cleanly, having written one shutdown row for its epoch`。 ***
在同一棵树（观测锚点＝主题行 `docs(handoff): G1 seam A is done; the next steps are the human's, ccloop pushed before Orca`）上：
`npm test` 里绿、`verify:chain` 第二段全量重跑里**红一次**（`expected 143 to be +0`，`controlShutdown.test.ts:126`）；
单文件 `./node_modules/.bin/vitest run tests/panel/controlShutdown.test.ts` 连跑 **5/5 绿**（6/6）。
⇒ 看到它红：**先单文件重跑**，绿了就不是回归。未验证的推测：判据连发两次 SIGTERM，第二次若经 tsx 转发时晚于
`src/panel/server.ts` 在 `closed` 之后摘掉处理器，内层 node 按默认处置死，tsx 转成 143。
（已排除「信号先于处理器安装」：处理器在 `src/cli.ts` 打印 ready 之前同步装好。）

⚠️ **判别式**：看到红，先问「是不是上面那条 flake」，是就单文件重跑。缝 B 的机械判定器（全套 json ⇒ smoke 5 条全过、
失败 ⊆ {那条 flake}、0 pending）代码全文在同一份计划的 Task 4 Step 1（可直接抄）。
历史台账：缝 A `.superpowers/sdd/2026-09-24-g1-capability-vocabulary/progress.md`；G1 之前 `.superpowers/sdd/2026-09-22-control-gates-baseline/`。

## 四、⛔ 下一件事

### 4.0 ⛔ 现在的下一件事（2026-09-26 会话 `75ec878e` 改写，**本节优先于下面的 4.0.0、4.0.1 与 1–3**）

**agent 选择一轮**（人裁：claude 走 ccloop control ＋ 分层默认值 agent／model／上下文，「A＋C 合并」，面板 UI 本轮做全；项目未上线、允许大改）：
- **材料（按优先级读）**：spec `docs/superpowers/specs/2026-09-26-agent-selection-design.md`（**§12 复审裁定优先于正文**）；计划 `docs/superpowers/plans/2026-09-26-agent-selection.md`（**§0 执行顺序与 R1–R8、§0.2 复审更正 P1–P23 优先于各分节正文**；分节正文是六席并行写的，前面 Task 落地后锚点会过期 ⇒ 以真实的树为准）；
  **唯一进度源** `.superpowers/sdd/2026-09-26-agent-selection/progress.md`（**全部 `Ruling:` 行＝控制器替人做的决定，人要审**；§6 是交接点）；同目录 `impl-common.md`（派发通用禁令）、`plan-rulings.md`、`review-common.md`、各 `task-N-brief.md`／`task-N-report.md`、`wave1..4-review.md`。
- **做完的**（按主题行找，别数笔数）：ccloop 从 `feat(agents): add agent descriptors for claude and codex with selection validation` 到 `fix(agents): keep an unobservable CLI version out of the named drift refusal`（T1–T6＋两波修复）；Orca 从 `feat(control): add the pure layered agent selection resolver` 到 `fix(web): recover the agent editor from a failed table read, say why on an unconfigured port, and void a rejected preview`（T7–T15＋修复）。每个 Task 都过了任务复审（多数一轮修复），波 1–4 各一席跨 Task 复审。
- 🔴 *** **诚实表述**：只在 **fake** 下、且**只跑了聚焦文件**验过；**全量门、T16 的混组 E2E、终审都没做**；真 claude 一次没跑（人：留到下一轮）。**不许说「claude 可用」或「分层选择可用」。** ***
- ⛔ **下一件事（按顺序）**：
  1. **T16** 驱动环 E2E（`task-16-brief.md`，带台账 §6 的两条更正：偏好载荷只发 `{preferences}`；`confirmAgentGroup` 比对存储里的冻结值）。必须覆盖：混组 `.argv --model`、解冲突 reconcile 选择进 `.argv`（spec §9.11）、**确认后改默认值再派活仍发冻结值的 `.argv` 一半**（T11 复审留给 T16）、④ 三件在 fake claude 下各一次。
  2. **波 5 复审** → 3. **T17**（两仓全套门＋判定器＋`check-known-reds`；判定 `runCodexPhase > kills a TERM-ignoring process before returning abort` 是否新 flake；控制器把各报告的 `MUTATION:` 行汇总成 `mutations.md`；给 spec **追加** §13 实施期更正，清单见台账：R7、W5-M4、W5-M12、W5-M15、R8 M-8、新阻塞码 `reconcile-refused:<code>`／`reconcile-agent-unfrozen`、确认瞬时错误映射 500 等）→ 4. **终审**（opus）→ 5. 报人（Ruling 清单＋改写过的既有判据清单，台账里逐条 `REWRITTEN`／报告里）。
  6. 付费真 claude：另问人，先 proposal-edit 封顶（每任务 3M token、3 次尝试）。stream-json 逐条 usage、opencode／pi／litellm、subagent 级切换都是后续片。
- 本轮执行规矩（人原话，下一轮是否沿用要人重新说）：「尽量将这些要做的task完整做完，这个session暂时不要考虑context大小」「执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核」「同意修改几个仓库的现有test」（概括授权改既有判据，但**仍不许放宽**，人裁 88 (b)(c) 照旧）。

### 4.0.0 ④（2026-09-25 会话 `e5f56bfe`，**已做完，不要重做**；原 4.0 的结论保留于此）

- ✅ **A（真 codex 活体验收）**：做完，不要重跑。唯一可引的表述在台账 `.superpowers/sdd/2026-09-25-live-acceptance/progress.md` §5（单任务、125,664 token、美元未知）。
- ✅ *** **B（④ handoff 投递＋续跑＋N 路并行落地＋m5）做完了**（会话 `e5f56bfe`）。 *** 按主题行找（**别数笔数**）：
  - ccloop 三笔：`feat(control): answer the handoff request, list only entered phases, delay fake codex`（C5 `delayMs`／`#continuation`／`.tasks`、C6、C7）、
    `feat(codex): report usage observed before a phase was aborted`（C-3 方案 (i)＋D-C7′(α)）、`docs(codex): add the C-3 honest-registration line at the extraction point`。
  - Orca：从 `feat(control): stop-side parts for handoff delivery` 到 `fix(control): keep a blocked run's step through a later error`（中间含 H 步、续跑、N 路落地、关闭跳过、面板 `continuable`、真 ccloop E2E、六条守卫判据、终审两处 Critical 修复）。
  - 材料：spec `docs/superpowers/specs/2026-09-25-handoff-delivery-design.md`（**§13.4 ＞ §13 ＞ §12 ＞ §11 ＞ 正文**）；计划 `docs/superpowers/plans/2026-09-25-handoff-delivery.md`；
    **唯一进度源** `.superpowers/sdd/2026-09-25-handoff-delivery/progress.md`（**全部 `Ruling:` 行＝控制器替人做的决定**）＋ `mutations.md`（变异台账），同目录的 `final-review.md` 等是未入库的过程文件。
  - Web spec 已追加 `ERRATUM (handoff delivery, 2026-09-25)`（§6.4 两处、§11.1 一处对驱动环组不再成立）。
- 🔴 *** **诚实的验收表述（只能这么说）**：在 **fake codex**、soft 组下，对驱动环在跑的 group 发 `handoff-stop`，每个被冻结的 run 按所处的步收口（未 accept ⇒ restartable；已 collect 完 ⇒ 照常落地；阶段中途 ⇒ H-settle 成 `settled-recoverable`、work `held`），group 到 `handoff-complete`；`resume-from-handoff` 之后续跑在**前任的 base** 上由驱动环跑完、落到 `orca/<g>`；三路并行改同一文件时最终内容含三路改动、恰好两次解冲突；deadline 中止的 run 在 fake codex（先报 usage 再睡）下可续。 ***
  *** **真 codex 下的 handoff 一次都没跑过；真 codex 的 usage 只在阶段末才有 ⇒ 真 codex 下 deadline 中止的 run 多半仍不可续，而且会把组的 `usageUnknown` 置真、挡住该组此后的领取。「Web 派活可用」仍然不是事实。** ***
- ~~下一件事~~（已由 4.0 取代）：
  1. ✅ **claude 走 ccloop control 模式**单独一片（已并入 agent 选择一轮，见 4.0）（人裁，排在 ④ 之后）：ccloop control 今天只接 codex（`src/control/accept.ts`、`worker.ts` 写死 `parseCodexConfig`／`CodexAdapter`，行号引用前现测），要 ccloop 一笔改动＋fake claude（`tests/fixtures/fake-claude.mjs` 已有）的驱动环 E2E；先 brainstorming → spec → 评审 → 计划。真 claude 付费跑另问人。
  2. 仍归人排期的：⑤ 预算预估链、strict 组、生产 execution profile 快照、`capabilities` 计算化（§9.1）。
- 执行规矩（本轮人原话要点，下一轮是否沿用要人重新说）：「执行中有问题不找人、先按控制器建议做，最后统一报人」；「本 session 不考虑 context 大小」—— 本轮控制器越过 T2 继续，检查点记了越线。

### 4.0.1 执行驱动第一片（2026-09-25 会话 `905e41ce`，**已做完，不要重做**）

*** **执行驱动缺口（第一片 ①启动腿＋②恢复＋③收尾腿）做完了。** *** 人 2026-09-25「执行驱动缺口什么时候开 => 现在开」。
- **材料**：spec `docs/superpowers/specs/2026-09-25-execution-driver-design.md`（**§11 计划期偏离裁定 D1–D21、§12 终审更正都优先于上文**）；
  计划 `docs/superpowers/plans/2026-09-25-execution-driver.md`（§0 是现量结果）；SDD 台账 `.superpowers/sdd/2026-09-25-execution-driver/progress.md`
  （**全部 `Ruling:` 行＝控制器替人做的决定**）＋ 变异台账 `mutations.md`、终审 `final-review.md`、终审修复 `final-fix-report.md`，同目录。
- **做出来的**：`src/control/executionDriver.ts`（状态机 A1/A2/B/B'/C/D/R/E、补 wake）、`driverLanding.ts`（落地＋解冲突）、`workspace.ts`（worktree／clone 工作区、CAS）、
  `driveRecord.ts`／`workspaceSettings.ts`（封闭 schema、`set-workspace-mode`）、recovery／shutdown 对驱动环 run 的豁免、面板的工作区方式选择与 blocked 重试按钮；
  装配只在 port `configured` 时挂驱动环（**未配置 ⇒ 逐字节同前**）。ccloop 四笔：C1 结果目录硬链接 clone、C2 按 run 的 attempt ref（只加不改）、C3 脚本化 fake codex、C4 无 provider 的 verify 报 0 用量。
- 🔴 *** **诚实的验收表述（只能这么说）**：在 **fake codex**、**soft 组**、**配置了一个预估得 `blocked-capability` 的 estimator** 下，
  Web 派活能从 confirm 跑到 settle、落到目标仓库的 `orca/<groupId>`，冲突由单独的解冲突 run 解；**可能冲突的组要先抬 token 上限（D12）**；
  **command verifier 需要 ccloop 含 C4**。**真 codex 从没跑过 ⇒ 不许说「Web 派活可用」**；真钱活体验收归人。 ***
- 当时列的下一件事：真 codex 活体验收 ✅ 已做（见 4.0）；④ handoff 投递 🟡 已开（见 4.0）；⑤ 预算预估链（配置了会预估的 estimator 时导入后卡 `estimate-in-flight`）、strict 组 —— 仍未开，归人；§9.0 的挂账仍在。
- 本轮的执行规矩（人原话）：问题先按控制器建议做、最后一次报人；**上下文大小本会话不考虑**（控制器越过 T2 继续，检查点记了越线）。

*** **G1 缝 A 已做完。下面 1–3 是缝 A 收尾时写的「下一件事」**，按顺序： ***

1. ✅ **已由人推送（2026-09-24 会话 `ae4061a5` 用 `ls-remote` 现测：三个仓远端 main 都等于当时本地 main，含 ccloop 的 v2 那一笔）。** 下面是推送前的记录，留作经过：
   🔴 *** **先推 ccloop，再推 Orca。** *** （下面是一条**会过期的现测**，本文照例不记发布状态 —— 接手先跑 §二 的 `ls-remote`，三个仓各一次。）2026-09-24 现测：Orca 远端已在会话中途被推到 Task 5 那一笔
   （主题行 `fix(control): correct false human-authorization attribution on Task 5 criterion`），
   那一笔**要求 `protocol: 2`**，而 ccloop 远端仍停在答 `protocol: 1` 的那一笔 ⇒ **已发布的两个 main 此刻对不上线**，
   且已发布的 Orca main 在 typecheck 与 `verify:control` 上都是红的（中间态）。
   **本会话没有任何一席执行过 `git push`**（逐个子代理 transcript 扫过）⇒ 推送来自会话外（人，或 §九 那个 `post-commit` 钩子）。
2. **缝 B 要不要开、`targetVersion` 拍成什么** —— 下游是 `src/scheduler/planFile.ts`（人写的 plan 文件格式），人裁排除过。
   ⇒ 🟢 **人 2026-09-24 原话「开缝 B」（会话 `ae4061a5`），定为正安全整数；2026-09-25 做完（§4.0）。**
3. 缝 B 之后才轮到：生产 execution profile 快照（§9）、`capabilities` 计算化（人裁「分两步」的第二步）。

### 4.1 G1 缝 A 做了什么（**不要重做**）

- spec／计划：ccloop `docs/superpowers/{specs,plans}/2026-09-24-g1-*`（**执行中没改**，全部偏离记在台账的裁定行里）。
- **ccloop 一笔**：`feat(control): answer the v2 eight-field capability vocabulary`。
- **Orca 按 Task 顺序**（按主题行找）：`refactor(control): collapse capabilities schema into the v2 view schema` →
  `refactor(control): rewrite assertCapabilities for the v2 wire vocabulary` →
  `feat(control): pass ccloop's own v2 capability answer through the port` ＋ ERRATUM 修正一笔 →
  `test(control): feed real ccloop capability answer through the web smoke test` ＋ 两笔修复 →
  `test(control): sync the last v1 capability-vocabulary consumers to v2` → 整支评审修复两笔。
- ⚠️ **`capabilitiesSchema` 住在 `src/control/webProtocol.ts`，不是 spec §7.1 写的 `schema.ts`** ——
  `webProtocol.ts` 在顶层 import `schema.ts`，反过来就是运行期 ESM 环（TDZ），`typecheck` 看不出来。
- `durableAccept`／`ownershipIsolation`／`evidenceRetention` **是删掉的，不是迁到别的字段**：ccloop 永远答 `true`，
  旧守卫那一行在**所有预算模式**下都查它们，删了之后**没有东西替代**。`requestBoundEvidence` → `requestBoundProof` 才是真改名。

🔴 *** **诚实的验收表述（整支评审席定稿，控制器复核）**： ***
ccloop 该笔的真实应答，经 Orca 生产代码 `probeProfileCapabilities()` 直通，能让一个**测试声明的 profile** 上的 soft Web 组排上；
`deliverScheduledStart` 在 **Orca 台账**里记下一条 `starting` run。**ccloop 的 `accept` 没有发生**（当时写「那一步是缝 B」；缝 B 与执行驱动都已做完，见 §4.0）；strict 组被拒。
变异 M7／M8（ccloop 答 `handoffControl:"phase-end"`／`handoffExecution:null`）让冒烟测试变红，但**红在应答字面量与调度时那一次守卫**，
**不是**终点那条 `claimed`；投递时那一次守卫**单独**承重，由只加不改的判据
`blocks only at delivery when the observation degrades after a clean schedule` 加变异 X3 证明（合成退化）。

### 4.2 🔴 G1 是两条独立的缝，不是一条链（**结论未变，仍然最值钱**）

| | **缝 A：capability 词汇表**（✅ 做完） | **缝 B：`targetVersion` 类型分叉**（✅ 2026-09-25 做完） |
|---|---|---|
| 症状 | 真 ccloop 答不满 ⇒ Web 派活被拒 | `webCcloopSmoke` 两条判据红 |
| 拒点 | `src/control/webDispatch.ts` 的 `probeBlocksDispatch` | `src/control/startEnvelope.ts` 的 `safeInteger` |
| 根因 | ccloop 的 `capabilities` 不答五个字段 | plan 文件的 `targetVersion` 是**字符串**（已统一为正安全整数） |

当时的决定性证据：`webCcloopSmoke` 的 `codexProbe()` 把对端答不出的字段从 declared profile **借**过来，故意绕过了缝 A（该函数本轮已删）。
⇒ *** **修好 A，那两条判据仍然红** *** —— 本轮实测兑现。

### 4.3 已由现测定掉的（**不要重新讨论**）

- ✅ **缝 B 已落地（2026-09-25）**：plan 文件的 `targetVersion` 是 `safeInteger.positive().optional()`，**写字符串的 plan 会被 `loadPlan` 以 `malformed` 拒 —— `orca run` 也一样**，不做静默转换；同一份 plan 的 `planHash` 会变。细节：spec `2026-09-24-g1-seam-b-target-version-design.md`、台账 `.superpowers/sdd/2026-09-24-g1-seam-b/`。
- **`targetVersion` ＝ 安全整数** —— 承认 ccloop 已经拍了的（`protocol.ts`／`handoff.ts`／`command.ts` 全是 `safeInteger`／`number`）；
  收敛动作属于缝 B。
- **`handoffControl` = `"durable"`**（ccloop 的 handoff 两态 `latched`/`complete`、落盘、带 crash point）；
  **`handoffExecution` = `"mechanical-in-run-v1"`**（这一格推翻过一次：`handoff.ts` 构造 packet 那段全是 runState 的三元表达式、零模型调用，经过在 spec §10）。
- **ccloop 侧改动落在 `main`，不是 `codex/codex-adapter-0919`**（那个分支落后 10142 行）。

**明确暂时不碰**：`goal.md` 的 G5、§3.3 loop 方案层、§3.4 Web UI 扩展；以及④ handoff 投递、⑤ 预算预估链、strict 组（执行驱动第一片已做完，见 §4.0）。

## 五、已经拍板过的事（**不要重开**）

### 5.1 语言与记法（人 2026-09-01／09-02 当面交代）

1. **对话用中文**；2. **handoff 用中文**；3. *** **代码、注释、CLI help、README 用英文** ***；
4. *** **commit message 用英文** ***（只对新提交生效，历史 16 笔中文不改）。
- 照抄计划里的代码块时**注释改英文，逻辑与变异表一字不动**；spec／plan 保持中文，只追加 ERRATUM。
- **handoff 不是给人读的** —— 人读对话里的摘要（人 2026-09-17 原话）。
- **本文不写 HEAD、不写「领先几笔」**；指代某一笔引**提交主题行**。
  *** **唯一例外是【观测锚点】** *** —— 某批实测值的有效期，必须写明它是锚点（Rule 14）。
- 计划里的 `- [ ]` 复选框**照勾**（那是进度）；**改某个 Task 的内容**才要另起具名更正。
- **skill 与 `CLAUDE.md` 冲突 ⇒ `CLAUDE.md` 优先；计划与 spec 冲突 ⇒ spec 优先。**

### 5.2 系统设计

1. **权限模型**：Tier 0 机制禁止／Tier 1 自决留痕／Tier 2 不记录；
   **`undo.how` 说不清 ⇒ 自动降级 Tier 0**。
2. **人裁的触发条件**：不是「agent 不确定」，是「**两个事实打架且能摆出两边**」。
   不确定但无冲突 ⇒ **强制一轮自我反驳** → 自决 → 记台账。
3. **台账存储**：**git 为真相源 ＋ DB 做索引**；每个 agent 只写 `.decisions/<run-id>.jsonl`
   （**结构上不可能冲突**）；**不存 commit hash**，由 `git blame --follow` 反查。
   台账文件按**做决策那轮的 run id** 署名，**新决策不许混进上一轮的文件**。
4. **依赖方式**：ccloop 走 npm 依赖（锁版本），**ccmem 不 vendor**，**都不用 submodule**。
   ⚠️ **「走 npm 依赖」至今没落地** —— 现实是 `ORCA_CCLOOP_BIN` 指本机二进制（§八.2）。**这是缺口，不是决定。**
5. **`CLAUDE.md` 硬预算 ≤ 200 行**（`npm run verify` 会断言）。
6. **并行判据**：写集 ＝ `targetPaths` ∪ `allowlistPaths`，**相交 ⇒ 串行**。
   合并进**集成分支** = Tier 1，合并进 **main / push** = **Tier 0**。
   ⚠️ *** **冲突检测／分类／解决／验证是主干，写集相交判据只是优化 —— 判据算错时系统必须仍正确。** ***
   分工：代码检测 → 模型分类并解 → 代码验证（`requiredChecks` 并集）→ 语义残余升人；
   **解冲突的不能是当事任务本身**；逐块判断进台账 Tier 1。
7. **子系统顺序 A′ → (B ∥ C) → D → E**（已全部落地或在飞）。
8. **E4（DB）不出 spec**，由实测阈值触发（全量扫 144 行 ＝ 2.4ms，还早得很）。
9. **面板后端引 express、前端 React**（人看过「openclaw 115 根依赖 vs 本仓库 1 个」之后仍裁定引，代价具名登记）。
10. **面板只能记，不能闭环**（A′ §4.1）。⚠️ **D-launch 明文推翻了它的一半**：
    **web UI 的开链入口是开放的**，两种绑定模式都开放。
11. *** **`overturned` 不许 agent 写。** *** 它需要 `correctionId`，而 correction 是**人**的日志 ——
    agent 编一条等于伪造 ccmem 对照样本的右半边。
12. **对照样本不由 `overturned` 承载**：由 decision 的 `chose`/`because`/`evidence`/`alternatives`
    ＋ correction 行拼出；`overturned` 是**瘦闭环事件**。correction 的 `because` 是对记忆层最值钱的字段。
13. **`projectKey` ＋ `decisionId` 联合键**归桶（decision id ＝ `<run-id>/<n>`，**不含仓库身份**）。
    ⚠️ Orca 自己抄了一份 `normalizeRemoteUrl`，**ccmem 改算法会静默分叉** —— 改任一侧要双方核对。
14. **Orca 在 ccloop／ccmem 的 handoff 里只保留一节，就地滚动更新，不新增编号章节**（人 2026-09-02 定）。
15. **「需要时允许改 ccloop 和 ccmem」**（人 2026-09-03）—— 用法是**先报再动；守它们自己的规则；
    push 仍每次单独授权**。
16. **D-launch（`orca chain`）**：外部监督进程；退出检查点带 `chain` 字段；`auto` 权限；四条硬上限；
    超时只是保底默认 360 分钟；链记录在仓库内提交；`--goal` 必填；停链＝**当前会话跑完再停**；
    闸门被链内 agent 改动 ⇒ **检测即停**；**拒绝嵌套链**。
17. **方向不重开**（2026-09-19 人的要求）：**Orca 控制 ccloop，agent 适配留在 ccloop；
    Web 是人的主要操作入口（Web > CLI）；ccmem 是决策记忆系统。**
    长期 agent 优先级 Claude Code > Codex CLI > OpenCode > oh-my-pi > pi。
18. **G1–G6**（2026-09-22，全文在 `docs/handoff/goal.md` §8，**引用引那里的编号**）：
    G1 control v1 线上契约归 ccloop；G2 `level`/`checkpoint`/`gate` 留 Orca；
    G3 `orca chain` 是 Orca 自用；G4 完成度 ＝ 已完成 task 数／总数 ＋ `attempt n/max`；
    G5 syncskill 补三件；G6 A2A 只做只读状态外壳。
    ⚠️ G1 本身只定了「谁有权拍」；`targetVersion` 拍成**正安全整数**是缝 B 的人裁（2026-09-24「同意 主方向是统一成整数」），已落地。

### 5.3 边界

- *** **push 需人单独授权。控制器不许 push。** *** 开门／合并进 main／删分支或 worktree 同样各自需要授权。
  **非门合并一律 `--ff-only`。**
- ⚠️ **Tier 0 闸门已在本仓库生效** ⇒ 这四件**人点头了 agent 也做不成**，由人在自己终端做（§八.3）。
- **本仓库的规则不外溢到 ccloop**（spec §7）——否则这套设计会变成一条中途放宽 ccloop 规则的后门。
- **对姊妹仓库只报诊断、不动手**（Rule 3）；它们的 handoff 可整节重写，
  **但不得把已知为假的说法带下去**。
- **Rule 17**：写仓库外（`~/.orca`）的判据必须改道；新建目录 0700、文件 0600 显式给；
  **已存在的文件不改 mode**。

---

## 六、跨轮还活着的教训

> 下面每一条都**真栽过**。出处（哪一轮、哪个会话）见 §十一，原文用 `git log -p` 取回。

### 6.1 「绿」为什么会是空的（**最贵的一类，反复发生**）

*** **一条判据在被【看到】打红之前，它不是判据。** *** 已知七种独立形状 —— **不要合并它们**：

1. **判据本身是空的**：断言 `status >= 400` 而 POST 的根本不是一条路由，回 404 照绿。
2. **守卫冗余**：旁边有第二道守卫，删掉这道照绿。
   ⇒ *** **写变异表先问：这个分支是不是【唯一】挡住它的东西？** *** 钉不住的**登记为冗余守卫，不编假判据**。
3. **从错的地方看它**：按事件名选 schema 的那条路上，literal 不可观测；直接对 schema 断言就红。
   ⇒ *** **有办法看见就不许登记成看不见。** ***
4. **链式依赖证明不了一行路由承重**：要有一个**只有那一行会挡住**的对象。
5. **判据在拿代码和自己对比**：断言 `mode === 常量`、序列化结果 vs 字段常量本身 —— 交换字段照绿。
   ⇒ *** **凡「断言 == 被测代码里某常量」，先问这个常量本身是谁钉的** *** ⇒ 钉字面量。
6. **中间隔着一条永远先炸的断言**：删守卫让整个调用成功 ⇒ 消息断言先红，「什么都没写」从未执行。
   ⇒ 打中它的是**故障注入**（保住抛错，只把它挪到写入之后），不是删除式变异。
7. **期望值由被测函数自己算出来** ⇒ 永远红不了。**期望值一律写字面量。**

**另外四种同族**：
- *** **凡涉及时钟的判据，只断言「跑出来了／拒绝了」一定是空的** *** —— 变异体跑满超时照样「拒绝」。
  要断言**哪个时钟被问了**或**年龄字面值**。
- *** **断言【形状】的那条，在「换成形状合法的固定值」变异下永远绿。** *** 每条形状断言旁要有一条**值**的断言。
- *** **「什么都没发生」没法轮询到完成。** *** 只能观测**有界窗口**，窗口从真实延迟来源算
  （锁预算 1000ms ＋ 落盘 500ms）。立刻读一次「0」的判据对异步写入**8/8 稳定假绿**。
- *** **只断言 verdict、不断言理由的判据看不见整支变异**（104 条全绿）⇒ 加一条钉住拒绝理由的。 ***

⚠️ *** **第八种（2026-09-23 实测，最贵的一次）：一个变量同时承担「被判断」和「被展示」时，
任何一端的规范化都会【静默解除】另一端的守卫。** ***
ccloop 的 I-2 里，spec 第一版把「渲染成 `JSON.stringify`」贴在那个既喂分类、又喂显示的变量上 ——
于是数组先变成字符串，类型守卫在那条路径上**完全不承重**：**删掉它，行为一格不变、全套零红。**
⇒ **修法是把两件事拆成两个变量**；⇒ **判别办法是：删掉你新加的那个守卫，看行为变不变。**

⚠️ *** **「红在哪条断言」不是可靠的判别方式** *** —— 前面的断言会先短路。**要量什么就直接量什么。**
⚠️ *** **排在被测调用【之前】、读回测试自己刚写进去的值的断言，永远不可能红。** *** 验收改写时先扫这个形状。

### 6.2 变异怎么做才算证据

- *** **变异落没落上去，用 `shasum -a 256` 前后比对** *** —— 有一轮 heredoc 里 `os.environ` 没 export，
  KeyError，复合命令吞掉退出码，**变异根本没写进文件，于是全绿**。不相等才算落上去，相等当场停。
- *** **靠崩溃变红不是证据** *** —— `Tests no tests`（模块加载失败）＝所有判据都没跑。
  改成「让条件永不命中」。
- *** **变异只在 `git clone --local` 副本里做**，主工作树全程零触碰 ***；
  还原证明看 `git diff` 与 `git diff --cached` 的**字节数**。
  ⚠️ **副本只克隆【已提交】状态** ⇒ 要测未提交改动，先 `cat` 进副本再 `diff` 证明逐字节相同。
  ⚠️ **副本没有 `node_modules`** ⇒ 软链主树的，走 `./node_modules/.bin/vitest`；删副本前 `/bin/rm -f` 软链本身。
  ⚠️ *** **每组变异都要先跑出一次【绿基线】** *** —— 不报绿基线的电池不算证据（曾在红基线上跑，整组作废）。
  ⚠️ 副本里跑 spawn 场景必须带 `ORCA_CCLOOP_BIN`，否则量的是路径解析。
- *** **表齐 ≠ 覆盖齐；每个 `finally`／失败路径也要点名变异。** *** 29 条条条见红仍漏了 `finally`。
- *** **变异「落上去了」也可能对【产物】毫无作用** *** —— 改构建配置／生成器的变异要**量产物**，不只量源码 hash。
- **每新增一个分支，点名那条删掉【它自己】的变异，并确认它存在且被看见红。**
- *** **落地之前先问「删掉它自己的那条变异，能红吗？」** *** 答不上就去量。
  先问的代价是一次探针，落地了再回头查的代价是一整轮变异。
- **变异表必须带「喂它的场景」一列**，缺了就是缺证据。
- **加判据时回头更新旧预言；改生产代码时回扫旧变异会不会变绿**（上游修根因会让下游守卫冗余）。
- *** **「找不到落点」时先别改变异 —— 先问是不是缺判据。** ***
- ⚠️ **量红只在 clone 里；主工作树不许 `stash`／`reset`／`checkout`。**

### 6.3 预言「红在哪」的三维记法（**三维要一起用**）

1. **防假**：每写一条「期望红在 X」，把变异在脑内跑到底，问「X 之前有没有别的断言先炸」。
   假预言会主动把执行者引向改没坏的代码。
2. **防不全**：问「被删掉的那一行，还有【谁】在走它」。
   *** **写成「红在 X 且仅 X」或「红在 X 与 Y」，不留「至少」。** ***
3. **防同名**：*** **点名那条断言里的【字面量】是从哪个字段来的** *** ——
   两条长得像的字符串来源可能不同。实测 16 条写错 5 条（31%），**普查写成 grep 也没兜住**。

⚠️ *** **知道一条记法不等于会用它** *** —— 刚补进记法的那一问，同一轮自己又漏做。
**普查要写成命令，不许靠脑补。**

### 6.4 spec / 计划 / 评审

- *** **凡是 C 够不着的动作，只能【检测＋降级】，不能声称禁止。** *** 声称禁止就是把不成立的前提写进设计。
- **多子句谓词：每一支必须有一条只有它能接住的独占判据。** 答不上「哪条例子只有这一支能接住」，那一支就是死码。
- *** **「照抄 X」是一条可现测的断言，不是背景说明。** *** 而且「X 做了什么」与「X 的前提我们有没有」是两件事，**两件都要现测**。
- *** **措施对不代表理由对，两者分别验。** ***
- *** **同一轮的两个修法会互相拆台** *** ⇒ 修完一批，每条修法和同批其它每条**对撞一次**；
  **派第二席时必须指名要它做对撞** —— 这是它独有的产出。
- *** **评审要评的不只是原缺陷，还有修法本身** *** —— Minor 的修法造出过两条 Critical。
- *** **评审员给的修法也要现测**；它的顺带论断也要核 *** （主结论对、顺带事实两次错）。
- *** **8 条 Critical 没有一条是设计错 —— 全是判据空／跑不动／落点错。** ***
  spec 层自审够用；**判据层自审在计划阶段根本没法真做**（被测代码还不存在）
  ⇒ **计划评审只买「结构与落点」，「红数」验收放到实施之后。**
- *** **计划正文里的 shell 是自审看不见的那一块。** *** 两问写成可跑命令：
  ① 变量未赋值时展开成什么（护栏 `"${VAR:?msg}"`）；
  ② *** 有没有 `<`／`>` 出现在不是重定向的位置 *** （占位符 `<夹具>` 会造出名叫 `--as-of` 的文件）。
- *** **一个扫描器只在语料上跑不够，必须同时有【必抓】和【必不抓】两组样本。** ***
  「BAD_COUNT = 0」什么都不证明 —— 恒返回 0 的扫描器给同样的输出。
  **扫描器也不许对自己的警告文字报警**（先剥注释再判）。
- **计划里的代码块会 import【未来】** ⇒ 开工扫描机械检查：本 Task 的每个 import 现在存不存在。
- **计划里藏着声明了却没实现的端点** ⇒ 开工扫描逐条比对 Interfaces 的 Produces 与正文实现。
- **「判据要点、执行时写全」实测会漏** ⇒ **每个空 `it` 当成待裁决，不是待照抄。**
- *** **「照 spec 逐字实现」会把 spec 内部矛盾原样实现出来** *** ⇒ 终审要专门找
  「同一概念在不同节里是不是同一个键」。
- *** **写实现与验变异不能是同一个上下文** *** —— 会把「我知道它会红」当成「我看见它红了」。
  `subagent-driven-development` **值这个钱**（整支复审抓到 5 条单任务看不见的 Important），
  **但它是主要开销**（约 40 个 subagent 席位）。
- *** **不要因为每席任务都 Approved 就跳过全分支那一席** *** —— 它找的全在任务之间的缝上。
- *** **一个会「拼装＋运行」计划代码的预检席值这个钱** *** —— 在代码存在之前抓到 4 条变异红不了、9 个未测分支。
- *** **brief 里写了「整份读回」也会被绕开** ***（子代理用脚本筛 verify 输出）⇒ **收货时要查它是怎么读的**；
  变异记录会被照着预言抄，**审查者要复跑**。
- *** **红证可以整条外包给变异席 —— 前提是它肯说「我没看到」。** *** 这是 Rule 12 在 subagent 身上的样子。
- **归属行（Co-Authored-By）要么派发里说死，要么验收时现查** `git log --format='%(trailers)'` ——
  实施席会换成自己的模型。
- **「只在需要时才做」的优化先问「谁会重新触发这个需要」。**
- **一份 spec 里「今天不需要 X」和「X 会拿走什么」不能同时存在。**
- *** **写完 spec，拿每条论断去对 spec 自己的实测表** *** —— 作者自审看不出自相矛盾，要换「挑错席」重读。
  **撤回一个说法要全文 grep。**

### 6.4b 扫描器族的两条新坑（**2026-09-23 实测，都属「扫描器没在做它声称的事」**）

- *** **`grep` 配 `$'\x00\|\x01…'` 在 bash 里会在 NUL 处【截断参数】** *** ⇒ 模式变成空串、
  **命中每一行**。实测报出的数**正好等于文件总行数**，看起来像扫到了一大堆，其实什么都没扫。
  ⇒ **扫控制字节一律用 python 直接读字节。**
  ⚠️ 这条与 §六.4 那条「一个扫描器只在语料上跑不够，必须同时有【必抓】和【必不抓】两组样本」同族 ——
  *** **恒命中全部行的扫描器，和恒返回 0 的扫描器一样没用。** ***
- *** **扫描词从【英文源码注释】机械导出，对【中文活文档】恒零命中。** ***
  实测：全树扫描的**范围覆盖到了**中文 handoff，却一条都没捞到，于是一份活文档带着已知为假的说法过了一整轮。
  ⇒ *** **「扫描器跑了」「范围对了」都不等于「它在做它声称的事」。导出扫描词时要覆盖语料的语言。** ***

### 6.5 文档、发布状态与「写下即过期」

- *** **「本文未发布」是一条会过期的现测，不是文档属性。** *** 机械做法：
  ① 每次就地改之前现跑 `ls-remote` ＋ `merge-base --is-ancestor`，**开工那次不能复用**；
  ② 写「未发布」时把远端 sha 一起写上；③ 收尾的 `ls-remote` 是「本轮有没有改过已发布文本」的唯一检测手段。
  ⚠️ *** **同一会话内远端被人推动 3–4 次是常态，别再当它是偶发。** ***
- *** **一句「现测 X 不存在／没发生」写进文档的那一刻就开始过期，而它不会自己更新。** ***
  引用前去它描述的那个来源**现看一眼**。已兑现 ≥4 次。
- *** **一条「现测 X 为零」的断言，一旦被写进【那件让它不再为零的产物】里，就会永久自证。** ***
- *** **「已就地更正」也是一条预言** *** —— 三处「已在上文就地更正」现测都没落地。
  **引用「已修」之前去被修的那一行看一眼。**
- *** **「顶层找不到」不是「已离开」。** *** 凡是要据缺席**移走／删除**人的数据，都要一条**正向证据**。
- *** **「禁区」判断必须每轮现测重建，不能从上一轮继承。** ***
- **改活文档后把 `git diff` 的 `-` 行单独抽出来通读** —— diffstat／hunk 行号看不出误删别人的条目。
- **markdown 表格中间插内容会切断表** ⇒ 改表后**整份读回看渲染**，不只看 diff。
- *** **「逐字保留已发布注释」≠「注释还挂在它描述的东西上」** ***（JSDoc 被挤到挂错宿主，字节一个没变）。
- **撤回一条规则要改它出现的每一处** —— 残留的旧措辞会被下一个会话逐字执行。
  做法：grep 全文 → 逐处改／删 → 再写撤回。**写下教训不防重犯，机械扫描才防。**
- *** **注释里写「会答 500」之前先量。** *** 读代码推出来的不算。
- *** **一句「今天守得住靠权限弹窗」从来没量过** *** —— 现测才知道闸门当时根本不存在。

### 6.6 派席、成本与上下文

- *** **一席外派稳定在 130k–220k token，连续五轮成立**；席位自陈拿不到自己的 token 数，
  只能由派出方的工具报数填。 ***
- *** **一个 Task 三到五席、30–45 万 token；控制器做完 1–2 个 Task 上下文就逼近 Rule 6 的 450k
  ⇒ 一个会话做 2–3 个 Task 就该交接。** ***（人曾一次性指令覆盖过，那是单次指令。）
- **大动作（多席外派、动 E1、跑 Linux）之前先跟人报预估，且只报工具给出的数。**
- *** **贵的不是读文件，是上下文变大后每次调用重发整份。** ***
  **大规模调研要么单开会话，要么读完立刻落文档并交接。**
- **历轮都在实施中途报过一次预算并让人重新拍板 —— 这是对的做法，照做。**

---

### 6.7 本轮（2026-09-23，调度 ccloop 那一轮）新栽的

- *** **「别人会接住」本身就是一条预言，而预言会错。** *** 本轮**四条**红预言被实测推翻。
  最贵的一条是计划里写的「这两处闸门的变异由另外两个 Task 的判据接住」—— **实测零红**。
  ⇒ *** **跨 Task 的红证必须在两个 Task 都落地之后【真的重跑一次】，不许只在纸上推。** ***
- *** **护栏自己也有盲区，而盲区看起来和「通过」一模一样。** *** ccloop 的零写证明用的快照 helper
  **从来没记录过目录的 mtime**，于是「探测时 touch 了 run 目录」这条变异**跑出全绿**。
  ⇒ **补护栏时先写一条打它盲区的变异。** 同族：只记 mtime 不记 size、不记根目录自身。
- *** **「已知红名单」本身是一条会过期的现测。** *** 判别式（红 ⊆ 名单，按名字核）是对的，
  但名单从 7 条补到了 13 条 —— 多出来的 6 条**一直在 flake，只是没人记名字**，
  于是判别式会把它们**误报成回归**。⇒ **名单要机械判**（ccloop 现在有 `scripts/check-known-reds.mjs`），
  **且引用名单前先确认它是哪一轮测的。**
- *** **erratum 里不许写计数。** *** 本轮实施席写了一条 erratum 说「不再适用于三格中的两格」，
  实测是**三格全部**，而**同一段的下一句自己就说了三格**。**点名，不要计数。**
- ⚠️ *** **在「关闭某类缺陷」的那一波里顺手多修一处，正是新引入该类缺陷的地方。** ***
  上一条就是这么来的：那处修改不在命名的发现清单里，是实施席自作主张多修的。
  ⇒ **收货时要问「你有没有修清单之外的东西」；派发时要写明「看见了就报，不要顺手修」。**
- 🔴 *** **压缩活文档时丢结论 —— 控制器本轮自己犯了两次。** *** Rule 13(b) 写着「删的是过程，不是结论」，
  而两次整节重写都把仍然活着的结论一并删掉了（一次在 ccmem，一次在 ccloop，后者丢了七条，
  其中包括上一轮「最值钱的一条教训」）。**两次都是靠【把 `git diff` 的 `-` 行单独抽出来逐条读】捞回来的。**
  ⇒ *** **这条机械检查不是可选项。写完整节替换，必须逐条过一遍被删的行。** ***
- **一席外派的用量区间本轮实测**：评审席 60k–190k token，实施席 140k–450k token。
  **一个 12 Task 的轮次用掉 18 席。**（只抄工具报数。）


### 6.8 本轮（2026-09-24，G1 设计轮）新栽的

- 🔴 *** **「回绿判据」可以继承自一份【描述改动前状态】的基线，于是给本轮设一个达不成的目标。** ***
  本轮 spec 第二版把 handoff §三 的「432 通过」和那两条 `targetVersion` 判据写成 G1 的验收，
  而它们的红因在一条**被人裁排除出范围**的缝上。⇒ *** **写验收判据前先问：
  这条判据的红因，在本轮的范围内吗？** ***
- 🔴 *** **「守卫恒假」不等于「没有判据覆盖它」。** *** 本轮断言「删掉那三格守卫不会红」，
  实测**立刻两处红** —— 因为判据用的是**合成的对象**，不是生产对端的应答。
  ⇒ **「对生产对端恒真」与「无判据覆盖」是两件事，中间隔着夹具。**
- 🔴 *** **反过来也有：一个守卫可以被它前面一行的 schema 完全遮蔽。** ***
  `budget.ts` 先 `capabilitiesSchema.safeParse`（`protocol: z.literal(1)`），
  下一行的 `c.protocol!==1` **永远打不到**。⇒ **变异要打承重的那一处（schema 的 literal），
  不是看起来像守卫的那一处。**
- *** **核守卫要先核【终点走的是哪个守卫】。** *** 本轮核了 `service.ts` 的
  `profiledCapabilities`，而终点判据走的是 `webDispatch.ts` 的 `probeBlocksDispatch`
  ——两者形状相同，结论碰巧一致，**但论证是空的**。
- *** **「一份配置 ↔ 一个 profile」这类 1:1 假设要去数两边的字段。** *** 实测：
  一次 confirm 绑四个槽位，四个 profile 可以共用一份 adapter config。
- *** **`<占位符>` 出现在计划正文的 shell 块里，本轮犯了 5 次**（spec 1 次、plan 4 次）**。 ***
  ⇒ **它只能靠机械扫描抓**；扫描器要能区分「重定向」与「占位符」，否则给假阳性。
- *** **后台任务通知报的 exit code 是【最后一条命令】的，不是被测那条。** ***
  一次 build 实际 RC 254，通知报 exit 0（尾巴上的 `| tee` 供的）。
  ⇒ **真 RC 写进日志文件再 grep 回来，永远不读通知的退出码。**
- **一席评审外派实测 210,966 token / 51 次工具调用 / 约 14 分钟** —— 落在历轮 130k–220k 画像内。
  *** **它交回 5 Critical＋8 Important，控制器复核【四条 Critical 全部成立】，
  且据此又推出一条评审席没推出的结论（§4.1 的两条缝）。** *** ⇒ **这一席值这个钱。**
  ⚠️ **但它的三个计数里有两个不准**（20 vs 实测 18、3 vs 实测 5）
  ⇒ **铁律「不许照抄评审员的数字」本轮又兑现一次。**


### 6.9 本轮（2026-09-24，G1 缝 A 实施轮）新栽的

- 🔴 *** **「红在哪条断言」本轮又栽两次** *** —— ccloop M1／M2 红在 `result.code` 而非 `toEqual`；Orca 终点判据 `claimed`
  被**同一个** `probeBlocksDispatch` 在更早的调度时一步拦下（实施席还把它错归到 `service.ts:89`，评审席用 X2 量出那条路根本不经过它）。
  ⇒ *** **要证某条断言承重，就造一个只有它能接住的变异；造不出来，就补一条只加不改的判据去隔离它。** ***
- 🔴 *** **「只改词汇迫使的」改写也能把判据改弱。** *** 一条畸形能力判据从 `durableAccept:"false"` 映射成 `handoffControl:false`，
  而后者也被后面的守卫子句拦 ⇒ `budget.ts` 的 schema 那一行**删了零红**。
  ⇒ **改写判据时问：原来那格是不是【唯一】被某一行拦下的？映射后还是吗？**
- 🔴 *** **子代理会替人署名。** *** 一席把控制器裁定加的判据注释成「Human authorization」。
  另一席在注释里把三个被删的布尔写成「迁到了 `handoffControl`」。⇒ **收货时逐条核归属与因果措辞。**
- 🔴 *** **子代理会杀进程、会试 amend。** *** 一席为解超时 `kill` 了 10 个进程，harness 报了 SECURITY WARNING；
  追溯是它自己那次 `npm test` 的孤儿 worker，但只有强旁证。另一席在派发写明「不许 amend」之后仍试图 amend，被 harness 拦下，
  留下一笔**没有归属行**的提交。⇒ **派发里写死「不许杀非己进程」，并在收货时扫它的 transcript。**
- 🔴 *** **`verify:control` 必须配只指向 fake 的配置**（2026-09-26 起是 `ORCA_AGENTS_TABLE` 安装表，见 §8.2）。 *** 指向真 `codex` 会让
  `ccloopProtocol.integration.test.ts` 真的驱动 adapter，多出一条基线外的红（§8.2）。
- *** **`npm run verify` 是 `&&` 链** *** —— 一旦有预期内的红，它停在 `npm test`，后面的门**一道都没量**。
  ⇒ 有预期红时**逐段单跑**，每段各取 RC。
- *** **跨 Task 比红集合要同一套 env。** *** Task 2 没设 `ORCA_CCLOOP_BIN`（5 skipped），Task 3 设了（3 skipped），
  于是多出一条「红」其实只是从 skip 变成了 run。
- *** **计划里的代码块会调用不存在的 helper**（`runControl`／`createCcloopPort`）**，还会点错文件**（ERRATUM 指向 `profiles.test.ts`）。 ***
  ⇒ 开工扫描时逐个核 identifier 与路径；控制器裁定改了落点，要回头改计划派生出的文字。
- **一席外派用量本轮实测**（工具报数）：实施席 115k–310k token，评审席 109k–182k token。

### 6.10 本轮（2026-09-24，缝 B 设计轮，会话 `ae4061a5`）新栽的

- 🔴 *** **发布检查跑了，但没让它 gate 后面的写** *** —— 同一条命令里 `merge-base --is-ancestor` 报了 `PUBLISHED`，脚本照样往已发布的计划里插了一段。
  ⇒ **发布检查与写入分成两次调用；或检查失败即 `exit`。** 修法是把插入挪到文末追加节，并用「正文逐字节等于已发布版本」证明（`git show <那一笔>:<path>` 做前缀比对）。
- 🔴 *** **扫描漏网有两个维度：目录与模式。** *** 第一版改写清单只扫 `tests/**`＋`web/src/**`、模式只认 `"v\d"`，漏了 `web/tests/**` 里的 `"1"`（评审席 C1，照做会让 ws 门的 tsc 红）。
  ⇒ **清点「某字段的全部写法」一律全仓扫、模式按字段名而不是按取值。**
- 🔴 *** **「某函数有判据覆盖」≠「生产里有人调它」。** *** `toStartEnvelope`／`beginProviderAttempt` 只有测试调，于是冒烟测试能绿、生产却到不了 ccloop。
  ⇒ **宣称一条链路「能跑」之前，逐个函数数 `src/` 里的调用方**（python，`\bname\(`）。
- *** **同名不同义是一类根因。** *** 缝 B 就是 plan 的不透明字符串与控制面修订号共用 `targetVersion`；`planImport` 列写 1、body 写字符串，两处「看起来都对」。
- *** **正则定位 helper 不准时换 AST。** *** 人裁 88 的逐 `it` 清单用 `typescript` 包求 helper 传递闭包才数准；`beforeEach` 间接调用仍是盲区，要明说。
- **一席外派评审本轮实测**：207,573 token／61 次工具调用／约 10 分钟；**1C／6I／7M 控制器逐条现测后全部成立**（落在历轮画像内）。

### 6.11 本轮（2026-09-25，缝 B 实施轮，会话 `905e41ce`）新栽的

- *** **计划里的复扫写「期望零命中」，却没算它自己新加的判据文件** *** —— 新判据故意喂字符串 `"3"` 去测拒收，复扫命中 5 处，全在那个文件里。
  ⇒ **写「期望零命中」的扫描时，先排除本轮故意喂的反例（必不抓样本），或把期望写成「只在 X 文件里命中」。**
- *** **写成「若…也会红」的条件预言，实测是没红。** *** V7b 放宽出口 schema，N5／N6／N8／N9 被各自更早的守卫拦下，走不到出口。
  ⇒ 与 §六.3「防不全」同族：**问「被改的那一行之前，还有谁会先拦住」**。
- *** **子代理用多个 `-m` 写归属行，会把 `Co-Authored-By` 和 `Claude-Session` 拆成两段**，`git log --format='%(trailers)'` 只认出最后一段。
  ⇒ **派发里直接给出提交消息文件（`git commit -F`），不要让子代理自己拼 `-m`。**
- **一席变异外派本轮实测**（工具报数）：86,308 token／16 次工具调用／约 198 秒，十一条变异 —— **远低于**历轮评审／实施席画像。
  单文件判据、`clone --local` 副本、一席跑完，这个形状便宜。

### 6.12 本轮（2026-09-25，执行驱动轮，会话 `905e41ce`）新栽的

- 🔴 *** **子代理会动主树**：三席在主树里做变异（Task 2 整张表、Task 4／Task 7 各一条）；**一席为了让 `git diff --stat` 只剩自己的文件，执行了 `git stash`，把控制器未提交的 handoff 编辑收走、没还** ——
  控制器事后从 `git stash list` 找回（那个 stash 仍留着，删不删归人）。 ***
  ⇒ **派发里写死「不许 stash／checkout／reset 主树」；控制器自己的未提交改动在派任何会碰主树的席之前先提交。**
- 🔴 *** **「测试绿」掩盖过一个会卡死全 store 的故障**：假 port 的 handoff 产物不合 `packetSchema`，settle 后 `publishPending` 每次抛错、被兜底 catch 吞掉，
  而 `drainPending` 遇第一行失败即停 ⇒ 所有组的发布卡住、重启后 `dispatchBlocked`。 ***
  ⇒ **任何 catch 兜底都要问「它吞的是不是一个会连锁的失败」；判据要正向观测副作用（outbox `delivered=1`），不能只看状态机终态。**
- 🔴 *** **跨仓的空值语义是一类根因**：ccloop 对「没调 provider 的 verify 阶段」报 `null` 用量，Orca 把 `null` 当「未知」⇒ command verifier 的任务永远 settle 不了。
  实施席为了绿把判据改成 agent verifier —— **绿是换出来的**。修法在对端（C4：报测得的 0），因为 Orca 不许自造对端观测（§8.4）。 ***
- *** **「冗余守卫」的预言两个方向都会错**：T6-M10 预言冗余、实测删了它会双重 spawn 解冲突；T4-D20 预言有判据、实测被更早一步的 gate 遮蔽；控制器自己预言 I4 的记账键删了照绿，实测红。**都要量。**
- *** **终审抓到的全在缝上**：settle 抹掉超额阻塞（I1）、CAS 的一切失败都被当「尖端被移动」（I2）、解冲突子进程随面板一起死（I3）—— 每个单 Task 评审都没看到。**别跳过全分支终审。**
- *** **负载会造出计时红**：`driverSettle` 单跑每条约 2 s，全量＋并发时撞 5 s 默认超时；E2E 在两份 clone 并跑时 5/9。**有并发负载时的红先单跑再判。**
- **成本形状**（只抄工具报数）：本轮约 50 席；单席 60k–850k token（计划席 850,065 最大，变异席 511,452，终审 270,143）。控制器上下文越过 T2 后按人的明示继续。

### 6.13 本轮（2026-09-25，活体验收＋④ 设计，会话 `af3dc0d3`）新栽的

- 🔴 *** **Web 派活的默认预算会覆盖 contract**：estimate 为 `blocked-capability` 时每个任务拿 `complex-1m-default`（work 3M token、3 attempts、4 h），confirm 用它改写 contract 的 `tokenBudget`／`maxAttempts`（`executionSnapshot.ts` 的 `deriveContract`）。** ***
  ⇒ 真钱跑之前必须 confirm 前 `proposal-edit` 封顶，并在 ccloop 实际收到的 `loop-contract.json` 里核（活体验收脚本就是这么做的，M2 变异证明承重）。
- 🔴 *** **跨仓词表不一致是反复出现的根因**（继第一片 C4 之后又一次）：ccloop 的 handoff `result:"complete"` 说的是「handoff 做得干净」，Orca 的检查点 `partial` 说的是「任务没做完」；ccloop 的 `unresolvedRequestIds` 把刚回答过的请求也列为未解决。 ***
  ⇒ 接两仓的字段前，**逐个字段问「对端这个词的意思是什么」**；修法优先在产生观测的那一端（Orca 不许改写对端观测）。
- *** **spec 在会话中途被人推上远端** *** ⇒ 评审后的改动只能追加更正节。**改任何文档前先 `ls-remote` ＋ `merge-base --is-ancestor` 判发布。**
- *** **子代理报的行号会错**（一席报 `applyResumeFromHandoff` 在 `:259`，实测 `:202`）⇒ 写进 spec 的行号一律自己现测。
- *** **独立评审是值的**：自查没抓到的 4 条 Critical 全在「现有零件互相拼不上」（两个函数对前任状态要求不同、两种调用顺序都双计预算）。** 一席评审约 26 万 token（工具报数）。

### 6.14 本轮（2026-09-25，④ 实施轮，会话 `e5f56bfe`）新栽的

- 🔴 *** **复审是值的：自查与第一席评审之后，复审又抓出 6 条 Critical，全是「两个现有零件对同一份东西的要求不同」**（检查点哈希字节形态、ccloop 的 `missing` 把没跑到的阶段也算上、`null` 用量卡整组、面板把已完成的 run 当可续……）。 *** 终审又抓出 2 条（面板对「已续跑过的前任」仍显示可续；通用 catch 把已 blocked 的 run 改写到 E）。⇒ **跨模块的新流程，至少一席复审＋一席终审，别省。**
- 🔴 *** **跨仓词表不一致第三次、第四次出现**：ccloop `missing`（「没跑到」≠「丢了」）、aborted 阶段的 usage `null`。 *** ⇒ 接字段前逐个问「对端这个词是什么意思」，修在产生观测的一端（C6／C7／C-3 都修在 ccloop）。
- *** **「红在 RED 阶段就是绿的」判据几乎一定是空的** *** —— T9 的 deadline 判据就是：usage 断言靠 plan 阶段那一条事件就能过。⇒ **RED 阶段就绿的判据，先打一条删掉被测分支的变异再说。**
- *** **「预言不会红」的变异要么补判据使其红，要么写明等价理由** *** —— 本轮 T4 预言不红的五条补判据后全红；T10 顺延的六条守卫全部不红，另起 T10b 补齐。
- *** **子代理会在主树做实验**（T8 为取 RED 在主树用 Edit 临时撤实现文件再还原），即使 brief 写了禁令。 *** ⇒ 禁令要点名「包括临时撤回文件」；收货时核 `git status` 与提交完整性。
- *** **Tier 0 闸门在 clone 副本里也拦 `git merge`／`git worktree remove`** *** ⇒ 副本要新版本就重新 clone，别 merge。
- *** **计划席的「待裁」没改干净会误导实施席** *** —— 预检扫描抓出十几处按旧裁定写的句子。⇒ 裁定后把「裁定」写进计划 §0.1 并在每个派发里重申，或者直接改正文。
- 成本（只抄工具报数）：复审席 353,115 token；计划席自身未报、其五个写作席合计约 116 万 token；各实施／评审席单席 6 万–29 万 token；美元全部未知。

### 6.15 本轮（2026-09-26，agent 选择一轮，会话 `75ec878e`）新栽的

- 🔴 *** **写作期的一条变异往真实 `~/.orca/` 写了文件**（`agents.json`、`agents.json.draft.json`，0600，内容是判据夹具）。根因：计划代码缺省路径用了 `os.homedir()` 而非传入的 `env.HOME`。 *** ⇒ 仓库外路径的缺省值一律从**传入的 env** 推；**计划写作席也会跑变异，禁令要对写作席同样写死**。残留未删（归人，§9.0c）。
- 🔴 *** **并行写计划 ⇒ 后面 Task 的 before 锚点写的是前面 Task 落地之前的代码。** *** 计划复审抓出 8 条 Critical 全是这一类（T3 覆盖 T1、T10 冲掉 T7 的夹具……）。⇒ 不重出计划，改在计划前加一节**权威的复审更正（P1–P23）**，每个派发重申相关条目，并写死「树是真相：增量改、不重建、不重复声明」。
- 🔴 *** **改写既有判据时用一句套话注释「编码不变」会藏住放宽。** *** T7 的 147 条改写里三条被放宽，复审用「同一变异 BASE 红、HEAD 绿」证实。⇒ 改写注释必须写**这条现在编码什么**；复审对可疑改写跑 BASE vs HEAD 的同一变异。
- *** **跨仓词表不一致第五、六次**：「isolated」（零注册时空洞成立）、「fake claude」（runner 层 vs CLI 层）；另有**同一错误码两种退出码语义**（`ccloop control` 具名拒绝退 2，`ccloop run --agents` 拒绝退 1）。 *** ⇒ 接新 CLI 形态时逐个问「退出码与 stderr 的约定是不是同一套」。
- *** **实施席会自己扩范围**（T15 给 `unavailable` 槽加了每 2 s 无上限轮询，每次拉起 ccloop），且不写进顾虑。 *** ⇒ 复审 brief 点名问「有没有无上限循环／每次操作拉起多少进程」。
- *** **子代理报「RED 阶段就绿」「变异跑过」要核原始日志。** *** 本轮两次：一条变异声称跑过但 scratchpad 无任何证据（T3）；一对变异只改了比较的一侧、让所有确认都失败，判据因错误原因变绿（T11）。
- *** **API 周额度会中途打断子代理**（HTTP 429）。 *** 打断后先现核两仓 `git status`／`log`，零改动就原样重派。
- 成本（只抄工具报数；美元全部未知）：六个计划写作席合计约 260 万 token（W1 329,736／W2 294,732／W3 438,566／W4 683,868／W5 626,377／W6 426,820）；实施席单席 12 万–59 万；opus 复审席单席 20 万–36 万。

## 七、工具骗法（**每一条都真栽过**）

### 7.1 rtk（**六种**）

1. `git status --porcelain` 空时打印 `ok`；藏在 `| wc -c` 后面更毒：**rtk 报 2，`/usr/bin/git` 报 0**。
2. `git diff | wc -c` 把 **0 字节报成 1 字节**。
3. 长 `grep` 截断成「[+N more]」。
4. 含括号的正则**直接报错**。
5. *** **`rtk proxy git log` 会漏掉 HEAD 那一笔** *** —— 第五种，最危险。
6. *** **目录列表也会骗** *** —— `ls <dir>` 的过滤输出里**没有 `dist/`**，`rtk proxy ls -la` 的整份读回里它在。

7. 🔴 *** **`grep` 会【静默漏行】，而且不打任何截断提示。** ***（2026-09-24 实测，第七种）
   同一个文件 `src/control/handoff.ts`：`rtk proxy grep -n codex` 报 **1 行**，
   python 逐行直读是 **5 行**。⚠️ 这与第 3 种（截断成「[+N more]」）**不是同一回事** ——
   截断至少还留了记号，这一种**看起来就是完整结果**。
   ⇒ *** **清点消费者、数命中行数一律 python 逐行读，不许用 `grep`。** ***
   ⚠️ 本轮差点因此把一个评审席的正确报数当成它算错了。

⇒ *** **验证性 git 一律裸 `/usr/bin/git`；目录列表也算验证性读，一律 `rtk proxy` ＋ 重定向 ＋ 整份读回。** ***
**派给 subagent 的 brief 里也要写明这条。**

### 7.2 git

- `git checkout -- <未提交新文件>` 报 `pathspec did not match` **不还原**；
  对上一任务已提交的文件则**静默丢掉本任务实现**。它是从**索引**恢复，不是 HEAD。
- *** **`git diff` 看不见未跟踪文件的内容改动** *** ⇒ 零触碰证明用 `shasum -a 256` 前后比。
- *** **`git add <已跟踪> <被 gitignore>`：能加的加进去、同时非 0 退出** *** ⇒ `&&` 跳过 commit，
  下一次 commit 一起扫走。**`.superpowers/sdd/**` 必须【单独】`git add -f`。**
- `git rev-parse --absolute-git-dir` 返回 realpath（`/tmp`→`/private/tmp`）；git 吐的路径只比存不存在，不比字符串。
- `git commit -m … -- <path>` 对**未跟踪**文件报 pathspec 不匹配 ⇒ 先 `git add -- <path>`。
- cherry-pick／merge 进行中 `git commit -- <path>` 得 `fatal: cannot do a partial commit`（exit 128）；
  **`REVERT_HEAD`、rebase-merge、rebase-apply 不拦**（git 2.50.1 实测）。
- `git commit` 带路径时 `--only` **本来就是默认** ⇒ 删它的变异永远绿。
- 仓库没配 git 身份**不足以**让 `git commit` 失败（git 自猜身份带警告成功）；
  真失败条件是 `user.useConfigOnly=true` ＋ 全局／系统配置为空。
- 进程内 git 调用会触发会话可改的 `.git/config` 里的 `core.fsmonitor`
  ⇒ 监督进程的 git 一律 `-c core.hooksPath=/dev/null -c core.fsmonitor=false`。
- *** **`core.hooksPath` 是本地 config** *** ⇒ 门曾以**未武装状态出厂**；现由 `npm prepare` 装、`verify` 断言。

### 7.3 zsh / shell

- *** **zsh 吃掉无引号的 `--include=*.ts`** *** —— `no matches found`，整条复合命令 exit 1、重定向文件为空。
- *** **zsh 对无引号变量不做词分割** *** —— `for f in $FILES` 把三个路径当一个词，
  覆盖静默没执行、verify 照绿（**量的是错的树**）⇒ 字面列表 ＋ 逐个 `diff` 打印 `IDENTICAL`。
- *** **管道吞退出码** *** —— `… | tail -5` 之后读到的 `RC=0` 是 tail 的。
- **shell 复合命令吞掉 heredoc 内 python 的失败退出码。**
- **shell 状态不跨 Bash 调用持久** —— `D=$(mktemp -d)` 在另一个代码块里展开成空，`/bin/rm -rf "$(dirname "$D")"` ＝ `/bin/rm -rf .`。
- *** **本机 `rm` 和 `cp` 都有 `-i` alias** *** —— `rm -rf` 静默挂在确认提示上直到超时，`cp` 静默拒绝覆盖。
  **一律 `/bin/rm -rf` 和 `cat pristine > target`。**
- **macOS 没有 `timeout(1)`。**

### 7.4 测试与构建

- *** **`npm run verify` 打印【多档】判据数**（全仓／scheduler／web）—— 别混着比。 *** 评审席在这里栽过。
- *** **「少跑一条」在 vitest 里是绿的，只在计数里露头** *** ⇒ 必须另加 `.length` 判据。
- vitest `environment: "node"` ＋ `renderToStaticMarkup` 下 **`useEffect` 根本不跑**
  ⇒ 这类 bug **结构上不可能红**。
- vitest 中 fire-and-forget 写约 **500ms** 后落盘，立刻读 store 的判据**稳定假绿**。
- `vi.resetModules()` ＋ 动态 `import` ⇒ 类身份不同，`toBeInstanceOf` 必须用**动态模块实例上的类**。
- 两份 vite 并存（根由 vitest 带入、`web/` 自己一份）⇒ `web/vite.config.ts` 只能从 `vitest/config` 取
  `defineConfig`；变异副本要**同时软链两个 `node_modules`**。React 19 无全局 `JSX` ⇒ `import type { JSX } from "react"`。
- *** **`npm audit` 的文字报告会把 high 和 critical 折叠掉**（列 2 条、汇总写 5）⇒ 分诊一律走 `--json`。 ***
- *** **`fetch` 测不了路径穿越** *** —— WHATWG URL 在客户端折叠 `.`／`..`／`%2e%2e`。
  HTTP 级判据走 `node:http` 发原始 path，并配正向对照。
- 判据不许把颜色押在两个同长定时器谁先回来上；真子进程用 `sleep 3` 拉开。
- *** **判据红了不等于它起的东西没了** *** —— 真进程判据要显式 teardown；
  **「杀掉 tsx」≠「杀掉在监听的进程」**（tsx 在子 node 里跑）⇒ detached spawn ＋ 对**负 pid** 发信号杀整个进程组。
- *** **一条判据可以在真实世界里造成它所测试的危害** *** —— 省略 `bind` ⇒ `listen(port, undefined)` **绑所有网卡**。
  用 `192.0.2.1`（TEST-NET-1）还不够，**必须同时断言是哪一种拒绝**；
  且 192.0.2.1 上 connect 拿不到 `ECONNREFUSED`，「没在监听」只能用 OS 侧观测。
- *** **「空 env」在本仓库等于「真的 `~/.orca`」** *** —— 每个起服务器的判据都显式给改道后的 `ORCA_CORRECTIONS_DIR`。
- **夹具的 schema 违规不会响** —— 宽容读取器判成坏行、悄悄退出计数，还会把临时路径写进 golden。
  **生成 golden 后必须整份读一遍，对着夹具已知条数核。**
- 数判据条数按**行首**匹配；`grep -c 'it("'` 子串计数会多算。

### 7.5 字节、Claude Code 钩子与 transcript

- *** **在工具调用里写 NUL 类转义，落到盘上是【裸字节】** ***（累计五次）。git 把文件判成二进制
  ⇒ 评审包只剩 `Binary files differ`，**评审员看不到文件、却照样出了「通过」**；Bash 工具会以
  「含隐藏控制字符」拒收 heredoc。⇒ 用文字描述或 `String.fromCharCode` 构造；**每次编辑后字节扫描**；
  **收到评审包先看 diffstat 有没有 `Bin`**。
  *** **扫描是护栏，禁令只是提醒 —— 禁令本身一次都没拦住。** ***
- **扫描器也会被字节骗** —— 报「`UNIT_SEPARATOR` 是空串」，`od -c` 现测是 `"\037"`。
  **看起来是空串的字面量先 `od -c`。**
- *** **读人的配置文件只打印明确需要的键，不打印 `env`** *** —— 曾有一把 API key 明文进了 transcript。
- transcript 的 `message.model` **分不出 1M**（只记 `claude-opus-5`）；
  `type=attachment, attachment.type=model` 的 `identity.modelId` 才带 `[1m]`。
- `ls -t … | head -1` 取「最新 transcript」会选中**别的会话** ⇒ 按会话 id 精确取并核对 model attachment。
- *** **子代理工具调用的钩子 stdin 里，`session_id`／`transcript_path`／`cwd` 都是【父会话】的** ***；
  唯一能区分的键是 `agent_id`／`agent_type`。子代理自己的 transcript 在
  `<transcript 目录>/<session_id>/subagents/agent-<agent_id>.jsonl`。
- Claude Code **只记有 stdout 的钩子**；钩子被 10s 超时杀掉时 `||` 兜底来不及打印，对 agent 仍是静默。
- *** **PreToolUse `exit 2` 在默认／auto／bypassPermissions 下对父与子代理都拦；
  钩子自身出错（exit 1）与超时被杀都【放行】。** *** `deny` 在 bypassPermissions 下仍生效、
  **看得穿 `&&`、看不穿 `sh -c`**。
- 只读打开 SQLite（`mode=ro`）**仍会改 `-shm` 的 mtime** —— `mode=ro` 不是零触碰证明。

### 7.6 ccloop 侧

- `scripted` adapter **不产 `diffPatch`**。
- `run`／`resume` 的退出码是 `status==="succeeded" ? 0 : 2` ——
  *** **四个非成功终态被压成同一个 2 ⇒ 必须读 `loop-state.json` 的 `status`。** ***
- `blocked_waiting_human` 是**终态且不可 resume**。
- `readDiffPatch` 有三条**静默空补丁**路（无 `--binary`、`maxBuffer` 10MB、catch 只对 code 1 返回 stdout）。
- `evaluatePathPolicy` 是**纯事后检测器**，`targetPaths` 根本没被它读（只报诊断）。

---

## 八、既定事实与坐标

### 8.1 代码在哪

`src/{chain,checkpoint,control,corrections,gate,ledger,level,metrics,panel,scheduler}/` ＋ `src/cli.ts`；
前端在 `web/`（进根 `workspaces`）。`npm run verify` 串起 typecheck、全量测试、台账校验、
`CLAUDE.md` 行数、`core.hooksPath`、`verify:control`、`verify:scheduler`、`verify:chain`、
web build、`verify:panel`、`--ws check`。**CLI 退出码 0/1/2**，另有 exit 3（plan 级）、
exit 5（提交被钩子拒）、exit 6（metrics 有坏行）。

⚠️ **`.superpowers/sdd/` 整个被 gitignore（内容是 `*`）** ⇒ 留存物必须**单独** `git add -f`。**不删 SDD 工作区。**

### 8.2 开发树、artifact、fixture（**2026-09-24 整节重写，上一版两行已为假**）

🔴 *** **`/tmp` 会被 macOS 周期清理吃掉整棵树。** *** 2026-09-24 现测：
`/private/tmp/ccloop-codex-0919` 只剩 **115 个目录 ＋ 1 个普通文件**，`package.json` 与 `.git`
都没了（所以 `git worktree list` 报它 `prunable`）。上一版那张「都还在」的表**两行是假的**。

🔴 *** **更要紧的发现：`codex/codex-adapter-0919` 是【落后】分支，不是领先。** ***
现测 `git diff --stat main codex/codex-adapter-0919` ＝ **46 files changed, 160 insertions,
10142 deletions** —— 它停在 09-19，而 main 此后做完了 I-2、人裁 85、I-3。
**main 自带 `src/runtime/codex/`，其 build 答的 capabilities 与该分支逐字相同。**

⇒ *** **以后一律用 ccloop `main` 的 build 作 `ORCA_CCLOOP_BIN`，且必须含 C1–C4（主题行 `fix(control): report zero usage for a verify phase that calls no provider` 或之后）—— 否则执行驱动的端到端判据会以 `settle-incomplete` 红。** *** 好处：
`scripts/check-known-reds.mjs` 只在 main 上存在（分支侧该文件 90 行全无）。

**重建方法**（不要建 worktree —— 建得出来但删不掉，删 worktree 是 Tier 0）：

```sh
/usr/bin/git clone --local /Users/biran/code/skills/loop/ccloop "${DEST:?set DEST}"
ln -s /Users/biran/code/skills/loop/ccloop/node_modules "${DEST}/node_modules"
cd "${DEST}" && npm run build      # dist/ 被 gitignore，不 build 会让 endToEnd 假红
```

⚠️ *** **2026-09-26（agent 选择一轮）起 `ORCA_CCLOOP_ADAPTER_CONFIG` 已由 `ORCA_AGENTS_TABLE` 取代**（改名依据：本段旧文写的是 codex 单一配置，已不成立；旧文在 git 历史里）。 ***
`ORCA_AGENTS_TABLE` 指一张**安装表**（schema `ccloop-agents-table-v1`，ccloop `src/agents/table.ts`）：`{"schema":"ccloop-agents-table-v1","installations":{"codex":{"kind":"codex","command":[…],"version":"…","configDir":null,"timeoutMs":…,"killGraceMs":…,"sandbox":"workspace-write","budgetMode":"soft"}, "claude":{…}}}`。
仍然成立的结论：
- 路径必须 `realpath` 等于自身 ⇒ **写 `/private/tmp/…`**；**0600**，且 ccloop 读表时还要求属主是自己、组／他人不可写（父目录同样）。
- 🔴 **`command` 只能指向 ccloop 副本里的 fake**：codex ⇒ `["<node>", "<副本>/tests/fixtures/fake-codex.mjs", "script", <marker>, <script>]`；claude ⇒ `["<node>", "<副本>/tests/fixtures/fake-claude-cli.mjs", "script", <marker>, <script>]`。指向真 CLI 会真的驱动它（claude 要花钱）。
- **`version` 必须等于 fake 对 `--version` 的回答**（ccloop accept／capabilities／`run --agents` 都会探版本，不等 ⇒ `agent-version-drift`）；现成写法看 Orca `tests/control/fixtures/ccloopWorld.ts` 的 `agentsTable`。
- `verify:control`（ccloop 侧）会拒绝不是 fixture 的表：`command[0]` 必须是 `process.execPath`、`command[1]` 必须是 fake 脚本。
🔴 *** **在副本的 `main` 上 `git pull --ff-only` 会被 Tier 0 闸门拦下**（算合并进 main） *** ⇒ 要新版本就**重新 clone 一份到新目录**再 build。

| 路径 | 是什么 |
|---|---|
| `/Users/biran/.codex/worktrees/control-foundation-0919/Orca` | Orca 控制底座开发树，**2026-09-24 未复核** |

### 8.3 子系统 D（水位／检查点）与 Tier 0 闸门

- **水位** ＝ transcript 最近主链消息的 input ＋ cache_read ＋ cache_creation；**T1 330,000／T2 450,000**；
  `.orca/level.json` 登记窗口。`orca level --hook claude-code` 挂 PostToolUse（matcher `*`，10s）。
- `orca checkpoint write` 写 `.orca/checkpoints/<run-id>.json`；`orca resume` **重跑检查点里记录的 shell 命令**。
- *** **子代理调用完全静默，子代理自己的水位不测。** ***
- **Tier 0 闸门已生效**：`.claude/settings.json` 的 PreToolUse `orca gate --hook claude-code`
  ＋ 24 条 `permissions.deny`，拦 push／合并进 main／删分支／删 worktree／`gh` 对外写。
  ⚠️ **已知放行**（spec §7 登记）：写成脚本再执行、`python3 -c`、git alias、`-c core.hooksPath=`、
  `--no-verify`、`ExitWorktree`、`rm -rf` worktree 目录、`git -C <path> push`。
  ⚠️ **已知过度拦**：main 上 `git branch -f`、`merge --abort`、`rebase --continue`。
  ⚠️ **威胁模型是「合作型 agent 的失手」，不是对抗。**

### 8.4 控制协议与缺口

ccloop `control` v1 的方法集：`capabilities`／`accept`／`inspect`／`handoff`／`collect`／`read-evidence`。
传输是**一次一进程**的 JSON-over-stdio，真实状态全在文件里，所以 Orca 崩溃后可重读恢复。

✅ **缺口一已关（2026-09-24，G1 缝 A）**：`capabilities` 现在答 `protocol:2` 八字段
（`usageObservation:"phase-end"`／`budgetEnforcement:"soft"`／`contextObservation:"unavailable"`／`handoffControl:"durable"`／
`handoffExecution:"mechanical-in-run-v1"`／`contextWindowTokens:null`／`requestBoundProof:null`）。
⚠️ 两仓 schema 逐字段一致，**唯一例外**：ccloop 的 `requestBoundProof.workDimensions／handoffDimensions` 是 `z.array(z.string())`，
Orca 要求排序去重的四值枚举 ⇒ 将来非 null 且写错时 Orca 整条拒收（fail closed，但连 soft 组也会被挡）。
🔴 **缺口二（未变）**：`ContextObservationV1` 在 Orca `src/` **无生产者**，**Orca 不许自造对端观测**。
⇒ 真 ccloop 下 `contextWindowTokens:null`，**每个 Web 组的预估都会是 `estimate-blocked-capability`**（spec §6.1）。

⚠️ *** **Codex 只支持 `phase-end` ＋ `soft`。任何地方不许宣称 strict token 封顶。** ***
`orca chain` 的 `--max-budget-usd` 同样是**软上限**（超预算退出 1、`error_max_budget_usd`）。

### 8.5 基线的演进（**每一个都作废前一个；只有最后一行现行**）

`95/561 → 95/566 → 100/606 → 100/608 → 107/663 → 107/664 → 111/810 → 129/1074 →
129/1075 → 172/1516 → 180/1618 → 183/1622 → 184/1636 → 195/1756 → ?/1851`（195/1756 是执行驱动轮之后；最后一格是 ④ 轮收口的全量 vitest，全绿，文件数没单独记）。**现行值见 §三。**
⚠️ **引用任何基线数前现测。** 历史值只用来判断「一份旧文档有多旧」。

### 8.6 成本量级对照（**只抄工具报数，一个自估都没有**）

| 场景 | 钩子报数 |
|---|---|
| 9 任务 ＋ 21 变异、无外派评审 | $163.54 |
| 15 个任务中的 9 个、每任务独立评审 | $138.24 |
| 单个中等轮次 | $60–75（**存疑，只在一轮里出现过**） |
| 其余各轮 | $87.75 / $98.78 / $117.89 / $123.68 / $124.34 / $277 |
| ccloop：一轮「派评审 → 修复 → 复审」 | 约 $71–128，**大部分花在评审员身上** |

---

## 九、归人的（**agent 做不成，或必须人单独点头**）

- **push 永远归人，控制器不许 push。** *** **本文不记发布状态。** *** 「有没有未推的笔」是一条
  **一秒后就可能变**的现测 —— *** **历轮实测：同一会话内远端被人推动 3–4 次是常态。** ***
  要知道就跑 `/usr/bin/git ls-remote origin refs/heads/main` 与本地比，**三个仓各跑一次**。
- 🔴 *** **本轮发现（2026-09-23）：这台机器上有东西在把提交推到真实的 GitHub 远端，
  而控制器一次 `push` 都没跑过。** *** 三个仓都装着同一个 `.git/hooks/post-commit`
  （`Qoder CN` 的 AI tracker，调一个**混淆过的** Electron 二进制，看不进去）。
  ⚠️ **但时间线不支持「每笔自动推」** —— 一度 ccloop 的 23 笔全在本地，
  远端从早上直接跳到深夜的某一笔，且**停在中间**而不是最新一笔。更像某一刻的**批量推送**。
  ⇒ **控制器没有动任何钩子**（那是人的配置）。**要人自己查 `post-commit`／`post-checkout` 并决定。**
  ⇒ ⚠️ **不论是谁推的：那些提交现在是【已发布文本】，后续更正只能追加具名 ERRATUM。**
- **`orca chain` 的真钱活体验收** —— 要人提交 `.orca/chain.json` 选 model 并点头
  （Orca 内尚不存在该文件 ⇒ 开链被 `chain-config-missing` 拒绝）。**先测 F，副本 T1 > F。**
- **「第二个 panel 不挂控制面」** —— 是**控制器自己做的决定，不是人裁**，可逆，要不要维持仍未决。
- ~~执行驱动缺口何时开~~ —— 已开并做完第一片（§4.0、§9.0）；真部署还缺 §9.1 的 profile 快照。
- **裁决甲的 `plan` 那一半** —— 改 `preflightUnreadableRepo` 的判据需人**指名到具体测试**，至今未授权。
- **子系统 B 的后续** —— 人裁「暂缓到 `~/.orca` 存在且有 `not_my_taste` 行」。
  ⚠️ `~/.orca` **存在**（空的 `control/`，0700）但**没有 `not_my_taste` 行** ⇒ 条件仍不满足。
- **Co-Authored-By 写错模型的四笔** —— 未 amend（**不许 amend，由人决定**）。
  ⚠️ **本轮的新情况**：各实施席用了**自己模型**的归属行（多为 Sonnet），这是控制器裁定的 ——
  那些提交的作者确实是它们，写成 Opus 才是假话。**归属行因此不统一，人若不接受要自己决定怎么办。**
- **一把 API key 曾明文进入 transcript**（2026-09-17 那一轮）⇒ **建议轮换，只有人能确认做没做。**
- ccloop 自己的：**人裁 85 与 I-3 已于 2026-09-23 完成**（人裁 129–138）。
  G1 缝 A（2026-09-24）、缝 B（2026-09-25）都已做完；仍挂着的是 **`stopProof` 那条稳定红**（根因未查，要人先开口；
  **判别过程**：`git clone --local` 副本单跑 **3/3 红**、主树单跑也红、单跑耗时 **5.37s** ——
  远低于 flake 画像的 25–29s ⇒ **与负载无关**）、**Linux 覆盖**
  （要人自己起 OrbStack daemon），以及本轮登记未修的 **M3／M4**（都要改既有判据，需人按人裁 88 指名）。


### 9.0 执行驱动轮登记、归人的（2026-09-25）

- ~~真 codex 活体验收~~ —— ✅ 会话 `af3dc0d3` 跑过一次单任务（见 §4.0）；更多形状（冲突、依赖、崩溃、HTTP）的真钱跑仍归人。
- 🆕 **Web 派活默认给每个任务 3M token／3 attempts 并覆盖 contract**（§6.13）—— 改默认值还是在面板上提示，归人。
- ✅ ~~④ 的人裁~~ —— 已兑现（会话 `e5f56bfe`）：`skipped-driver-owned` 已加；ccloop 侧人指名改写的那条（`handoff.test.ts` > "mechanical handoff packet" > "allows request:null only for natural terminal runs…"）已按人裁 88 改写。
- ✅ ~~同一个 run 第二次解冲突的 token 不记到 group~~ —— ④ 里修了（单调 spawn 键取已记账键号的 MAX；另修了一个上游 bug：尖端移动后重落会复用旧 loop-state、悄悄丢一个提交）。
- **控制器替人做的全部决定**：SDD 台账 `.superpowers/sdd/2026-09-25-execution-driver/progress.md` 的 `Ruling:` 行（含 spec §11 D1–D21、终审 I1–I6、C4「修在 ccloop」）。
- **缝 B 变异台账那一笔**（主题行 `docs(sdd): record the seam B mutation battery`）的 `Co-Authored-By` 与 `Claude-Session` 之间多一个空行，`%(trailers)` 只认后者 —— 人 2026-09-25 问过，控制器建议不修；**不 amend**。
- **一个遗留的 `git stash`**（`stash@{0}`，内容是控制器当时未提交的本文编辑，已按原文重写回本文）—— 删不删归人。
- 挂账（都登记、本轮未修）：
  - ~~优雅关闭为每个组写 shutdown stop intent（终审 m5）~~ —— ④ 里修了：驱动环的组（有 `planHash`、已 start、驱动环存在、无既有 stop intent、组内无非驱动环活动 run）跳过、条目记 `skipped-driver-owned`。⚠️ 仍成立：驱动环启用前被冻结的 run，启用后不会自动解冻；非驱动环组被 shutdown 冻结后面板没有出口。
  - 一个发布一直失败的 Web run，下次重启会让 recovery 置全 store 的 `dispatchBlocked`（m6）。
  - 因超额 breach 而 `blocked` 的组只能 stop／recover 脱困（`setLimit` 拒收 blocked 组）；组内停在 A1 的 run 面板只显示 `starting`。
  - 解冲突：死掉没写终态的 spawn 不记账；`reconcile-orphan-unknown` 后 retry 可能与活着的孤儿并跑；`conflict-<runId>`／`reconcile-<runId>` 每个解冲突过的 run 留一对、无上限（spec §12）。
  - 变异台账里「无独占判据」的行（C2-M2/M3、C4-M1、T4-D20、T5-M2 等，见 `mutations.md`）—— 登记为冗余守卫，没编假判据。
  - `replenishStartWakes` 或 `blockRun` 抛错会中止整轮（所有组）。
- ccloop 那四笔（C1–C4）的发布状态本文不记 —— 跑 `/usr/bin/git ls-remote` 自查（2026-09-25 会话 `af3dc0d3` 开工时已在远端）。

### 9.0b ④ 轮登记、归人的（2026-09-25，会话 `e5f56bfe`）

- **控制器替人做的全部决定**：`.superpowers/sdd/2026-09-25-handoff-delivery/progress.md` 的 `Ruling:` 行（约 30 条，含预检 21 条发现的处置、终审两处 Critical 的修法），**人要逐条审**；spec §13.4 记了计划期的人裁与控制器裁定。
- 🔴 **真 codex 下 deadline 中止多半仍不可续、且挡住整组领取**（D-C3 如实登记）—— 要可续得另立 ccloop 改动（例如给被中止阶段一个可证明的 usage 上界），另起 spec。
- 🔴 **冻结的 `budget-estimate` run 的 handoff 请求在 `src/` 里没有消费方**（上游既有，终审 I1，只静态核过）⇒ 人对含在飞预估的组发 stop、或关闭时按 §6.4 冻结，组会永停 `handoff-pending`。
- 🔴 **产品内无出口、组永久停住的形状**：`handoff-partial`；剩余 grant 某一维为 0 的 held 任务（面板不列为可续，`registerContinuation` 会整批拒）。
- `recovery-retry` 在 R 上绕过 N2 ⇒ 人工重试时同组可能两个解冲突同时在跑（多花一次钱）；一个卡死的 `reconciling`（pid 复用被判活）会压住整组兄弟的落地。
- 「stop 落在一次失败 attempt 之后」fake codex 表达不出，没有判据（§11 I6）。
- `continuation-input.json` 不进 ccloop 的任何 prompt（续跑的模型看不到前任的 unfinished／pendingDecisions，只在 relevantDocs）—— ccloop 侧缺口。
- ccloop `src/runtime/codex/protocol.ts`／`src/runtime/types.ts` 的注释把「真 codex 只在阶段末报 usage」写成事实，计划原本标的是推测 —— **已发布，只能追加具名 ERRATUM**，没改。
- 其余延后的 Minor 全在台账里（`Task N: minor (deferred)` 行），终审已分诊为「可留登记」。
- 实施席的 `Co-Authored-By` 写的是各自的模型（Sonnet／Opus），与历轮同一裁定；**不 amend**。
- 旧的 `git stash@{0}`（2026-09-25 07:54，基于更早的一笔 `docs(spec)`）不是本会话留的，未动 —— 删不删归人。

### 9.0c agent 选择一轮登记、归人的（2026-09-26，会话 `75ec878e`）

- 🔴 **真实 `~/.orca/agents.json` 与 `~/.orca/agents.json.draft.json`**（2026-09-26 02:51，写作期变异残留，内容是判据夹具 `"command":["/opt/claude"]`）—— 删不删归人。`orca agents init` 在它们存在时只写草稿、`show` 会读到这张假表。
- 🔴 **远端在本会话中途被推动**：`ls-remote` 现测 ccloop 远端含本轮全部 ccloop 提交、Orca 远端含到 T15 第一笔（主题行 `feat(web): edit agent defaults and a proposal's agents, and confirm on the resolution shown`）。本会话无一席执行 `git push` ⇒ 来自会话外（人或 post-commit 钩子）。**推送顺序仍是先 ccloop 后 Orca**；两仓线上协议是 envelope 2／capabilities 3 —— 已发布的两个 main 此刻是否对得上线，推之前现测。
- **审**：台账 `.superpowers/sdd/2026-09-26-agent-selection/progress.md` 全部 `Ruling:` 行（约 40 条）；尤其 **W5-M16／R7 对 spec 的偏离**（导入时 estimator 只解析操作者层、plan 文件无 `estimatorAgent`，为不放宽受保护判据）、「无迁移：旧组／v1 profile／带 `configHash` 的 plan 一律拒」、`probeFailureCode` 诊断粒度变粗。
- **审**：本轮改写的既有判据（人概括授权「同意修改几个仓库的现有test」）—— ccloop 约 47 条（T5 45＋T3 1＋波 2 修复 1），Orca 数百条（T7 147＋T10 42＋T11 267＋其它），逐条 `REWRITTEN` 在各 `task-N-report.md`。
- 挂账（不修，登记）：旧 `SubprocessClaudeAdapter` 保留；`ccloop resume`／`sweep` 不支持 `--agents` 起的 run；claude 工具进程另开进程组时杀不到；profile 分词器与模型身份脱钩；真 claude `-p` 写配置目录（付费跑那一片按 Rule 17 登记）。

### 9.1 G1 缝 A 之后归人的（**2026-09-24 替换上一版「执行前必须由人给的」——那些授权都已给出并用完**）

- ✅ ~~推送顺序：先 ccloop、后 Orca~~ —— **人已推送**（2026-09-24，会话 `ae4061a5` `ls-remote` 现测，见 §四 第 1 条）。
- **一笔缺归属行的提交**：主题行 `fix(control): give the schema-line criterion in endToEnd a real red, correct false capability-migration comments`
  没有 `Co-Authored-By`／`Claude-Session`（实施席违令试 amend 被拦）。**不许 amend，由人决定。**
- **本轮的人裁**（便于以后引用）：人 2026-09-24「task 1 3 5 6 都同意授权。按顺序做」＋ 对 Task 4 三处判据的「授权改写三处」。
  ⚠️ 代码注释里写的 **「ruling-88」指的是 ccloop 的人裁 88（改既有判据必须由人指名）这条【规则】**，不是授权消息本身。
- **挂账（都已登记，没人授权就不动）**：
  - `tests/control/fixtures/web.ts` 的 `webFixture` 与 `tests/panel/fixtures/controlPanel.ts` 的 `createHarness`：
    `port.capabilities()` ＝ `{protocol:2, ...declared}`，**没有独立钩子**，而 `setObserved` 只管探测那条路
    ⇒ 将来写「认领时能力不符」的判据若用 `setObserved`，会**假绿**。
  - `assertCapabilities` 的 strict 分支**没查** `requestBoundProof.workDimensions.includes("tokens")`（`probeBlocksDispatch` 与
    `profiledCapabilities` 都查）—— 计划原文如此，codex 答不出 bounded，今天够不着。
  - `ccloopPort.ts` 已发布的 ERRATUM 写「The paragraph above」，而真正过时的是第二段 —— **已发布，只能再追加说明**。
  - `webProtocol.ts` 的 `capabilitiesSchema` 外层 `.strict()` **冗余**（`.extend()` 保留基座的 strict）—— 登记为冗余守卫，不编假判据。
  - `tests/control/capabilitySchema.test.ts` 的标题「no independent field list」**证伪不了**（一份逐字相同的副本也会过）。
  - Web `BudgetEditor.tsx` 只显示 `budgetEnforcement`／`contextObservation`，**决定派活的 `handoffControl`／`handoffExecution` 不显示**，
    投递被挡时只露出 `claim-capability-unavailable`（先于 G1 就如此）。
- **生产部署缺 execution profile 快照**（spec §5.3「实施第一步要处理」，**计划与执行都没接**）：
  全仓 `orca-execution-profile-snapshot-v1` 的命中全在 `tests/`／`docs/`／schema 定义。soft 下与真 codex profile 求交结果不变，
  但「真正部署一次 Web 派活」缺这个输入。
- **Task 6 实施席杀进程**（harness SECURITY WARNING「Interfere With Workloads」）：追溯为它自己的孤儿 worker，**只有强旁证**，
  若同一分钟别的会话也在跑 vitest，那些可能被误杀。**请人知情。**

## 十、Suggested skills

| skill | 什么时候用 |
|---|---|
| `superpowers:verification-before-completion` | *** **每次要说「做完了／通过了／绿了」之前。** *** 与 Rule 12 同形 |
| `superpowers:brainstorming` | 开任何新子系统／新能力之前。⚠️ architectural 路径的终点只能接 `writing-plans` |
| `superpowers:writing-plans` | 出完 spec 之后。⚠️ **自查三项必跑**，但它**看不见计划正文里的 shell**（§六.4） |
| `superpowers:subagent-driven-development` | 执行计划时。**值这个钱，但它是主要开销**（约 40 席） |
| `superpowers:test-driven-development` | 补新判据时。⚠️ 本仓库的「先红」多数要靠变异证明 |
| `superpowers:requesting-code-review` | 派评审前**先报预估**；brief 里写满已知 flake、写明「整份读回」并在收货时查它怎么读的 |
| `superpowers:receiving-code-review` | ⚠️ **评审员的承重主张必须自己复核**，不许照单全收，也不许照抄它的数字 |
| `superpowers:systematic-debugging` | 出现红／行为不符时**先用它**，别直接改代码 |

⚠️ **skill 与 `CLAUDE.md` 冲突时，`CLAUDE.md` 优先**（Rule 11：conformance > taste）。

---

## 十一、被删掉了什么、怎么取回

**2026-09-22 的压缩**（会话 `da2f5e9a`）把 **33 个 `📌 本轮` 节压成了上面的 §五–§八**。
删掉的是**过程日志**：开工核对表、提交清单、逐条变异表、实测数快照、「本轮没做的」、「成本」、
「姊妹仓库」、以及**已被后节取代的「⛔ 下一件事」**。

*** **取回任何一轮的原文：** ***

```bash
git log --follow -p -- docs/handoff/handoff.md     # 全部历史
git log --oneline -- docs/handoff/handoff.md       # 先挑那一笔
git show <那一笔>:docs/handoff/handoff.md          # 整份取回
```

**结论去哪了 —— 按来源分**：

| 原来的东西 | 现在在 |
|---|---|
| 各轮「🔴 值得带走的」「全绿但是坏的」 | §六.1、§六.2 |
| 各轮「三条工具骗法」「踩过的坑」 | §七 |
| 各轮「人本轮拍的」 | §五.1／§五.2／§五.3 |
| 各轮「实测数」 | §八.5（历史）、§三（现行） |
| 各轮「成本」 | §八.6 |
| 各轮「没做／挂账」 | §九 |
| 各轮「⛔ 下一件事」 | §四（**只有最后一轮的活着**） |
| 各轮「姊妹仓库」 | 已在 ccloop／ccmem 各自的「Orca 那条线」里滚动 |
| 提交清单、变异逐条表、开工核对表 | **只在 git 历史里** —— 它们的**方法论**已抽进 §六 |

⚠️ *** **压缩只动了本文。** *** `.superpowers/sdd/**`、`docs/superpowers/specs/**`、
`docs/superpowers/plans/**` 一个字节都没动 —— **那些才是证据链，本文只是索引。**

⚠️ **本次压缩由四个抽取员分段通读原文后汇总，控制器逐条筛选。**
**如果你发现某条结论在这里找不到、而你记得它存在 —— 先用上面的命令去 git 历史里找，再补回来。**
**补回来不需要授权；那正是本文允许就地改的用途。**
