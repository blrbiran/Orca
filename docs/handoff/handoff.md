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

**已经能跑的**：`orca validate`／`plan`／`correct`／`metrics`／`panel`／`compact-reviews`／
`level`／`checkpoint write`／`resume`／`gate`／`chain`（完整用法 `src/cli.ts` 的 `USAGE`）。
出厂 `orca panel` 会开控制 store、挂 `/api/control`、listen 前跑完 recovery、自带 wake pump、
SIGINT/SIGTERM 每 epoch 恰好写一条 shutdown；`--no-control` 关掉时行为与挂载前逐字节相同。

*** **G1 缝 A 做完了（2026-09-24）**：真 ccloop 的 `capabilities` 答 v2 八字段，Orca 直通对端应答，
`control-capability-unsupported` 那道缺口关了。 *** 细节与诚实的验收表述见 §四。

*** **G1 缝 B（2026-09-25）与执行驱动第一片（2026-09-25，会话 `905e41ce`）都做完了。** *** 细节见 §四 4.0.1。

*** **④ handoff 投递＋续跑＋N 路并行落地＋m5 也做完了（2026-09-25，会话 `e5f56bfe`）。** *** 细节与诚实的验收表述见 §四 4.0；现在的下一件事也在 4.0。

✅ *** **agent 选择一轮（2026-09-26，会话 `75ec878e` 做 T1–T15、会话 `ab5a693c` 做 T16／T17／终审）做完了。** *** 其后会话 `8c6302e0` 裁了终审 I-2、做了夹具层审计；会话 `43e3e1d8`（2026-09-27）完成人对 R1–R30 的逐条审、落地 R1／R3／R7／R17／R28，并**第一次跑了付费真 claude**。细节与下一步见 §四 4.0。 会话 `94b09282`（同日）让人审完改写判据，并落地了付费轮四个发现的裁定（B1–B3 修，B4 登记）。会话 `4d2e426e`（同日）删了 `~/.orca` 的夹具残留，并付费跑了真 claude 的 `[1m]` 与两任务解冲突（台账 §19／§20）。随后开了 **claude 中止前观测用量（stream-json）** 一轮：会话 `4d2e426e` 落了 Task 1–2，会话 `5b01dbd9` 落了 Task 3–6、终审与修复，**本轮已收口、人已审过，真 claude 下付费跑通一次**，见 §四 4.0。

✅ *** **面板 UI 重做一轮（2026-09-27，会话 `a50f4d80` 做计划 Task 0–6 与终审修复，会话 `f8281a60` 做人裁后续）已由人 merge 进 main。** *** 细节见 §四 4.0.a。
✅ **UI 第二批（深色对比度＋kind 重要性，会话 `f8281a60`）已由人并入 main**（主题行 `Merge branch 'ui/panel-contrast'`）。细节见 §四 4.0.a 末条。

✅ *** **⑤ 预算预估链（2026-09-28，会话 `f341f05f`）已落地、已推送、人已审完；人授权的待办 1–6 已由会话 `c85d2c4e`（同日）做完**：ccloop 临时目录泄漏、删残留（27）、两处 v1 闸门的独立判据（24）、挂账三条（26 的 b／c／d）。*** 只剩 26(a)（要先做设计）。细节与诚实的表述见 §四 4.0。

✅ *** **loop 方案层（goal.md §3.3）两部分都做完了（2026-09-30，会话 `1d7d9aa0`）**：plan 文件的 task 可以写 `loop`（五个内置方案）代替手写契约，面板显示白话做法卡片，`set-task-loop` 在 task 开跑前（确认前后都行）改方案、输入与预算。*** 细节与诚实的表述见 §4.0。

**还不能说的**：*** **「Web 派活可用」「claude 可用」「分层选择可用」都不是事实。** *** 能说的只有：**真 codex 下单任务主链跑通过一次**（2026-09-25，会话 `af3dc0d3`，
请求模型 gpt-6-luna，服务层不含 HTTP，n＝1；台账 `.superpowers/sdd/2026-09-25-live-acceptance/progress.md` §5 是唯一可引的表述）；**真 claude 下单任务主链跑通过一次**（2026-09-27，会话 `43e3e1d8`，claude 2.1.283、请求模型 claude-opus-5-5、隔离参数、n＝1；台账 `.superpowers/sdd/2026-09-26-agent-selection/progress.md` §14 是唯一可引的表述）；**真 claude 下 1M 窗口单任务、两任务冲突经 `ccloop run --agents` 解开各跑通过一次**（2026-09-27，会话 `4d2e426e`，各 n＝1；同一台账 §20 是唯一可引的表述）。
**面板 HTTP 这条路在真 claude 下单任务跑通过一次**（2026-10-03，会话 `16ab00f2`，claude 2.1.288、claude-opus-5-5、n＝1；台账 `.superpowers/sdd/2026-10-03-panel-http-live/progress.md` 是唯一可引的表述）。依赖、崩溃恢复、strict 组、④ handoff、⑤ 预估链（single-call 估算）、混 kind 都没在真 agent 下验过；冲突／解冲突只在真 claude 下跑过一次（两任务、一处冲突），真 codex 下没跑过。**驱动环只在 port `configured` 时挂；未配置时行为逐字节同前。**

✅ *** **loop 方案人审后的跟进（W1–W7）与面板中英双语（2026-10-01，会话 `e604b1ba`）做完了**：细节、要人审的点、诚实表述见 §4.0。 ***

✅ *** **C4 ＋ v2 阶段超时 3 小时（Orca）与 ccloop `rejectOn` 改为 verifier 判断（2026-10-01，会话 `ceca1c47`）做完了**：见 §4.0。 ***

✅ *** **adapter／CLI 合并四步全部做完（2026-10-01，会话 `be653b22`）**：`orca run` 旧路径已退役（**`orca run` 命令不存在了**，跑一轮只能走面板／控制路径）；ccloop 只剩 `--agents` 入口。细节、人要审的裁定、推送顺序见 §4.0。 ***

✅ *** **N1「提想法 → 澄清需求 → 拆分 → 确认」第一版做完（2026-10-02，会话 `b5e8d368`）**：需求就是一个 `clarifying` 状态的 group；预估链泛化成按 `purpose` 分派的单次调用；面板第五个分区「需求」。人已审完裁定。**付费真 claude 跑了两次：澄清→拆分→确认→导出跑通，落地两次都被挡住（R-A／R-B）**。细节见 §4.0／§4.0.g。 ***

✅ *** **ccloop「被杀的 run 能续跑＋孤儿 runner 收＋R-A＋R-B」一轮做完（2026-10-02，会话 `ece96b67`，只改 ccloop 仓）**：门绿，付费真 claude 跑通「杀掉 ccloop → runner 自退 → resume 续跑到成功」一次。Orca 已于会话 `7fe6d61b` 重钉到它（`ae2caa3`）。细节见 §4.0.h、§4.0.i。 ***

✅ *** **N5 记忆区（memory tab）第一版做完（2026-10-03，会话 `184d0372`）**：面板第六个分区「记忆」，只读，经 `ccmem export --json` 读，设了 `ORCA_CCMEM_BIN` 才会起 ccmem，分区第一次被打开前不发任何请求。ccmem 仓零改动。细节见 §4.0、§4.0.j。 ***
✅ **记忆区三条搁置的小项（2026-10-03，会话 `6a4dd7f3`）做完，人 2026-10-03 已审（「同意」）**：见 §4.0.k。
✅ **看板剩下的部分（goal.md §3.4，2026-10-03，会话 `6a4dd7f3`）做完，人 2026-10-03 已审（「同意」）**：依赖关系图、Git 区、loop 方案卡片的 git 一行随工作区方式变；同会话修了 `estimateE2E` 的夹具撕裂读。见 §4.0.l。
✅ **面板 HTTP 在真 claude 下跑通一次＋syncskill 补三件（2026-10-03，会话 `16ab00f2`）做完，等人审**：见 §4.0.m。
✅ **Orca 接 syncskill（2026-10-03，会话 `08b1007d`，Orca ＋ ccloop 两仓，SDD 七个 task＋终审）做完，人已审**：loop 方案可声明 skill 集，每个 run 注入只读快照、作为 claude plugin 加载；见 §4.0.n。
✅ **syncskill 跟进（2026-10-03，会话 `9d95e6c8`）做完，等人审**：重钉 ccloop 到 `2b380ea`；codex＋skills 改在 confirm／set-task-loop 就拒；skills 形状错报出具体原因；修了一处临时目录泄漏；**真 claude 下付费跑通一次带 skills 的任务**（n＝1）。见 §4.0、§4.0.o。

**现行基线（会话 `9d95e6c8`，2026-10-03，syncskill 跟进之后）**：Orca 全量 2738 条，只红已登记 flake（`gateCheck` K13、`driverProgress` R2、`controlShutdown` 143；`verify:chain` 的全量另红 `driverRequirementSplit`），各单跑 3/3 绿；其余各段 RC 0；`check-tmp-leak` 配不配表都 0 残留。原始报数在台账 `.superpowers/sdd/2026-10-03-syncskill-integration/progress.md` 末节。ccloop 本轮零代码改动，基线仍是会话 `08b1007d` 的 1140 条、只红 `stopProof`。

**上一版基线（会话 `6a4dd7f3`，2026-10-03，§4.0.l 那一笔的内容；原始报数在台账 `.superpowers/sdd/2026-10-03-board-graph-and-git/progress.md` 的 Gate 段）**：clone 做法与改道同下，`ORCA_CCLOOP_BIN`＝ccloop `ae2caa3` 的 build。全量 vitest **289 文件、2623 条、2617 过、2 红、4 skipped**；红的是已登记的 `driverRequirementSplit`，和本轮自己的 `scanPanelText`（新图的两词 class 字面量被当成待翻译文字，已在代码里修掉、没动判据）。`verify:chain` 的全量另红 `gateCheck` K13、`controlShutdown` 143（都已登记）。修后重跑：typecheck、web build、`scanPanelText`、`--ws check`（web 383/383）都 RC 0；三个 flake 文件单独各 3/3 绿（1 分钟负载 17→6）。其余各段（台账、`CLAUDE.md` 150/200、hooksPath、`verify:control` 1221 过 3 skipped、`verify:scheduler` 194、`verify:ccloop-pin` 3、`verify:panel`、R1 真 ccmem、`check-tmp-leak` 0 残留）都 RC 0；真 `~/.claude/ccmem` 条目名与真 `~/.orca` 的 stat＋sha256 与本会话早先的快照相同。

**更早的基线**（会话 `184d0372`、`b5e8d368`（会话 `08b1007d` 压缩本节时删去）、`be653b22`（`gate/gate-report.md`，该会话 scratchpad，已不存在）、`e604b1ba`、`1d7d9aa0`、`2f65a729`、`c85d2c4e`、`94b09282` 各一版；会话 `b5e8d368` 压缩本节时删去，原始报数都在各自台账：`2026-10-03-memory-tab/progress.md`（Gate 块）、`2026-10-02-requirement-to-split/progress.md`（Task 15 行）、`2026-10-01-panel-i18n/task-12-report.md`、`2026-09-30-loop-plans` Task B8 行、`2026-09-29-tmp-leak-skipped-file` §5、`2026-09-27-single-call-estimate` §3.23、`2026-09-26-agent-selection` §16–§18）。它们留下的、仍然成立的结论：
- 跑门：clone 里先 `npm run build --workspace web`（不 build 有 `panel-dist-missing` 假红）；`ORCA_AGENTS_TABLE` 夹具表的 fake codex 必须是 `integration` 模式（`ok`／`script` 会让 `ccloopProtocol.integration` 红）；改道 HOME 下只会有 `~/.npm/_logs`。
- 临时目录泄漏已修（每个测试文件一个临时根 `tests/setup/scopeTmpdir.ts`）；护栏 `node scripts/check-tmp-leak.mjs`（两仓都有），TMPDIR 要短、要是真目录（§6.22）。
- ⚠️ 负载：`driverRecovery` 在 load 约 37 时单文件也能连红 3 次 ⇒ 判 flake 要等负载降下来并记 `uptime`。

⚠️ *** **新登记的负载型 flake**：`tests/control/executionDriverE2E.test.ts` 在重负载（两份 clone 并跑变异）下出现过 5/9（R1 子场景）；无负载单跑 3/3 全绿。
`tests/control/driverSettle.test.ts` 的真 git 场景曾在全量＋并发负载下撞默认 5 s 超时，已给 30 s（主题行见上）。 ***
⇒ **看到这两个文件红：先单文件重跑，绿了就不是回归。**
⚠️ *** **（2026-09-27 会话 `5b01dbd9` 新登记）`tests/chain/gateCheck.test.ts` 的 K13 在全量里撞过 5 s 超时，单跑 3/3 绿。另有一个反例要记住：`driverRecovery` 那条在高负载时（load 约 37）单文件也能连红 3 次。** *** ⇒ 所以单跑判别要在负载降下来之后做，并同时记下 `uptime`，不能只看一次单跑。
⚠️ *** **④ 轮新增的负载型 flake（同样规则：单文件重跑绿 ＝ 不是回归）**：`tests/control/driverRecovery.test.ts` 的 "drives a retried run on from where it was blocked, to settled"、`tests/control/driverLanding.test.ts` 两条、`tests/control/handoffE2E.test.ts` 的 G（依赖 30 s 实时窗）、`web/tests/controlCommandRecovery.test.tsx` 的 "drops the id when the lookup returns the command's retained result"（单跑 3/3 绿）。 ***
⚠️ **（2026-10-01 会话 `e604b1ba` 新登记）`tests/control/ccloopPort.test.ts` 在全量里 5 s 超时一次，单文件 3/3 绿；ccloop 的 `codexWatchdog` 那条在负载 33 下也红过一次（已在已知名单）。web 测试默认超时现为 15 s（`web/vite.config.ts`）。**
⚠️ **（2026-09-30 会话 `1d7d9aa0` 新登记）`tests/control/driverLanding.test.ts` 的 "X1: lands while the person has orca/<group> checked out, leaving their files and index alone"**：全量里 5 s 超时（1 分钟负载 43／48），单文件 3/3 绿；同轮 `driverRecovery` "drives a retried run on…" 也在负载 43 时红过一次，单文件 3/3 绿。
✅ **（2026-10-03 会话 `6a4dd7f3` 登记并修掉）`tests/control/estimateE2E.test.ts` 的 E2 曾以 `SyntaxError: Unexpected end of JSON input` 红过一次**（不是超时）：夹具读 fake CLI 的日志时，fake 已建好文件、还没写进内容，空串被当成一行交给 `JSON.parse`。人点头后修了：主题行 `test(fixture): read a fake CLI log created but not yet written as no lines`，`logLines` 跳过空行，新判据 `tests/control/ccloopWorldLogLines.test.ts` 对旧读法见红。机制是读代码得出的，撕裂读本身没有复现过；**若它再红，说明还有别的原因（例如半行），要重新查。**
⚠️ **（2026-10-02 会话 `7fe6d61b` 新登记）`tests/control/driverRequirementSplit.test.ts` 的 "fails the third consecutive invalid draft as split-validation-exhausted, and a schema-invalid one as split-output-invalid"**：三次全量里都以 5 s 超时红（1／5 分钟负载约 8–13），单文件 3/3 绿；它走 fake port、不经 ccloop，新旧 ccloop 下单跑该条都约 1.9 s（负载 19 时现测）。
⚠️ **（2026-09-29 会话 `2f65a729` 新登记）`tests/control/driverProgress.test.ts` 的 "R2: books exactly the usage of a collect without progress, and nothing twice"**：全量里 5 s 超时一次（5 分钟负载 10.6），单文件 3/3 绿。同一轮 `driverLanding` D 也以 5 s 超时红过一次。

⚠️ *** **已知 flake（2026-09-24 会话 `ae4061a5` 现测登记，根因未查；2026-09-25 那一轮全套里没出现）**：
`tests/panel/controlShutdown.test.ts` > `a real SIGTERM to a real panel` > `makes it exit cleanly, having written one shutdown row for its epoch`。 ***
在同一棵树（观测锚点＝主题行 `docs(handoff): G1 seam A is done; the next steps are the human's, ccloop pushed before Orca`）上：
`npm test` 里绿、`verify:chain` 第二段全量重跑里**红一次**（`expected 143 to be +0`，`controlShutdown.test.ts:126`）；
单文件 `./node_modules/.bin/vitest run tests/panel/controlShutdown.test.ts` 连跑 **5/5 绿**（6/6）。
⇒ 看到它红：**先单文件重跑**，绿了就不是回归。未验证的推测：判据连发两次 SIGTERM，第二次若经 tsx 转发时晚于
`src/panel/server.ts` 在 `closed` 之后摘掉处理器，内层 node 按默认处置死，tsx 转成 143。
（已排除「信号先于处理器安装」：处理器在 `src/cli.ts` 打印 ready 之前同步装好。）
2026-09-27 会话 `f8281a60` 在全量里又见一次（同样 143），单文件重跑 3/3 绿。

⚠️ **判别式**：看到红，先问「是不是上面那条 flake」，是就单文件重跑。缝 B 的机械判定器（全套 json ⇒ smoke 5 条全过、
失败 ⊆ {那条 flake}、0 pending）代码全文在同一份计划的 Task 4 Step 1（可直接抄）。
历史台账：缝 A `.superpowers/sdd/2026-09-24-g1-capability-vocabulary/progress.md`；G1 之前 `.superpowers/sdd/2026-09-22-control-gates-baseline/`。

## 四、⛔ 下一件事

### 4.0 ⛔ 现在的下一件事（2026-10-03 会话 `9d95e6c8` 改写；**本节优先于下面的 4.0.o、4.0.n … 与 1–3**）

会话 `9d95e6c8` 做完了人排的四件：重钉 ccloop、修临时目录泄漏、两条裁定的优化（(a) skills 形状报出原因，(b) codex＋skills 提前到 confirm 拒；(c) 留给 H6）、真 claude 付费跑一次带 skills 的任务。结论在 §4.0.o，**等人审**。

1. **先核推送**：四个仓各跑 `/usr/bin/git ls-remote origin refs/heads/main` 与本地比。推送归人。本轮 Orca 有重钉＋跟进几笔、ccloop 只有一笔 handoff 文档；Orca 已钉 `2b380ea`（ccloop 远端已有），**两仓推送没有先后约束**。
2. **人要审的**：§4.0.o 的「替人做的裁定」与「改了的既有判据」；台账 `.superpowers/sdd/2026-10-03-syncskill-integration/progress.md` 末节「Follow-up (session 9d95e6c8)」；spec `docs/superpowers/specs/2026-10-03-syncskill-integration-design.md` §12（优先于 §11 与正文）。
3. **下一件由人选**。首选仍是 codex 的 skill 支持（H6）：它消掉 I1 剩下的那条路（确认后安装表被改）。其他候选：带 skills 的 agent verifier／profile 声明／多任务的真 claude 验收（本轮只跑了 standard 方案、names、单任务）；记忆区后续；ccloop §5.1 与「reaper 杀活 claude」的真 claude 验收；同时启动任务数上限；N1 第二版；goal.md 的 N2、§3.5 litellm、A2A。
4. **验证只在 `git clone --local` 副本里做**：HOME 与四个 XDG 根改道、TMPDIR 短真目录；Orca clone 里先 `npm run build --workspace web`、`git config core.hooksPath scripts/githooks`；`ORCA_CCLOOP_BIN` 指 ccloop clone（`2b380ea`）的 `dist/cli.js`；`ORCA_AGENTS_TABLE` 只放 fake codex（`integration` 模式，0600，`/private/tmp/…`）；真二进制判据 `ORCA_SYNCSKILL_REAL_BIN=<syncskill clone>/dist/index.js`、`ORCA_CCMEM_REAL_BIN=/Users/biran/code/skills/ccmem/bin/ccmem`。⚠️ `npm run verify` 是 `&&` 串的；本轮改用逐段各跑各的脚本（每段单独记 RC），推荐照做。
5. **付费跑**：先定判据与上限、报人。现成判据：`scripts/live-panel-http-acceptance.ts`（`--skill --syncskill-bin <abs>` 是带 skills 的变体）。跑前后记 claude 装目录 mtime（本会话 20:45 又见重装，同版本）。
6. **环境坑**（本会话新见）：rtk 把 `diff` 报成「Files are identical」而 `cmp` 说不同 ⇒ 字节比较一律 `/usr/bin/diff`、`/usr/bin/grep`；人自己常开着一个 `orca panel --port 7777`，它会写真实 `~/.orca/control/…`，比对 `~/.orca` 前后快照时先核它的启动时间；`rm`／`cp` 带 `-i` 别名，子代理要写明 `/bin/rm`。
7. **建议用的 skill**：开工 `superpowers:using-superpowers`；新设计 `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:subagent-driven-development`；红先 `superpowers:systematic-debugging`；收尾前 `superpowers:verification-before-completion`。

### 4.0.o syncskill 跟进（会话 `9d95e6c8`，2026-10-03，**已完成，等人审**）

**几笔**（按主题行找）：`chore(deps): repin ccloop to its syncskill round …`；`test(control): gate the real-protocol file at run time …`；`fix(loop-plans): name what is wrong with a skills declaration …`；`feat(skills): refuse skills on a non-claude installation at confirm and set-task-loop …`；`test(live): add a --skill mode to the panel HTTP acceptance …`；`fix(live): count the Skill tool calls …`；以及 spec §12／台账／本文的文档笔。ccloop 一笔：`docs(handoff): Orca section v41 …`。
- **重钉**：`ae2caa3` → `2b380ea`，`pin-ccloop.mjs` 七项全 ok。
- **泄漏**：`ccloopProtocol.integration.test.ts` 改成 `beforeEach` 里 `ctx.skip()`；不配表时全量 0 残留。
- **(a)**：skills 形状错报 `malformed:tasks.N.loop.skills: skills-shape:<原因>`（`both-profile-and-names`／`neither-profile-nor-names`／`unknown-key`／`empty-names`／`names-not-strings`／`profile-name`／`not-an-object`），沿用 labels 的写法；名字规则违规仍是 `loop-plan-invalid:<task>:skills-shape`。改之前实测：两个 key 都写时报「Unrecognized key 'names'」，会误导人只删 names。
- **(b)**：ccloop 的 `listAgents` 应答里本来就带每个安装的 kind（上一轮「Orca 拿不到 kind」不对）。confirm 只在有任务声明 skills 时问一次；set-task-loop 在已确认任务的 payload 带 skills 时问；不是 claude ⇒ `skills-unsupported-agent:<task>:<安装id>:<kind|not-in-table>`（Orca 新错误码，422，中文文案已加）；问失败 ⇒ 按它自己的错误拒；事务前没问（那时还是草稿）⇒ `proposal-version-conflict`。ccloop `acceptStart` 继续兜底。6 条变异各自见红。
- **付费跑**（n＝1）：claude 2.1.288、claude-opus-5-5，standard 方案单任务、`names` 声明一个 skill，skill 里放随机口令、检查只比 sha256。25/25，exit 0。claude 自报 $0.3157524（plan $0.134412、execute $0.1813404），ccloop 报 106,008 token＝账本。execute 调了一次 `Skill orca-run-skills:orca-live-marker`，plan 没调。两次调用都带 `--plugin-dir`、都没有 `--disable-slash-commands`；口令不在任何调用的 argv、计划文件、确认后的视图里。
- **门**：见台账末节；全量 2738 条只红已登记 flake（各单跑 3/3 绿），各段 RC 0，泄漏 0。

**改了的既有判据**（要人知情）：web 夹具的 `listAgents` 加列 claude 安装（它的 `resolveAgent` 本来就认）；`setTaskLoopSkills` 的夹具与 `confirmSkills` C16 的任务 a 改用 claude 安装（断言一字未改）；`skillsE2E` 的 I1 codex 判据整条改写成「confirm 就拒」。

**替人做的裁定**：(a) 走 labels 写法而不是把形状检查挪到展开阶段（代价：skills 的错仍有两个码）；(b) kind 取自 `listAgents`、只在需要时问（代价：带 skills 的 confirm 多一次 ccloop 调用）；验收脚本里两个检查名 `…Holds42` 改成 `…HoldsAnswer`。

**诚实的表述**：付费只跑了一次，覆盖 standard（命令型 verifier，所以没有 verify 那次调用）、`names` 声明、单任务、claude；**带 skills 的 agent verifier、profile 声明、多任务、codex 都没在真 agent 下跑过**。I1 剩下的那条路（确认后安装表被改）仍在，等 H6。

### 4.0.n Orca 接 syncskill（会话 `08b1007d`，2026-10-03，**已完成，等人审**）

**材料**：spec `docs/superpowers/specs/2026-10-03-syncskill-integration-design.md`（中文讨论、英文正文；§10 评审轮、§11 实施期更正，**都优先于 §1–§9**）；计划 `docs/superpowers/plans/2026-10-03-syncskill-integration.md`；台账 `.superpowers/sdd/2026-10-03-syncskill-integration/progress.md`（全部 `Ruling:`、每个 task 的评审与修复轮、终审、门）。

**做成了什么**（Orca 十多笔，按主题行找：`feat(skills): spawn syncskill …`、`feat(loop-plans): let a loop task declare a skill set …`、`feat(confirm): freeze each task's skill set …`、`feat(set-task-loop): change a task's skill set …`、`feat(driver): inject each run's skill snapshot at A2 …`、`feat(panel): show a task's skill set …` 及各自的 fix／test 笔、`chore(scripts): add the offline claude probe …`；ccloop 三笔见 ccloop handoff 末节）：
- loop 方案可选 `skills`：`{profile}` 或 `{names}`（名字规则＝syncskill 的 `isSafeSkillName` 再加「不含逗号、不带首尾空白」）；挂在 recipe 上、与 `inputs` 平级，**不进 ccloop 合约**；不声明时字段省略，旧任务的归档字节、`planHash`、合约／快照／信封哈希都逐字节不变（各有 golden 判据）。
- confirm 时冻结进执行快照（profile 当场 `syncskill --json --no-refresh profile ls` 解析成名单）；`readConfirmedTaskExecution` 核对快照与 recipe 一致，篡改 ⇒ `recovery-blocked`。set-task-loop 能改；已确认任务上**声明没变就沿用冻结的名单、不起 syncskill**（人裁 H3）；草稿任务从不查。
- 每个 run 在 A2 注入到 `<workspacesRoot>/skills-<runId>`（git 树之外、`.claude-plugin/plugin.json`、目录 0700、快照只读），锁信息记在 drive 记录 `skills`；信封带 `skillPluginDir`（realpath）；目录随工作区一起清（按 runId，不看 drive 记录）。ccloop 对这种 run 加 `--plugin-dir`、去掉 `--disable-slash-commands`。
- 面板：loop 卡片显示声明的 skill 集与确认后冻结的名单；run 详情多一张表列出锁（名字、commit 或「local」、md5）。中英双语。
- `ORCA_SYNCSKILL_BIN`（绝对路径，空＝未配置）读在 `src/skills/syncskill.ts` 的 `syncskillOptionsFromEnv` 一处，web service 与驱动都用它。

**实测**（都不花钱）：claude 2.1.288 离线录请求——带 `--disable-slash-commands` 时任何 skill 都不发给模型；去掉后 cwd 的 `.claude/skills` 与 `--plugin-dir` 的 skill 都发、用户 `~/.claude/skills` 不发；plugin skill 以 `orca-run-skills:<名>` 出现（**提示词要点名 skill 就得用这个带前缀的名字**）；锁文件内容不外发；只读 plugin 目录照常加载。codex 0.155.1 会读 `$CODEX_HOME/skills`、cwd 的 `.codex/skills`、`.agents/skills`，加不进 worktree 外的目录 ⇒ 下一轮。

**门**（会话 `08b1007d`，干净 clone；Orca 在 `chore(scripts): add the offline claude probe …` 那一笔、ccloop 在 `test(control): hash the schema's output …` 那一笔、syncskill 在其 main 上）：ccloop 1140 条、只红 `stopProof`，`check-known-reds`／`check-tmp-leak`／typecheck／build RC 0。Orca 全量 2724 条：2713 过、9 skipped、2 红＝已登记的 5 s flake（`gateCheck` K13、`driverRequirementSplit`），各单跑 3/3 绿（1 分钟负载 4–6）；因 `&&` 链被跳过的各段补跑：ledger、CLAUDE.md 行数、hooksPath、`verify:scheduler` 194、`verify:ccloop-pin` 3、`verify:panel` 395、web build、`--ws check` 都 RC 0，`verify:control` 1294 过 4 skipped RC 0（夹具表 fake codex `integration`），`verify:chain` 的全量只红三条已登记 flake（再加 `controlShutdown` 143）。三个真二进制判据（syncskillReal、driverSkillsReal、ccmemReal）**真的跑了**、全过。`check-tmp-leak` 在没设 `ORCA_AGENTS_TABLE` 时留 1 个根：用插桩定位到**早就存在**的 `tests/control/ccloopProtocol.integration.test.ts`（第 33 行 `describe.skipIf`，违反 `tests/setup/scopeTmpdir.ts` 的 ERRATUM），设了表就 0 残留——不是本轮回归。⚠️ 已由会话 `9d95e6c8` 修掉（主题行 `test(control): gate the real-protocol file at run time …`）。真实 `~/.syncskill` 条目与 `~/.orca` mtime 门前门后相同。原始报数在台账的 Controller gate 段。

**诚实的表述**（本会话写下时）：只在 fake claude、离线探针、真 syncskill 的判据下验过；没在真 claude 下付费跑过带 skills 的任务；codex 不支持；Orca 仍钉旧 ccloop。⚠️ **后两件已由会话 `9d95e6c8` 改变**（付费跑通一次、已重钉），见 §4.0.o。

**人裁**（本会话）：H1 只对带 skill 集的 run 去掉 `--disable-slash-commands`；H2 skill 集声明在任务的 loop 方案上；H3 profile 在确认时冻结；H4 方向（run 外目录＋plugin＋锁进 drive 记录）；H5 本轮不付费；H6 codex 下一轮；verifier 也带 skill、快照只读（人同意）。

**替人做的裁定**（最要紧的；全部在台账 `Ruling:` 行）：
- ~~agent 种类只由 ccloop 判~~ ⚠️ **已被会话 `9d95e6c8` 推翻**（人选「优化」）：`listAgents` 的应答里每个安装 id 都带 kind，Orca 现在在 confirm／set-task-loop 就拒，见 §4.0.o。原裁定的代价（终审 I1：开跑才拒、之后只能停组）现在只剩「确认之后安装表被改」这一种情况。
- set-task-loop 的 payload 不带 `skills` ＝ 删掉 skill 集（payload 是完整期望状态，和 `inputs` 一样）；面板改预算与预估建议都会原样回送。已确认任务上改了声明而 `ORCA_SYNCSKILL_BIN` 未设 ⇒ `syncskill-unconfigured`。确认竞态 ⇒ `proposal-version-conflict`。
- 计划文件里 skills 形状错由 zod 拒成 `malformed: …`，只有名字规则违规报 `skills-shape`。⚠️ 会话 `9d95e6c8` 让它报出具体原因（`malformed:tasks.N.loop.skills: skills-shape:<原因>`），见 §4.0.o。
- 九个错误码都是 durable 422（含 `syncskill-timeout`）；`deps.syncskill` 可选、缺省＝未配置。
- Orca 与 ccloop 都直接在本地 `main` 上提交（照历轮做法；合并进 main 归人）；Task 1 与 Task 2 两仓并行。

**登记未修**（台账 `minor (deferred)`，终审已分诊、都不挡推送）：`STDERR_EXCERPT_BYTES` 按字符截；`--no-refresh` 只有 fake argv 判据守着（真 syncskill 在种子目录上加不加都不写）；skills 拒绝排在 `prepareExecutionSnapshot` 自己的检查之前；confirm 即使会被 no-op 拒也会先起 syncskill；一个只靠 chmod 0500 得 EACCES 的判据在 root 下不会红；run 视图多传了 UI 不显示的 `profile`／`source`。syncskill 那边：其他集成测试把整个 `process.env` 传给 CLI，跑测试的 shell 里若 export 了 `SYNCSKILL_DIR` 会被带偏（syncskill 台账已记）。

### 4.0.m 面板 HTTP 真 agent 验收＋syncskill 补三件（会话 `16ab00f2`，2026-10-03，**已完成，等人审**）

**面板 HTTP（Orca 仓，一笔：主题行 `test(live): drive one task from import to landing through the panel's HTTP API under real claude`）**
- `scripts/live-panel-http-acceptance.ts`：起真 `orca panel`，用它打印的一次性 token 全程走 HTTP（偏好 → import-plan → proposal-edit → confirm，字段照 `web/src/BudgetEditor.tsx` → start），之后只读页面读的 group 视图；SIGTERM 收面板，核无残留进程组。判据＝退出码 0（fake 18 条、付费 21 条检查）。
- fake：rc 0；变异「去掉 token 头」⇒ 401 `token-required` 红，「fake 写 41」⇒ run `blocked` 红。付费（人批：上限 $2、单次 `--max-budget-usd 0.6`）：rc 0，21/21，claude 自报 $0.545137，ccloop 报 165,610 token＝视图账本，n＝1。台账 `.superpowers/sdd/2026-10-03-panel-http-live/progress.md`。
- 读到的事实：驱动正常落地的 run 在视图里显示为 `settled-recoverable`（`landed` 只是中间态）；落地看 `RunViewV1.git.landedCommit`。
- 没覆盖：真浏览器、真 codex、经 HTTP 的预估与 handoff、多任务。

**syncskill 补三件（syncskill 仓 `main`，人定「直接在 main 上做」；spec／plan／台账都在 syncskill 仓）**
- spec `docs/superpowers/specs/2026-10-03-profile-inject-version-design.md`（中文；§9 是实施期更正）、plan `docs/superpowers/plans/2026-10-03-profile-inject-version.md`、台账 `.superpowers/sdd/2026-10-03-profile-inject-version/progress.md`（已入库，含 17 条 `Ruling:`、14 条变异、门）＋同目录 `mutations.py`。
- 做成了什么：`config.json` 顶层 `profiles`；`profile set|ls|rm`；`inject (--profile <名> | --skills a,b) --target <目录>`：先全部解析再动手，复制成解开符号链接的快照，target 里已有同名 skill 或锁文件 ⇒ 退 7，写 `<target>/syncskill-lock.json`（`syncskill-lock-v1`：每个 skill 的 `source`／`resolved_commit`／`content_md5`），不碰 `config.links`、agent 目录、manifest；git 源物化后把 `rev-parse HEAD` 记进 `.sources/<名>/state.json` 的 `resolved_commit`。人裁：快照（不用符号链接）、只记录不重放、profile 进 `config.json`。
- 过程：5 个 task 各经一次任务评审；Task 3（skill 名路径穿越）、Task 4（`profile set` 收了 inject 会拒的名字）各一轮修复；控制器变异发现 spec §7 第 3 条（锁里 git 源的 commit）没写成判据 ⇒ 补；opus 终审 2 条 Important（原型链键名 `__proto__`／`constructor`；回滚会删一个不是本次建的 staging 目录）＋1 条 Minor（inject 前 preflight 会重写 manifest）一波修完、复审通过。
- 门（控制器在 syncskill clone 上现跑，修复波那一笔）：build 0；unit 526/526；integration 280/280；0 skipped。`install-cli` 一条帮助判据在负载 13 下 5 s 超时过一次，单跑 3/3 绿。
- Orca 调用方要知道的（syncskill 现行约定，没改）：未预期的错误退 1 且不一定有 JSON `error` 事件；commander 的用法错误（如缺 `--target`）退 1 不是 2。
- **诚实的表述**：只在 syncskill 自己的单元与集成测试（临时 HOME）下验过；**Orca 还没有任何代码调用 syncskill**，也没对真实 `~/.syncskill` 跑过。
- 登记未修（syncskill 台账与 spec §8）：`--sync-dir` 等四个改道开关不生效；`normalizeSourceEntry` 丢 `skill_subdir`／`ignore`／`archive_path`（子代理报告，未复核）；`tsc --noEmit` 对 syncskill 测试本来就有约 176 个类型错（与本轮无关）。

**替人做的裁定（都在台账，摘最要紧的）**：`inject` 的 skill 名守卫只拒空、`.`/`..`、以 `.` 开头、含 `/` `\` NUL（不用 `^[a-zA-Z0-9_-]+$`，本地 skill 目录名可能带点）；空清单 ⇒ `E_USAGE_INJECT_SELECTION`；`profile set`／`rm` 的 change 事件沿用 `entity: 'skill'`（spec 不许新事件类型）；`inject` 跳过 manifest 自动刷新、保留配置诊断；staging 改用 `mkdtemp`（spec §5 原文不动，§9 记更正）；接受实施席给既有判据补 `profiles: {}`／`resolved_commit` 字段（形状断言，没有放宽）。

### 4.0.l 看板剩下的部分＋`estimateE2E` 夹具（会话 `6a4dd7f3`，2026-10-03，**已完成；人 2026-10-03 已审，同意**）

- 两笔：`test(fixture): read a fake CLI log created but not yet written as no lines`；`feat(board): draw the dependency graph and show the git scheme from the drive records`。spec `docs/superpowers/specs/2026-10-03-board-graph-and-git-design.md`（D1–D7、判据表、§5 登记未做）；台账 `.superpowers/sdd/2026-10-03-board-graph-and-git/progress.md`（三条 `Ruling:`、24 条变异、门）。没写计划、没派子代理（一小片，spec 的判据表就是计划）。
- 依赖关系图：`web/src/dependencyLayout.ts` 纯代码排布（层＝到它的最长依赖路径，同层按 taskId），指向本组没有的任务、会构成环的依赖都不画但在图下计数说明；`web/src/DependencyGraph.tsx` 每个任务一个可聚焦按钮，点或回车打开与表格同一个任务详情；不受标签筛选影响；**组里没有任何依赖时不画**（台账 Ruling）。
- Git 区：`web/src/GitScheme.tsx`。工作分支 `orca/<组>`、「每个任务一个合并提交、第二父是 attempt」是驱动的事实；每个任务 run 的工作区方式、起点提交、落地提交来自服务端新给的 `RunViewV1.git`（`src/panel/controlViews.ts` 从 drive 记录取，**投影不跑 git**；线上可选字段，服务端总是给）。合并进 main、push 显示为「等人做（本面板没有这个按钮）」。新 run 用哪种工作区方式取页面已有的 `RepositoryWorkspaceV1` 读数，只认本组的仓库。
- **改了已发布 spec 的一处**：loop 方案卡片的 git 一行原是固定的「独立 worktree」，仓库设成 clone 时是假的；现在随工作区方式变（worktree 原文不动、clone 一句、没读到一句；不传的老调用方仍是原文）。loop plans spec 追加 §15 记这条更正。**既有判据一条没改**。
- 没做（spec §5）：图上不画写集冲突；`orca/<组>` 是否已并入 main 或已 push 不显示；每个 run 的耗时（run 视图没有开始时间戳）。
- **诚实的表述**：只在 jsdom 和 fake 驱动下验过；**没在浏览器里看过真实渲染**（SVG 布局、深浅主题下的颜色），也没在真 ccloop 跑出的组上看过。

### 4.0.k 记忆区三条搁置的小项（会话 `6a4dd7f3`，2026-10-03，**已完成；人 2026-10-03 已审，同意**）

- 一笔：主题行 `fix(memory): name an errno libuv cannot name, and restore fetch after the memory area`。台账：`.superpowers/sdd/2026-10-03-memory-tab/progress.md` 末尾的 `Follow-up` 行与一条 `Ruling:`。
- ENOEXEC：Node v22.13.1 在 macOS 上同步抛出，`code` 是 `"Unknown system error -8"`、`errno` -8。现在 `exportFailure` 遇到不是大写名字的 `code`，就按 `errno` 的绝对值去 `os.constants.errno` 里查名字，查不到就答 `unknown`。线上答 `ccmem-failed:ENOEXEC`，Node 的原话留在 message 里。
- spec 追加 §11（E1：`ccmem-failed:` 还会带 spawn 的 errno 名；E2：status 里不会有空格）；`src/memory/adapter.ts` 原注释不动，下面追加一条 CORRECTION。
- `web/tests/i18nPseudo.test.tsx`（人 2026-10-03 授权改）：改用 `vi.stubGlobal`，`afterEach` 里 `vi.unstubAllGlobals()`，另加一条判据「记忆区跑完后 fetch 还是原来那个」。
- 变异三条都单独见红；没见红的两支（`unknown` 兜底、正则直通）理由写在台账。门的报数见 §三 的「上一版基线」与台账。

### 4.0.j N5 记忆区第一版（会话 `184d0372`，2026-10-03，**已完成；人 2026-10-03 已审，「需要你特别知道的」与「替你做的裁定」两部分都同意**）

- 材料：spec `docs/superpowers/specs/2026-09-29-memory-tab-design.md`（§9 人裁 Q1–Q7；**§10 是写计划时的更正 D1–D11，优先于正文**）；计划 `docs/superpowers/plans/2026-10-03-memory-tab.md`（开头「Drafter findings」表是每条更正的证据）；台账 `.superpowers/sdd/2026-10-03-memory-tab/progress.md`（已入库，含全部 `Ruling:`、每个 task 的变异、终审、门）。
- 做成了什么：`src/memory/`（`adapter.ts` 只放类型；`ccmemExport.ts` 严格解析 export；`search.ts` 子串＋NFC＋固定排序＋请求参数解析；`ccmem.ts` 唯一起 ccmem 的地方，argv 恒为 `export --json --scope global|project`、先 global 后 project、cwd＝仓库、env 原样透传）；`src/panel/memoryApi.ts` 四条 GET（`/api/memory/status|list|search|item`），每个应答发出前过 strict schema；`parsePanelArgs` 读 `ORCA_CCMEM_BIN`（不设或空 ⇒ 不配置，不查 PATH；相对路径 ⇒ `ccmem-missing`，不起进程）；`web/` 第六个分区「记忆」（中英），第一次打开才请求，丢弃乱序应答；`tests/setup/relocateCcmem.ts` 让每个测试文件的 `CCMEM_DATA_ROOT` 落临时目录，并按条目名比对真实 `~/.claude/ccmem`。
- 状态码：`ccmem-missing` 503；其余 `ccmem-*` 502；`memory-repo-unknown`／`memory-not-found` 404；`memory-query-invalid` 400；七个固定码都有中文条目。
- 改了的既有判据：`web/tests/shell.test.tsx` 的 SECTIONS 一行（人授权）；`web/tests/i18nPseudo.test.tsx` 改了一个夹具字符串（避开新英文值 "project" 的撞词，该文件头注明「改夹具数据、不改规则」）并新增记忆区 AREA（只加不改）。**这两处都要人知情。**
- 实测（命令与 commit 在台账）：真 ccmem 单次 `adapter.search`（两行、临时根）约 192–198 ms；fake 125–134 ms（首次冷启动 770 ms）。没对真实数据量过（人裁 Q6）。
- **诚实的表述**：记忆区在 fake 与一个真 ccmem（临时数据根、两条记忆）下验过；**没有对真实 `~/.claude/ccmem` 跑过**，所以真实数据量下的耗时、输出大小、会不会触发迁移都没量。面板读记忆可能让 ccmem 在真实数据根里迁移（人裁 Q2 已接受）。

### 4.0.i 重钉 ccloop ＋ 第二次付费验收 ＋ Q6（会话 `7fe6d61b`，2026-10-02，**已完成**；过程删了，结论留在这里）

- 重钉 `99054f2` → `ae2caa3`（主题行 `chore(deps): repin ccloop to its crash-resume round, …`），`pin-ccloop.mjs` 七项全 ok。判据 `tests/control/neverStartedUsage.test.ts` 钉住「claude 没起来 ⇒ 记 0 ⇒ group 用量不会变 unknown」（对 `99054f2` 红）。其他起因的「用量未知清不掉」挂账仍在。
- 付费（ccloop 台账末节，各 n＝1，claude 自报合计 $0.3782952，R-A 那次 plan 的花费拿不到）：R-A 真 claude 下记 0、run 判 `failed`；R-B 跑到 `succeeded` 但走的是「提示词说检查由 verifier 跑」，§5.1 没走过；reaper 按 `lstart` 收掉了冻住的 runner 组，但没赶上杀一个活的 claude。
- Q6（读 ccmem `scripts/lib/db.mjs`，① 另有实测）：半截备份不会被当成可复用备份，但会计入「只留 5 份」轮换、WAL 模式只拷主文件——改不改是 ccmem 的人裁；`runVersionedMigration` 每个迁移文件一个事务，被杀停在一致的中间版本，安全。
- 环境教训：本机 claude 会在任意时刻被重装（同版本也会）⇒ 付费跑前后记装目录 mtime；ccloop 不留结果包，报花费要套 `scripts/claude-tee.mjs`；包装脚本按「任一参数是 `--version`」判探版本。

### 4.0.h ccloop 被杀 run 续跑＋孤儿 runner 收＋R-A＋R-B（会话 `ece96b67`，2026-10-02，**已完成，pending 裁定人已全部追认；Orca 已于会话 `7fe6d61b` 重钉到它**）

- 人裁：三件都修（R-A／R-B 一起）；R-B 走「带改动文件的自报 error 交给 verify ＋ 提示词说明检查由 verifier 跑」；R-A 走「证明没起过就记 0 ＋ ENOENT 在 runner 内有界重试」；普通 `resume` 自己接管被杀的 run；sweep 也认被杀的 run；容量实测人已批（时机由 agent 选）；本会话「有问题先按建议执行、最后报审」。
- 材料全在 ccloop 仓：spec `docs/superpowers/specs/2026-10-02-crash-resume-and-orphan-reaping-design.md`（§11、§12 是更正）、同名计划、台账（见上）。按 brainstorming → spec → 独立评审 → 计划 → SDD（9 个实施 Task 各经一次任务评审，6 个有一轮修复）→ opus 终审 → 一次修复波 → 复审。
- 门（ccloop 干净 clone）：1124 条、1123 过、只红 `stopProof`；两个检查脚本 RC 0。
- 付费真 claude（n＝1）：SIGKILL ccloop 后 runner＋claude 约 2.5 秒内退出；租约真过期后 `ccloop resume --agents` 不靠补文件续跑到 `succeeded`；claude 自报 $0.2392012（被杀那次花费拿不到）。
- **诚实的表述**：「被直接杀掉的 run 能用 `ccloop resume` 续跑、孤儿 runner 会自己退出」在真 claude 下跑通一次；收进程（reaper）、R-A、R-B 当时只在 fake 下验过（**会话 `7fe6d61b` 的第二次付费验收见 4.0 第 3 条**）。Orca 于会话 `7fe6d61b` 重钉到 `ae2caa3`，已用上这些行为。
- **容量（新登记给 Orca）**：真 claude 执行中途实测 runner 10 fd、claude 18 fd（验收专用的 tee 另 8 fd），每个在飞任务至少 3 个进程（worker、runner、claude）；本机 `kern.maxprocperuid` 5,333、`kern.maxfiles` 245,760（2026-10-02 现测）。由此推算的上限约 1,700 个并发任务，**这是推算**，没算工具子进程。Orca 要做大规模并行时，需要一个由实测（带工具调用的任务）推出、留足余量的「同时启动任务数上限」。

### 4.0.g N1 第一版（会话 `b5e8d368`，2026-10-02，**已完成、人已审完全部裁定**；过程删了，结论留在这里）

- spec `docs/superpowers/specs/2026-10-02-requirement-to-split-design.md`（**§15 是 11 条实施期更正，优先于正文**）；计划同名于 `docs/superpowers/plans/`；台账 `.superpowers/sdd/2026-10-02-requirement-to-split/`（`progress.md` 与 `preflight-rulings.md` 入库；`final-review.md` 等未入库）。
- 预估链泛化成按 `purpose` 分派的单次调用（`src/control/singleCall.ts`）；已存的预估 run 仍是 `phase: "estimate"`。
- 控制 store **schema 6**（`requirement_rounds`／`requirement_drafts`；⚠️ 旧版 Orca 打开迁移后的真 `~/.orca` 报 `control-schema-unsupported`）；group 新状态 `clarifying`；仓库概况＝`git ls-tree` 清单＋根目录说明文件＋可选 ast-grep `outline`（`@ast-grep/cli` 钉 0.45.3，blob 用 `git cat-file --batch` 原样取）；`clarify`／`split` 自动重试至多 2 次；五条命令 `requirement-open`／`-answer`／`-consensus`／`-draft-feedback`／`-draft-accept` 与需求上的 `recovery-retry`；文档以 `mktree`／`commit-tree` 导出成 `orca/<groupId>` 的第一笔提交（`.orca/requirements/YYYY-MM-DD-<slug>.md`，仓库外零写入）；`start` 等导出完成；面板第五个分区「需求」（中英）。
- 人已审完：台账全部 `Ruling:` 行与替人定的要点（含导出状态 `conflict` 在界面上叫「受阻」／"blocked"）。
- 挂账：需求上的用量一旦未知就清不掉（付费跑 R-A 是它的真实触发）；概况构建只能串行；`hash-object --no-filters` 的 `--no-filters` 按设计红不了。

### 4.0.f 上一会话（`be653b22` 合并四步，`b5e8d368` 前半）留下的结论（**已完成、人已审；过程删了，结论留在这里**）

- adapter／CLI 合并四步做完：ccloop 只剩 `ClaudeAgentAdapter` 与 `--agents` 入口，`orca run` 旧路径退役（**`orca run` 命令不存在了**）；Orca 的 57 条整轮判据经 `ccloop run --agents` 跑 fake codex `frames` 模式（要含该模式的 ccloop checkout）。人已审完全部裁定（四本台账末尾 Human review）。
- 人裁「`--adapter` 不需要提示，直接不支持」⇒ ccloop `run`／`resume`／`sweep` 对不认的 `--` flag 一律报 `unknown flag <flag>`。
- 付费真 claude（`b5e8d368`，claude 2.1.286，各 n＝1，工具报数合计 $0.3469558）：**「中断后读 partial」第一次是坏的**——runner 写完 stdout 就 `process.exit`，macOS 管道异步写，partial 在 8192 字节截断；ccloop 已修（主题行 `fix(claude): deliver an interrupted execute's partial whole …`），修后跑通。**`resume --agents` 只在人工补齐移交记录后跑通**：被直接杀掉的 run 没有任何 CLI 路径能续跑（`resume`／`sweep` 只认 loop 在 `stale_candidate` 边界写的 `owner-transfer.json`）；ccloop 死后 runner（`detached`）与 claude 继续跑完、继续花钱。台账 ccloop `.superpowers/sdd/2026-10-01-live-partial-and-resume/progress.md`。
- Orca 已重钉 ccloop `99054f2`（七项核对全过）。
- 挂账（未变）：恢复窗口不可用时 60 s 不是真上限；`PARTIAL_FLUSH_MARGIN_MS` 在 Orca 手抄一份；`agent-selection.json` 只冻结选择与 hash；claude 自动升级后旧 run 会被 `agent-version-drift` 拒绝续跑。

### 4.0.e 上一会话（`ceca1c47`，2026-10-01）留下的结论（**已完成、人已审；过程删了，结论留在这里**）

- **C4 ＋ v2 阶段超时 3 小时**（主题行 `feat(control): loop plans v2 stop relying on rejectOn tokens and give each phase three hours`；台账 `.superpowers/sdd/2026-10-01-c4-and-phase-timeout/progress.md`；spec `2026-09-30-loop-plans-design.md` §13）：design／investigate 改 command verifier（每个目标一条「存在且非空」检查）；bugfix 的先红要求进 successCondition；三者 `rejectOn` 都是 `REJECT:unused`；v2 阶段超时 10,800,000 ms（Web 路径仍截到 task 的 activeMs 与 `MAX_TIMER_MS`）。
- **ccloop `rejectOn` 只交给 verifier 判断**（方案 D）；Orca 已重钉到 `1e4e434`（主题行 `chore(deps): pin ccloop 1e4e434, …`）。
- 诚实的表述：C4 与 3 小时只在 fake／jsdom 下验过；`rejectOn` 新提示词在真 claude 下没跑过。
- 挂账：`evidenceRequired` 同形的子串问题（ccloop spec §7，README 示例 `"command output"` 恒满足）；`reconcile.ts` 的 `rejectOn: ["nonzero exit"]` 在新行为下无效（无害）；Web 卡片「Acceptance: N check commands」不计文档检查。

### 4.0.d loop 方案层（2026-09-30 会话 `1d7d9aa0`，**已完成、人已审**）

- 做成了什么、诚实表述：见 spec `2026-09-30-loop-plans-design.md`（§10 评审、§11 计划期更正、**§12 人审后的更正**）与台账 `.superpowers/sdd/2026-09-30-loop-plans/progress.md`。人审结论：C2／C3 改为 v2 默认、C4 实测、R-F5 由双语取代、F 组挂账按跟进一轮处理，其余认可（台账 `2026-10-01-loop-plans-followups` H1–H11）。
- 仍然成立：`denylistPaths`／`maxFilesTouched` 只查 agent 自报（人裁 H10：继续挂账）；分钟级收尾窗口要和 ccloop 一起改；fake codex 恒报改了 `answer.txt` ⇒ loop task 的 E2E 要把它放进 `targetPaths`；CLI 遇到 loop task 拒 `loop-plan-cli-unsupported`。

### 4.0.c ⑤ 预算预估链与其后续修复（2026-09-28 会话 `f341f05f`／`c85d2c4e`，**已完成、人已审完**）

⑤ 已推送、人已审完（台账 `.superpowers/sdd/2026-09-27-single-call-estimate/progress.md` §3.21–§3.25）；人授权的待办 1–7（临时目录泄漏、删残留、两处 v1 闸门独立判据、26 的 b／c／d）都已做完，§3.23 的 7 条 Ruling 人已全部认可。**stdin 传 prompt 只有静态证据，真 claude 没跑过。** 还挂着：26(a)；runner stderr 按块解码已在本会话修掉。

⚠️ 下面「人裁」到「执行规矩」这几条是 `f341f05f` 写的 ⑤ 这一轮的原文，仍然有效，保留作出处。

- **人裁**（spec §2 逐字）：
  - S1「A 更多真 claude 形状 + B ⑤ 预算预估链」「先做 B，再做 A」⇒ **A 线还没开**；
  - S2 完整 ⑤；
  - S3 连「应用建议」一起做；
  - S4 方案一（估算作为第二种活走 control 生命周期）；
  - S6「这个session 中如果有需要的话，我授权你改」（改既有判据的一揽子授权）；
  - S7「ccloop 现在没有发布，暂时不用考虑兼容性」；
  - S8「问题先按你的建议执行，最后报我审核」「这个session暂时不要考虑context大小」。
  - ⚠️ S6、S8 **只限那一会话**，不延续。
- **做成了什么**：
  - ccloop 新增通用的 `single-call` 活：envelope `protocol: 3`，`work` 分 `loop`／`single-call`；解析应答加兄弟字段 `singleCallExecution`（claude `"v1"`，codex `null`）。
  - 驱动环按 phase 分流出估算链 A1 → A2e → B／B′ → Ce。Ce 只比 prompt 哈希，然后在同一事务里调 `completeEstimateInStore`。
  - `failed` 的原因分三种：`estimate-call-failed`／`estimate-output-invalid`／`estimate-output-plan-mismatch`。
  - 冻结：`handoffRunIds`／`deliverAndCollect` 认估算 run，一律 `settled-restartable` ⇒ 估算 `interrupted`、退回承诺。
  - 恢复：在 `driverOwnsWebRuns` 下跳过任何状态的估算 run。
  - 估算 run 没有工作区，不碰目标仓库。
  - 面板 `suggestedOperations`：use N、Apply row、Apply all，都发 `provenance: "model"`。
- **实测修掉的三个卡死**（修前都看到红）：
  - 估算永远 `running` ⇒ start 被 `estimate-in-flight` 拒。E1 的变异实测过：claude 1M 的 estimator 今天就会这样。
  - 冻结时估算 run 的请求没人接 ⇒ 组停在 `handoff-pending`。
  - **只要库里有过一个估算 run（含已完成的），每次重启都整库 `dispatchBlocked`**。
- **材料**：
  - spec `docs/superpowers/specs/2026-09-27-single-call-estimate-design.md`：**§11「实施期更正」与文件头「修订二」优先**；
  - 计划 `docs/superpowers/plans/2026-09-27-single-call-estimate.md`：开头两张 Drafter findings 表是起草时对真代码核出的偏差；
  - 台账 `.superpowers/sdd/2026-09-27-single-call-estimate/progress.md` §3：全部 `Ruling:`、S6 名单（§3.2 ccloop、§3.8 Orca）、夹具改动、终审分诊、两仓门的原始报数。
- **提交**（按主题行 `git log --grep` 找）：
  - ccloop 六笔：从 `feat(control): carry loop or single-call work in a protocol-3 start envelope` 到 `fix(control): book a failed single call's observed usage, …`。
  - Orca 九笔代码：
    - `feat(control): speak start envelope protocol 3 …`
    - `feat(control): write the v1 estimate instruction and its JSON Schema, …`
    - `feat(control): drive an estimate run through one ccloop single call …`
    - `feat(control): stop, restart and recover an estimate run …`
    - `test(control): an estimate runs end to end under real ccloop and fake claude, …`
    - `feat(web): apply the model's suggestions per field, per row or all at once, …`
    - `test(scripts): a live estimate scenario for claude, …`
    - `fix(control): block an unreadable single-call record by name, …`
    - `test(agents): let the embedded fake ccloop answer singleCallExecution beside capabilities`
- 🔴 *** **诚实的表述（只能这么说）**：
  - fake claude ＋ 真 ccloop build 下，E1／E2／E3 端到端成立：
    - E1：导入 → 估算 `ready` → 应用一条建议 → confirm → start → 落地；
    - E2：估算在飞时 handoff-stop → `interrupted` → `handoff-complete`；
    - E3：估算在飞时重启 → 不全局阻塞。
  - 验收脚本 `--fake-claude --scenario estimate` 跑绿。
  - **真 claude 下 single-call 估算一次都没跑过**。`--tools ""` 与 `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 只有静态证据（claude 2.1.283 的 `--help` 与包内字符串）。
  - 「claude 可用」「分层选择可用」「Web 派活可用」仍然都不是事实。 ***
- **门**（2026-09-28，干净 clone，env 照 §三）：
  - ccloop（内容＝修复波那一笔）：build／typecheck RC 0；1059 条、1057 过、2 红（`stopProof`＋codexWatchdog 日期 flake），`check-known-reds` RC 0。
  - Orca：229 文件／2084 条、2083 过、1 红（已登记负载 flake `driverRecovery`，单跑 3/3 过）；web 148/148；`verify:panel` 15/15（原始报数在台账 §3.18；§三的现行基线已换成会话 `c85d2c4e` 的那一版）。
- 🔴 **token 额度的口径未变**：`--task-tokens` 是一个任务所有阶段、尝试、续跑共用的**累计**上限，**实际工作设到 1,000,000 以上**，只有测试可以调小。估算自己的 grant 是 Orca 常量 `ESTIMATE_GRANT`（250k token／900 s），single-call 的超时是 grant 减 10 s。
- **挂账**（spec §10／§11；会话 `c85d2c4e` 修了其中三条，见本节开头）：
  - spawn 失败或出流前退出 ⇒ 用量 null ⇒ 组 `usageUnknown` 卡住（**仍挂着**）；
  - ~~prompt 作为单个 argv 参数，Linux 上限 128 KiB~~（已修）；
  - ~~面板「应用建议」后，同一字段的未保存 draft 仍显示~~（已修）；
  - ~~loop 阶段超时不带观测用量~~（已修）；
  - 冻结时已完成的调用照样记 `interrupted`，那次花费白花（**仍挂着**）。
- **人审准备（2026-09-28 会话 `fa672d9e`，人已授权）**：
  - 已发布的归属注释被 `dfe2398` 就地替换 ⇒ 已逐字还原（主题行 `test(control): put back the published agent-selection ruling comments …`）；
  - 两个错数已更正（台账 §3.19）；
  - `dfe2398` 漏登记的 6 个夹具文件已补登（§3.19）；
  - 夹具默认 `"v1"` **不是空绿**：4 条变异全量量过（§3.20）。但两处 v1 闸门**只有一条判据守着**；
  - 5 处 doc 注释随代码改写：4 处保留，`schema.ts` 补回了 spec 指针（§3.20）。
  - **人审清单已按编号 1–27 在会话里交给人**。编号到条目的对照见 §9.0e，人回复「认可/回退 N」时按那张表找。
- **归人**：见 §九 9.0e。
- **本轮新的教训**：见 §六 6.20。
- **执行规矩**：授权都不延续。付费 claude、真 codex、改既有判据、删用户数据、杀进程，每一次都要人重新开口。

### 4.0.b claude 中止前观测用量（stream-json）（2026-09-27 会话 `4d2e426e`／`5b01dbd9`，**人已审过，不要重做**）

- claude 阶段被 handoff deadline 或 handoff-stop 中止时，ccloop 报中止前从 stream 观测到的用量下界，不再报 `null`。于是 run 可续，组不会被置 `usageUnknown`。正常跑完的阶段记账不变。
- 材料：spec `2026-09-27-claude-stream-usage-design.md`（§8 优先）；台账 `.superpowers/sdd/2026-09-27-claude-stream-usage/progress.md` §3。七条点名改写与全部裁定都已由人认可。
- 诚实的表述：真 claude 下付费跑了两次（各 n＝1），第二次（`--task-tokens 400000`）整条链跑通，claude 自报 $0.3371014，被中止的那次花费拿不到；第一次用默认 150,000 额度，续跑被判 exhausted。
- 挂账：`setEncoding`、写观测时的 `catch`、`total !== null` 守卫、`outcome.json.observedUsagePath` 四处删掉后没有判据会红；`message_delta` 配对不看 `parent_tool_use_id`；`--scenario conflict` 用默认额度会报 `group-budget-unavailable`。

### 4.0.a 面板 UI 重做（2026-09-27 会话 `a50f4d80`／`f8281a60`，**已并入 main，不要重做**）

- **做成了什么**：左侧导航＋四个分区（Chains／Task control／Decisions／Metrics，按 hash 寻址，默认 Decisions）；决策区左列表、右详情，列表行带 question 摘要（两行截断，`null` 显示占位）、按 kind／scope／repo 筛选；主题跟随系统深浅、可手动切（按浏览器存）；详情所在的行被筛掉或已审掉时，详情区顶部有提示；列表日期是浏览器本地日期。
- **材料**：spec `docs/superpowers/specs/2026-09-27-panel-ui-redesign-design.md`（§1 是人裁 U1–U5 原话）；计划 `docs/superpowers/plans/2026-09-27-panel-ui-redesign.md`；台账 `.superpowers/sdd/2026-09-27-panel-ui-redesign/progress.md`（全部 `Ruling:`、变异、两轮全量）；被推翻的旧规定见 `docs/superpowers/specs/2026-09-09-panel-design.md` 末尾 ERRATUM（列表不带 question 被 U1 推翻）。过程交接在 `docs/handoff/handoff_ui.md`，结论都已并入本节、§6.19、§9.0d。
- 🔴 *** **最承重的约束：四个分区始终挂载，非当前区只由 `styles.css` 的 `.section-pane:not([data-active="true"]) { display: none }` 隐藏** *** —— 不许条件渲染、不许 `hidden` 属性。变异实测：改成只渲染当前区 ⇒ `agentPreviewRefresh`＋`controlCommandRecovery` 共 16 条既有判据红。jsdom 不加载 CSS ⇒ 可见性由 `web/tests/shell.test.tsx`（钉 `data-active`）与 `web/tests/styles.test.ts`（直接读样式表）守。
- 🔴 **`orca panel` 的 ready 行一个字节都不能改**（`scripts/verify-panel.ts` 的正则、`tests/panel/endToEnd.test.ts` 钉着，`controlShutdown` 按子串等它）。给人看的「在浏览器打开这个 url」提示写在 **stderr**，stdout 仍只有一行（`tests/panel/readyHint.test.ts`）。`/` 不要 token（服务端注入 `index.html`），只有 `/api/*` 验 `x-orca-token`。
- **`DecisionListRow.question` 前后端都必填**（`string | null`，读不到台账 ⇒ `null`，列表不失败）；`projectForList` 展开进带类型的字面量，漏写即编译失败。
- **诚实的表述**：只在数据目录改道的真面板上用 Playwright 看过深浅两套截图；**人的视觉验收还没做**。本轮只换了布局与样式，Chains／Task control 的交互一行没动 —— 要改它们的交互是新一轮，先 brainstorming。
- **第二批（人视觉验收后提的；已由人并入 main，主题行 `Merge branch 'ui/panel-contrast'`）**：
  - 深色 token 逐层往亮里走（卡＜浮层＜hover＜边线），选中行底 22%，正文／次要文字各提亮；`--on-accent` 让深色下 Agree 用深色字（原白字叠浅蓝 2.54:1）。🔴 **这些值被 `web/tests/contrast.test.ts` 钉着**：它读 `styles.css` 深色 `:root` 的 token、按 WCAG 公式算比值（边线／卡 ≥1.4、卡／底 ≥1.12、选中行／卡 ≥1.4、正文 ≥7、次要文字 ≥4.5、按钮字 ≥4.5）。**别往暗里调。**
  - kind 重要性（人裁，只是 UI 序，`KIND_TIER` 仍全 high）：🔴 reconcile、abandon ＞ 🟠 interface、dependency、boundary ＞ 🟡 criteria、scheduling。定义在 `web/src/kindRank.ts`（`Record<DecisionKind, …>`，新 kind 不分档即编译失败）；kind 下拉按档排序、选项文字带 emoji（原生 `<option>` 在 macOS 不认 CSS 颜色）；列表徽章 `data-level` ＋ CSS 色点。
  - 过程、现测、变异：`docs/handoff/handoff_ui.md` §六（已在 main 上）。

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
- ⚠️ **（人 2026-09-29 在会话 `2f65a729` 重申，收窄上一条）**：「handoff文档用中文。代码、注释、其他文档用英文。」⇒ **只有对话与 `docs/handoff/**` 用中文；新建的 SDD 台账、spec、plan 一律英文。** 已有的中文台账／spec／plan 不翻译，往里追加更正时保持原语言。
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
  控制器事后从 `git stash list` 找回（那个 stash 已于 2026-09-28 由人授权删除）。 ***
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

### 6.15 agent 选择一轮（2026-09-26，会话 `75ec878e` 与 `ab5a693c`）新栽的

- 🔴 *** **写作期的一条变异往真实 `~/.orca/` 写了文件**（`agents.json`、`agents.json.draft.json`，0600，内容是判据夹具）。根因：计划代码缺省路径用了 `os.homedir()` 而非传入的 `env.HOME`。 *** ⇒ 仓库外路径的缺省值一律从**传入的 env** 推；**计划写作席也会跑变异，禁令要对写作席同样写死**。残留已于 2026-09-27 按人授权删除（会话 `4d2e426e`，台账 §19）。
- 🔴 *** **并行写计划 ⇒ 后面 Task 的 before 锚点写的是前面 Task 落地之前的代码。** *** 计划复审抓出 8 条 Critical 全是这一类（T3 覆盖 T1、T10 冲掉 T7 的夹具……）。⇒ 不重出计划，改在计划前加一节**权威的复审更正（P1–P23）**，每个派发重申相关条目，并写死「树是真相：增量改、不重建、不重复声明」。
- 🔴 *** **改写既有判据时用一句套话注释「编码不变」会藏住放宽。** *** T7 的 147 条改写里三条被放宽，复审用「同一变异 BASE 红、HEAD 绿」证实。⇒ 改写注释必须写**这条现在编码什么**；复审对可疑改写跑 BASE vs HEAD 的同一变异。
- *** **跨仓词表不一致第五、六次**：「isolated」（零注册时空洞成立）、「fake claude」（runner 层 vs CLI 层）；另有**同一错误码两种退出码语义**（`ccloop control` 具名拒绝退 2，`ccloop run --agents` 拒绝退 1）。 *** ⇒ 接新 CLI 形态时逐个问「退出码与 stderr 的约定是不是同一套」。
- *** **实施席会自己扩范围**（T15 给 `unavailable` 槽加了每 2 s 无上限轮询，每次拉起 ccloop），且不写进顾虑。 *** ⇒ 复审 brief 点名问「有没有无上限循环／每次操作拉起多少进程」。
- *** **子代理报「RED 阶段就绿」「变异跑过」要核原始日志。** *** 本轮两次：一条变异声称跑过但 scratchpad 无任何证据（T3）；一对变异只改了比较的一侧、让所有确认都失败，判据因错误原因变绿（T11）。
- *** **API 周额度会中途打断子代理**（HTTP 429）。 *** 打断后先现核两仓 `git status`／`log`，零改动就原样重派。
- 成本（只抄工具报数；美元全部未知）：六个计划写作席合计约 260 万 token（W1 329,736／W2 294,732／W3 438,566／W4 683,868／W5 626,377／W6 426,820）；实施席单席 12 万–59 万；opus 复审席单席 20 万–36 万。

- *** **（会话 `ab5a693c`）判定器读的行格式与报告写的格式不一样 ⇒ 判定器检查零行、照样 `OK`。** *** 计划要台账里有 `- REWRITTEN: <repo>:<path> > …` 行，实施席却都写在报告里、格式不同 ⇒ 台账 0 行，「改写过的判据仍在且通过」这一项空转。补法：转换后逐行对 json 全名、对不上的单列给人；并把补行改一个字喂判定器，看它退 1。
- *** **修「某检查挡住了 X」时，要找齐所有同类检查。** *** 波 2 只改了端口构造那一道存在性检查，装配层还有第二道 ⇒ 「删表不挡回收」只在端口层成立，面板整个起不来；原判据只量端口层，一直绿。终审靠探针把整条装配路径跑一遍才看见。⇒ 判据要量保证被宣称的那一层（这里是「面板能起来」），不是修改点那一层。
- *** **两条各自合理的设计叠在一起会出死路，而分开审查看不见。** *** 「版本进 configHash」（C6）＋「开跑的组不能重新冻结」⇒ CLI 原地升级即永久卡组（终审 I-2）。fake 轮里版本从不变化，判据看不到。（这一处已由人裁 (a) 解开：hash 不再含 version，见 §4.0；「两条合理设计叠出死路」这条教训仍然成立。）
- *** **变异会留孤儿进程。** *** 删掉 `probeVersion` 超时 kill 的变异、以及让 E2E 起 worker 的变异，都在 PPID 1 下留了长寿进程；fixture 在 `/var/folders/…/T/` 下，命令行不含席的 scratchpad 路径，席的「只杀自己路径」规则认不出它。⇒ 变异席前后各 `pgrep` 一次，按起始时刻对到具体变异。
- 驱动脚本给 `vitest run` 传空文件列表 ⇒ 跑的是**全套**，不是空跑。脚本级检查（非 vitest）要单独分支。
- 远端在一次会话里又被会话外推动两次（`ls-remote` 现测），本会话无一席 push。
- 成本（会话 `ab5a693c`，只抄工具报数；美元未知）：T16 实施 242,107；波 5 复审 199,243；T17 门席 260,770；变异电池 ccloop 416,801／Orca 270,336；终审 393,278；终审修复 174,174（token）。

### 6.16 会话 `8c6302e0`（终审 I-2 ＋ 夹具层审计）新栽的

- *** **「BASE 红、HEAD 绿」这个机械定义也会把【设计上有意去掉的】交叉核对判成放宽**（MC1：Orca 按 spec 不再重算 ccloop 的 hash）。 *** ⇒ 审计报「放宽」时先问：丢掉的这份核对，在规则只住一处的前提下还该不该存在；该不该交人裁。
- *** **「这个变异零杀伤」只相对于跑过的文件范围成立。** *** 审计的 R1 只在 15 个依赖替身的文件上跑、判「没有判据抓它」；席 C 跑全套发现 11 条 scheduler 判据抓它，真正的缺口在下一层消费方守卫。⇒ 判「无覆盖」前在全套上跑一次；再往下一层对**消费方自己的守卫**做收窄变异（只守了 `failed`、漏了 exhausted 等）。
- *** **改夹具转绿的既有判据没有任何机械检查**（T11 红 267 条、只列 60 行 `REWRITTEN`）。 *** ⇒ 以后概括授权改判据时，夹具 diff 要单独列给人并派审计。
- **夹具对所有输入答同一个常量**（这里是 `configHash`）会让「值被张冠李戴」完全不可见。⇒ 夹具要么按输入派生值，要么给可选开关；本轮加了 `distinctConfigHash`。
- **子代理写不了报告文件**（harness：「Subagents should return findings as text」）⇒ brief 里让它把报告放在最终消息里，不要要求 `report.md`。
- **Tier 0 闸门在 scratch clone 里也拦 `git reset/restore/checkout/clean`** ⇒ 变异还原用 `cat 原文件 > 目标` 或换新 clone，别在 brief 里写这些命令。
- **变异运行器自己会坏**：一席的第一版把被变异文件截成空，整批「变异」都是空模块；另一席的把同名 `it.each` 行合并，藏住一次杀伤。⇒ 运行器先喂坏输入（锚点缺失、同名多行）自检。
- `orca checkpoint write` 要求工作树干净 ⇒ 先提交手头的文档再写检查点。
- 成本（只抄工具报数；美元未知，会话钩子报约 $10 时仍在中段）：审计 432,833；席 A 281,873；席 B 292,874；席 C 212,634（token）。


### 6.17 会话 `43e3e1d8`（R1–R30 人审、R1／R3／R7／R17 落地、第一次付费真 claude）新栽的

- 🔴 *** **fake 只认形状，不认真 API 的约束。** *** fake claude 从不校验 `--json-schema`，一个真 API 必拒的 execute schema（顶层裸 `oneOf`）在全部 fake 判据下都绿，第一次付费跑就撞上。⇒ **交给真 CLI 的参数至少要有一条判据直接读「runner 实际传了什么」**；**真付费跑之前先让 tee 留下原始回包**（ccloop 的 runner 在失败时丢掉 claude 的 stdout，真因只在 tee 里）。
- 🔴 *** **改了 runner／fixture 只跑那个目录，会把别处的判据带红。** *** 控制器自己犯了：ccloop 那笔 schema 修复提交时，`run --agents` 的 3 条判据是红的（fake 靠 `oneOf` 认阶段），到 Orca 全量里以 E2E `terminal:failed` 露头。⇒ **改哪个仓，就在那个仓跑全量再提交。**
- 🔴 *** **「审阅清单的计数」也会是空的。** *** 上一会话写「约 55 条、B1 16／B2 8／B3 12／B4 4」，四组之和是 40，分组没落盘；本会话按「一个可独立推翻的决定＝一项」机械重拆成 R1–R30 并落盘（`ruling-review.md`）。⇒ **给人审的清单必须落盘、带编号，计数要能复算。**
- 🔴 **控制器给人的理由也会是假的**：R28 说 `versionOf`「会阻塞面板」，实测它只在夹具和脚本里。人按错的理由拍了板，修法碰巧仍对。⇒ **给人建议前，理由里的每个事实都要现核一次。**
- **回退／定时判据**：每步从「观测到的时刻」起推进会累积漂移，第三步起越过下一次触发 ⇒ 推进一半断言「还没发生」、再推进过点断言「发生了」。**夹具里「第 n 次读就变」的语义**，一旦产品多了一条读路径（获焦重读）就会错位 ⇒ 按「发生过哪件事」变，不按读的次数变。
- **夹具表模式**：fake codex `ok`／`script` 会让 `ccloopProtocol.integration` 红，要 `integration`；全新 clone 要先 build web，否则 panel 判据全是 `panel-dist-missing`。
- **`--no-session-persistence` 不等于零写入**：claude 仍在 `~/.claude/projects/<cwd 编码>/` 建空 `memory/`。
- 成本（只抄工具报数）：付费 claude $0.16246＋$0.4126642；本会话无外派子代理；会话自身最终美元数工具未给。

### 6.18 会话 `94b09282`（人审改写判据、付费轮四个发现、B4 根治、负载 flake）新栽的

- 🔴 *** **根因先实测，再动手。** *** 控制器凭读码断言 flake 是「execute 离截止只差 10 ms」，并按这个改了一版；加负载实测后，真因是 verify 撞上 20 ms 的单阶段超时，8 次红 5 次都是这一句。⇒ **修 flake 之前先在负载下复现，让判据把结局与事件序列打出来。**
- 🔴 *** **zsh 不拆分未加引号的变量**：`kill $pids` 一个都没杀掉，随后的「是否存活」检查也是空检查，报了假的「已停止」。 *** ⇒ 起后台进程一律写成 bash 脚本、用数组，结束时逐个 `ps -p` 核对。
- 🔴 **按工作目录找夹具的判据，在别处用 `--root` 跑会假红**（ccloop `subprocessClaudeAdapter` 的 `fake-claude.mjs`）⇒ 变异和全量一律 `cd` 进 clone 再跑。
- 🔴 **机械改写从下往上插行时，排在前面的就地修改要先做**，否则后插的行会把它们推错位。改完核 diff 的「新增／删除」行数与计划一致。
- **Orca 的 Tier 0 闸门会拦下 clone 里的 `git pull`**（不重试，也不换说法重来）⇒ 要新版本就重新 `clone --local`。
- **免费探针**：把 `ANTHROPIC_BASE_URL` 指向无人监听的端口，一个请求都发不出去，可以零成本量 claude 的**启动期**副作用。先用不带开关的对照组复现，再测开关。
- **口头解释也要现核**：控制器说「切回页面只起一个 ccloop」，读码后是 1＋N 个，每个还会跑一次 agent CLI `--version`。给人做决定的依据，要先现核再说。
- 成本（工具报数）：付费 claude $0.152572（一次 plan 调用）；无外派子代理；会话自身最终美元数工具未给（中途钩子报过约 $13.91）。


### 6.19 面板 UI 重做一轮（2026-09-27，会话 `a50f4d80`／`f8281a60`）新栽的

- 🔴 **在 worktree 里改代码时，别同时在同一棵树上跑全量**：第一次基线就因为和编辑并发而作废。基线一律在干净 clone 上跑。
- 🔴 **按子串做锚点的替换会误中更深缩进的同形行**（`"      ))}\n"` 是 `"              ))}\n"` 的后缀）⇒ 截代码块用**整行相等**匹配。
- 🔴 *** **`Record`＋`as` 构造出来的对象，类型里的必填字段是空话**：`question` 收紧为必填后根 tsc 仍是 0。 *** ⇒ 展开进带类型的字面量，再用「删掉这个字段」的变异确认 tsc 真的红。
- **类型变化会波及未授权的测试**（字面量、`webParity` 的互赋值检查）⇒ 动共享类型前先两侧 `tsc`，再决定改类型还是请人授权改测试；只放宽一侧会被 `webParity` 打红。
- **改既有判据前，先看它在新行为下真的红**（同文件其余判据绿），这是改写必要性的证据。
- **jsdom 不加载 CSS** ⇒ 任何只靠 CSS 实现的行为，都要有一条直接读样式表的判据。
- **调用方给的「没有」是 `null` 还是 `undefined`，先读调用方再写条件**：App 在详情加载中传 `null`，按 `=== undefined` 写的提示会在加载时误出。
- **Tier 0 闸门也拦 scratch clone 里对名为 `main` 的分支做 `git merge`，以及含 `reset --hard` 或解析不了的 `cd $VAR` 的组合命令**（不重试、不换说法）⇒ 合并预演用只读 `git merge-tree --write-tree`，把结果树 `git archive` 进新 clone 跑全量；路径写字面量。
- 🔴 **「token 不存在」的红不是判据被看见红**：新加的对比度断言第一次红在 `no dark token --on-accent`，量的是「有没有这个名字」，不是比值。⇒ 先把现值原样抽成 token，看它红在**实测比值**（2.54），再改值。
- **对比度问题先量再修，量对对象**：深色「对比度差」量出来文字全过、只有层次（边线／卡 1.08）不过 —— 与 md2publish `theme-design-lessons.md` 规则 7／10 同一结论。jsdom 不渲染 ⇒ 判据直接对 CSS token 做 WCAG 计算。
- **main 会在你做分支时被别的 agent 推进**：合并前重新 `git ls-remote`／`merge-base --is-ancestor`，`--ff-only` 不成就只读 `git merge-tree --write-tree` 查冲突；只多了文档的话，分支上的全量结论对合并结果仍然成立。
- **人手动起面板时，`ORCA_*=…` 单独成行、既没 `export` 也没行尾 `\`，就传不进子进程**，结果写进了真 `~/.orca`（已由人决定删除，挪进了废纸篓）。


### 6.20 ⑤ 预算预估链一轮（2026-09-28，会话 `f341f05f`）新栽的

- 🔴 *** **逐 Task 只跑点名的判据文件，会漏掉嵌在别处的同形夹具。** *** 线上应答加了一个必填字段，每个 Task 都绿；干净 clone 的全量门才抓到 `tests/agents/command.test.ts` 里内嵌的假 ccloop 应答缺那个字段（3/3 稳定红）。⇒ **改线上 schema 的轮次，收尾全量门不能省，且门要在最终树上重跑。**
- 🔴 **两个仓的 canonical JSON 排 key 算法不同**（ccloop `localeCompare`，Orca 按 code unit），**且 ccloop accept 存盘时会按自己的算法重写 envelope** ⇒ 跨仓比对哈希只对「单个字符串」可靠（prompt），对对象不可靠（schema）。
- 🔴 **spec 里写的「冻结记录逐字段写」是读代码时的想当然**：两处冻结点都是 `{ ...resolution }` 展开。⇒ 声称「不改持久化 schema」之前，数一遍所有写入点，看是展开还是逐字段。
- **同一个 profile 给所有角色时，一个角色的能力声明会变成另一个角色的约束**：estimator 要声明 1M 窗口 ⇒ worker 同窗口 ⇒ confirm 拒 `handoffAtContextTokens: null`（产品问题，§9.0e）。
- **计划起草交给两位子代理并行写、控制器合稿时，两边的接口会各自发明**（这次是 fake 的 `delayMs` 形状）⇒ 合稿前先写一份共享接口契约，合稿后逐名对一遍。
- 🔴 *** **（会话 `fa672d9e` 核出）一揽子授权（S6）下改写判据时，实施席把上一轮已发布的归属注释整行替换掉了**，台账和评审都没发现。 *** ⇒ 验收改写类提交时，用 python 扫一遍 diff 里被删的注释行，逐行查它在远端 main 上是否存在；存在的就只许追加，不许替换。ccloop 那一侧做对了（保留原文加 ERRATUM），可以直接抄。
- **量「夹具默认值会不会造成空绿」要两个方向一起量**：①删掉闸门，看有没有判据红（证明闸门有守卫）；②把夹具默认值翻转，看有没有判据红（证明默认值承重）。只做一个方向，另一个方向的空绿仍然可能存在（§3.20）。
- 🔴 **（会话 `292277d5` 核出）handoff 里写的残留数量（「4 个」）与现测（52 个）差了 12 倍**，因为当时只数了自己「知道的」那一种来源。⇒ **登记残留时要写清楚是什么命令测出来的、按什么前缀，并且查到产生它的代码**。只数自己知道的那一种，会把一个每跑一次全量都会发生的泄漏看成一次性事故。
- 被当作 `ORCA_CCLOOP_BIN` 的 clone 不许同时做变异（上一轮的教训，本轮照做无事故）；判 flake 等负载降下来并记 `uptime`（§三）；判据等真正要断言的状态，不等「文件存在」。

### 6.21 待办 1–6 那一轮（2026-09-28，会话 `c85d2c4e`）新栽的

- 🔴 **人给的判据也可能量不出来**：「全量前后 `$TMPDIR` 目录总数要一样」在当时的 ccloop 上永远不成立，因为全套本来就漏约 805 个（会话 `2724716d` 修后为 0）。⇒ 先跑一次修复前的量测，确认判据能分出修前修后；分不出就把 `TMPDIR` 改道到空目录、按前缀数，并把改法记进台账。
- 🔴 **单文件连跑 10 次全绿，不能证明清理没问题**：负载下的全量里，C4 的清理撞上 fake worker 还在写，报了 `ENOTEMPTY`。⇒ 清理一个会派生进程的判据时，先等那个进程退出（pid 在记录里），再在全量里验证。
- 🔴 **只用 ASCII 的判据看不见编码缺陷**：runner 按块解码 stdin 的缺陷，是边界判据刚好用了 `é` 才露出来的。⇒ 涉及传输的判据至少放一个多字节字符的样本，并让它跨过读块的边界。
- **变异红在前一条断言上，不等于量到了目标**：24 的第一版红在 `group-budget-unavailable`，26(c) 的变异红在 drafts 的相等比较上 ⇒ 去掉前面的断言或改夹具，直接量目标值（台账 §3.23 都记了）。
- **工具层**：Orca 的门会拦下 clone 里的 `git pull`（用 `cat 主树文件 > clone 文件` 同步）；`rm -rf $(…)` 会被安全检查拦下，要先打印路径，再删字面路径；本机 `cp` 带 `-i`，会静默拒绝覆盖，一律用 `cat >`。

### 6.22 两仓临时目录泄漏那一轮（2026-09-28，会话 `2724716d`）新栽的

- 🔴 **`TMPDIR` 改道本身会造出假红**：放在会话 scratchpad 下太长（tsx 的 socket `$TMPDIR/tsx-<uid>/<pid>.pipe` 超过 macOS 104 字节，撞名 `EADDRINUSE`）；用软链（`/tmp/...`）则 git 报真实路径、比路径的判据红。两次各红 7 条，都不是回归。⇒ **`TMPDIR` 用短路径的真目录**（如 `/private/tmp/<短名>` 或 `mktemp -d "${TMPDIR%/}/cl-XXXX"`）。
- **能在一处兜住的，不要逐个改**：人授权的是逐个改 35 个判据文件；实测一个 setup 文件（每个测试文件一个临时根）就让泄漏归零，且一个既有判据都不动。⇒ 动手前先找一处能覆盖全部的位置。
- **模块顶层的副作用会随 import 扩散**：`verify-panel.ts` 在顶层 `mkdtemp`，判据 import 它的纯函数时也会建一个目录。

### 6.23 标签＋进度＋待办批量那一轮（2026-09-29，会话 `2724716d`）新栽的

- 🔴 **计划里给的测试夹具可能测不到任何东西**：Task 5 的夹具在 harness 建好之后才替换 `port.collect`，可 router 早已把方法绑定走了（`profiles.ts` `ownPort`），于是「改之前就绿」。实施子代理靠「先红」发现，改为包 `router.resolve`。⇒ 先红这一步不能省，它是在量夹具本身。
- 🔴 **子代理建议的修法可能依赖不存在的 API**：台账里写的 `store.db.isTransaction` 在 node v22.13.1 上是 `undefined`，照做会把每个组失败都重抛、推翻整个 Task 10；终审实测后改用每组 SAVEPOINT。⇒ 建议的修法里用到的 API，先在本机量一次。
- **写文件工具会悄悄把 NFD 字面量规范成 NFC**：判据里一个 NFD 的 `café` 被改写，M1b 因此打不红。⇒ 判据里有非 NFC 文本时，写完用 python 核字节。
- **「红在前一条断言」这一轮又出现多次**（M4b、M4h、M8 的几条、Task 8 的 status 断言）。⇒ 每条变异报「红在哪一行」，不是「红了哪个 it」。
- **子代理会把自己的模型名写进 `Co-Authored-By`**：两笔 ccloop 提交（`docs(codex): append a named erratum …`、`fix(claude): close a streamed message only with …`）写成了 `Claude Sonnet 5`，已发布不能改。⇒ 派发时把整行原样给出，提交后用 `git log -1 --format=%B` 核。
- **测量用的 `TMPDIR` 要短、要是真目录**（§6.22 的延续），`mktemp -d /private/tmp/cl-XXXX` 一直可用。

### 6.24 loop 跟进＋面板双语那一轮（2026-10-01，会话 `e604b1ba`）新栽的

- **「按你的建议办」不是改判据的授权。** 人给了「执行中按你的建议办」，但改既有判据仍要人点名：C4 那笔改动因此停在补丁里，等人点名。反过来，spec 里写明「计划按扫描补全、类别内都授权」的，扫描漏掉的同类判据仍在授权内（本轮 `taskAmendments.test.ts` 那条就是这么放行的）。
- **翻译位置最常见的漏洞是「没人看得见」。** 前 4 个 task 里 3 个因为新 `t()` 位置没有任何判据在中文下断言它而多修一轮。⇒ 每个新位置都要在中文下断言**完整文字**，并跑「放回英文」的变异看见红；`toContain` 一个别处也会出现的词等于没断言。
- **伪语言判据会被插值剥掉。** 把整句包进 `⟦…⟧` 时，传进 `t()` 的原始英文值会和标记一起被剥掉 ⇒ 只包固定文字，插值留在标记外。3 个字符以下的值仍然看不见。
- **整轮终审抓的是「每个 task 都对、合起来错」。** W7 的「保留版本」路径把 `chosenBy` 改成手选，按标签选方案的 task 一键应用就被判过时——所有服务端夹具都是手选，web 判据又用的是会答成功的假服务端。⇒ 夹具要覆盖默认路径（plan 文件不写 `plan` 时就是按标签）。
- **真 verifier 会引用规则原文。** 子串匹配的 `rejectOn` 对「解释为什么不适用」的通过判定是毒药；这件事只有付费实测看得到（fake 从不这样说话）。
- **i18next 的 `addResourceBundle(…, deep, overwrite)` 会改写你 import 进来的那个对象**（i18next 按引用保存）⇒ 测试里换 bundle 要先删再加一份拷贝。
- **定时器上限**：Node `setTimeout` 延迟超过 2,147,483,647 ms 会被改成 1 ms（带 TimeoutOverflowWarning），任何「不设限」的时长都要先截到它。

### 6.25 记忆区一轮（2026-10-03，会话 `184d0372`）新栽的

- **写文件工具会把源码里的 `\u` 转义换成字面字符**，而且是在控制器写计划时就发生了（计划里的 `"caf\u00e9"` 落盘成了字面 `é`）。判据靠两种 Unicode 形式不同来成立时，字面写法在下一次规范化编辑后会静默变空。⇒ 这类源码用 python 写，写完按字节核「转义文本在、该行无非 ASCII 字节」。
- **express 5 里，注册在 4 参数错误处理器之后的路由照样匹配**（计划的 M-route 变异因此恒绿）；真正的后果是该路由的异常绕过 JSON 错误处理、变成默认 HTML 500。`src/panel/api.ts` 里「放在错误处理器下面就不再匹配」那句注释实测为假（按 Rule 3 没动，别据它改路由顺序）。
- **Node 22.13.1 上 `execFile` 的 ENOTDIR／ENOEXEC 是同步抛**，不进回调；ENOEXEC 的 `code` 是 `"Unknown system error -8"`。判别「spawn 失败」与「编程错误」看 `error.syscall === "spawn"`。maxBuffer 超限不置 `killed`。
- **一条判据的标题承诺比它的断言多**：「env 原样透传」原判据只记了两个变量，`{...process.env, ...options.env}` 这种「好心的合并」照绿；补一个只在 `process.env` 里的哨兵才看见红。⇒ 「什么都没加」要用一个只可能从错误来源出现的值去量。
- **派席报告不可直接当证据**：两次实施席把测试数、变异数写错（报告与实际输出不符）。控制器逐个打开 `mut-*.txt` 才算数——这一步每个 task 都要做。
- **全部面板分区一直挂载**：任何分区在挂载时发请求，都会出现在每条 App 级判据的请求序列里，也会在「从没打开过」的情况下产生副作用（这里是起 ccmem）。⇒ 有副作用的分区按「第一次激活」才请求。

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
129/1075 → 172/1516 → 180/1618 → 183/1622 → 184/1636 → 195/1756 → ?/1851 → 220/2003 → 222/2009 → … → 287/2611`（287/2611 是会话 `184d0372` 记忆区一轮的门，2 红都是负载 flake；中间几版见 §三与各台账；222/2009 是会话 `f8281a60` 对 UI 合并结果树的预演，全过；195/1756 是执行驱动轮之后；?/1851 是 ④ 轮收口的全量 vitest，全绿，文件数没单独记；220/2003 是会话 `94b09282` 收尾的全新 clone，全过）。**现行值见 §三。**
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
- ~~一个遗留的 `git stash`~~ —— 已由人授权删除（2026-09-28，会话 `fa672d9e`）。
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
- ~~旧的 `git stash@{0}`~~ —— 已由人授权删除（2026-09-28，会话 `fa672d9e`）。

### 9.0c agent 选择一轮登记、归人的（2026-09-26／27，会话 `75ec878e`／`ab5a693c`／`8c6302e0`／`43e3e1d8`／`94b09282`）

已由人裁定、已落地的条目（终审 I-2、R1–R30 人审、改写判据人审、付费轮 B1–B4、R29 名单、负载 flake、`~/.claude/projects` 残留、孤儿进程、真实 `~/.orca` 下的两个夹具残留）已从本节删去，结论都在 §4.0 与台账 §11–§19。
- 🔴 **推送**：顺序**先 ccloop 后 Orca**。Orca 的端到端判据是对新 ccloop build 跑绿的；线上协议形状没变。哪些笔已在远端，跑 `/usr/bin/git ls-remote` 自查。
- **负载型 flake（登记，单跑绿）**：Orca `gateCheck` K12 5 s 超时一次。ccloop `runLoop.integration.test.ts` 里另有 19 条 `perAttemptTimeoutMs: 20,`，其中真要跑 plan／verify 的在重负载下可能同样会红，特征是「… phase exceeded per-attempt timeout of 20ms」（台账 §18）。
- **变异会留孤儿进程**：做完变异后跑 `pgrep -fl "ccloop-agents-version|worker.js"`，杀进程要人授权。
- 挂账（登记不修，spec §11／§13.3／§13.5／§13.8）：
  - 旧 `SubprocessClaudeAdapter` 保留；
  - `ccloop resume`／`sweep` 不支持 `--agents` 起的 run；
  - claude 工具进程另开进程组时杀不到；
  - 旧 `ControlService` 的 claim／continue 路径（K1／K3／K4 等）生产不可达、无判据；
  - 派活不与确认快照比对；
  - claude model 以 `[1m]` 结尾可绕过上下文档位；
  - handoff 宽限在冻结值无效时退回 0；
  - 安装记录的 `configDir` 或 kind 字段改了，已开跑的组仍然没有出路（`command`、`timeoutMs`、`killGraceMs` 自 R1 起已不在 hash 里）；
  - `orca run` 解冲突时「信号取消是否仍发布 attempt ref」没量；
  - 本轮之前就弱的判据：ccloopProtocol 的 SIGKILL 两行、controlReadApi 的键数与 `objective.taskId`、controlConfigPort 的 `defaults`。
- 更正（本次重写时）：旧版挂账里「`versionOf` 无超时」自 R28 起已不成立（10 s 超时）；「`command` 改了已开跑的组永久无出路」自 R1 起已不成立。

### 9.0d 面板 UI 重做一轮登记、归人的（2026-09-27，会话 `a50f4d80`／`f8281a60`）

- 🔴 **合并 `ui/panel-contrast` 进 main（人已要求，agent 被 Tier 0 闸门拦下）**：`cd /Users/biran/code/skills/loop/Orca && git pull --ff-only && git merge --no-ff ui/panel-contrast && git push`。只读 `merge-tree` 无冲突（main 相对分支只多了本文的文档行）。合并后等着的那个 agent 可以继续。
- **视觉验收**：第一批人已看过（提出了深色对比度与 kind 排序 ⇒ 第二批）；**第二批还没看**。看之前要 `npm run build --workspace web` 再重起面板（旧进程服务的是旧 `web/dist`）。
- **四条被改写的既有判据尚未人审**：名单在计划 Global Constraints，每条旁有 `REWRITTEN … U1 … U4 … a50f4d80` 注释。
- **真 `~/.orca`**：第一次的数据已挪到 `~/.Trash/orca-real-data-2026-09-27`（清不清归人）；**之后又被写了**（`reviews.jsonl` 840B＋`control/`，人在 7777 端口起的面板视觉验收时写的，多半仍是 `ORCA_*` 没 `export`）—— 人的数据，未动。
- **两个 UI 分支与 worktree 删不删**：`ui/panel-redesign`（已合）、`ui/panel-contrast`（待合），worktree 都在会话 scratchpad 下（`git worktree list`）；`docs/handoff/handoff_ui.md` 合并后要不要删、并回本文 —— 都归人。
- **控制器替人做的决定**：台账的 `Ruling:` 行（含跳过 `orca level` hook 的 `checkpoint write` —— 本批因此没有 `.orca/checkpoints` 记录）。

### 9.0e ⑤ 预算预估链一轮登记、归人的（2026-09-28，会话 `f341f05f`）

- 🆕 **会话 `2724716d`（2026-09-29）之后归人的，以 §4.0「还挂着的」为准**；本节以下是 ⑤ 那一轮的出处。

- 🆕 **会话 `c85d2c4e`（2026-09-28）做完了待办 1–6**（台账 §3.23）。下面「已授权、未做」里的 24、26 的 b／c／d、27，以及泄漏修复，都已做完；**本节再往下的原文保留作出处，不再是当前状态**。现在归人的：
  - ~~审 §3.23 的 `Ruling:` 行~~：人已全部认可（会话 `2724716d`，台账 §3.24）。
  - ~~ccloop 全套临时目录泄漏~~：已修、`ccloop-*` 存量已删（台账 §3.24）。`orca-*` 存量也已删（§3.25）。
  - **26(a)** 仍挂着（要先做设计）。
  - **付费验证**：估算与 stdin 传 prompt 都没在真 claude 下跑过。

- 🆕 **人审结论（2026-09-28 会话 `292277d5`，台账 §3.21）**：下面编号 1–27 都已回复。**本节以下的「审这一轮」和「人审清单」已经过期，但保留原文，方便按编号对照。**
  - 已授权、未做：
    - 24：两处 v1 闸门各补一条独立判据；
    - 26：挂账四条都修；
    - 27：**全部 52 个都删**（不是原来说的 4 个），另加两个会话的 scratchpad clone。其中 48 个出自 ccloop `tests/control/singleCallCapability.test.ts`，这个文件从来不 `rm`，每跑一次全量漏 6 个。人要求**尽快修**，优先级高于 26（台账 §3.22）。
  - 25：人采纳控制器的建议。现在不改代码；等 ccloop 能实时观测上下文时，加一个显式的关闭值，不放宽 `null`。今天的绕法是 estimator 和 worker 选不同的 profile（台账 §3.22）。
  - 同一会话还和人对齐了 `docs/handoff/goal.md`，新增 §9（现状对齐）和 §10（新诉求 N0–N8，人裁 G7–G11 记在 §10.2）。**下一轮选题时先读 goal.md §10.1 的先后。**
  - ⚠️ 26 会碰既有判据和 ccloop 的代码，开工前要按 ccloop Rule 15(a) 逐条列出要改的判据给人看。27 删之前要现测清单。

- **审这一轮**：全部 `Ruling:`（台账 §3）；**S6 名单**（ccloop §3.2：12 个测试文件加 helper `agentsFixture.ts`，只改 envelope 字面量，真正改断言的是 `protocol.test.ts` 的「names unsupported protocol versions…」；Orca §3.8：O1 表 17 行、O2 的 1 处），以及台账列出的「夹具改动」（§3.19 补了 `dfe2398` 漏登记的 6 个夹具文件，其中 fake ccloop 替身的行为变了）。已发布的归属注释被就地替换那件事已还原（台账 §3.19）；源码 doc 注释随代码改写的 5 处已由控制器按仓库先例裁定：4 处保留，`schema.ts` 补回指针（§3.20）。⚠️ ccloop Rule 15(a) 要逐条指名，S6 是一揽子授权 ⇒ **要人事后逐条认可或回退**。
- ~~推送~~：人已在 2026-09-28 推了三个仓（会话 `fa672d9e` 用 `ls-remote` 现测，远端等于那一会话开工时的本地 HEAD）。之后的新笔以现跑 `ls-remote` 为准。⚠️ 这批笔里的注释从此是**已发布文本**，只能追加具名更正。
- **付费验证**：`--claude --scenario estimate`（`--task-tokens` ≥1,000,000）从没跑过；`--tools ""` 与输出上限只有静态证据。
- **产品问题**：一个 profile 给所有角色时，estimator 声明窗口 ⇒ confirm 强制数值 handoff 阈值（无法表达「不按上下文交接」）。
- **挂账要不要修**：spawn 失败／出流前退出 ⇒ `usageUnknown` 卡组（要先定义「可证明零花费」）；Linux argv 128 KiB；应用建议后 draft 仍显示；loop 阶段超时不带观测用量。
- **残留**：OS tmp 下 4 个 `ccloop-single-call-*` 目录（变异超时留下）、scratchpad 里的 clone；删都要人点头。（孤儿 `worker.js` 已由人授权杀掉，2026-09-28 会话 `fa672d9e`。）
- **A 线（更多真 claude 形状：依赖、handoff、混 kind、n＞1）**：人裁 S1 排在 B 之后，还没开。
- **人审清单编号表**（会话 `fa672d9e` 交给人；人回「认可/回退 N」时按此对照；细节在台账 §3.2／§3.8／§3.19／§3.20）：
  - **A1 ccloop S6（`06b6453`）**
    - 1：`protocol.test.ts`「names unsupported protocol versions…」改成拒 1、2、4（唯一改了断言的一条）；
    - 2：其余 12 个文件只改 envelope 字面量，含 helper `agentsFixture.ts`。
  - **A2 Orca S6**
    - 3：`startEnvelope`「copies the claim…」；
    - 4：`ccloopPort`「asks capabilities about exactly…」末尾加 `singleCallExecution: null`；
    - 5：`webCcloopSmoke`，V2→V3，外来版本 1→2；
    - 6：`estimator`「freezes exact input formula…」改为数整条 prompt（`4b5db1f`）；
    - 7：其余 11 个文件只改字面量或做类型收窄。
  - **B 夹具改动**
    - 8：台账原有登记的夹具（`dfe2398`／`4b5db1f`／`18ace7e`）；
    - 9：§3.19 补登的 6 个，含 fake ccloop 替身的行为变化。
  - **D Ruling**
    - 10：claude `"v1"`、codex null；
    - 11：直接在 main 上落提交；
    - 12：F10 只比 prompt 哈希；
    - 13：归属行写实施席自己的模型、不 amend；
    - 14：ccloop W1 判据读 argv；
    - 15：O2 两处表外夹具事后认可；
    - 16：`restartRun` 无工作区就跳过清理；
    - 17：`confirmSoft` 与验收脚本回显窗口；
    - 18：`providerCalls` 三元式；
    - 19：O6 新判据两处与 brief 不同；
    - 20：修复波 C1–C3、O-a–O-e；
    - 21：终审登记不修的 4 项；
    - 22：约 60 条变异没有重跑；
    - 23：`18ace7e` 不单独派评审。
  - **E 开放问题**
    - 24：两处 v1 闸门要不要补第二条独立判据（现在只有 `estimatePrompt.test.ts`「is blocked-capability unless … v1 …」一条）；
    - 25：单 profile 下 confirm 强制数值阈值的产品问题；
    - 26：挂账修哪几条；
    - 27：OS tmp 下 4 个 `ccloop-single-call-*` 目录，以及会话 `f341f05f`、`fa672d9e` scratchpad 里的 clone，删不删。
  - ⚠️ 人回「回退」某条时，回退对象按台账 §3 对应的 Ruling 行或 S6 表找；**回退动的是已发布的笔，只能追加新提交，不能改写历史**。

### 9.0f #13／重钉脚本／loop 方案层一轮登记、归人的（2026-09-30，会话 `1d7d9aa0`）

- **人审**：本会话按人的授权「先按你的建议执行，最后报给我审核」替人定了很多点，清单见 §4.0 第 1 步。
- **归属行**：本轮全部实施子代理都跑在 Opus 5.5 上，所以统一的 `Co-Authored-By: Claude Opus 5.5 (1M context)` 是真话（台账 P8）。评审子代理不提交。
- **上下文额度**：本会话越过了 Rule 6 的 T1（330k）与 T2（450k）。人事先明说「这个session暂时不要考虑context大小」；越线在 Orca 检查点 `orca-dev-1d7d9aa0` 与本节都有记录。
- **付费**：本会话零付费调用；loop 方案在真 agent 下没跑过，`rejectOn` 令牌对真 verifier 的测量要一次付费跑（spec §8）。
- 变异副本留在会话 scratchpad（`mut-*`、`gate-*`），没删；删要人点头。

### 9.0g loop 跟进＋面板双语一轮登记、归人的（2026-10-01，会话 `e604b1ba`）

- **人审**：见 §4.0 第 1 步（两本台账的全部 `Ruling:` 行、计划头部裁定、`zh-review.tsv`）。
- **C4 改动的判据点名**：§4.0 第 2 步。
- **ccloop 行为改动**（要人开口）：`rejectOn` 的匹配规则；`setTimeout` 溢出对别的客户端的防护。
- **付费**：本会话付费调用只有 C4 那 6 次（人批准的「每次封顶 1 美元」），claude 自报合计 0.4917684 美元；会话本身的花费工具没给。
- **上下文额度**：本会话越过了 T1 与 T2（人明说「这个session暂时不要考虑context大小」）；越线记在检查点 `orca-dev-e604b1ba`。
- **删除**：本轮早期子代理删过自己的 scratch 副本（`/bin/rm -rf`，没经人批准）；此后一律保留。会话 scratchpad 里的 `mut-*`、`rev-*`、`gate-final` 等要删请人点头。

### 9.0h 记忆区一轮登记、归人的（2026-10-03，会话 `184d0372`）

- 本轮替人定的裁定全在台账 `Ruling:` 行（提交在本地 `main` 而非 worktree 分支；评审 Important 推翻了计划里两处写死的代码；i18nPseudo 夹具改了一个字符串；终审先于门；三条 parked）。**人 2026-10-03 已逐项看过并同意**（含 i18nPseudo 夹具改动与 Rule 6 越线的知情）。
- 记忆区三条 parked 小项与后续，见 §4.0 第 2 条。
- 本轮的提交归属行写的是各实施席自己的模型（Sonnet／Haiku／Opus），与 §九 已登记的做法一致。
- 会话 `184d0372` 的 scratchpad 原始输出：人授权「判断不再需要就删」，已删（证据已在台账里）。三仓推送：人已推（同会话 `ls-remote` 现测）。

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
