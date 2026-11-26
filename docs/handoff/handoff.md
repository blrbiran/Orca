# Orca Handoff

> ⚠️ **这份文档是多 agent 共享的，而且【它不该无限膨胀】。**
> *** **本文允许就地改、允许删、允许整节替换**（Rule 13，2026-09-22 由人放宽）。 ***
> 动别的 agent 落下的条目要**同时**满足三条：(a) 指得出**是什么让它过期的**（提交主题行／哪一次实测）；
> (b) 它承载的**结论**在留下来的段落里活着 —— **删的是过程，不是结论**；(c) 不把已知为假的说法带下去。
> **三条里有一条不确定就留着。**
> ⚠️ **放宽的只有本文。** `.superpowers/sdd/**` 与已发布的 spec／注释**仍然一个字不改**，只能追加具名更正。
> ⚠️ **本文不写任何当前哈希**——提交本文这个动作本身就会改 HEAD，而人也会自己推远端。
> 要指代某一笔就**引提交主题行**，要指代材料就**引路径**。固定的历史锚点（旧 pin、旧观测提交）可以写，但要标明是历史。

> 📄 **方向性的问题**（我们到底要造什么、某条诉求能不能做、先后怎么排）去读 `docs/handoff/goal.md`。**每轮交接不需要读它。**
> 📄 本文于 2026-10-13（会话 `808feb6a`）由约 1540 行压缩；2026-10-18（会话 `a3b2a7a7`）再把 §三／§四／§八 的历轮过程压成结论（约 517 → 见 `wc -l`）。删掉的过程原文在 git 历史里，取回方式见 §十。
> 📄 2026-11-11（会话：2026-11-11 Orca 会话派出的子 agent）再压一次（约 1,137 行／285 KB → 见 `wc -lc`）：§三 的 40 余个历轮小节压成 §3.A「仍成立的结论」，§四 只留一份接手顺序，§八 删去已了结项、合并重复，历轮登记的残余移进 §八「已知缺口」；§五／§六／§七 未动。删掉的原文按 §十 取回（提交主题行 `docs(handoff): condense the Orca handoff -- drop finished rounds' process, keep rulings, traps and open items` 的父提交）。

**目录**：§一 是什么／仓库在哪 · §二 开工先跑 · §三 当前状态与诚实边界 · §四 ⛔ 下一件事 · §五 不要重开 · §六 坑 · §七 代码／协议 · §八 等人的 · §九 本目录其他文件 · §十 旧文取回。
**已登记的 flake 不在本文**：看 `docs/handoff/known-load-flakes.md`。

---

## 一、Orca 是什么、仓库在哪

**系统层**：决定跑哪些任务、怎么排、并行还是串行；持有决策台账工具、调度器、执行驱动、Web 面板（面板是人的主要入口）。

| 仓库（**2026-10-13 起的路径**） | 角色 |
|---|---|
| **Orca** `/Users/biran/code/skills/orca/Orca` | **系统** —— 工头＋工地记录＋看板 |
| **ccloop** `/Users/biran/code/skills/orca/ccloop` | **一个工具** —— 把单个任务跑成循环；agent 适配（claude／codex／omp）都在这里。Orca 经 npm GitHub 依赖钉它 |
| **ccmem** `/Users/biran/code/skills/orca/ccmem` | **记忆层** —— Claude Code 插件，Orca 只走它的 CLI（`ccmem export --json`），**一个字都不 vendor** |
| **syncskill** `/Users/biran/code/skills/orca/syncskill` | skill 管理；Orca 用它把每个 run 的 skill 集冻结成只读快照 |

⚠️ 旧路径 `/Users/biran/code/skills/loop/{Orca,ccloop}`、`/Users/biran/code/skills/ccmem` **已不存在**（人 2026-10-13 搬迁）。
旧台账／spec／归档里的旧路径是历史文本，不改；要找搬走的东西问人或 `sourceget find`。
旧归档目录现在在 `/Users/biran/code/skills/orca/orca_archived_files/`。

⚠️ **最容易搞混的一点**：`.decisions/` 台账**住在被干活的那个目标仓库**里，不住 Orca 也不住 ccmem。
*** **Orca 必须能对任意目标仓库工作，不能假设自己在那个仓库里。** ***
**Orca 调用 ccloop，一个任务一个 ccloop run。ccloop 不知道 Orca 存在。**

---

## 二、先跑这些，以输出为准

```bash
cd /Users/biran/code/skills/orca/Orca
for r in Orca ccloop ccmem syncskill; do
  /usr/bin/git -C /Users/biran/code/skills/orca/$r ls-remote origin refs/heads/main   # 开工核一次、收尾【必须】再核一次
  /usr/bin/git -C /Users/biran/code/skills/orca/$r status --short --branch
  /usr/bin/git -C /Users/biran/code/skills/orca/$r worktree list
done
/usr/bin/git log --oneline -8
ls ~/.orca                                        # Rule 17 的开工核对项
node_modules/.bin/tsx src/cli.ts resume           # 从最近的检查点接手
```

- ⚠️ **判断远端只能 `ls-remote`**，`git status` 的 `ahead N` 是缓存 ref。同一会话内远端被人推动 3–4 次是常态。
- ⚠️ *** **所有 git 核对一律用 `/usr/bin/git`** *** —— rtk 会改写 git 并骗人（§六.6）。
- ⚠️ **验证性跑一律重定向到文件再整份读回**。日常用 `npm test`（按改动选测试，`CLAUDE.md` Rule 18）；`npm run verify` 是发版门、只在人说打 tag 时跑（没有 `ORCA_RELEASE_TAG` 它自己 exit 2）。一次整套也要十几分钟（会话 `3831d12f` 现测：rebase＋web build＋选中 411 个根文件＋132 个 web 文件的 `npm test` 合在一条命令里超过 Bash 的 600 s 上限）⇒ **放后台跑**，不要指望 Bash 的 600000 ms。
- ⚠️ 普通沙箱下全量会大面积红成 `spawnSync ps EPERM`／`listen EPERM`（2026-10-10、10-12 两次实测），那不是业务红；要用本机进程权限、私有 HOME/XDG/`CCMEM_DATA_ROOT`、短 `TMPDIR` 重跑，原失败日志照留。

---

## 三、当前状态

> 2026-11-11 压缩：当时的 `3.最新`（会话 `3153bf70`，现为 `3.上一轮`）原样保留；其下 40 余个历轮小节（会话 `9179cdad` 回溯到 `a3b2a7a7`，2026-10-18 → 11-10）压成 §3.A「仍成立的结论」。那些轮次的分支都已合入 main、三仓 main 已推（2026-11-11 `/usr/bin/git ls-remote` 现核：Orca／ccloop／ccmem 本地 main＝`origin/main`），删去的是过程（门的计数、变异清单、付费明细、push／repin／清理请求），出处指到 spec／plan／台账或提交主题行；原文按 §十 取回。§3.1–§3.3 是 2026-10-18 会话 `a3b2a7a7` 压出的结论（2026-11-11 按现状改掉了过期处：profile 版本、schema、Codex 模型、指向已删小节的引用；§3.2 表补上后来几次真 agent 跑通），§3.4 只留门的规则。

### 3.最新（2026-11-26，测试者台账 Batch 71，Orca 会话 `63396468`）

- **#509（gc 回归，P0）**：`single-call-contract/claim/result`、`estimate-result` 归入 `OUTBOX_RECORD_KINDS`；`OutboxKind`
  联合类型约束 `closeSingleCall`/`singleCallClaimRowOf`/`upsertOutbox`；未分类 kind 改为「只持有自身引用的 artifact」并记
  `skippedByReason: outbox-kind-unclassified`（`--strict` 式整体拒绝取消）。判据 `tests/control/{outboxKinds,artifactReclaim}.test.ts`；
  4 条变异各只打红自己。
- **#513（P0）**：`usagePause.ts ceilingGrantExhausted` 识别「auto-continued 但 task grant 被越界清零」；`ceilingStopExits`/
  `ceilingStopWait` 报 `live-ceiling-stop:grant-exhausted` 并给 `task retry --work`，`retryTask` 在该形态接受 top-up、保留
  `allowancePredecessorRunId`（续下一 attempt），不把 `settled-recoverable` 改成 failed；`recovery list` 选入 ready 形态。
  **记账不变**（不自动补 token；B 的「自动发钱」半条登记为 policy 项）。判据 `tests/control/liveCeilingSettle.test.ts`，4 条变异。
- **#512**：`displayRunState` 把 persisted `settled` 投影成 `settled-succeeded`（`recoverable` 仍是独立字段，`continuable` 不变）；
  web 类型/文案/`INACTIVE_RUN_STATES` 同步；改写了 `driverSettle`、`runContinuable` 两处与本条直接冲突的判据（人本轮授权）。
- **#497（半）**：新 `GET /api/control/group-ids`（只读 groups 表），CLI 组名前缀解析改读它；旧面板 `route-not-found` 回落
  summary。判据 `tests/panel/controlApi.test.ts`、`tests/commands/groupBrief.test.ts`。**`status` 仍读 summary**（需要 per-group
  counts/needsYou），余项。
- **#501（半）**：`deliveryGraph.independent` 现在也当 wave 约束——第 k 波每个 unit 必须经 `dependsOn` 传递到达第 k-1 波任一 unit，
  否则 `delivery-graph-layer:<task>:<unit>`。spec `2026-11-23-split-instruction-v9-design.md` 追加 Correction；"AFTER both" 缺边那条
  不是结构化检查，仍开放（设计项）。
- **门**：每笔 `npm test`（改动部分）绿；#512 首轮命中 3 个旧名判据、#497 首轮命中 23 个 fakePanel 缺路由，均按新契约修正后绿。
  全量 `test:full` 未跑。
- **未做（下一轮）**：#498+#508（review-fix 改既有测试/acceptance flaky，需 brainstorm+spec）、#493 余项（链接 config.toml 与 Orca
  文案）、#446/#453（ccmem 设计/付费 A/B）、#497 的 status 半边、#501 的边覆盖半边。

### 3.最新（2026-11-26，Orca session `00f1b4df`）—— #498/#508 acceptance failure identities 与 test-change disposition：Task 1–5 实施完成

- 实施在隔离 worktree `worktree-acceptance-baselines`：`/Users/biran/code/skills/orca/Orca/.claude/worktrees/acceptance-baselines`。进度唯一记录 `.superpowers/sdd/2026-11-26-acceptance-baselines-and-test-changes/progress.md`；设计与计划是 `docs/superpowers/specs/2026-11-26-acceptance-baselines-and-test-changes-design.md`、`docs/superpowers/plans/2026-11-26-acceptance-baselines-and-test-changes.md`。
- **Task 1–2**：schema 25→26 精确键 TAP failure identity 基线，键含 repo/base/原样 command/setup digest/reporter；base 红身份累积、green 不删。node:test TAP 只保存相对文件/嵌套 test path/诊断哈希；每个 tip 红尝试都参与比较，新增或不可比身份失败。setup 成功后 union checks 全跑；suite 与 union 完全同命令时复用，缺 baseline 时只在 tip 红后用冻结 base 与同一 setup/command 收集。
- **Task 3–4**：任何 base 已有 test 文件修改/删除都使 acceptance 为 `test-change-pending`；新增测试仅 focus/skip/todo 才设门。person-only `group accept-test-changes` 绑定 checked tip 与 sorted path digest。D3 对 delivered commit 重跑同样检查；review-fix 的测试改动不会被 criteria-review auto-ratify 或 command waiver 清掉；CLI/brief 分开显示 acceptance 与 requirement review。
- **Task 5 E2E**：review-fix 在 `targetPaths` 内改已有测试、required checks 绿、criteria flag 经 `orca-auto` ratify 后，acceptance 仍 pending，直到 person disposition；另覆盖新 TAP failure 拒绝与相同已知 flake 的 `passed-relative`。这一跨路径行为在 Task 1–4 现有实现上已成立，因此只补 E2E 判据，无生产代码修补。
- **最终 affected gate**（命令 `TMPDIR=/tmp npm test`，代码观测基线 `2731ddaa`＋隔离 worktree 改动）：RC 0；最终 review 修复后重跑，root 与 web 全绿，85 个慢文件/真实 ccloop E2E 按 Rule 18 延后；root 与 web typecheck 通过，web build RC 0（既有 >500 kB chunk advisory）。`npm run test:full` 未跑。**独立 TypeScript 与整分支 review** 共 0 Critical／7 Important／2 Minor；全部处置：批准 payload 绑定人所见 tip/digest、扫描失败阻塞（含 single landing）、D3 waiver 只覆盖唯一未解决失败、真实 Node TAP（block scalar／location／suite summary）、`{skip:true}` 选项、缓存基线保留 base tests/exit 供 #387、schema26 夹具、失败详情取实际失败比较。新判据先红后绿。
- migration 25→26 仅由隔离临时库判据覆盖；**未迁移生产 `~/.orca` 数据库、未重启 panel**。本仓契约无变化，ccloop 未 repin，无付费 provider 真跑。
- **下一步**：commit 已完成（工作树主题行见下）并已 `--ff-only` 合入 Orca main；**push 被自动发布面审查拦下**（它未识别 `origin` 指向公开 `blrbiran/Orca` 的授权），留待人执行 `git push origin main`。workspace 保留在 worktree 中供复核。

### 3.最新（2026-11-26，测试者台账 Batch 70）

- **Orca**：#466 基线仅逐字复跑已确认的 required check，未匹配具名说明未核实。#494 未曾绿过的缺文件检查显示 `not-run`，验收接管后 CLI 标记历史 watch tip。#495 人设期望只显示一次，估算下限显示原建议值，倍数按实际期望算。#502 检查冲突与 plan 级不达标同时保留，给出 `requirement open`。#419/#485 无自定上限的 criteria-review 默认 500k，可配置并显示派发时上限。父组已通过时显示 advisory 和出口。父组终止后，派生 judge 无法裁定的 flag 由 `orca-auto` ratify 并附原因，已归档的 judge 也会在收敛时处理。
- **发布**：Batch 70 已快进合入本地 `main`。本轮首次 Orca push 被自动权限审查拒绝，理由是未识别到以 `allow-push` 开头的直接消息。接手用 `/usr/bin/git ls-remote` 现核。
- **门**：repin 前实现分支 `5bfbe51c` 的 `npm test -- --base main` 1770/1770，107 个文件延后；repin 后默认解析测试与下面两项通过。`vitest run tests/commands/groupShowLandingWatch.test.ts tests/panel/landingWatchSuperseded.test.ts` 9/9，`npm run build` RC 0（观测代码 `5149af72` ＋ pin `86444493`）。新构建的配对改动门 `TMPDIR=/tmp ORCA_CCLOOP_BIN=<ccloop checkout>/dist/cli.js npm test -- --base 1ee96d8d --maxWorkers=4` RC 0：336 个后端文件，2186 过／15 跳过，0 个 Web 文件入选，89 个文件延后（Orca 代码观测点 `86444493`，ccloop 从 `1546e3e` 重建，与 pin `4ccbfc2` 的源码、测试和包清单一致）。日志 `/tmp/orca-b70-rebuilt-gate.NL0Tq8`；较早使用旧构建的门已停止。正式安装的 pin 上另以 `env -u ORCA_CCLOOP_BIN vitest run tests/control/{artifactReclaim,ccloopDefaultE2E,criteriaReviewLifecycle,preexistingFailure}.test.ts tests/panel/criteriaReviewLifecycle.test.ts --maxWorkers=1` 复验，68 过／3 跳过（观测代码 `86444493`，日志 `/tmp/orca-b70-final-focus.5WcpsR`）。完整套件未跑。
- **#493**：Orca repin 到 ccloop 的 `fix(codex): a phase refuses a private CODEX_HOME that carries hooks.json (tester #493)`（pin `4ccbfc2`）。锁文件只改 ccloop，repin 脚本通过默认解析 E2E 12/12、typecheck、`npm ci`。运行前检查两个私有路径是否含 `hooks.json`。本机免费探针与测试者的真实 exec 现场读数不同，不能用 feature 列表断言所有 hook 来源都已关闭。当前面板部署另核，本轮未重启。
- **syncskill**：#506 修复 SSH 远端 shell 脚本的引用，POSIX 测试通过。#482 非回退 rsync 错误与超时给 `E_REMOTE_TRANSPORT` / exit 5，清理失败报 staging 路径。超时后已启动的远端操作可能继续。已有共享 `agents` 链接保留，新技能只在共享目录已存在时默认链接，`install --shared-agents` 显式启用。`npm run build`、`npm test -- --maxWorkers=1` 在 `c80a3e8` 通过，987 项。
- **ccmem**：#507 合并 backfill 入队护栏、无凭据停止续队、日报排除 embedding/维护任务，孤儿回收年龄单列。已有日报未重算，清理默认预览且须显式给两档期限，详见姊妹仓。#452 仅将 rollout 首行有证据的关闭请求单列，真实格式未验证。#445 超时单列，保留三次非额度失败的诊断口径。`npm test` 在 `77dfe8f` 1147/1147。生产 schema 021 迁移及 daemon 部署仍待操作，现有生产库未迁移。

### 3.上一轮（2026-11-25 晚，会话 `dee8a34f`）—— 测试者台账 Batch 69

- 人确认上一轮 #478 同 attempt、#479 拒绝算术矛盾、syncskill #474 status 只读、#477 dry-run `pushed` 列计划。上一轮清理命令人已执行。三个待审建议：#445 保留三次非额度失败的诊断阈值，抽取健康单独计量；基线 #466 只复跑逐字匹配的已确认 required check；syncskill 共享 `agents` 默认目标另审，别混入 #488 的隔离边界。
- **Orca**：#483 给真实 group view 的 run 发 `checkpointId`（旧 wire reader 兼容缺键）；#505 artifact GC 只看 QUEUE 的 `delivered`，RECORD 照归属判定、未分类 kind 拒绝清理；#499 `set-limit` 短缺按维度给差额、card 补其余预算维度；#500 brief 单列 failure 和完整的 next。#505 未在测试者的大库 `--apply`，既往 `handoff-request` 门仍按原判据。
- **ccloop / #478**：第一次现场组 `ceiling-acceptance-1` 在 plan 的 catalog 探针失败，group view 记 0 token。`codex debug models` 现测 1,450,999 B，超过原 1 MiB。ccloop 已推 16 MiB 有界修复，Orca 已通过 repin 脚本（含默认解析 E2E、typecheck、`npm ci`）；按主题 `chore(deps): repin ccloop to d226bd1 for the catalog-probe bound` 找。**付费隔离验收通过**（代码观测点 `b4755521`，ccloop pin 同上述）：`ceiling-acceptance-isolated` 用 `gpt-6-sol`，组上限 60,000，扣除 review/handoff 后 live ceiling 58,000。`orca run show` 显示 plan 43,319，execute 观测 18,572，合计 61,891 时在 execute 被停。`orca group set-limit ceiling-acceptance-isolated --limit '{"tokens":1200000}' --as-person --if-revision 7` 后续跑只报 execute 139,190 tokens，组 `done` 1/1，落地分支独立 `npm test` 7/7。两段均为 attempt 1，后继 `resumesAttemptOf` 指向前任，任务谱系扣除重复；`group brief --json` 的组账仍按两笔 run 记 `usedAttempts:2`。总记账 201,081 tokens，工具未报金额。隔离面板已停。证据根 `/private/tmp/orca478.wsPL3z`，含临时面板私有数据，仅本机查阅。
- **syncskill**：#484 `--plan` 走只读路径，未支持则具名拒绝；#486 认旧 local source 并在读不全时保留未知来源的 link；#480 没 include 且 link 矩阵为空时，push preview 和真实 receiver 都保留远端技能，显式矩阵的回退仍在；#489 config 和本地 server manifest 原子发布且留备份，坏 JSON 报损坏；#490 保留未知键；#481 push/pull/sync JSON stdout；#488 自定义 sync-dir 的默认 agent 根落在其内部 `.agent-home`，扫描迁移需显式 flag。`ssh_defaults`／`directions` 执行语义、manifest history／跨进程锁另留。
- **ccmem**：#496 无路径不入队、旧坏 payload 记跳过，状态读数带 24 h 计数；#492 用合成语料示例和 `expected_substring`，不匹配报 `E_CORPUS_STALE`，用户可传本库语料。生产 daemon 未重启。详见姊妹仓 handoff。
- **收尾补丁**：#487 doctor 展开 agent 与 source 的 `~`，使用当前选中的 home，#491 为只读 doctor、source list、remote list、link list 提供结构化 JSON，source URL 会脱掉凭据与查询参数。syncskill 合入后 `npm run build` 和 `npm test -- --maxWorkers=1` 通过，974 项全绿（观测点 `d5af5bc`）。#503 完成组的交付事实与可选项目默认值分别显示，#504 完成后的旧失败说明复审才会使用答案，保留原有提交回答的出口。
- **Orca 门**：`TMPDIR=/tmp ORCA_CCLOOP_BIN=<新 pin 的 ccloop build> npm test -- --base main -- --maxWorkers=4` 的观测点 `b4755521`，后端 2,742 过／4 红／15 跳过，Web 21/21，延后 102 文件。三个红文件 `allowanceHeldSettlement`、`handoffE2EResume`、`taskResultPaired` 在 `git clone --local` 隔离复测、同新 pin、`vitest run` 串行 7/7。收尾补丁的同环境 `npm test -- --base 50855233` 在 `5a8e5719` 上后端 746/746、Web 253/253、延后 19 文件。全量门未跑。
- 本轮计划 `docs/superpowers/plans/2026-11-25-tester-ledger-batch-69.md`，过程 `.superpowers/sdd/2026-11-25-tester-ledger-batch-69/progress.md`，测试者台账由人转发更新。#498、#501 仍需单独设计。

### 3.上一轮（2026-11-25，会话 `5d3d0c09`）—— 测试者台账新一批：#478 撞 ceiling 保留工作（ccloop＋Orca，已 repin）、#469 证据缺失降级、#468 artifact 回收、#470 `project remove`、#476 #479 #432 #466；syncskill #456 #477 #474；ccmem #475 #464 #452 #453 开关、FTS OR 开关；四仓已推

- **人的话**：开头裁了五件（删除 artifact 由面板执行＋CLI；#470 有未归档组就拒、`--archive-groups` 先归档；FTS 先开关后默认 AND；帮我重启 ccmem daemon；残留给命令）；台账分析后人定：#479「你看下怎么做整体最优，允许重开以前的裁定」、#466「同意（只注销自己的）」、#453「如果你觉得合适，那我同意」、#475「同意（Stop 约 30 s、cron run 立刻）」、#474「整体最优」、#478「做 brainstorm＋spec」→「你不要想着偷懒…必要的话允许改 ccloop」→「同意这个方案，写 spec、独立 review、修复后写 plan 并实现」；随后 `allow-push`、「尽量完整做完」「忽略 context」「批准改写所有必要的判据」「允许必要的付费真跑」「卡住先按建议做，最后报审」。
- **Orca（主题行，均已合入 main 并推）**：
  - **#478**（spec `docs/superpowers/specs/2026-11-25-ceiling-stop-keeps-work-design.md`，独立审阅后修订；plan `docs/superpowers/plans/2026-11-25-ceiling-stop-keeps-work.md`）：`chore(deps): repin ccloop to 305dad1 for the ceiling continuation (#478)`；`feat(control): a ceiling stop with its continuation settles continuable; a refused accept-attempt keeps it; every surface names the exits (#478)`；短期提示 `fix(control): task retry and recovery retry name a live-ceiling stop and its way on (tester #478)`。**原来**：撞 ceiling 的 run 工作其实在 `refs/orca/runs/<runId>`＋快照里，但 ccloop 把被打断阶段的产出文件列进 `missing` ⇒ checkpoint 永不可续，继续＝从 plan 重来。**现在**：ccloop 给可续跑的 ceiling 停止附上 allowance continuation（见 ccloop handoff）；Orca 在 `settleCeilingStop` 里用放宽的 `validateAllowanceCheckpoint` 验它，checkpoint 可续，`classifyCeilingStop` 照旧（≥1M headroom 自动续、否则 `groupCapStop` 等 `set-limit`、pause-line 等 `decide-usage`），续跑从被打断的阶段、在保存的树上接着做；续跑**不多扣 attempt**（`resumesAttemptOf`，控制器裁定，待人审）；被拒的 `accept-attempt` 恢复 `settled-recoverable` 与等待；落地清 `groupCapStop`/`usagePause`/`allowancePredecessorRunId`；`group show`／`brief`／`recovery list`／Web 写出两个出口（set-limit 或 decide-usage，以及 accept-attempt）。
  - **#469**：`fix(control): a missing artifact file degrades the views instead of failing them` 等 5 笔：两个 reader 抛具名 `artifact-data-missing`（409）；查看类（group show/brief、run show、证据路由、Web）降级显示 `closure:"evidence-missing"`＋`evidenceMissing:[ids]`；决策路径保持严格、细节里带缺失 id；同内容重写会补回丢失的 `data`；`orca doctor` 加 artifact 完整性一行；README Troubleshooting。出口实测：已关闭的 run 证据缺失 ⇒ pause-dispatch 后 archive-group 可走；未关闭失败 run ⇒ retry-task 可走。
  - **#468**：`feat(gc): orca gc --include-artifacts -- a fail-closed reference scan; the panel deletes (tester #468)` 等 3 笔：默认关；dry run 在 CLI 只读、按跳过原因汇总字节；`--apply` 经 control socket 由**面板**在准入门内同步重算并删（本进程启动后发布过的 id 一律保留）；引用扫描按 token 穿透 artifact 内容、读不出即整份计划为空；`ARTIFACT_HOLDER_TABLES` 逐表登记，未知表永远持有；先删目录后删行（崩溃留下的「行在数据缺」由 #469 处理）。硬链接去重不做（读路径要求 `nlink===1`）。
  - **#470**：`feat(panel): remove a project from the registry, refused while its groups are not archived (tester #470)` 等 6 笔：`orca project remove <name> [--archive-groups]`（owner 门同 `project add`；未挂载／目录不存在的条目也能解析）；`project show` 对未挂载条目 exit 0 并说明；Web Remove 按钮（有组时二次确认）；`status`／`list`／Web 的缺目录提示改指新命令。spec 追加「Human rulings and revisions」。
  - **#476** `fix(control): the done pass closes a ready system verdict group settled before #467`；**#432** `fix(commands): a stop's next line offers the group's ready tasks only when one is claimable`；**#466（收窄版）** `fix(gc): unregister ccloop attempt worktrees under a removed runs directory and sweep orphans`（逐条 `git worktree remove` 不带 force，只碰 `panel.runs` 下的登记，**从不 `prune`**）；**#479** `fix(control): name a group limit below its allocations and refuse confirming it without --accept-shortfall`（控制器的整体判断：平分不改，#478 让撞 ceiling 只是暂停；**只在「已声明分配之和 > 限额」这种算术矛盾时拒绝确认**，`--accept-shortfall` 放行，Web 有勾选框；Orca 自己的确认豁免；估算类只警告；brief 加 `budget-headroom-zero:<n>`，预览加 `budget-slice-zero`；#212 的 spec 追加 Correction）。
  - **main 上原本就红的判据**：`test(control): #289 path B counts repeats, not lines, since blockRun writes its own (#439)` —— #439 让 `blockRun` 自己写日志后，「恰好一行」变成两条不同的行；改为「collect 失败恰好一次、没有任何行重复」，两个变异（去掉每消息保护、去掉理由变化保护）各见红。
- **ccloop**（见 ccloop handoff）：#478 生产者两笔，已推，Orca 已 repin 到 `305dad1`（之后 ccloop main 又多一笔 handoff）。
- **syncskill（已合入）**：#456 `fix(transport): classify an ssh failure by its exit code, not its text`（真 `execFile` 错误的退出码在 `err.code`；共用分类器用在三处）；#477 `fix(push): a dry run's human plan and --json render one result; warnings carry a code`（dry-run 的 `pushed` 现在列计划推送——JSON 破坏性变化，写在提交说明）；#474 `fix(status,dry-run): read-only commands refresh in memory and write nothing`（`status` 也只读，控制器裁定）。**事故**：子 agent 把 worktree 里的 `node_modules` 软链提交进了 #456 那笔（`.gitignore` 只有 `node_modules/`，不匹配软链），快进合并时把主检出的真 `node_modules` 换成了自指软链；已补 `chore: untrack the node_modules symlink a worktree commit carried in`（`.gitignore` 加裸 `node_modules`）并 `npm install` 重建；`npm ci` 因 lock 不同步（`@esbuild/win32-x64`）失败——预先存在，lock 未改。
- **ccmem（已合入，见 ccmem handoff）**：#475 可打断的空闲休眠（实测等待 p50 199→58 s）、#464 点号键、#452 off/shadow、#453 有界内联开关（默认关，A/B 未跑）、FTS OR 开关（默认 AND；真库副本校准后**不建议翻默认**）。daemon 重启两次（备份 `global.db.bak.1795563914074`、`.1795566600165`；第一次 plist 的 `PATH` 被 agent shell 改写，详见 ccmem handoff）。
- **门（现测，面板已停，`TMPDIR=/tmp`，`ORCA_CCLOOP_BIN=/Users/biran/code/skills/orca/.wt-ccloop-305dad1/dist/cli.js`，`npm test -- --base fddffd41` 覆盖本会话全部 Orca 改动＋repin）**：选中 652 文件（root 528／web 124），root **3532 过、2 红、17 跳过**，web **1082/1082**；121 文件推迟到 `test:full`。2 红都是 `tests/panel/security.test.ts`「真进程 5 s 内自行退出」（结束时 load 98–114），**单跑三次 11/11** ⇒ 负载（known-load-flakes 已有）。各批分支的门见各子 agent 报告（都绿，或红在 main 上同样红）。
- **面板**：主检出 `npm run build`＋web build RC 0 → `launchctl bootstrap gui/501 …plist` → `orca panel restart` → `orca status` 全 ok（ccloop `305dad1` installed/built）。
- **repin 的坑（新）**：`pin-ccloop.mjs` 的 `npm install github:…` 两次挂死（一次 5 h）。原因：npm 对 `github:` 先走 `ssh://git@github.com`，本机代理（198.18.x TUN）下 `ssh -T` 能认证但 git-over-ssh 传数据挂住，不失败也就不回落 https；registry 的长连接也会卡。**解法**（只对该命令生效的环境变量）：`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_0=ssh://git@github.com/ npm_config_fetch_timeout=45000 npm_config_fetch_retries=5 npm_config_maxsockets=4`，外面套 `perl -e 'alarm 1500; exec @ARGV'`。最后一项检查「npm ci 复现 lock」仍挂，在 scratchpad 克隆里手动 `npm ci --prefer-offline` 补跑：RC 0、build-info 是 `305dad1`、lock 逐字节不变（写在 repin 提交说明里）。
- **诚实边界**：**#478 付费验收未跑**（真 codex、让 plan 跑完而 execute 撞 ceiling、set-limit 后续跑无 plan 阶段）——手写计划文件＋卡限额的搭建量大，本会话上下文已超 Rule 6 的 450k，移到下一轮 §4.0 第 1 条；#478 的两处登记：续跑在 A2 被拦（多目录、snapshot v2 不支持）时 lineage 少计一次 attempt，显式 `task continue` 不做扣减；#468 在大 store 上面板同步删除那一步会阻塞多久未测（本机 store 只有 98 MB）；#469 handoff 停止的 run（`drive.outcome===null`、证据在 checkpoint）未降级；#453 默认值待付费 A/B；FTS 默认不翻。

### 3.0 2026-11-20 → 11-25 凌晨各轮仍成立的结论（2026-11-25 会话 `5d3d0c09` 压缩：这些轮次的分支都已合入、四仓已推；删去的是过程——门的计数、变异清单、push 请求——原文按 §十 取回本节压缩提交的父提交）

- **测试分档（人裁，CLAUDE.md Rule 18）**：`npm test`＝改动部分（`scripts/test-affected.mjs`；改动的测试＋镜像目录＋**直接** import 者＋目录表），补丁与合入 main 都用它；≥30 s 文件与真 ccloop E2E 推迟到 `npm run test:full`；`--wide` 已删；vitest `fsModuleCache` 开着。分析 `docs/superpowers/specs/2026-11-24-test-time-analysis.md`。
- **ccloop pin 与门**：`ORCA_CCLOOP_BIN` 必须指向**带 tests 的 ccloop 检出或克隆的 `dist/cli.js`**，不是 `node_modules/ccloop`（没有 `tests/fixtures/fake-codex.mjs` ⇒ 真 ccloop E2E 以 `MODULE_NOT_FOUND` 假红）。#465 MCP 名单读失败重读一次；#439 每个 ccloop control 子进程给 `CCLOOP_WORKER_RECEIPT_TIMEOUT_MS=10000`（面板环境已有非空值则沿用），`blockRun` 自己写一行日志（会话 `5d3d0c09` 据此改写了 #289 path B 判据，见 §3.最新）。
- **launchd 域**：agent 的 shell／ssh 里 `launchctl managername` 答 `Background`；label 已在 `gui/<uid>` 加载就用它（`fix(service): a shell outside the login session acts on the panel loaded in gui/<uid>`）。跑门前停面板仍用 `launchctl bootout gui/501/dev.orca.panel`。
- **#466（基线）**：agent 自报的命令若逐字等于 task 已确认的 required check ⇒ 在组的 base 上跑一次；green ⇒ 标 `notConfirmedAtBase`、不进等人列表。只核实逐字相同的命令（可逆决定，待人审，§八）。测试者收窄后的 #466（prunable worktree）是另一件，会话 `5d3d0c09` 已修。
- **#432**：只有 person 可 retry 一个停在 pause line 的 task（按 `continue` 的规则把暂停线推过已用量，保留被停 run 的工作；agent 被拒 `usage-stopped-needs-person`）；卡片与 brief 写出停因与出口。组状态命名归 #370 设计。
- **#467**：settle 时把仍 `ready` 的 ladder/judge 组推到 `review`（旧组的回填见 §3.最新 #476）。
- **#470（前半）**：目录不存在的项目报 `missingPaths`，`status` 为 warn 不再 exit 1（后半 `project remove` 见 §3.最新）。
- **#437**：写侧与读侧对追加的 `ready` fix task 的 grant 统一用 `allocationCommitment`（以读侧为准，#212 背书）。
- **#434**：`working-tree` 只有真写了（`lastIntegrated`、无 pending、非 blocked）才算交付；`recovery list` 有 `integrationBlocked` 行、brief 有 `delivery-blocked:<scheme>:<code>`；后来的 landing 要等新 tip 写完才算交付（`localDeliveryCaughtUp`）。「retry-integration 覆盖未提交改动」三次调查未复现，测试者已撤回。
- **#441 #442 #450 #443**：collect mapper 补 `memory`（run-outcome 回写不再空转）；overview 预取含 `appendedTasks` 的合约哈希；`orca panel --help` 打用法、未知 flag 拒绝；README「Disk use, and what `orca gc` does not reclaim」。
- **#438 #440 #439 B'**：卡片与 brief 的 budget 带 `reservedTokens`／`headroomTokens`（同一个 `groupHeadroom()`）；`requirement show` 每个带 reasons 的 draft 单独一行；`launch-never-claimed` 写一行 stderr。
- **#385**：拆分指令 v9（可选 `deliveryGraph`，与草稿自称的图不符 ⇒ 交回理由，不拒绝）；requirement 点名全量验证而无 task 跑它 ⇒ `requirementDelivery` 提示；单元提示（`T<n>`）只提示。v9 的付费评测仍未跑（§八）。
- **#393 #399**：summary 与 overview 每请求每组只读一次（`GroupSourceCache`；overview 拒绝时 summary 回退自己的 reader）；overview 支持 `sinceChangeSeq`；隐藏标签页停轮询；recovery 移动 dispatch latch 时推进投影游标。
- **C-1（人「同意」）**：socket agent 给需求／估算单次调用 `charge-remaining-grant` 超过 250,000 tokens ⇒ `large-charge-needs-person:<n>`；flow 调用保留旧规则；`observedFloor` 也读单次调用的下界。
- **#418 #417**：`work.memory` bundle（只在 ccloop 宣告 `features.memory:"v1"` 时发，8 KiB／1200 token 上限，dir 项目拒绝）与 run-outcome 回写 outbox（`ccmem orca-outcome upsert`，默认开，`--no-ccmem-outcomes` 关）；纠正导出在 `ORCA_CCMEM_BIN` 绝对＋control 开时默认开；`orca status` 的 ccmem 行常驻 warn（Orca 派出的 agent 不加载 ccmem hook；claude phase 仍会加载目标仓自己的 project/local hooks）。
- **#419 #369 #375 #328 #366 #386**：父组终态后派生 criteria-review 组自动收敛（归档不删除），`orca group archive --derived-of`；模型目录带 `lastFailure`（历史失败标注，不主动探测）；转录与 `orca doctor` 带 agent warnings（omp 19.0.1 无 `--no-mcp`）；#328 worktree 模式下自建 `.git-*` 目录的提交在 step D 被拒（`workspace-git-readonly`），confirm 提示 clone／working-tree（根因不修，人裁）；`orca gc`（默认 dry-run、`--include-uncleaned`、`skippedByReason`）与 `status --disk`；#386 判「不修」。
- **#400 #389 #370 #383 #387 #391 #392 #382 #384 #388 #390 #394**：`core.symlinks` 跟随；operator `set-limit` 可装在 active unbounded run 旁；archive/close 清 wake、unarchive 重新 arm continuation；reported＋两绿记 flaky；验收记录带 `evidence` 与 `# tests` 计数（tip 不足 base 一半判 failed）；审阅事实带失败名；`.decisions/**` 与需求文档不进 review diff；`apply-parallel --pair/--all`；自动确认按组创建者解析偏好；卡片默认无勾选框；静态资源 gzip。
- **syncskill（11-20 → 11-25 各轮）**：远端路径一律由 `remote_repo` 派生并 shell-quote（含 `$`），`node_bin`、`BatchMode`／`ConnectTimeout`；push set＝`skills.include` 三态（unset 回落 link 矩阵、empty 不授权删除）；push 走 staging＋receiver 原子 promote，失败清 staging，`prune`（staging）与 `prune --recover-backups`；远端 manifest 原子写＋`.bak`；`remote add` 合并；列表读失败报 `E_REMOTE_TRANSPORT`（#456，会话 `5d3d0c09` 补了真 `execFile` 形状）；`skill remove`、`push --on-conflict`；`install` 打印真实落点、doctor 认 `agents` 目标（#462）；build 先删 `dist/receiver` 再拷。
- **A3 付费面板小任务**：2026-11-20 失败（claude 被安全软件 SIGKILL、codex 模型名缺前缀），scratch 组已归档；未重跑。

### 3.上一轮（2026-11-19，会话 `3ba26002`，Opus 5.5 控制器）—— 测试者台账大批合入（#377 #381 #337 #379 #365/#328 #362 #364b #368b #374c #170、dogfood 三项、多目录拆分冲突）＋ 去掉复制 P1（ccloop）／P2（Orca）＋ allow-push 粘贴修复；面板已重装（该轮三仓未推，`57896c64` 已推）

- **人的话（原话要点）**：面板重装「你帮我做」；#337 读法「同意」；543e800e 的控制器裁定「同意」（含 `close-delivery-pending`）；#365/#328「同意你的建议」（写回工作树、首次使用时让人选，排在 P1 之后）；#377「同意」（只因 base 本来就红 ⇒ 相对通过、挂说明、组 done）；#379「同意」（用同一份澄清结果重新拆成新组、旧组自动归档）；#370「同意」（维持原裁定）；#381「每组跑的时候至少不应该绑 profile 中版本号的 hash」「是不是可以不绑，从根源上解决问题。各个参数允许自动升级」，`secretValueHashes` 不绑「同意」，老组一次性兼容「同意」、可用别名「同意」、「同意动控制库的表结构」（最终没动表结构）；顺序「同意」；allow-push「经常会无效…看下如何修复、优化」；离开前：`allow-push`、「这次批准改写所有必要的判据」「这一轮允许必要的付费真跑」、repin 与收尾时可推三仓、「有问题先按你的建议执行…最后报给我审核」。
- **全部裁定与过程**在台账 `.superpowers/sdd/2026-11-19-tester-issues/progress.md`（逐条 `Ruling:`、每次合入的门与红文件处理）。**控制器替人拍板、待人审的**见 §八 第 8 条。
- **已上本地 main（每件：实施→独立审阅→修复→`test:wide`→`--ff-only`；未推）**：
  - **allow-push 粘贴修复**（`fix(gate): a message pasted whole that starts with allow-push grants; …`）：本会话人的整条消息是粘贴的，钩子看到的是 `<pasted_content id=…>` 开头，闸门没发许可（转录实证；钩子 0.5 s，不是超时）。现在开头的粘贴块剥一层再判；提到 allow-push 却没生效时钩子当场说一句。未验：工作中途插入的消息是否触发 UserPromptSubmit。
  - **#377**：代码判定「只因 base 本来就红」的条目为相对通过（round 上 `relativePass`，七个代码条件，整命令匹配、数字退出码），组 done＋说明；自动修复额度夹到组剩余。顺带修了一个既有漏洞 `fix(acceptance): compare with the base only when the full suite itself was red at the tip`（任务检查红而套件没在 tip 上跑时曾记 `passed-relative`）。
  - **Track C**：`GET /api/control/runs/:runId` 轻量读（#374c，MCP 并发下按调用存）；`task retry --model`（#368b）；面板启动在服务锁后清 `<stateDir>/staging`（#364b，Rule 17 登记）；#170 已结束 run 的 handoff-request 行读作 finished。
  - **需求流程**：dogfood ① 额度耗尽的需求调用不重试、显示重置时间与下一步（含用量未知被挡后人补录的路径）；② 只做存在性检查的 `test -f` 不算越界；③ 拆分指令 v8 把人的反馈与冲突带过自动重拟（遇需求修订即止）；#362 v8 规则＋`runtimeDataPaths` 提示（只提示）。
  - **#381**：组绑定哈希只覆盖执行相关字段（`profileId`、`allowedWorkKinds`、`capabilities`、上下文 tokenizer、证明哈希、`workMaxOutputTokens`）；整块 `estimatorPreflight` 与 `secretValueHashes` 不绑；估算一律用 Orca 最新指令（现为 4）；preflight 字段可选（默认 64000／**12000**／utf8 2/3），整块缺省＝默认、`null`＝不估算；换密钥启动时提示一次；老组兼容＝面板启动时 `VACUUM INTO` 备份后在 `meta` 记 `profileHashAlias:<旧>`→新（**没动表结构，仍 schema 25**）。
  - **#337**：folder 与多目录组也审（folder 在 vault 里按 diff 审；多目录每目录一节、证据 `<key>:<path>`、修复任务按目录写）；修复轮后仍不过 ⇒ `noted`（满足 done、概览一行 `review-note`、只许 `review-accept`）。
  - **#379**：`orca requirement resplit <g> --text "<哪里拆错了>" [--group <新>]`，只对已接受未确认的组；复制澄清结果、旧草稿记为带反馈的 rejected，同一事务里归档旧组并互链；有组依赖时拒（`requirement-resplit-group-edges`，给出挪依赖的命令）。无 Web 按钮。
  - **#365/#328**：新交付 `working-tree`：组完成后把改动写进注册仓库的工作树、不提交；逐路径 `(type, mode, oid)` 守卫，人的改动一律拦下点名、不覆盖；写前重读归档／暂停、不跟随符号链接、崩溃可续；首次使用在 Web Results／`group brief` 问人（显示具体路径）；项目默认只能由人设（person token）；与人存的默认逐字节相同的组自动确认照常放行（**改了已发布的 H4 裁定，待人审**）。审阅确认：`local` 交付本来就与 workspace 模式无关（集成步骤在面板进程里移 ref）⇒ #328 真正的墙是需求要求 agent 在 run 里写 ref。顺带修了既有 bug：设项目交付会丢 `criteriaReview`／`flows`。
  - **去掉复制 P2**：ccloop 宣告 `attemptRef` 时才走新路（**在当前钉的 `57b6d15` 上逐字节不变**）：step C 取 ccloop 记录的尝试 sha、在目标仓库建只增不改的 `refs/orca/runs/<runId>`、检查用 `check-<runId>` worktree、落地 `update-ref`、step E 写 snapshot v2（范围 bundle＋日志）、多目录逐目录钉。**A2 基准**（测试者同类仓库 `jianghu-unwritten`，26,200 文件／3,651 MiB，原仓库前后不变）：step E 3,979 ms＋校验 234 ms（目标 ≤10 s；原来约 64 分钟），归档 162,878 B，目标对象增长 2,560 B。
  - **多目录拆分冲突**：多目录拆分指令 v6（冲突、反馈延续、运行时数据规则；v5 字节钉住）。
- **ccloop**：去掉复制 P1 在 ccloop **本地 main**（`633534c`，已 build），两轮审阅；不带键逐字节同旧；全量 2921/2921、known-reds RC 0。**未推 ⇒ Orca 未 repin**（npm 的 GitHub 钉要已推的提交）。
- **面板**：本会话重装三次，最后一次在 P2 合入后（pid 以 `orca status` 现测）；schema 25；#381 首启在真库写了别名（备份 `control.sqlite.bak.1795063010214`）；两个 done 组照常读。**发现**：一直没开跑的组 `requirement-37df7f6e-…`（10-17 的网页易用性评估）绑的是更早的 profile 哈希 `479b2177…`（那之后文件改过），别名覆盖不到，开跑会 `profile-changed`——改动之前也一样；救它要当时的 profile 原文件，否则另建组。
- **门**：每批 `test:wide`（P2 与多目录拆分对着在 `57b6d15` 构建的 ccloop：`/Users/biran/code/skills/orca/.wt-p2-ccloop-pin/dist/cli.js`；其余对着 ccloop 主检出）；红文件逐个查清：`offPlanWritesE2E` 验收 4 是**测试与产品的竞态**（在未改动 main 上也复现，已修测试）；其余是负载下的抖动（重跑绿）或真缺口（已补）。**付费真跑本会话没跑。**
- **诚实边界**：P2 的带键路径只在夹具与真 ccloop P1 上测过，没在真面板上跑过（要等推送＋repin）；A1／A3 未跑；#365 未在真面板上点过 Web 首问；#379、#365 首问没有 Web 之外的真人验收；子 agent 多次报告上下文超过 330k（钩子报 443k／470k／496k，无法核实），已按 Rule 6 记台账；**控制器会话本身也超过了单会话 450k**（钩子报约 635k；人说本会话先不考虑上下文大小）。

### 3.上一轮（2026-11-18 晚 → 11-19，会话 `543e800e`；会话 `3ba26002` 压成结论）

- 上 main 并已推：批 D（V/C/D 三线：需求审阅没过可见、读侧 running、`archived (was X)`、错误码一次＋next、`--help`、零问题 `answer --finish`、无 report 的失败 run 只清一次、C1 下一个 run 被告知最后失败的命令、审阅答案形状坏重问一次）、#356 lilac 取代 light、#378 组依赖图、#355 closed 终局（交付未完成拒绝关闭）＋#357 计数与列表多选批量、#379 拒绝＋下一步、#380 `drop-path`、#381 历史事实、去掉复制 P0（工作区不检出）、ccloop `57b6d15`（omp 启动隔离）repin。会话 `3ba26002` 开头人对其裁定整体「同意」。付费 dogfood 的三个发现已在 `3ba26002` 修掉。教训：付费真跑与门不能同时跑；面板重启也会让在跑的门撞 Rule 17 守卫。

### 3.上一轮（2026-11-18 全天，会话 `4389b15f` 上午 ＋ `ca534c51` 下午；会话 `543e800e` 压成结论，过程按 §十 取回）

- **上了 main 并已推**：测试者台账 12 件（#350 review 卡住、转录行首时间、#337 提示词半边、#319 Results 结论卡、test-affected 快速档收窄、#347 Orca 侧、#327 Dependencies 卡、#321C 成本对比中位数、#345 goal 点名的新文件补进写集、#348 读不出的 run 只隔离到任务、#332 step E 后 kick pump、stuck-runs 审阅修复、#349 Orca 侧）；#346 计划外写入（loop plan v4：无 allowlist、targetPaths 是计划；并行兄弟写集冻结进 denylist；`parallel-claim` 诊断；`retry-task --after`；orca-auto 自动重试）；#341 已有失败四层（clarify v4、control schema 24→25 新表 `base_check_results`、`group brief.knownRedAtBase`、v4 合同约束行＋组 Problems 三个答案）；#351 新路径可落在新子目录；#352 review 修复写集取 `missing` 点名路径；split 指令 v7 `requirementConflicts`（**只单仓**，多目录仍 v5）；#309 摘要按 4096 字节截；#328 残余（待批 tier-0 决定让组 needsYou）。ccloop #347（execute 答案失败细分）、#349（codex 会话删除失败不再判失败）已推、已 repin。
- **面板**：会话 `ca534c51` 重装到当时的 main，**control schema 25**；schema 24→25 单向，回退用 `~/.orca/control/panel/control.sqlite.bak.1794982894`。
- **只到设计稿**：`docs/superpowers/specs/2026-11-18-repair-attempt-design.md`（#321 B；会话 `543e800e` 审阅认定照原稿测试者场景触发不了，先做了 Orca 侧 C1；ccloop 半边待做，两条 ccloop 判据人已逐条点名允许）；`2026-11-18-salvage-accept-design.md`（#352 挽救：人裁不做，改做窄修，已上 main）。
- **环境教训（仍成立）**：① 并发子 agent 跑 vitest 一律 `--maxWorkers=2`；② `/private/tmp` 下会话 scratchpad 约每 30 分钟被外部清掉，持久的克隆／日志放 `/Users/biran/code/skills/orca/.wt-*`；③ 所有 worktree 的 `node_modules` 软链到主仓，在 worktree 里 `npm ci`／`rm`／`ln -sfn` 会改坏主仓那一份（`/Users/biran/code/skills/orca/.agent-notice-node-modules.md`）；要独立安装就在自己的 worktree 里不建软链、直接 `npm ci`（会话 `543e800e` 的 repin 即如此）；④ zsh 不拆分 `$VAR`；⑤ `rm` 变量路径会被安全检查拦，子 agent 删自己的克隆也常被拒——留给人清；⑥ 长 TMPDIR 让 socket 路径超 103 字节，测试用 `TMPDIR=$(mktemp -d /tmp/oXX)`；⑦ ccloop 的 vitest 2.1.9 要 `--minWorkers=1 --maxWorkers=2`。

### 3.上一轮（2026-11-17 晚，会话 `0e0846ae`）—— 交付尾合入；测试与门精简；#338–#344 修复；P0（卡死 run／不可能的修复）落地；面板已重装

- **人的话（原话要点）**：交付尾 Correction 1、2 的 12 条「按你的建议走」（含 1.4 改为本轮修、1.6 照建议）；#346「选 (a) 我的折中方案」；本会话「按你的建议走」做 1→4、5 只到 spec；「测试精简点头同意」（门策略第 1、3 项）；「这一轮允许改必要的判据」「允许删除/修改必要的测试」「这轮可以在需要时重装」。**本轮无付费真跑；无 `allow-push`**（远端 main 在会话中被人推到 `fix(abandon): a run that succeeds after an abandon request lands; spec Correction 2`，其后的提交未推，以 `ls-remote` 现核）。
- **交付尾（#333/#336/#337 提示词半边）已合 main**：四个疑似负载红低负载下各单跑两次 35/35（R-F 也绿）；新增 Correction 3：「无可带」的 local 组完整后记为已交付（`lastIntegrated=T`、无提交），done 门可达（`fix(delivery): a finished local group with nothing to carry is recorded as delivered (delivery tail Correction 3)`）。spec `docs/superpowers/specs/2026-11-17-delivery-tail-design.md` Correction 1–3。
- **测试与门（0a，人点头）**：`npm test` 现在是**快速档**（镜像目录＋直接 import 者＋目录表测试；≥30 s 与真 ccloop 文件推迟并逐个打印；不是合入门）；`npm run test:wide` 每批合入跑一次（今天的选法），同树绿过有树哈希戳不重跑；`npm test -- --rerun-failed` 只重跑上次失败文件并标明「不是门」；`web/dist` 缺或旧自动 build；机器级锁 `/tmp/orca-gate-<uid>.lock`，**门跑起来的测试拿嵌套锁**（否则测试里再起门会等自己的父进程——本轮真挂过 39 分钟，`fix(scripts): the tests a gate runs get a nested lock…`）。Rule 18 已改。剪枝：`handoffE2E` 拆三文件、G 注入 5 s 宽限；`agentSelectionE2E` C3/D1、`executionDriverE2E` R1 的 A2/D/E 三点、`handoffE2ERecovery` 的四个 R-H 点、`heldEffectChains` 长度 3 只在发版门（`ORCA_RELEASE_GATE=1`，`tests/helpers/releaseGate.ts`）；R1 的 B-after-accept 与 C-after-terminal 留日常；`startForm` 改注入上限 10；删 `agentUpdatePaired`。`store→migrations→proposalReopen` 环已切（`budgetBalance.ts` 叶子模块）＋逐模块导入判据 `importEachModule`。#338：`hookTimeout`、panel 运行态目录只记顶层条目。
- **小修（已合）**：#342 `orca help panel|user|mcp`＋`docs/cli.md`；#340 复核 `checkConflict` 结构化落盘、`why: check-conflict`、CLI/Web 三行展示；#339 `set-integration --history-source <taskId>=refs/heads/<b>`（可重复）／`--history-artifact`＋Web 表单；CLI `task continue`／`resume-handoff --continue` 现在用 run 记录的 partial checkpoint（原来找 complete，永远找不到）。
- **P0（spec `docs/superpowers/specs/2026-11-17-stuck-runs-and-impossible-fixes-design.md`，Correction 1、2 优先；人未逐条审，§八）**：S1 pause 收尾未触达 provider 的 `starting`/`start-pending` run（同 `restartRun`，保留 legacy 承诺）；S3 `task retry` 接受 held 任务（含 token-policy；`retryGrant.ts` 一并放行）；S4 `recovery list.heldTasks[]`／`unresolvedRuns[]`、brief `task-held`；S5 复核每条判据 `fixableBy: work|plan|person`，只有 work 开自动修复，全非 work 停 `not-fixable-by-work`，自动修复任务 token 上限 max(2×源任务用量, 1M) 且不超源 grant；S2 新命令 `orca run abandon <g> --run <r> --note`（人专用）：无 token 数的 run 一律带只观察的 live ceiling（不进 reserve），abandon 把它降到已观测用量，ccloop 停下后收尾 `settled-failed`／`operatorSettlement:abandoned`、任务 `blocked`（`run-abandoned`），不自动重派；**abandon 之后仍成功的 run 照常落地**（控制器裁定，Correction 2）；宽限期内未停 ⇒ `abandon-unresolved`。
- **#346** 本轮只写了 spec（`docs/superpowers/specs/2026-11-17-off-plan-writes-design.md`）；W4 人裁自动重试。实现进度见 §3.最新（会话 `4389b15f`）。
- **门与证据（现测；日志在会话 scratch）**：第一批 wide 门因锁死锁被停（928 文件过，`workerLostE2E` 负载红、`scanPanelText` 抓到 #339 的未翻译占位符，已修）；两批合并后 `npm run test:wide`（HEAD 为上述 Correction 2 那笔）：root 933 文件 932 过、web 249 全过，8,124+2,060 条过、48 跳过；唯一红是 `archiveGroup` 动词表漏 `abandon-run`（真漏，已修，`--rerun-failed` 84/84）。各子任务的变异：本人 13 条＋闸门工具 13＋剪枝 4＋S5 14/15（第 15 条暴露冗余写入已删）＋S1/S3/S4 15＋S2 16＋abandon 成功落地 1＋嵌套锁 1，全红、还原 0 B。
- **面板已重装**：无活动 run → `sqlite3 .backup`（`~/.orca/control/panel/control.sqlite.bak.1794927706`，integrity ok，已改 0600）→ `npm run build`＋web build → `orca panel restart`，`orca status` 全 ok（pin 未变 `a46cadb`）。
- **测试者台账**：`orca_archived_files/issue-20261023.md` 只改状态表（另一个本地 git 仓，未推）：15 条移入已修、#332/#337 移入部分解决、未决剩 16；正文逐字节未变。
- **会话末人的裁定（原话）**：stuck-runs spec「下一轮派一个独立subagent review 并修复review问题后开始写plan以及实现」；#346 W4「按建议走」（自动 after-sibling 重试，已追加到 spec 末尾）；两个 `*.paired` saved-result 文件「不留」（已删，连同 `scripts/verify-saved-result.mjs` 与 `npm run verify:saved-result`、README 那段；主题行 `test: drop the two paired saved-result files…`）；#335／#322／#332 的控制器建议「按建议走」；推送「已push」（三仓远端以 `ls-remote` 现核）；合并完的 agent worktree 由人删（命令见 §八 第 12 条）。
- **诚实边界**：①P0、#339/#340 等全部只在夹具／假 ccloop／driver harness 验证，无真 agent、无旧现场重放；②S2 对有限 token grant 的 run 只能等宽限后标 `abandon-unresolved`（它本有 tokenBudget 封顶）；③（④⑤ 已由会话 `4389b15f` 解决：#347 已做、快速档已收窄；③ abandon 时 usage 未知的终态已有判据，见 spec Correction 3）。

### 3.上一轮（2026-11-17 下午，会话 `0ae7510a`）—— #334、#335、#322 余项、#332、#317/#318/#331 上 main

- 已上 main（按主题行 `git log --grep` 取）：#334 review diff 有界读取、准备失败的 review 关成 `failed-before-provider`；#317/#318/#331 UI；#335 `overlapSerialized` 与 `narrow-target-path`；#322 余项（`passed-relative` 时修复任务去掉 base 上就红的全量）；#332 只改说法（`waitingOn: settle`），settle lane 串行未动、未在真现场复现。交付尾在该轮写成、本轮合入（见 3.最新）。
- 教训仍成立：新 worktree 跑门前先 web build（否则 `panel-dist-missing` 假红）——现在 `test-affected` 自动做。

### 3.上一轮（2026-11-17 上午，会话 `9982cf01`／`orca-9d`）—— #328 历史交付、#320 时间显示、#323/#325/#326 已上 main、ccloop 已 repin、面板已重装

- **远端与边界**：开工与收尾均用 `/usr/bin/git ls-remote origin refs/heads/main` 现核三仓。人本会话消息开头有 `allow-push`，但 agent 的 ccloop push 仍被 Tier 0 钩子拒（按钩子要求未重试，原因未查）；之后三仓远端都已含本会话提交——**不是 agent 推的**。ccloop #320 在远端后，Orca 在独立 `git clone --local` 树用 `scripts/pin-ccloop.mjs` 钉到 `fix(runtime): keep a full final raw transcript line at close (#320)`（各检查 ok、默认解析 E2E 12/12），提交 `chore(deps): pin ccloop at the transcript observation-time producer (#320)` 后 `--ff-only` 进 main。面板空闲时停→`sqlite3 .backup`（`integrity_check` ok，备份在 `~/.orca/control/panel/` 下带时间戳的 `.bak.*`）→主仓 `npm ci`→root/Web build→重启，`orca status` 报 ccloop pin「installed and built」，HTTP 200。repin 提交是否已在远端，以收尾 `ls-remote` 为准（见 §八）。
- **合并后日常门暴露的 #328 回归（已修）**：第一次合并后 `npm test` RC1（根 15 文件／11 条红，Web 254 文件全过）。独立重跑后确认**不是**负载或面板重启（上一版本节曾这样猜，是错的）：①`integrationScheme.ts`→`historyIntegration.ts`→`historySource.ts`→`integrationScheme.ts` 循环导入，以 `integrationScheme` 为入口时 `historyChainSchema` 为 undefined，3 个套件导入即崩；②新拒绝码 `integration-history-frozen`／`-invalid` 缺 en/zh 文案（`refusalCoverage` 红）；③#328 把单仓 split 指令升到 v6，`splitParallelCandidates` 仍期望 v5；④四个真实 ccloop E2E（`requirementE2E`、`dirRequirementE2E`、`dirRequirementOutOfRepo`、`agentWalk`）的 fake claude 仍按 v5 头匹配 split，永远等不到草稿。修复见 `fix(control): break the history-chain import cycle and follow split v6 in criteria (#328)`：链 schema 移入叶子 `historyExpectation.ts`、补文案、导出 `SPLIT_PROMPT_HEAD_V6`、判据按人的「这次批准改写所有必要的判据」带 Ruling 注释改写。原 15 个红文件修后单跑全绿。**教训**：#328 分支只跑了聚焦门就合 main，合并前应跑一次 `npm test`。
- **#328 实现**（主题行 `feat(control): freeze explicit named-source history intent (#328)` 至 `fix(control): keep history proof valid for append-only targets and pending retries (#328)`；spec `docs/superpowers/specs/2026-11-16-history-delivery-design.md` Correction 1–7）：local/group/merge 可带显式 `historyExpectation`（有序来源 ref、目标 ref、直接第二父、必需文件）；来源在对应 task 落地时按私有 pin 绑 SHA；整条来源双父链在对象库中构造后一次 CAS 发布到目标，支持崩溃重入、目标追加移动的显式 retry、来源冲突具名阻断；最终验收按真实第一父链与树核验，tree-only acceptance／system verdict 不放行，目标或组 tip 移动会撤销 `done`。Web Git 区与 CLI `group show` 显示来源顺序与证据；普通组路径字节不变。
- **#320／#323 体验**（主题行 `feat(transcript): display matched ccloop observation times`、`fix(transcript): revise late marker times safely`、`fix(web): localize visible times and clarify transcript status (#323 #325 #326)`）：ccloop 在原始 stdout 行后追加 `ccloop.line-observed`（字节偏移＋接收时间），消费端只给紧邻可解析行附时间并支持 live 补读；Web 时间按本地时区显示、转录状态改标在可见标记上、窄屏标签不拆行；`liveCeilingStop.at` 仍当枚举不当时间。
- **验证**：ccloop #320 聚焦 7 文件／76 条、typecheck/build RC0（ccloop 全量门未重跑）；Orca #328 聚焦与相邻组门、Web 历史展示、三个独立审阅均过；合并后回归修复后原 15 个红文件单跑全绿。repin 门的结论已由会话 `0ae7510a` 补上（见 §3.最新「门与证据」末条）。**用法教训仍成立**：不设 `ORCA_CCLOOP_BIN` 时真 ccloop 文件全跳过、RC0 也不算证据；指向安装包 `node_modules/ccloop` 会因缺 `tests/fixtures/fake-codex.mjs` 假红；main 已推后默认 base 选 0 文件，需 `node scripts/test-affected.mjs --base=<ref>`。
- **未完成**：#333 立即集成入口、#322 自由文本冲突漏报、#321 verify-only 重跑、#317 双滚动、#323 其余时间位点、#331 耗时列、#327 依赖可视化、#92 批量操作、#108 结构化验收、#71/#78 产品与视觉基线；#224/#266/#196 仍待同仓精确 phase／失败尝试样本；#328 没有真付费 provider 验收，也没有重放旧事故组。

### 3.上一轮（2026-11-16，会话 `365ff5f9`）—— #315/#296/#291 本地闭环与 ccloop #316 生产者，发布状态已由本轮接手

- **人的话**：本轮消息开头 `allow-push`，授权必要的判据改写、付费真跑、ccloop 与 repin 后的 Orca 普通 push；卡住需人处理的事留到最终总结，继续可逆工作；三仓 handoff 滚动，另给下一位 agent ≤10 行摘要。开工 `/usr/bin/git ls-remote origin refs/heads/main` 现核三仓本地＝远端。用户反馈 `orca_archived_files/issue-20261023.md` 是证据入口，不照单采纳其修法或旧状态。
- **Orca 代码（本地 main，按主题行找）**：`fix(test): ignore only transient panel accept claims (#315)`＋`fix(test): keep same-named panel directories in the user-data guard (#315)` 仅排除真实面板 run 目录里带 UUID 的临时普通文件，持久锁、目录及其它 `control/` 仍入快照（对同名普通文件有意留一个窄盲区）。`fix(control): judge estimate answers and Board failures in dependency order (#296)`＋`fix(control): preserve version-one estimate answer order (#296 review)`：v1 冻结指令按归档计划数组序，v2+ 的答案诊断按依赖序，持久估算仍 canonical taskId 序；Board 首错先报前置。`fix(control): distinguish task expectation, funded share and hard cap (#291)`：预览分清预期、claim 时份额与人的硬 task cap（`taskCapTokens` 可选），CLI 不再把正在跑／已完的 task 说成没钱；真实 claim 算法没改。
- **ccloop #316（本地 main，尚未装进 Orca）**：`fix(codex): preserve execute work when only the output log is an array (#316)`＋`fix(recovery): replay Codex array-log execution through its own decoder (#316)`；只在 Codex execute 接受字符串数组日志、拼成既有 string，保留原 final 与用量；已完成执行在 verify 前被预算停下时的成功来源同样可读，旧格式失败胶囊仍拒。共享／Claude／OMP 严格解码没放宽。严格 provider wire 仍要求 string，这只处理实际送达的数组；旧已被替代的事故 run 不被追认。
- **证据**：新增／审阅修正的判据均先见行为红再绿。`TMPDIR=/tmp npm test` 在代码分支最终树 **7,896 passed / 142 skipped / 0 failed**（889 文件过、27 文件跳过；root typecheck 0）；合进 main 后同命令 RC1：**7,895 过／142 跳过／1 红**（`flow/startForm` 的本地 HTTP `ECONNRESET`，未改动路径；该文件单跑 9/9 绿，`known-load-flakes.md` 已登记），**不能称合并后日常门通过**。中间一次只有 `criteriaBaseRun` 的 `index.lock` 红，该文件单跑 18/18，同样已登记。隔离 Orca clone 的 `npm run build` RC0，主树未重 build／未重启面板。ccloop typecheck/build RC0，新恢复来源与相邻判据 35/35、原生恢复 28/28、OMP 仅验证恢复 14/14、setup 37/37；两次全量 JSON 门 `check-known-reds.mjs` RC1，第二次仅名单内 watchdog 与 `stalledCauseAndFloor` 预条件红；后一条在未改 main clone 同形失败。ccloop clone 变异删数组投影令 10/12 新判据红，还原后两个 diff 各 0 B。详见两仓 `.superpowers/sdd/2026-11-16-*/progress.md` 与日志。**无真付费 provider 跑**；ccmem 只滚动 handoff，未改代码／daemon。
- **发布／部署边界**：本轮 `/usr/bin/git -C <ccloop> push origin main` 被 Orca Tier 0 钩子以“push is Tier 0”拒，指示不得重试或改写；本会话未再试。Orca `package.json` 仍钉上轮 ccloop pin（以现读为准），本轮不能通过 npm GitHub 依赖 repin；面板未由本轮 build/restart，不能把 #316 或 Orca 新代码称为已装。Orca／ccmem 的远端 push 也未尝试，待三仓远端现核。
- **后续产品判断**：`docs/superpowers/specs/2026-11-16-budget-confidence-proposal.md` 区分 Codex 响应后软停与真正请求前硬预算；#225/#297 不得许诺严格封顶。#224/#266/#196 先用同仓精确阶段用量与失败尝试量校准估算，不套旧案例倍率。#108 的结构化验收、#92 批量操作、#71/#78 整体入口与定位另开产品设计；#193／#195 等依赖新的观测或性能证据。测试者的 #312/#313/#267/#273 是已修代码、旧现场不可重放，#285 当前 blocked 文案已经修正。

### 3.上一轮（2026-11-16，会话 `5f974912`）—— ccloop repin、面板重启、`g-28d9b560` 收尾；验收基线、完成态接受、#265 自动补路径

- **人的话**：本会话开头 `allow-push`；「继续，尽量将该做的工作都做完」「这次批准改写所有必要的判据」「这一轮允许必要的付费真跑」；遇到必须等人的事继续做不必等人的部分，最后报审并写三仓 handoff。
- **ccloop repin**：主题行 `chore(deps): repin ccloop to the Codex loop session observations`，钉 `1453fc5`（当轮 ccloop main）。面板随后 build/restart；`orca status` 现测 pin 与 installed 都是 `1453fc5`，面板 pid `92463`。Codex loop 的会话观察与按 UUID 删线程已进入运行路径；保留风险仍是 `thread.started` 留证前崩溃残留与 SQLite/WAL 物理擦除未证。
- **`g-28d9b560` 已 `done 7/7`（真实验证 B）**：`review-fix-4` 的 run 原为 `settled-recoverable` / `exhausted`（verify 边界被 live ceiling 停，572,147 vs 349,124），archive snapshot `missing: []`。用新路径 `orca task accept-attempt g-28d9b560 review-fix-4 --run run-3a7648af… --as-person`：命令把 run 转成 `settled-failed` + `operatorSettlement{kind:"completed-attempt", outcome:"exhausted"}`、`active=0`；driver 从 snapshot 重建 attempt、跑检查并落地。**acceptance 在 `ce389952` `passed`（10 条命令全 exit 0）**；review 第 5 轮因组已 5.75M/5.6M 无法资助（`unfunded`），用 `group review-accept --as-person` 接受。**没有付费重跑，组已 done。**
- **A 验收基线**（spec `docs/superpowers/specs/2026-11-16-baseline-aware-group-acceptance-design.md`；主题行 `feat(control): classify a red acceptance suite against the group's base (#279 #283 #312 #314)`）：tip 的全量命令红两次时，在组 base（首个 work run 的 `drive.base`）再跑同一命令；base 也红两次 ⇒ `passed-relative`（可 done，记录 `fullSuite.baseline` 与 `baseline:` 命令），base 绿 ⇒ `failed`。只分类全量命令，不跑 base 的任务检查；`acceptanceSatisfied`、wire schema、`group show` 行同步。判据 `groupAcceptanceFullSuite` 7/7；三条 review 判据的夹具从 `false` 改成 `test ! -f a`，保持“真失败”语义。
- **B 完成态接受**（spec `…-completed-attempt-acceptance-design.md`；主题行 `feat(control): accept an attempt whose work finished but whose settlement did not (#230)`）：`accept-attempt` 新增 `settled-recoverable/exhausted` 与 `blocked/E/succeeded` 两种形态，要求完整 snapshot；E-block 还没结算的余量按 `close-run` 释放并置 allocations terminal；`drive.landedCommit` 已在 tip 的 E-block 记 `already-landed`，不产生第二个 merge commit。判据 `acceptAttemptCompleted` 2 条＋既有 accept-attempt 25 条；`g-28d9b560` 已按此路径真实落地。
- **C #265 自动补路径**（spec `…-implied-write-paths-design.md`；主题行 `feat(control): a success condition's named path joins the task's write set (#265)`）：单仓 split 在展开/校验前把 successCondition 点名的、别 task 列过的路径加进本 task 的 `targetPaths`；#268 的写集相交自动把它变成串行边；draft 记 `impliedPathsAdded`，`requirement show` 打 `implied-path-added:`。多目录仍保留 hint＋手动 `add-implied-path`。判据 `splitImpliedPaths`／`splitWriteSetSerial`／`requirementDraftEdit` 全绿；`tests/control/acceptAttemptCompleted.test.ts` 为新增。
- **门（现测）**：`TMPDIR=/tmp npm test` root **6,494 passed / 140 skipped / 0 failed**（790 文件过、27 文件跳过），web **1,664 passed / 0 skipped**；root typecheck 0、build 0、web build 0、web typecheck（`node_modules/.bin/tsc --noEmit -p web/tsconfig.json`）0。第三轮门唯一非零是 web typecheck 缺 `impliedPathsAdded` 的夹具，已修并单跑绿；第二轮的两条红（`startForm` ECONNRESET、`taskResultCollector` control-peer-timeout）单跑 39/39 绿，判负载。日志 `/tmp/orca-gate3.log`（临时目录）。
- **诚实边界**：① A 的 `passed-relative` 只在夹具验证；`g-28d9b560` 的 acceptance 直接 green（fix 让 `npm test` 全绿），真实 base-red 组未重放；② B 的真实验证是 ceiling-stop 在 verify 的形态，E-block 只在夹具；③ C 只对单仓，多目录仍 hint；④ 旧 dogfood 组（`dogfood-20261112-3` 等）已 `id-not-found`，本会话无法重放 #267/#273/#312/#314 的旧现场；⑤ repin 采用 Codex 删线程后，残留风险仍成立。
- **待人**：push——本会话消息开头有 `allow-push`，但 `~/.orca/gate/push-grants/` 只有更早会话的文件，`git push origin main` 被 Tier 0 拒（未重试）⇒ 三仓本地 main 领先远端，待人推。其余：#291/#296 的剩余语义判据；#225 的 codex 单 turn 硬边界；#224/#266/#196 估算校准；#92/#71/#78 等产品/UI 项。

### 3.上一轮（2026-11-15，会话 `60e715bf`）—— 测试者 #313/#314/#315 与 #243/#291/#261/#229/#296 的代码修复；#267/#273 只写了设计稿

- **状态口径（先看这条）**：本轮改动已按主题拆成提交、`--ff-only` 合入**本地 main**（基线 `72fe8393`），**未推送**；三仓开工时本地＝远端（`ls-remote` 现核）。没有 repin、没有重启面板、没有真付费 provider、没有动旧 dogfood 组。`npm run build` 与 `npm run build --workspace web` 均 RC0，面板仍在跑旧进程。下面的计数只对这条本地 main 成立。
- **反馈文档里已过期的条目**（正文最后复核早于修复）：#285（`28a0ba2a` 已让 blocked/静默 run 不再说 producing output，`runUsageLines.test.ts` 钉着）、#312（`6341c212`）、#311（`12be602e`）、#310 主体（`dd14646d`，旧行形态即 #313）、#230（`3afe1c42` 起视图与 brief 都从 run 投影；`blockedRunTaskStatus.test.ts` 三条钉着，存储 `running` 是恢复路径，本轮复核后**不改**）。#164 正文已写「不再算缺陷」。
- **本轮改成的**（TDD，每条先见红）：
  - **#313**：`executionDriver.ts` 的 ceiling 复用分支不再对缺失的 `liveCeilingStop` 调 `hashPayload`。已提交 checkpoint 但 `onSettled` 未跑的旧行，补写 `liveCeilingStop`／`drive.outcome` 并以 `blockedAt=C + blockedReason=live-ceiling-usage-unknown` 停住，`recovery list` 给 `next=settle-usage`；不发明零用量、不推进 `settled-recoverable`。判据 `liveCeilingSettle.test.ts`「finishes a stored ceiling row…（#313）」，从 DB 旧行启动。
  - **#315**：`tests/setup/relocateUserData.ts` 的快照排除 `panel/logs/`、`panel/panel.json`、`panel/panel.lock`（panel 自己的运行写入），`control/`、`person/`、`vault/`、`panel/service.env` 等仍受守卫；失败信息区分「测试写入或外部进程」。判据 `tests/setup/relocateUserData.test.ts`；面板**正在运行**时 `estimateExpectation.test.ts` 20/20 通过（改前会 file-level 红）。
  - **#314 A**：首轮 review 不再被「acceptance 未通过」挡死，但也不抢在 acceptance 前跑（两遍都需要组的 run 空闲，先跑 review 会把 acceptance 饿住）。门改为「acceptance 已在本 tip 记录结果」，`failed` 也放行；review prompt 加一句 `Group acceptance failed on this tip …`，组仍要两者都过才 done。G 设计稿追加 §21 更正。判据 `requirementReviewAcceptanceGate.test.ts` 与改写后的 `requirementReviewFix.test.ts`「starts an initial review even when group acceptance truly fails (#314)」（Ruling 行引本轮授权）。
  - **#314 B**：`reviewInputsOf` 现在带 accepted draft（没有 draft 时用 archived contracts）的 `layers`／`dependsOn`／`targetPaths`／`successCondition`／`checks`，prompt 单列「The accepted delivery plan」，并说明计划类判据看这一节、代码类判据看 diff。AC12 那类判据不再必然 `cannot-judge`。
  - **#243 补充**：`add-live-note` 的结果多可选 `delivery: "current-run" | "next-run"`（只有 prepared 的 run 才有 live-notes 文件）；Web 的 `LiveNoteList` 只对视图态 `starting`/`running` 说「排队运行中」，blocked/settled 说等待下一次。旧命令结果因为可选字段仍可解析。
  - **#291**：`fundingPreview` 对 ready 任务不再一律落 `task-budget-unavailable`，按同一批事实点名 `dependencies-pending`／`usage-unknown`／`no-remaining-grant`／`no-group-headroom`；optional-v1 且 `authoredTokens:null` 的行带 `expectation:true`，funded 时 reason 为 null。显示层专用。
  - **#261**：`assertPrivateRecoveryDirectory` 改为 canonical 父目录 + 字面末段，接受 `/var`→`/private/var` 系统别名，仍拒绝末段软链；判据直接调断言。
  - **#229**：`archive.ts` 的 `publish()` 按 artifact id 进程内排队；判据用 `beforeDuplicateRead` 数并发进入，旧码 max=2，新码 max=1。跨进程仍不承诺（注释写明）。
  - **#296**：新增 `src/control/planOrder.ts`（最长路径分层 + 层内 taskId，code-unit）。`estimateTaskIds`、`review fix` 无草稿回退改用它；**`group show` 的 `workItems` 仍是 canonical taskId 序**——视图 schema `set-not-canonically-sorted` 钉着，Web 表已按依赖布局排（`ebaae764`）。判据 `planOrder.test.ts` 与 `estimatePromptV2.test.ts` 的依赖序用例。
- **#267／#273（Orca 半边已实现）**：`recoveryRetry` 在命令事务前，对「driver work run、blocked at C、outcome=null、有 prepared envelope」调用 ccloop 的 `settle-lost-worker`。成功 ⇒ ccloop 已写 terminal，恢复后的下一次 collect 消费它，run 离开 `blocked+outcome=null`，`recovery list` 给 `close-run`／`settle-usage`；worker 活着 ⇒ 照旧 resume；其它失败 ⇒ 响亮报错，不再假报 `resolved:true`。不写 `work_items.status`、不发明零用量、不自动开 worker-lost 重跑。判据 `tests/control/recoverySettlesLostWorker.test.ts`（4 条，含下一次 collect 收敛）。设计稿 `docs/superpowers/specs/2026-11-15-recovery-settles-interrupted-design.md` 含 As built；**ccloop 半边未改**，也未在真 ccloop 的旧现场重放。
- **#224／#266（估算校准第一步）**：确认 expectation-model 组时按 `repoTaskHistory` 一次写入 `expectationFloorTokens = max(1M, 本仓历史中位数)`；`taskExpectation` 只用它给「来自 estimate」的 expectation 兜底，人设的 tokenIntent 不被历史抬。判据 `estimateHistory.test.ts`「confirmation floors an estimate-derived expectation at the repository median」。**估算器本身仍未看仓库规模/历史**；#196 的 plan 成本未动。
- **#265（未落地，待人裁）**：试过在 `validateSplitDraft` 里对「goal/successCondition 点名了另一个 task 的精确路径」硬拒，结果把既有的 hint + `add-implied-path` 流程打断（`splitImpliedPaths`、`splitWriteSetSerial`、`requirementDraftEdit` 共 4 条红），因为现有夹具正是用「描述另一个 task 的文件」来演示 hint。**已回退**，本仓仍是「提示 + 人手动 `add-implied-path`」；运行时的 allowlist miss 诊断（`path-policy` + `--allow-observed-paths`）不变。下一步要定的是：硬拒、自动补进 targetPaths、还是维持 hint——三者对写集/隐式边的语义不同。
- **门（现测）**：`TMPDIR=/tmp npm test`（日常受影响门，不是全量 `verify`）**RC1**；`test-affected` 选 1,103 个文件（root 915／Web 188）；root **7,881 passed／142 skipped／1 failed**，Web **1,664 passed／0 skipped**；两边 typecheck 均 0。唯一红是 `tests/control/driverReconcileN.test.ts`「N2: while one run … does not land until the reconciliation has …」的 30 s deadline，单跑 **5/5 绿**，属 handoff 已登记的负载形状（上一轮也红过），不是本轮代码。日志 `/tmp/orca-fixes-mytest4.log`（临时目录，可能失效）。142 条跳过含配对／真二进制用例，未在本轮重跑。
- **诚实边界**：① #313 的修复只用夹具旧行验证，没有在 `dogfood-20261114-1` 的真实现场重放；② #314 B 改变了 review 的 prompt 输入，未用真模型验收；③ #296 改的是 `estimateTaskIds` 的输入顺序与 review fix 回退，服务端视图顺序**故意未改**；④ #229 的串行只在单进程内；⑤ 面板仍是旧构建（未 build／restart），本轮的 Web 改动没在真面板看过；⑥ 旧生产组未做任何恢复；⑦ #267/#273 的 Orca 半边只对 fake ccloop 验过，没有真 ccloop 的 blocked 旧行重放。
- **待人（下一会话先看）**：① **Codex 会话保留/擦除裁定**——`thread.started` 留证前崩溃残留与 SQLite/WAL 物理擦除未证，未 repin；② **面板 build／restart**——本轮的 Web／服务端改动没部署，`launchctl kickstart` 需人显式授权；③ **push**——本会话消息开头有 `allow-push`，但 `~/.orca/gate/push-grants/` 只有更早会话的文件；实际 `git push origin main` 被 Tier 0 闸门拒（`push is Tier 0`），按闸门要求**没有重试**。三仓本地 main 领先远端，待人放行或手推；④ #313 的真实旧行、#314 的旧组、#267/#273 的真 ccloop 现场都要新面板才能重放；⑤ #265 的产品取舍（硬拒／自动补／维持 hint）；⑥ `g-28d9b560` 的组上限或 accept-attempt 仍未处置；⑦ 两个 agent worktree 仍在 `5c9eddbb`，含未提交副本，按旧清单不要强删。

### 3.上一轮（2026-11-15，会话 `1b8535c8`）—— #267／#273 配对闭环、#312 复评解锁、Codex 临时读数消费端已在本地 main

- **本轮做成**（主题行按 `git log --grep` 取）：`test(control): prove a blocked lost worker unlocks dependent work (#267 #273)` 串起 C 阶段超时阻塞、worker 被杀、显式 `recovery retry --run`、`worker-lost` 自动重试和下游完成；删掉本仓 worker-lost 分支的定向变异在独立 clone 红于等待结算，clone 的 `git diff` 与 `git diff --cached` 还原后各 0 B。`test(control): give debug priority a valid ladder source` 把旧 `orchestration` 假来源换成真实失败 run，仍有普通组竞争槽位；变异删优先级也见红。`fix(control): review a finished fix after a failing acceptance (#312)` 让完成的 review-fix 在**新 tip 已有验收结果**时再评审，验收失败仍挡住组 done；新增正负判据先红后绿，已发布 G 设计仅在文末追加 §20 更正。Codex 消费端由 `feat(web): show Codex response observations separately from booked usage (#285)` 接入当前 main，再由 `fix(usage): distinguish booked Codex work from response observations (#285)` 显示精确临时下界、中文阶段与上次入账值，修正过期注释和越线措辞。原分支不再是待合工作。
- **门（本轮完整日志现读）**：在上述消费端修正**未提交、随后按相同源码字节提交**时，`TMPDIR=/tmp npm test` RC0；`test-affected` 18 个改动路径、1,059 文件被选（root 812／Web 247），root **6,422 passed／140 skipped**（785 文件通过／27 文件跳过），Web **2,017 passed／0 skipped**；内含两边 typecheck，只有追加的设计 spec 路径不选测试。`startForm`、`criteriaBaseRun`、`orchestration` 本次均通过。命令和全日志在 `/tmp/orca-267273-ACu4mRCT/daily-gate-final.log`（临时目录，可能失效）；root `npm run build` 与 Web `npm run build --workspace web` RC0。另用 `ORCA_CCLOOP_BIN=/private/tmp/orca-267273-ACu4mRCT/ccloop-pin/dist/cli.js`（独立 clone 的**当前 package pin** 构建，`dist/build-info.json` 核对）跑 `vitest run tests/control/sleepBlockedResumeE2E.test.ts tests/control/workerLostE2E.test.ts` **10/10**；日常门里这些配对用例属于 140 条跳过，不能混报为门覆盖。没有调用真实付费 provider。
- **仍要区分的状态**：上面证明的是隔离的新组路径，未操作 `dogfood-20261112-3` 等旧生产组；#312 的 `dogfood-20261114-2` 也未在真面板重放，旧 README 全量检查失败仍须按证据修复或由人裁 waive。Orca `package.json` 仍钉 J 轮 ccloop；ccloop 的 Codex 响应观测／按 UUID 删除已有远端提交，但 `thread.started` 留证前的崩溃残留及 SQLite/WAL 物理擦除未证（Orca spec `2026-11-14-codex-live-usage-design.md` §9），**保留策略未裁，故本轮不 repin**；#195 精确上下文占用仍无生产者。面板服务本轮未重启，不能声称 7777 已装新代码。`g-28d9b560` 上轮导出树 22/22＋AC4 仍只算历史观察，未动组上限或做接受，`review-accept` 不适用。
- **反馈与边界**：测试者台账新增 #312 已修代码；#229 只证明并发 archive 的 20 轮，不证明完整驱动；#230 存储的 running 与读视图 blocked 分离是恢复路径；#265 的隐含路径提示仍非完备语义验证；#224/#266 的历史中位数只供展示，不校准 estimate；#279/#283 仍按配置的 full-suite 命令运行、缺配置时标未跑。台账是测试者文件，本轮未替其改状态。推送／授权与下一轮顺序见 §4.0、§八，远端状态须用 `ls-remote` 现核。

### 3.上一轮补记（2026-11-14，会话 `20ff3baa`）—— #296 review-fix 来源已修；codex 去 `--ephemeral` 副作用已实测并改写设计；g-28d9b560 的付费修复已产出且独立验证通过，卡在组上限等人

- **人的话**：本轮开头授权必要付费真跑、必要判据改写，并临时允许在 repin 后与全部任务完成后 push Orca／ccloop／ccmem 的 main；要求「卡住必须等人的事就继续做不必等人的部分」并写进 handoff。
- **#296 已修**（主题行 `fix(control): a review fix inherits the task its criteria trace (#296)`）：导入计划按 taskId 排序，修复任务原先取 `plan.tasks[0]` 继承合同与 agent，于是 `a-integration` 排在 `z-core` 前时会把核心任务的修复挂到集成任务配置上。现在按已接受草稿的 `traces` 选覆盖最多未满足条目的任务、并列取作者顺序靠前者；无草稿的组回退到依赖根。判据先在旧码上红在 `expected 'codex' to be 'claude'`；新增三条（唯一来源、最多命中、无草稿回退），`requirementReviewFix` 7/7；变异把「最高命中」改成「第一个命中」后见红。门见本节末。
- **codex 实时用量（#297／#285／#195）**：本轮用隔离 HOME／CODEX_HOME＋本地假 Responses 端点复测（0.167.0，零成本）。新证据：**失败的调用也会落盘**（端点不可用时 rollout 仍含 34,352 B 的 base instructions 与用户 prompt，然后 `turn.failed`）；成功调用额外写 `thread_history_1.sqlite*`、`logs_2.sqlite*`、`state_5.sqlite*`、`queue_1.sqlite*`、`memories_1.sqlite*`、`goals_1.sqlite*`、`thread-writer-locks/`。rollout 的 `token_count` 与 stdout `turn.completed` 字段逐项一致。设计已改写（`docs/superpowers/specs/2026-11-14-codex-live-usage-design.md`）：停止是「观测到一次响应之后」，不是硬上限；saved-result 恢复的旧 argv 含 `--ephemeral`、必须版本化；0.167.0 无 CLI 线程删除命令（上游 source 有内部 API 但未证与已装版一致）⇒ 保留策略需人裁。**未改 ccloop 代码**。
- **g-28d9b560 付复核**：`group review-fix`（人本轮授权付费）开出 `review-fix-4`，继承了追踪 AC4 的 `cli` 任务配置（configHash 与 cli 相同）。执行阶段完成并产出提交（attempt ref 指向的树：5 文件 +112/−24），但 verify 阶段撞组上限被 `liveCeilingStop` 停成 `exhausted`：单次 572,147，组 5,749,023／5,600,000。**我独立验证了这个产物**：把 attempt 树导出后目标仓 `npm test` **22/22**，分三次独立调用 `add`→`tag`→`search`→`save` 均能看到前一次数据，AC4 满足。它没有落进 `orca/g-28d9b560`。**待人**：抬组 token 上限后重跑验证，或人用 `orca task accept-attempt` 落地这个已发布 attempt（两者都要人权限）。
- **诚实边界**：付费修复的 rollout／cost 数字是 Orca 报的；「22/22 与 AC4 手动复现」是在导出的 attempt 树上跑的，不是 Orca verify 的结论。#296 的 `fixSourceTaskId` 用 `readDraft`，历史组缺草稿行时按无草稿回退（Ruling 已记台账）。
- **push 未成（待人）**：本轮消息开头已敲 `allow-push`，但 `~/.orca/gate/push-grants/` 里仍只有更早会话（`a927913e…`、`c8b75eac…`）的文件，没有本会话 `20ff3baa` 的；三仓 push 都被闸门按「未授权」拒掉，没有换写法重试。**本地 main 领先远端**：Orca 含本条在内、ccloop 的 `docs(handoff): the Codex persistence probe…`、ccmem 的 `docs(handoff): roll the Orca line forward…` ⇒ 下一轮先核授权文件再推（以 `ls-remote` 现测领先笔数）。
- **门（现测，负载 40–50）**：`TMPDIR=/tmp npm test`（日常门，跑在 `fix/review-fix-source-296`）首轮 exit 1，41 个 suite 全部倒在 Rule 17 快照守卫——门跑的同时面板里的付费 review-fix 正在写真 `~/.orca`（多出 `archive-2d3c…`、`ceiling-run-3a7648af…`）。面板空闲后单独重跑这 41 个文件：**38 过**；`driverReconcileN`「three runs conflicting…」与 `schedulerBridge`「runs a real conflicting graph…成功」单跑各绿（deadline／30 s 超时形状，负载）；`orchestration`「admits a debug group Orca opened itself」是**既有红**（`task-run-moved:ladder-source-superseded`，未改动 main 上同样红）。`requirementReviewFix` 7/7、typecheck 0。**教训**：门不要与面板里的付费运行重叠，否则 Rule 17 守卫会把整批 suite 判红。
- 台账：`.superpowers/sdd/2026-11-14-review-fix-source-296/progress.md`、`.superpowers/sdd/2026-11-14-codex-ephemeral-probe/`。

### 3.上一轮（2026-11-14，会话 `3ffce7ec`，承 L 轮余项）—— 多目录草稿 hash、隐含路径按钮、K2 Web 回退、#229 并发判据、#170 诊断已合；g-28d9b560 的 AC4 实测为真、等人；codex 实时用量可行性已探明并写 spec，等人裁；台账 `.superpowers/sdd/2026-11-14-session-3ffce7ec/progress.md`

- **人的话（原话全文在台账）**：「这一轮暂时忽略 context 大小，尽量多处理一些问题」；开头 `allow-push`；「这次批准改写所有必要的判据。这一轮允许必要的付费真跑」；g-28d9b560「按你的建议先跑一次 npm test 再决定」；#279／#283「之前轮我已经裁了，暂时不改」。
- **已合进 main**（按主题行 `git log --grep` 取）：
  - `fix(control): a multi-directory draft's hash binds its secondary writes, and the Web names what waits` —— 发现 A：新增 `src/control/requirementDraftHash.ts`，多目录草稿的 `draftHash` 现在覆盖 `{plan, output}`（单目录草稿字节不变）；生产、accept、draft-edit、plan-library-save 四处统一校验；**读取视图对旧规则下存下的多目录草稿给出新 hash**，旧 hash 仍被拒（审阅抓到的兼容问题，判据先红后绿）。发现 B：隐含路径的新写入在写入方目录、`orderWrites` 按登记顺序排，把写入挪到主目录之后做不到 ⇒ 服务端会以 `checks-primary` 拒时 Web 隐藏该按钮，提示与原因保留。K2 回退：`web/src/groupCategory.ts` 的旧服务端回退补上需求侧五类事实、评审未过、等待决定的暂停（6 条 `it.each` 先红后绿）。
  - `test(control): concurrent archives reuse shared artifacts across twenty rounds (#229)`（只加判据：3 个来源 × 20 轮并发归档共享 artifact store；变异红；与 `driverSettleRetry` 共 6/6。**不是完整驱动的并发 settlement 验收**——step E 本身串行）。
  - `fix(control): distinguish old handoff outbox rows in recovery (#170)`：`recovery list` 可选 `handoffOutbox`，按请求实际状态把未投递行分成 open-request／in-progress／finished／service-record；本机当前 0 行，不显示。
- **codex 实时用量（#297／#285／#195 的共同根因）**：免费探针（隔离 HOME／CODEX_HOME＋本地假 Responses 端点，codex-cli 0.167.0）证实：去掉 `--ephemeral` 后会话文件写在 `CODEX_HOME/sessions/**/rollout-*-<thread_id>.jsonl`，**每个响应之后、下一次请求之前**追加 `token_count`（含 total／last 用量与 `model_context_window`）；8 个并发 exec 共用一个私有 CODEX_HOME 全部成功、8 个不同 thread、各自数值与 `turn.completed` 一致。代价：文件保留整个对话、`thread_history` SQLite 行、必须按 thread_id 精确取文件。设计与风险在 `docs/superpowers/specs/2026-11-14-codex-live-usage-design.md`，**§7 等人裁**（重开「#297 只做提示」这一裁定，仅限 loop phase）。
- **g-28d9b560**：在组分支 tip 的导出树上跑目标仓整套 `npm test` = **20/20 绿**（AC5 因此事实上满足）。同时**直接复现了 AC4**：`add` 之后的下一次 `search`／`tag` 看不到前一次的数据（每次 CLI 调用新建 store）。⇒ AC4 不是判官抖动能解释的，是 CLI 跨调用不持久化的产品缺口；组未动，等人选 accept／paid review-fix。
- **门**（`TMPDIR=/tmp ORCA_CCLOOP_BIN=<9c83b38 build> node scripts/test-affected.mjs --base=main`，两轮：第一轮 exit 0；第二轮 rc 1）：
  - 第二轮根目录 801 文件、20 红／web 165 文件 1476 绿。20 红逐个归因：`orchestration`（已知红）、`workerLostE2E`（登记 flake，单跑 7/7）、`taskResultCollector`「blocked optional RPC」（登记负载形状，与 `chainsApi` 合跑 41/41）、`chainsApi` C1–C11（登记负载，单跑 11/11）、`allowanceHeldSettlement` 2 条＋`servicePanel`＋`panel/security`＋`schedulerBridge`（单跑 27 绿；schedulerBridge 单跑 9/9）⇒ 负载。
  - `splitTracedCriteria`「keeps a multi draft expanded before #204…」是**本轮真回归**：它用旧 plan-only hash 直接 accept，已改判据用视图给出的新 hash（`test(control): the pre-#204 multi draft is accepted under the hash the view now shows`），该文件 5/5。本机负载 20–60。
- **面板**：`npm run build` 与 `web` 构建均 0；但 `launchctl kickstart -k gui/<uid>/dev.orca.panel` 被 auto 模式分类器拦下（「需人显式授权重启面板」）⇒ **7777 仍在跑旧构建**，待人重启（或在终端 `orca panel restart`）。
- **push 未成（待人）**：人已在消息里给 `allow-push`，但 `~/.orca/gate/push-grants/` 里没有本会话的文件（只有更早会话的）⇒ 闸门把 ccloop／ccmem 的 docs 推送按「未授权」拒掉，没有换写法重试。两仓各有一笔只改 handoff 的提交在本地 main，下一轮确认闸门认到授权后一并推。

### 3.L（2026-11-14，会话 `6b727312`，测试者反馈 L 轮；压成结论；台账 `.superpowers/sdd/2026-11-14-tester-followup-l/progress.md`）

- **已合、已装**：K1／K2／K3（`--ff-only`）；`group show` 不再重复打落地回归行；`usagePause.ts` 注释更正（claude／omp 轮间停、codex 整阶段结束才停）；K3 缺的两条多目录草稿判据；#173／#224／#266 估算历史中位数（`estimateHistory.ts`，只提示）；两个 review-fix 真缺陷（**期望模型组开不出修复任务**——`openFixTask` 的 `?? 0`；**修复任务 allowlist 不含自己的 targetPaths**）。
- **登记未修**（后两条已在会话 `3ffce7ec` 修掉）：ccloop `savedResultRecovery.ts` 的松 `indexOf`；#195 context 观测。
- **仓库外**：经面板 `set-limit`／`review-fix`（人授权）；面板重启两次。ccloop／ccmem 零代码改动。

### 3.K 测试者反馈 K 轮的结论（会话 `23ce4a7b`，2026-11-14；L 轮会话 `6b727312` 合入、压成结论；台账 `.superpowers/sdd/2026-11-14-tester-followup-k/progress.md`）

- 人裁不重开：#297／#225 codex 只提示、不中途拦截；#279／#283 只做 ①（标「未跑全量」、不默认跑）；#235 保留原裁定只改措辞（ccloop 命令检查失败的 `safeToRetry` 第 2 次 attempt 起机械为 false，不能当「验证者判不可重试」）。
- 已落地：K1（blocked run 不吃抬上限、`recovery list` 的 `capBlocked[]`、无完整 checkpoint 的 continue 说「从头重跑」、handoff 的 checkpoint-blocked、CLI EPIPE、几处 `next`、codex 提示措辞、#235 措辞）；K2（服务端「需要你处理」单一规则 `PROBLEM_KINDS`＋summary `needsYou`、全量 ① 一整套、Web run 详情的实时上限／停止行／codex 提示）；K3（并行建议误报、#265 裸文档名、`requirement-draft-edit` verb 与 CLI／Web）。各席可逆决定人已「同意」。#196 量过（plan 占小任务 22%–34%），本轮不改。

### 3.J 测试者反馈 J 轮的结论（会话 `c8b75eac`，2026-11-13→14；2026-11-14 会话 `23ce4a7b` 压成结论：已推、已装、J 轮可逆决定人已「同意」；台账 `.superpowers/sdd/2026-11-13-tester-followup-j/progress.md`）

- 已落地：两次 repin（ccloop J 轮全部：codex 单次调用容许前言、`accepted.lock` 陈旧锁回收、#308 `never-claimed`、#287 build-info、#299 `model-unavailable`、原始用量明细生产者）；Orca P0（#294／#298 `operatorNote` 423、#307、#289、#305、#300 无限制组无暂停线）、控制批（#308 #299 #287 #286 #292 #309 #285 #290 #291，#297 只 CLI 提示）、Web 批（#301 #293 #303 #304 #288 #296 #302 #306）；原始用量明细（spec `2026-11-13-raw-usage-detail-design.md`，schema 24：`usage_ledger` 新列，`agent_kind` 目前恒 NULL）。
- 坑：push 闸门只认人在消息**开头**敲 `allow-push`；repin 用 `rev-parse` 取 SHA，别手拼。

### 3.I 测试者反馈 I 轮的结论（会话 `d467cbd2`，2026-11-13；2026-11-14 会话 `c8b75eac` 压成结论：已由 J 轮 repin、推送；I 轮可逆决定人已「同意」；过程按 §十 取回；台账 `.superpowers/sdd/2026-11-13-tester-followup-i/progress.md`）

- 已落地：push 闸门可经人在消息**开头**敲 `allow-push` 放行普通 push（12 h、本会话、只 `git push origin [<ref>…]`；闸门 spec §12）；`test-affected` 只改 pin 时只选读 `ORCA_CCLOOP_BIN` 的测试；Part B 期望模型组的未知用量可显式 `charge-observed-floor`；#273 复审修复（连丢按认领顺序、stepC 认「有 candidate 无停止证明」的 `worker:lost`）；付费 dogfood 揪出的 4 个 P0 卡死（worker-lost 结算读不了／扣光非 token 维度／无下界；暂停线续跑死循环 ⇒ 无完整 checkpoint 就全新开始，`recovery list` 有 `blockedRuns`）；#278 #243 #263 #230（不改码）#272 #265 #282。
- 判过的：#266 的 1M 期望下限是设计（`EXPECTATION_FLOOR_TOKENS`）；#261 决定不改；#230 读侧维持。
- 坑：repin／`npm ci` 前先停面板（否则面板每轮 `control-peer-exit:ENOENT`）；配对验收是 opt-in，常规门看不到它的漂移。

### 3.H 测试者反馈 H 轮的结论（会话 `7e164691`，2026-11-12→13；2026-11-13 会话 `d467cbd2` 压成结论：全部已由人推、Orca 钉 ccloop `26b3127`；过程按 §十 取回；台账 `.superpowers/sdd/2026-11-12-tester-followup-h/progress.md`）

- 已落地：G 轮 Part B（新建组默认预算期望模型：组上限硬、任务额度是预期、暂停线）与 Part C（任务间 handoff 目录、Live 说明）；#273 worker 丢失自动恢复（spec `2026-11-12-worker-lost-recovery-design.md`）；#282 需求复核 run 缺 `estimateId`（写端补、读端缺省 null）；#278 组级验收的已删分支；#279／#280 组级验收跑人采纳的全量命令（spec `2026-11-12-group-acceptance-full-suite-design.md`）；#281 #284 #285 #274 #277 #164。
- 判过的：#283＝#279（默认跑 `npm test` 按人裁不采纳）；#219 测试者表写反；#235、#230（读侧）维持；#274 不放宽严格解码。人已审（I 轮开轮「未评论的部分同意」）：#279 两细节、accept-web 席的 "Instruction Poisoning" 误报审计、G 轮 §4.0 第 3 条那批可逆决定。
- 坑：门在跑时人改真 `~/.orca` ⇒ Rule 17 守卫批量「红」；脚本拼合冲突会丢块边界（合后必须 typecheck）；3 席并行负载 50–180；`handoffE2E` G 改用 SIGSTOP；repin 后、主仓 `npm ci` 前 `orca status` 报 `pinned X, installed Y`。

### 3.G 测试者反馈 G 轮的结论（会话 `d1cbbd58`，2026-11-12；2026-11-13 会话 `7e164691` 压成结论：其 B／C 两部分已在 H 轮合入、已由人推到 H 轮 repin2；过程按 §十 取回；设计 `docs/superpowers/specs/2026-11-12-tester-followup-g-design.md`，台账 `.superpowers/sdd/2026-11-12-tester-followup-g/progress.md`）

- 已落地：小修（#272 `group show --runs summary`／`group list --fields`／`help --json`；首次使用；#261 #267 #264 #265 #268 #230（读侧）#206 #209 #245 #170 #246 #174 #212 #232 #220 #215 #227 #219 #271）；Part A 无改动完成（agent 验证器或声明直接完成、命令验证器先过目标判断）、`task reopen`／`accept-no-change`、往已确认组追加任务、需求复核（不满足 ⇒ 同组修复任务 ≤2 轮）；Part D #192（依赖落地即可领）、#269（每次落地跑检查并集、红进 Problems）、#189（本组放行）。
- 判过的：#261 是 macOS `tmpdir()` 与 realpath 不等；#267 本可用 `recovery retry --run` 救；#263＝#261＋预算设计；#270 是测试者的核查。
- 坑：主仓 `npm ci` 会打断软链主仓 `node_modules` 的席；「git＋子 shell／管道」被闸门判不能判定；7 席并行负载 150–300 ⇒ ≤3 席；Part D 后 `round()` 等自己的 settle，计时型判据按事件放行；`zhTerms` 不许英文角色词进中文句。

### 3.F 测试者反馈 F 轮的结论（会话 `5abcad7d`，2026-11-12；同上压缩；设计 `docs/superpowers/specs/2026-11-12-tester-followup-f-design.md`，台账 `.superpowers/sdd/2026-11-12-tester-followup-f/progress.md`）

- 已落地：#195 改裁（confirm 收 `handoffAtContextTokens:null`；§5.2.8 管的是 profile 的 `contextWindowTokens`，原样成立）；#116 有限组未知用量可显式按观测下界结算（`--acknowledge charge-observed-floor`，非自动）；#81 低频功能收进 More／「⋯」、member 不能增改项目；W4 #183／#173／#162／empty-result 说清楚；W5 组级验收每次检查独立 worktree（修了真竞态）；#252 两半（ccloop 半边由 G 轮 repin）。
- 坑：ccloop 改既有判据要人逐条点名（转述的一揽子授权不算）。

### 3.E 测试者反馈 E 轮的结论（会话 `e43cd52d`，2026-11-11；2026-11-12 会话 `d1cbbd58` 压成结论：其 repin 已被 F/G 轮取代、已由人推；过程按 §十 取回；设计 `docs/superpowers/specs/2026-11-11-tester-followup-e-design.md`，台账 `.superpowers/sdd/2026-11-11-tester-followup-e/progress.md`）

- 已落地：#241 组级验收（组分支末端跑 setup 并集＋必需检查并集，记在组 body `acceptance`，`orca group recheck|waive-acceptance`）；#245 合并后检查留证（`drive.postMergeCheck`）；转录按 attempt→阶段→seq 排、工具调用与结果合行、‹ › 分页；#242 #246 #250 #125 #251；编排 agent 可结算未知用量；不限额组显式 `task retry` 拿新额度（`fresh-start`）；D21 `orca project add`（owner）；#168；#256 #258 #257 #84 #200（lilac）；ccloop #249。
- 判过的：#246 设计如此；#247／#248／#259／#260 是测试者目标仓里 agent 生成代码的缺陷（G 轮复核成立）；#257 默认视图是 spec 定的。
- 坑：子 agent 把转述的一揽子授权当可疑输入（ccloop Rule 15 要人逐条点名）——转述时附原话出处；`cd $VAR` 被闸门判不能判定。

### 3.D 测试者反馈 D 轮的结论（会话 `f958ec3f`，2026-11-11；同上压缩；设计 `2026-11-11-cli-browser-login-design.md`、`2026-11-11-budget-defaults-and-reviewed-acceptance-design.md`）

- 已落地：#208 `orca auth login`（设备码、owner 浏览器批准、收取时铸 token；`orca login` 仍在）；预算 A 方案（不限额组里估算只作预期，服务端拒 `estimate-advisory-in-unlimited-group`）；`orca task accept-attempt`（#227，两段式、离线跑检查、CAS 落地）；拆分校验 #130 #135 #136；#164 #125 #183 #189 #149 #122 与一批 UI（每视图一个主按钮等）。
- 残余：accept-attempt 只收 `settled-failed`（exhausted 先 `close-run`）；#234 attempts 按 lineage 计（G 轮预算新模型接手）。
- 坑：hook 报的 `orca level` 是父会话的数（派活写明忽略）；worktree 跑门要 `ORCA_CCLOOP_BIN`；两分支各自重生成 CLI 文档时 rebase 后重跑 `gen:cli-docs`；新 verb 要进 `archiveGroup` CALLS、`accessMatrix`、`refusalCoverage`、`i18nPseudo`。

### 3.C 测试者反馈 C 轮的结论（会话 `29b4e843`，2026-11-11；2026-11-12 会话 `5abcad7d` 压成结论：其 repin 已被 #249 的 pin 取代、两份设计稿已在 D 轮落地（主题行 `feat(auth): CLI login requests an owner approves in the browser (#208)`、`feat(budget): an estimate's task work is an expectation in an unlimited group`）；过程按 §十 取回）

- 已落地：Live 区默认跟随在跑调用的转录（`fix(web): the Live region follows the running call's transcript without a press (#226)`；一个标签页只流式一份，follower 不从另一个 follower 抢）；续跑带 operator note（`feat(control): a continued task carries the operator's note (#226 ii)`：`continue-task`／`resume-from-handoff` 的 `operatorNote`，**不注入正在跑的 turn**——要干预就先 handoff-stop 再带 note 续跑；权限沿用 `any`）。
- 判过的：#235 不改（`safeToRetry:false` 是 ccloop 写的、重复失败不作阶梯跳过条件是 spec `2026-11-04-task-setup-and-check-retry-design.md` §4.7 明文）；#237 大概率是 magpie 转发 effort 的映射问题（推断、未复现，人裁先放下）。
- 坑：会话 scratchpad 每轮被换 ⇒ 长跑日志写固定路径；`test-affected` 跑完删自己的 JSON；agent 的 push 被 Tier 0 闸门拦，对话授权不解除。

### 3.B 测试者反馈 B 轮的结论（会话 `3153bf70`，2026-11-10；2026-11-11 会话 `e43cd52d` 压成结论，过程按 §十 取回；计划与裁定 R1–R6 在 `docs/superpowers/plans/2026-11-10-tester-followup-b.md`）

- 测试者判断有误、别照抄的：#230 不是死锁（`orca recovery retry --run <id>` 让 E 处 block 的 run 重走 E 不重付）；#229 不是并发竞态（driver 单线程，`artifact-id-conflict` 现带 `<id>:<check>`）；#235 不改顺序（R3）；#206 在 pin `73fff1a` 上已修；#231／#240 只有 CLI 踩；#241 前半是设计缺口 ⇒ R2（后半由 E 轮组级验收接手）。
- 已落地（主题行按 `git log --grep` 取）：T1 E 处瞬时错误在 `landed` 上重试 ≤3；T2 `retryFundingOf` 与 `retry-funding-below-attempt-cost` 资金下限；T3 CLI answer 补齐、`--unanswered`、`worker-window-unknown`／`threshold-above-window`；T4 `check-write-scope` 与 successCondition 附验收原文；T5 冻结 codex selector 失效 ⇒ `agent-selection-invalid`，`orca requirement set-agent`；T6 单仓落地合并树 ≠ attempt 树时跑合并后检查（R2，默认开；E 轮起留记录）；T7 执行条／依赖图通道／Live 区；T8 非当前 section 卸载（R1）；T9 repin 时 `test-affected` 只选点名 ccloop 的测试（R6）；T10 set-agent 的 Web 控件。
- 坑：带 `for`／子 shell／`cd $VAR` 的 git 命令会被 Tier 0 闸门判「不能判定」——拆成一条一条、用绝对路径；worktree 没有 `web/dist` 时 panel-socket 测试 `panel-dist-missing` 假红。

### 3.A 仍成立的结论（压缩自 2026-10-18 → 11-10 各轮；细节在所列 spec／plan／台账）

**人裁（不要重开；原话在所列台账或 git 历史里本文的原小节）**

- **#145／#160**（2026-11-08，会话 `fe1f3fa6`）：「保留现行为」——未估算任务带 `complex-1m-default`＋`tokens:null`（无限）仍可 confirm，只打提示；`tests/commands/unestimatedDefault.test.ts` 钉着。不要改成「必须先应用估算或人明确接受」。
- **#174**（同轮）：「接受软额度」——criteria-review 判官在源契约 token 上限为 null 时给有限 200k 工作授权（拍的常量、未校准、不是 soft provider 的硬上限），父组 summary 有可选 `criteriaReviews[]`、Board 对 failed／debugging 出提示；真实限费要另立设计。
- **agent 可设有限额**（同轮）：`orca group cap <g> --tokens <n>` 只能把 token 上限调低（`proposal-edit` 的 `capOnly` 窄形式；`set-limit` 与普通 `proposal-edit` 仍 human-only）；不提供绕过估算的路径；组要已有可编辑 proposal。`capOnly` 是 Orca 自己的 Web／CLI 认识的可选 wire 键，ccloop 不涉及。
- **close-run 权限档**（2026-11-07）：「暂时不用收窄」——Web member 与本机无 person token 的 socket 客户端都能关闭满足证据条件的 terminal run；这是产品选择，不是缺陷。
- **#209**（2026-11-10）：「不改判据，改产品」——worker 选到 codex catalog 未列的模型照常解析与确认，agent preview 该槽带可选 `warning`（`model-not-in-catalog: …`）。
- **#212**（2026-11-09）：保留 claim 时按 headroom 均分，不改冻结规则；只加显示——只读 `GET groups/<g>/funding-preview`，`proposal show`／`group confirm` 人类输出多一行 `task <t>: authored …; a claim now funds …`，`--json` 字节不变。
- **#210／#215**（2026-11-09，选 A）：ccloop 终态失败原因可带 `usageKnownZero:true`（只在观测为 0 时写）；Orca `settle-unknown-usage` 的 `release-known-zero` 只在「该事实＋累计用量 0＋封存 proof」时允许，否则 `known-zero-not-proved`。
- **#191**（2026-11-09）：「太复杂了，你按无法拿到测试者原始数据的前提来走」。
- **UI 信息架构**（2026-11-09）：「先按你的答案走」——侧栏 workspace switcher、Settings 只留身份＋链接、Import 用对话框、runs 表把转录与证据移进单 run 详情；已落地（主题行 `feat(web): one workspace switcher, import on demand, and run details that stay out of the table`）。这也是人 2026-11-05 对 #70 说的根因：「当前UI排版以及项目设置的位置不合理、不符合现代agent的通用习惯」。
- **#127／#138 方向**（2026-11-09，`docs/superpowers/specs/2026-11-08-omp-verdict-recovery-and-noop-undo-design.md` Correction 2）：独立 checks 只有**合同显式声明**时才可判完成；no-change undo 是结构化可验证证明，保留字串永不作数。
- **retry-task 追加额度**（2026-11-05）：「想要增加被授权的 agent 的能力，可以不止是人才允许。」⇒ 人随时可加；agent 在全局 `agentTopUpCap`（按组求和、只有人能设）内可加。
- **failover**（2026-11-05）：「如果是provider额度用完，且有备用provider，可以改provider并重试。」默认开（D1）；人或计划文件选的 agent 不换（D2）；三处偏离（复用 ccloop `quota`＋`detail`、休息不建表、顺序放 orchestration settings）人已「同意」。As built `docs/superpowers/plans/2026-11-05-quota-failover.md`。
- **阶梯与准备命令**（2026-11-04）：「希望在遇到一些非常明显问题的情况下，带着之前的问题，自动再试一次」「对，就是第一类」——阶梯只重试能修的；准备命令「自己推断。如果人愿意，也可以提前由人提供」——由拆分推 `setup`。
- **soft 模式**（2026-11-03）：「同意。我们之前的很多裁定在新的语义下可能有一些过期了，一些需要、可以修改。」D1–D6「允许没有下界也继续。新版本之前的不改没关系。」D4（已停住的不自动放行）不做。
- **overview**：「先 (a)，前后质量对比过了再 (b)」——(a) clarify 不带 `structure` 已做（付费对比 prompt token −44%、问题质量看不出损失）；(b) 未做。**flow D1 (a)**：flow 池保持有限，不默认 soft。
- **F6**：「同意给隔离测试特殊处理。」——`orca login`／`user add|passwd --password-stdin` 只对真实 `~/.orca` 以外的面板。前台 `orca panel` 不做 agents 表迁移（人裁）。
- **主题与下拉**：「霜白，深色，浅色，蔷薇，紫夜，暮色，余烬。这几个配色还行，其他可以删掉」——`THEME_PREFS`＝system／light／dark／frost／rose／violet／dusk／ember，被删 id 回落 `system`、「不加映射」；Radix Select「(a) 全量换」，项目选择器「换radix selector。但是不要合并成一个」；提问表单未选值 (a)：空触发器＋占位，不默认第一项。
- **署名**（2026-11-05）：「不要固定写 opus 5.5，应该按实际模型写或不写」。
- **I3**（2026-11-06）：只拒「已归档且没做完」的前置组（人问「归档时为什么要改其他组？」）。
- **测试者反馈轮规划**（2026-10-28）：#69／#70 不改、**不做跨调用 session 复用**、Board 不加批量／触摸／列／WebSocket（后来 #70 由上面的 UI 信息架构处理）。会话 `4ed8eb65`：Q4 Board 与项目选择器裁定不重开；Q5 #109 不重开，等 token 数据。#111「同意，等实际测试时再看是否有问题」。#64「基于问题本身看…怎样做是最优的」（设置分类改成顶部 tab）。H9「两种都要」（定时 flow 与定时 group，已落地）。
- **方向**：「现在是破坏性大改的最好时候…看如何做是全局最优的」（`goal.md` P1）；H6／H8／H10 写进 `goal.md` G12–G14；先做只读的实时转录＋边界干预，真正中途插话以后按能力逐家开放；flow `operatorNote`「放在 web 运行页里。orca cli 现阶段不用做」；flow 附件「(a)」（存储区绝对路径）。
- **2026-10-18 设计轮**（原话在各 spec §2）：纠正派给独立 debug agent（默认原 agent＋模型、必须新 session、人可换）；`undo.how` 人可选填、不填由机器写；合入才算关闭、**不加「等待合并」状态**；裸 run 目标延后；账本在目标仓 `.decisions/`、随落地提交走；过不了撤销检查的决定 task 照常完成、UI 显示「需要人确认」；Codex 阶段不带任何个人 skills／AGENTS.md／hooks／MCP，命令仍用真 HOME。

**产品与设计结论（按主题；出处是所列 spec／plan／台账）**

- **终态 run 与记账**：`orca group close-run <g> --run <r>` 是显式命令、不是自动巡检（自动版打红 20 条既有判据，台账 Ruling）；只收当前、最新、`blocked/C`、非成功的普通 work run，要原始 report、封存的 stop proof、完整已知用量、无未决 handoff；关闭只结束记账，不把失败 execute 变成可验证成果。仍未解决的未知用量 ⇒ close-run 直接拒 `run-closure-evidence:usage-unknown`（#207），先 `task settle-usage`。已停的 run 在被 over-grant 置 blocked 或暂停的组里也能结算（#213）。spec `2026-11-07-terminal-run-closure-design.md`，台账 `.superpowers/sdd/2026-11-07-terminal-run-closure/progress.md`。
- **追加额度**：`orca task retry --work <json>`（schema 23 表 `work_grant_top_ups`）只给可追加额度的分支，`finite-legacy` 直接拒（`retry-top-up-unsupported:finite-legacy`）；top-up 按它授予的量抬高冻结合同上限、再由资金 grant 封顶（`dispatchedPolicy`，判据 `retryTopUp.test.ts` T14），没有 top-up 的 run 派发字节不变。剩余额度低于本 lineage 每 attempt 平均花费时阶梯不自动重试（T2）。verify-only 的资金证明＝冻结原 grant＋已授权且排在新 run 前的 top-up（spec `2026-11-07-verify-only-work-top-up-design.md` Correction 2）。
- **已存结果恢复**：可恢复的来源只有带完整证据的种类——`execution-complete-before-verification-v1`（exhausted，但 execute 已完成、未进 verify；spec `2026-11-07-exhausted-attempt-recovery-design.md`）与 `ccloop-execution-without-final-v1`（OMP 干净退出但 final 严格解码失败：只凭已发布 attempt 重跑必需检查，**不带 execution／normalized hash、不重建答案、不写 decisions**）。`execution-format-failure-v1` 仍不可恢复；**历史上没有胶囊的 exhausted run 仍不可恢复**。门是来源种类、不是 outcome；不要放宽严格解码、不要伪造 normalized hash。跨仓验收 V10（verify-only）与 V11（#158）都在当时的 pin 提交上过过；那两个 `*.paired` 文件与 `npm run verify:saved-result` 已按人裁删除（2026-11-17 会话 `0e0846ae`「不留」：只能带旧 Orca／旧 ccloop build 跑，从无门设置），合成的 saved-result 判据仍在。prompt-mode codex 的 exhausted 来源由 ccloop `fix(control): a prompt-mode codex exhausted run keeps its completion source` 保留（已在当前 pin）。
- **no-change 完成与 undo**（#127／#138）：合同可选 `verification.commandChecksDecideGoal`（缺省不出现；仅 command verifier／单仓／无 setup）；C 处用 Git 量 attempt tree＝base tree 写证明，E 只在证明点名本 run 的 attempt 时写 acceptance；其余空结果仍是 D14 的 blocked。决策可声明 `undo.kind:"no-change"`，证明由控制器填并覆盖 agent 的值；量不到证明 ⇒ 仍 tier-0 交人。
- **估算**：指令 v3＝ledger 口径（input＋output＋cacheRead＋cacheWrite）；v4＝v3＋实测 framing 段（本机一次 plan 调用约 43,000 token，一个任务 framing 下限约 90,000），答案形状仍 v3、wire 不变。`fix(estimator): the instruction names the answer key the schema demands` 修掉了 v3／v4 一直让模型答 v2 键的问题（v3 字节因此变了）。估算超限只警告、不改组状态；不限 token 的组导入／接受不自动估算。
- **soft 模式**：组 `limit.tokens` 为 null 时，单次调用（clarify／split／估算）用量未知不停，按 ccloop 下界记账、标 `usageApproximate`（spec `2026-11-03-soft-mode-approximate-usage-design.md` §7）；loop run 由 `settle-approximate-usage` 每个 driver 轮自动按下界结算（行记在 `{client:"panel", principal:"orca-auto"}` 下，ccloop 收据按这两值认；spec `2026-11-06-soft-mode-loop-run-settlement-design.md` §6）。有限组、flow 调用照旧停（**2026-11-12 F 轮起**：有限组可由人或 agent 显式 `--acknowledge charge-observed-floor` 按下界结算，见 3.最新 W2）；flow 调用用量未知由 owner「按 grant 记账并重试」（spec `2026-11-01-flow-call-unknown-usage-settlement-design.md` §9 As built）。
- **failover 与额度探针**：run 以 ccloop `quota` 失败 ⇒ orca-auto 换顺序里下一个可用安装立即重试（`orca orchestration set --failover-order …`／`--failover-off`）；休息从已存 run 推（codex 报的重置时间，否则 15 分钟翻倍封顶 8 h，成功即解除；不另建到期唤醒，pump 每 5 s 重读休息）；休息结束且没被移走 ⇒ 每个安装一次 `quota-probe`（spec `2026-11-06-quota-rest-probe-retry-design.md` rev 2）。**单次调用与 flow 调用的改派未做**。
- **观测路径重试**（D1–D5，`docs/superpowers/{specs,plans}/2026-11-06-observed-path-retry*`）：`blocked_waiting_human` 不走原样阶梯；`orca task retry --allow-observed-paths` 结清旧 run、追加 ccloop 用 Git 实测报出的漏报路径（≤128 条）并记不可改写的合同版本。
- **任务准备命令**（spec `2026-11-04-task-setup-and-check-retry-design.md` §10、plan 文末 As built）：任务可带 `setup`；拆分看 manifests 推 setup、核 npm 命令存在；`setup-failed` 与「失败检查根本没跑起来」（exit 127/126、`command not found`、`Missing script:`）阶梯不重试；集成检查 setup 失败＝`errored`；已存结果恢复与多目录遇 setup 以 `setup-unsupported-here` 拒。Orca 跑的检查共用 `src/control/checkCommand.ts` 的 `runAsCheck`。
- **启动与槽位**（spec `2026-11-05-review-exit-over-grant-start-queue-design.md`）：组 `done` 由 pump 写；只有有活的组占槽（暂停、held、blocked 不占）；显式 start 满上限时排队 `queued-for-slot`；不限组的超额只记录不卡。人创建的不限 token 组自动确认（`autoConfirmUnlimitedPass`），自动确认即开跑（R2 D7）。
- **纠正 ⇒ debug task**（spec `2026-10-18-correction-debug-task-design.md` §12 与文末 Correction 优先）：「已关闭」只看目标 ref 的树里有没有关闭行（`correctionState.ts`），`alreadyCommitted` 排除 `refs/heads/orca/*`、`refs/orca/*`、`refs/ccloop/*`；没有原契约时打开 debug 可带 `checks`（与原契约取并集）；复现命令按 ccloop 跑检查的方式（`sh -lc`、继承环境）以 Orca 身份在 ccloop 沙箱外执行。
- **核实过的代码事实**（2026-10-18，引用前现测）：控制派活**只看显式 `dependsOn`**，落地是谁先做完谁先合；`undoHowIsExecutable` 是**词法**谓词（`git revert 3f9c2a1b7e` 判 false、`git revert --no-edit <40 位 sha>` 判 true）；`git log --all` 会命中 group 分支，**不能当「已合入」判据**。
- **流程引擎**（spec `2026-10-22-flow-engine-design.md` §25、`2026-10-22-flow-phase1-gaps-design.md` §21 as-built 优先）：`flow-start` 只接受已登记的 `dir` 项目、`--repo` 模式的面板起不了流程、流程子组不受判据保护；释放被扣住的对外／不可撤回效果在**每条路径**上都要人的权限（Web 上的 owner 或 socket 上 owner 的令牌，member 与派出的 run 一律拒）；`GET /flows/images`、`/flows/settings?dir=` 与附件上传拒派出的 run。
- **已落地的大块**（都已合入、装上；spec 在 `docs/superpowers/specs/`，as-built／Correction 节优先于正文）：CLI v2（`2026-10-21-cli-v2-design.md` §14–§16）、检查与触发器（`2026-10-22-checks-and-triggers-design.md`）、流程引擎第一期与缺口（见上）、实时转录（`2026-10-23-live-transcript-design.md` §12 Revision 3）、目录项目需求（`2026-10-24-dir-project-requirements-design.md`）、定时流程与计划库（`2026-10-24-scheduled-flows-and-groups-design.md`）、多目录项目 H7（`2026-10-24-multi-dir-projects-design.md`）、测试者第二轮 R2（`2026-10-24-tester-round2-design.md`）、kanban＋自动编排 S1–S5、系统 debug 组与阶梯 L1–L3、估算挂起（`2026-10-21-estimate-parking-design.md`）、澄清分档 #86（`2026-10-21-clarify-scope-caps-design.md`，旧需求按「大」档）、agent 版本自动刷新（遇 `agent-version-drift` 改表里 `version` 并重派一次）、单次调用未知用量结算 #62（`2026-10-27-single-call-unknown-usage-settlement-design.md` §9／§10）、恢复 CLI（`2026-10-28-recovery-cli-design.md` §4 优先）、拆分指令 v3（`2026-10-28-split-prompt-v3-design.md`）、socket 结算（`2026-10-29-socket-usage-settlement-design.md`，schema 21）、Radix Select 全量（`2026-10-29-radix-select-everywhere-design.md`）、测试范围与发版门（`2026-10-20-test-scope-and-release-gate-design.md`）、控制 run 写决定（`2026-10-18-control-run-decisions-design.md` §10 优先）、测试者第三轮（`2026-11-01-tester-round-3-design.md`）、loop 卡的文档检查计数（`2026-09-30-loop-plans-design.md` §16）。流程引擎的调研在 `docs/research/2026-10-21-flow-engine-research.md`、`docs/research/2026-10-21-flow-architecture-options.md`。
- **其余已落地、别重做**（按当时代码核过；issue 号见 `orca_archived_files/issue-20261023.md`，它在 2026-11-16 仍更新，**只按现读正文与本仓代码判状态**）：#157／#159／#164／#166／#167／#168／#169／#171／#172／#179／#180／#181／#182／#183／#184／#185／#186／#187／#188／#189／#190／#198／#199、#201／#205／#211／#213／#214／#222／#223、UI #216–#221、#62、#98–#104，以及更早各轮的 #2–#156 各项（按主题行 `git log --grep='#NNN'` 取；I1–I7 逐条状态在 `.superpowers/sdd/2026-11-05-session-3cfc2e73/issue-status.md`）。#63 的裁定（归档组 unavailable）只对「已归档的 criteria-review 判官」放行只读。
- **按事实判过、不是缺陷**：#112 根因不成立（pin 与本机都报 `transcripts:"v1"`）；#99／#110 不是缺陷；#105 在本机不适用（8 个 codex 模型都报 100 万窗口）；#165 已有精确提示；#92、#78、#200 是产品选择；#20／#24／#29／#38 判不改、#22 延后（会话 `7753e97d`）；#60 的「自动确认无限循环」从代码复现不出（每个提案版本只拒一次，C22c／C24 钉着）。
- **组间依赖边 v2**（会话 `8b1469ea`）：只定方向——计划文件可声明组依赖，agent 在确认时提议边、先连后标红——**暂不实施**。
- **需要先量再说**（旧数字在别的条件下测，同条件复测前不要当成当前故障去改）：#193／#196／#197（转录写放大、plan 成本、task 间不复用 session）、#194（OMP RSS）。#192：settle ≥5 s 时 stderr 打一行 `orca-driver: <runId>: settle took N ms (archive …, acceptance …, commit …), lane wait W ms`（`lane wait` 是会话 `ca534c51` 为 #332 加的：在共用结算车道上排队的时间；走车道的结算才有；慢阈值按「自身＋排队」算），慢在哪、要不要优化待真实数据（publish／cleanup 未计时；落地到入车道之间的间隔仍量不到）。
- **#191**：本机免费探针在隔离配置下出站 body 仅 7,384 B，真实 dogfood 的 clarify／split 各约 13.5k token，**复现不出约 232k 隐藏前缀**；不据此改 usage 账本。**#195**（草稿 `contextPolicy.handoffAtContextTokens:null` 在确认期的真实表现）要同配置 live 样本。
- **#170 按未定**：`stopIntent.ts` 有 `FROM outbox WHERE kind='handoff-request' AND delivered=0` 的读取，`OUTBOX_QUEUE_KINDS` 的归类由 `outboxKinds.test.ts` 源码扫描钉着；`src/` 里看不到生产调用方驱动 `deliverHandoffStop`，但未实测——**不要按分类改名了事**。
- **25 万 input 的来源**（`docs/superpowers/specs/2026-11-01-overview-token-cost-findings.md`）：每次澄清／拆分带整份仓库 overview，上限约 288 KiB（Orca 仓量出约 13.5 万 prompt token）；这没有单独证明 25 万，差的部分要测试者的数。

**诚实边界（仍为真）**

- 真 `quota-probe` 没有自然触发过；claude `limit reached|<unix>` 的重置时间解析无真样本；第三方 provider 的 `structuredOutput:"prompt"` 缺真实对应。
- OMP 的 exhausted 恢复与成功执行路径只有代码级支持，无真 OMP 回归。
- v4 的 43k／90k 来自同机两次观测，没有付费真跑验证它把估算抬到够用；`n=1` 的 4× 低估（估算 11,000 vs 实际 43,849，2026-11-09 codex `gpt-6-sol`）不能当全局常数。
- `drive.noChange.attempt === drive.attemptSha` 那段是纵深防御，没有独立变异能打红；离线读者只能校验 no-change 证明的形状，树相等要由有仓库的读者复核。
- `savedRecoveryAccounting` 调 `settlementReceipt` 这一步没有判据；flow 调用被 stop 关闭后再结算的那一路池子不计费（activity 记 `poolNotCharged`），没有判据。
- 三家（claude／codex／omp）都**不**遮蔽密钥、都能读工作区外绝对路径、都能在 `--add-dir` 目录里写（2026-10-24 会话 `ffec7b28` 付费实测）。
- 下列 UI 只在 jsdom／截图里测过，没在真面板真数据上看过：T7／T8／T10（见 §3.B）、D 轮与 E 轮的 UI（见 3.上一轮、3.最新）、UI 信息架构批、Radix 下拉、需求页筛选、标签 chip 与「正在保存」、转录自动打开、看板空状态、flow 运行页结算按钮、需求页「至少」提示、#113／#114／#115／#75／#77／#80／#87／#91。

**环境、做法与坑（来自已压缩各轮；§六 是更早的总表）**

- `orchestration.test.ts`「admits a debug group Orca opened itself」（`task-run-moved:ladder-source-superseded`）是**既有红**：历轮在未改动 main 的 clone 上同样红。其余负载形状见 `known-load-flakes.md`。
- 跑 `npm test` 用 `TMPDIR=/tmp`：长 `TMPDIR` 让 `control/proj-*/control.sock` 超 103 字节，曾一次造出近百条假红。
- 真 ccloop／配对判据的 `ORCA_CCLOOP_BIN` 用 ccloop 工作树或 pin 提交克隆的 `dist/cli.js`（npm 包没有 `tests/fixtures/*`，用它跑 `multiDirLandingD` 会造出 56 条假红）；配对夹具要求该二进制所在仓库的 HEAD＝`package.json` 的 pin。（saved-result 的配对验收文件已删，见 §3.A。）**跑真 ccloop 判据时不要同时 rebuild ccloop**（读到写了一半的 dist ⇒ `SyntaxError … does not provide an export`）。
- 根目录 `npm run typecheck` 不查 web：另跑 `cd web && npx tsc --noEmit -p tsconfig.json`。读 `npm test` 日志要看 typecheck 段（rc≠0 不一定是测试红）。
- `npm test --base <ref>` 会被 npm 吞掉 flag ⇒ `node scripts/test-affected.mjs --base=<ref>`。测试运行期间不要改源文件（会造出竞态红）。别同时开多个门（负载 100–400 时门失去判别力）。
- worktree 没有 `web/dist` 时 panel-socket 测试会 `panel-dist-missing` 假红（`ln -s <主仓>/web/dist web/dist`，或在 worktree 的 `web/` 里 `npx vite build`）；zsh 里多文件变量用 `${=files}` 或数组。
- Tier 0 闸门：一条 Bash 一个 git，用 `/usr/bin/git -C <绝对路径>`；`for`／子 shell／`cd $VAR`／`-C $VAR` 会被判「不能判定」拦下，被拦就停、不换写法重跑；被拒的复合命令里每一步都没执行。闸门不认聊天里的 push 授权；只认人在自己消息**开头**敲的 `allow-push`（2026-11-13 起，Rule 15、闸门 spec §12）。
- 控制模块 import 环上不加静态 import（会话 `3cfc2e73` 曾让 90 个文件加载失败；`known-load-flakes.md` 同会话节）。
- `dev checkpoint write`：要干净树；auto 模式审批会拦它（用会话转录当来源），要人加 Bash 允许规则或在终端跑；90 s 无输出不等于挂死（`runMeasurement` 把输出攒到命令结束才写）。
- 子 agent：报告有时送不到主会话，`SendMessage` 让它「重发、不做新工作」；它写不了 `.superpowers/sdd/` 下的报告文件；hook 报的 `orca level` 是父会话的数；单次 200 轮上限，长线分片落地。
- 真 codex 每跑一次会往人的 `~/.codex/config.toml` 追加 `[projects."<路径>"] trust_level="trusted"`（登记未修）⇒ 跑前备份、跑后按人裁删、逐字节核对。沙箱必须 export `CCLOOP_CACHE_DIR`（否则写真 `~/.cache/ccloop/agent-catalog`）；sqlite 打开源库一律 `file:<path>?mode=ro`（猜错路径会新建空库）。
- 「合并后重启 Claude Code 会话」只在钩子串变了时需要。auto 模式分类器会拦「经 agent 转达的人的批准」与改 agent 权限的命令，被拦就停、交人。沙箱里的 `ps`／`pgrep`／`launchctl` 看不全，判 ccmem daemon 活没活看锁行心跳；给人 `panel install` 命令前先读已存的 `service.json`。
- `orca doctor` 的 `agent-path` 跟调用者的 PATH 走（`agentPathDirs`，`src/service/config.ts`）：旧终端里 22.13.1 在前就报 fail，服务本身没坏——措辞问题，登记未修。
- 本机 `npm ci` 会卡在代理 ⇒ 杀掉加 `--fetch-timeout=60000 --fetch-retries=5`。ccloop 全套在本机负载下不能当门，红了先和未改动 main 交错单跑对比。
- 测试用 fake 安装表（`ORCA_AGENTS_TABLE`，写法看 `tests/control/fixtures/ccloopWorld.ts` 的 `agentsTable`）：每个 `command` 只指副本里的 fake；codex 用 `integration` 模式并带 marker（缺 marker 会在 cwd 写出 `undefined.argv`）；`version` 填 fake 自己对 `--version` 的回答（codex `9.9.9-fake`）；不要 export `GIT_AUTHOR_*`。误用真实 agent 表会让 `ccloopProtocol` 红（环境，不是 flake）。
- 人的 Chrome 有 Vimium，单键快捷键会被吞（除非站点被排除）。
- 装进 7777：`npm run build`＋`npm run build --workspace web`＋`launchctl kickstart -k gui/$(id -u)/dev.orca.panel`（或 `orca panel restart`）；锁文件变了先 `npm ci`；schema 要动先 `sqlite3 .backup`。重跑 `orca panel install` 用干净 env（不带会话里的 `ORCA_CCMEM_BIN`／`CCMEM_CONFIG_PATH`）。
- 性能基准：`ORCA_PERFORMANCE_ROOT=<空目录> npx tsx tests/bench/controlPollPerformance.ts --seed --expect-optimized --output <目录>`。
- 判据夹具里的检查命令要**真执行**检查文件：`checkPaths` 只把命令真正执行的路径算作检查文件（#198），`true src/check.ts` 不算、`node src/check.ts` 算。本机只有 `python3`（`python -c` 型检查必 127）。claude 拒写 `~/.claude` 下的 scratch ⇒ 放 `/private/tmp/<会话>/`。
- 每条人裁（包括「否掉某方案」）当场记进台账；漏记会让子 agent 拿旧版本写设计。
- 真 claude 报决定少而准、omp 全报 minor（会话 `3d229487`）。
- `correctionCoarseDebug` 的挂住已查清：Node 22.13.1 下 `execFileSync` 用 `input` 给 git 喂 16 KiB 偶发死锁；夹具已改路径参数＋60 s 超时。

**仓库外的写（Rule 17 记录；备份留不留归人，见 §八）**

- `~/.orca/profile.json` 的 `profile.estimatorPreflight.instructionVersion`：2 → 3（2026-11-07，备份 `.bak.1794052467224`）→ 4（2026-11-09 人授权，备份 `.bak.20261109-v4`）。
- `~/.orca/agents.json`：claude／codex 的 `command[0]` 改到 nvm 22.23.4、codex `version` 0.167.0（2026-11-07，备份目录 `~/.orca/backups/node-22.23.4-switch-1793982205000/`，内含 `codex-config.toml.before-paid-run`）；三个 `timeoutMs` 被 2 h 迁移改成 7200000（2026-10-31 一次事故，内容即人裁结果，原字节在标记文件 `<table>.bak-pre-2h-timeout`；迁移现在只在 `mode.service === true` 跑）；更早 claude 改 `bypassPermissions`（备份 `.bak-20261020`、`.bak-20261020-perm`）。ccmem daemon 的 plist 改指 22.23.4 的 claude（ccmem handoff）。
- 控制库升级前备份（`~/.orca/backups/`）：`schema14-cutover-1792329773353`、`schema15-cutover-1792586473769`、`pre-schema18-20261023-230314`、`pre-schema19-20261024-062118`、`pre-schema20-20261025-023827`、`pre-schema21-20261029-135742`、`schema22-cutover-1793909239424`、`schema23-cutover-1793941018824`、`2026-11-07-d2-o19/`、`pre-schema24-20261114/`（会话 `c8b75eac`）；另有迁移自留的 `control.sqlite.pre-v23-1794586642038`；另有 `~/.orca/control-bak-20261020` 与迁移自留在库旁的 `control.sqlite.pre-v*-*`。
- `~/.zshrc` 加了 `ORCA_CCMEM_BIN`（备份 `~/.zshrc.bak-20261023-orca`）；orca-control skill 经 syncskill 装上（备份 `~/.syncskill/config.json.bak-20261023-orca`）；`~/.claude/skills/tech-writer{,-deslop,-voice}` 软链改指 `/Users/biran/code/skills/skills/runskills/skills/*`；`~/.claude/skills/orca-control` 是指向仓内的软链（改仓即生效）。
- push 授权文件 `~/.orca/gate/push-grants/<session>.json`（0700／0600，由 `UserPromptSubmit` 钩子在人敲 `allow-push` 时写；会话 `c8b75eac` 起出现）。
- `~/.codex/config.toml` 的 trust 条目历次按人裁清理（备份 `.bak-o9-20261026`、`.bak-o9-20261026b`、`.bak-af2ceee1-20261104`、`.bak-af2ceee1-df2`）。

### 3.1 已经做成的（都在 Orca／ccloop main 上）

- **CLI**（CLI v2 Task 7 起，`src/commands/registry.ts`）：`orca decision validate|metrics|compact-reviews`、`orca plan preview`、`orca agent init|show|refresh`、`orca dev level|gate|checkpoint write|resume|chain start|stop|unlock|check-append-only|correct`，加 `panel／control／mcp serve／user`；旧顶层名到 Task 14 删除；**Task 7 之前分出的 worktree 过不了链的闸门检查（`src/chain/gateCheck.ts`），须重建或 rebase**；全局 `orca` shim（跑 `dist/`，pull 后先 `npm run build`；新 pin 后主仓先 `npm ci`）。**`orca run` 已退役**，跑一轮只走面板／控制路径。
- **面板服务**：`orca panel install|uninstall|start|stop|restart|status|logs`；整站登录（owner／member、CSRF）；`<stateDir>/control.sock` 给 agent（`orca control get|send`、`orca mcp serve`、`skills/orca-control/`）。重装服务只记录当前 shell 里具名的 `ORCA_*`，先 `--dry-run` 比 `service.json`。
- **执行链**：执行驱动（worktree／clone、落地 `orca/<group>`、解冲突 run、N 路并行落地）、handoff 投递与续跑（含交接停止＋未知用量的 `recovered` 出路，spec `2026-10-14-handoff-stop-unknown-usage-design.md`）、single-call 预估链、N1 澄清→拆分→确认、loop 方案层、合入方案（`local`／`push-target`／`push-branch`／`github-pr`）、花费上限、Results、Activity。
- **估算**：确定性修复＋一次自动重试＋指令 v2（spec `2026-10-17-estimate-usable-answer-design.md`；台账 `.superpowers/sdd/2026-10-17-estimate-usable-answer/`）。之后升到指令 v3（ledger 口径）与 v4（实测 framing），`~/.orca/profile.json` 现为 `instructionVersion: "4"`（2026-11-09，见 §3.A）。
- **agent kind**：claude、codex、omp；三种 skill 注入（claude `--plugin-dir`、codex `codexSkillsDir` 每 phase 临时链、omp `ompSkillsDir` 的 `<skills>` 清单，**OMP 永远 `--no-skills`／`--no-extensions`**）。single-call：claude `"v1"`、codex `"v1-soft"`（输出上限事后核对、只在 soft 估算模式接受）、omp 按目录行（方案 A＋按目录上限预占）。
- **ccloop 目录缓存**：`$CCLOOP_CACHE_DIR`（缺省 `~/.cache/ccloop`），键含二进制与配置 stamp、30 分钟、版本号也缓存；codex single call 在**每个安装键一对复用的私有 `HOME`／`CODEX_HOME`**（`<cache>/codex-home/<sha256>/`，链 `auth.json`／`config.toml`、从不删正规凭据，挪成 `.displaced-<ms>`）。模型清单 API 与 web datalist。
- **错误码**：ccloop 进程失败答 424 `ccloop-failed:<码>[: 细节]`（例外：`apply-agent-update` 仍 500）；「组在执行」单一判定（`src/control/executionPending.ts`），执行中 `start` 答 409 `group-execution-pending`。`set-task-loop` 在组 `running`／`review`／暂停时也能改**未开始**的任务。omp clarify／split 的上限拒绝不自动重试，人点 group 重试时按冻结的 `agentSlot.selection` 重算上限。web 统一经 `web/src/ccloopCodes.ts` 解释码（兜底文案不说「ccloop」）。
- **纠正 ⇒ debug task**（会话 `3d44b2fb`／`f3a75a90`，spec `2026-10-18-correction-debug-task-design.md`）：纠正开独立 debug group、复现优先检查、落地带关闭记录、「已关闭」＝目标 ref 的树里有关闭行、只限人的记录／人工关闭／撤回 verb、Decisions 页里的纠正列表。**付费端到端与推送类合入方案的关闭都没验过**。
- **Decisions 页撤回**：撤回自己的审阅／未关闭的纠正（spec `2026-10-18-decisions-review-withdraw-design.md` §10 优先）；撤回记录在 `reviews.jsonl` 的 `withdrawn` 行与 `~/.orca/correction-withdrawals.jsonl`。
- 控制库：**schema 24、单向**，真实 `~/.orca` 已迁到 24（2026-11-14 会话 `c8b75eac`，原始用量明细；23 是 2026-11-06 会话 `86352010`；各次升级前的备份清单见 §3.A「仓库外的写」；引用前现测）（切换与回退：`2026-10-12-live-service-cutover.md`）。Linux systemd 用户服务跑通过一次（两仓全量没在 Linux 跑过；`2026-10-12-followup-acceptance.md`）。

### 3.2 还不能说的（**诚实边界，原样保留**）

*** **「Web 派活可用」「claude 可用」「分层选择可用」「OMP 可用」都不是事实。** *** 能说的只有下面这些 **n＝1** 的跑通，各以所列台账为唯一可引表述：

| 什么在真 agent 下跑通过一次 | 时间／会话 | 唯一可引的表述 |
|---|---|---|
| 真 codex 单任务主链（gpt-6-luna，服务层不含 HTTP） | 2026-09-25 `af3dc0d3` | `.superpowers/sdd/2026-09-25-live-acceptance/progress.md` §5 |
| 真 claude 单任务主链（2.1.283、claude-opus-5-5） | 2026-09-27 `43e3e1d8` | `.superpowers/sdd/2026-09-26-agent-selection/progress.md` §14 |
| 真 claude 1M 窗口单任务；两任务一处冲突经 `ccloop run --agents` 解开 | 2026-09-27 `4d2e426e` | 同一台账 §20 |
| claude 阶段中止前的 stream 用量 | 2026-09-27 `5b01dbd9` | `.superpowers/sdd/2026-09-27-claude-stream-usage/progress.md` §3 |
| N1 澄清→拆分→确认→导出 | 2026-10-02 `b5e8d368` | `.superpowers/sdd/2026-10-02-requirement-to-split/progress.md` |
| 杀掉 ccloop → runner 自退 → `ccloop resume` 续跑 | 2026-10-02 `ece96b67`／`7fe6d61b` | ccloop 仓 crash-resume 台账末节 |
| 面板 HTTP 路径单任务（claude 2.1.288） | 2026-10-03 `16ab00f2` | `.superpowers/sdd/2026-10-03-panel-http-live/progress.md` |
| 带 syncskill 的 claude 单任务 | 2026-10-03 `9d95e6c8` | spec `2026-10-03-syncskill-integration-design.md` §12 |
| 真 Codex plan／execute／verify 落地（ccloop 本地修复构建） | 2026-10-12 | `docs/handoff/2026-10-12-followup-acceptance.md` |
| 真 OMP plan／execute／verify 落地 | 2026-10-12～13 | `docs/handoff/2026-10-12-oh-my-pi-acceptance.md` |
| 真 OMP single-call：clarify、split 通过；estimate 被判 `estimate-output-invalid` | 2026-10-15 `026d10e3` | `.superpowers/sdd/2026-10-15-omp-single-call-acceptance/progress.md` |
| 真 Codex single-call（不经 Orca）P1c／P1d 通过 | 2026-10-16 `a852f96a` | `.superpowers/sdd/2026-10-15-every-agent-requirement-chain/p1c-report.md`、`p1d-report.md` |
| 真 OMP 需求链（隔离世界）open／clarify／split 通过、estimate 冷 `ready` 热 invalid | 2026-10-16 `a852f96a` | 同目录 `p2-report.md` |
| 估算付费验收：omp ×5（4 首调 ready＋1 重试后 ready）、claude 1M ×1 ready；**codex 未测（额度）** | 2026-10-17 `d0843ec0` | `.superpowers/sdd/2026-10-17-estimate-usable-answer/paid-acceptance-report.md` |
| 真 claude `--scenario decision`（claude-opus-5-5）：1 条 major 决定落账 | 2026-10-21 `8b1469ea` | `.superpowers/sdd/2026-10-21-session-8b1469ea/progress.md` |
| 公众号流程沙箱验收后推草稿（第三次成功，人在草稿箱确认） | 2026-10-22 `b37f7ce9` | `.superpowers/sdd/2026-10-22-session-b37f7ce9/progress.md` |
| H7 多目录端到端（alpha 发布后驱动崩溃→重启回放→`partial`→`retry-rest`→三成员落地）：codex `gpt-6-luna`（`o9-codex-7`）、omp `local-litellm/deepseek-flash`（`o9-omp-5`）、claude（`o9-claude-2`，22/22）各一次 | 2026-10-26／27 `ffec7b28`／`7753e97d` | `.superpowers/sdd/2026-10-24-session-ffec7b28/progress.md`、`.superpowers/sdd/2026-10-27-session-7753e97d/progress.md` |
| omp 全链 open→clarify→consensus→跨目录 split→估算→开跑→崩溃→retry-rest→落地，20/20 checks | 2026-10-27 `3cd8fb02` | `.superpowers/sdd/2026-10-27-session-3cd8fb02/progress.md` |
| 付费自举（codex `gpt-6-luna`，Orca clone 当目标）：带 `setup:["npm ci"]` 的单 bug 组 1/1 落地 | 2026-11-05 `af2ceee1` | `.superpowers/sdd/2026-11-04-session-af2ceee1/progress.md` |
| codex 0.167.0 经 ccloop 跑一个 loop `succeeded`（`gpt-6-luna`，隔离 HOME／CODEX_HOME） | 2026-11-07 `b5e3c5a8` | 只在本文该会话原节（git 历史，§十） |
| CLI＋skill dogfood（Codex 0.167.0 `gpt-6-sol`）：clarify→split→accept→设额度→hold confirm→start→`done 1/1` | 2026-11-07（Codex 会话） | `.superpowers/sdd/2026-11-06-observed-path-retry/progress.md` |

**没在真 agent 下验过**：依赖、崩溃恢复、strict 组、真 codex 下的 handoff 与冲突、真 claude 的 single-call 估算、混 kind、带 skills 的 verifier／多任务、OMP 带 skills 的真 provider 跑、正式 owner 登录后的 Results／Memory、`push-*`／`github-pr` 合入。
（2026-11-11 注：「崩溃恢复」里只有上表 H7 那条「驱动崩溃→重启回放→partial→retry-rest」在三家真 agent 下各跑通一次；这一行其余各项未见新证据。）
**Codex 只支持 `phase-end`＋`soft`：任何地方不许宣称 strict token 封顶**；软 token 预算也不能说成严格金钱上限。

### 3.3 仍然成立的结论与残余（来自已压缩的各轮；全文在所列台账）

- ⚠️ **R7 已生效**：真实 profile 下 omp 与 claude-1M 的导入**真跑付费估算**；`framingTokenOverhead`＝12000（人裁），`contextWindowTokens` 仍 null（改它会让所有 kind 都真跑估算，归人）。
- **排队估算的 `withdrawn` 终态已实施**（会话 `3d229487`；spec `2026-10-17-estimate-usable-answer-design.md` 末尾 Correction 节）。停在开跑前（stopped pre-start）的组的排队估算已改为「挂起」（会话 `9ec98639`，spec `2026-10-21-estimate-parking-design.md`）。
- **Codex single call 残余**（spec `2026-10-15-every-agent-requirement-chain-design.md` **§11 优先于正文**）：refresh token 经软链轮换未验；keyring 存凭据时 fail closed；worker 的 `ccloop-agent-catalog:` 日志无生产 sink；一行提示的框架开销工具报 **10109–11590 token**（OMP 约 2047）；`notify=[]` 是否真挡住人的 notify 程序未量。
- **OMP**：omp 18.10.1 对 `127.0.0.1` 也走 `HTTP_PROXY`、启动时探测本地 ollama（fake 上游要吃掉意外请求）；**不把任何本机选择器设为默认**；一次验收是 pilot 不是可靠性。
- **谱系与用量**：`lineageWorkUsage()`（`src/control/usageSettlement.ts`）是谱系求和唯一规则；work 剩余为 null 只在三层上限都缺时出现；spawn 前中止 ⇒ `neverStarted` 记 0，目录行不可解析 ⇒ 用量 null。
- **Rule 17 事故遗留**：会话 `4de777f4` Task 7 往真 `~/.cache/ccloop/agent-catalog/` 写过路径，该删的只剩两项（§4.1）。**人用真面板时跑门**会让 Rule 17 守卫在文件级报红（面板写 `~/.orca/control/panel`），挑人不用面板时跑；门脚本的 `~/.cache/ccloop` 比对会被运行中的面板服务改写（服务按设计用真缓存）。
- ⚠️ `ORCA_CCLOOP_BIN` **不能**指 `node_modules/ccloop/dist/cli.js`（npm 包不带 `tests/fixtures`）⇒ 指一份 build 过的 ccloop `clone --local`。`taskResultPaired` 两条硬编码 `/private/tmp/…`，**不设变量也红**，是固定环境红。
- **repin 的做法**：只在装了真实 `node_modules` 的工作树里 `node scripts/pin-ccloop.mjs <40 位 sha>`（它会 `npm install`；**别在软链 `node_modules` 的树或主仓跑**），且只在人推了 ccloop 之后；必须用 npm 10 跑（原来实测的是 nvm Node 22.13.1 的 npm 10.9.2；2026-11-07 起 nvm default 22.23.4 带 npm 10.9.9，它下面锁文件是否同样只动 root 与 ccloop **未实测**，会话 `b5e3c5a8`）——npm 11 会重写锁文件里与本 pin 无关的 `peer` 标记，锁检查因此红；repin 门要拿那个 sha 的 ccloop build 作 `ORCA_CCLOOP_BIN` 跑 `verify:scheduler` 与真 ccloop 特性文件（JSON reporter 证明 passed 不是 skipped；会话 `3d229487` 的做法：`tests/scheduler`＋`grep -rl ORCA_CCLOOP_BIN tests` 的全部文件，再带 fake 表、`ORCA_CONTROL_VERIFY=1` 跑 `ccloopProtocol.integration`＋`webCcloopSmoke`）；全新 clone 跑门先 `npm run build --workspace web`。`ORCA_CCLOOP_BIN` **别指姊妹仓工作树的 `dist`**（不等于 pin，真 ccloop 文件会假红）。
- **Codex 隔离的付费教训**（P1／P1b，会话 `a852f96a`）：MCP 名单必须在**同一套隔离**下列（在真 `~/.codex` 下列出的名字给隔离配置下关闭项会让 codex 配置加载失败、零请求）；codex 的 `error` item 当诊断、不当失败；按已装 codex 的 `features list` 过滤要关的 flag。
- known-reds 名单只加了 `codexAdapter` outer watchdog；`verifySavedResult`「r1 command interruption…」已查清并在 ccloop 修掉（会话 `9ec98639`：macOS 对已退出未回收的进程组 `kill()` 回 EPERM）。
- **仓库外由 agent 经人授权改过的**（Rule 17 记录）：`~/.orca/agents.json`（备份 `~/.orca/backups/agents.json.bak.20261017`；claude／codex 保留 nvm 稳定路径，不用 cmux 临时 shim）、新建 `~/.orca/projects.json`（0600）、`~/.orca/profile.json`（备份 `profile.json.bak-20261017-v1`）；ccmem 的 `core.hooksPath` 已 unset；三仓 Qoder `post-commit`／`post-checkout` 钩子已备份后删除。
- 本机：`/opt/homebrew/bin/node` 坏（缺 libsimdjson）；nvm default 是 22.23.4（有 fts5；2026-11-07 起，会话 `b5e3c5a8` 现测；旧终端里 22.13.1 仍在 PATH 首位）；`/usr/local/bin/node` 是 24.13.0（正式服务用它）。真 Codex 用过 `gpt-6-luna`，2026-11-07 起也用过 `gpt-6-sol`（当时有额度；额度以付费前现核为准），每次付费先问人。

### 3.4 门（**历史观测，引用前现测**）

- 最近一次整条发版链（旧 `npm run verify`）exit 0 的记录仍是会话 `f3a75a90`（2026-10-19，观测提交＝历史锚点 `05a191c2`，`ORCA_CCLOOP_BIN`＝旧 pin `02cbacc` 的 build）：全量 4273 过／33 跳过／0 红，`~/.orca` 哈希不变。之后有过整套 `verify-suite`／`test:all`（如会话 `ffec7b28` 的 H7 与流程边界批，见其台账），但没有再跑整条链。**按人裁（`CLAUDE.md` Rule 18），下一次全量门在人说打 tag 之前**，用 `ORCA_RELEASE_TAG=<tag> npm run verify`。
- 各轮 `npm test` 的计数只对它当时的树成立，2026-11-11 已从本文删去（在各轮台账与 git 历史里）；最近一次见 3.最新「门」条。flake 判别在 `known-load-flakes.md`。

---

## 四、⛔ 下一件事（按顺序）

### 4.0 接手顺序（2026-11-26，Batch 71；现状以 §3.最新与各仓 `/usr/bin/git ls-remote` 为准）

1. **#505 优先收测试者的大库 dry-run**。`/usr/bin/time -p orca gc --include-artifacts --older-than 0 --json` 默认只读。回传 Orca 版本、退出码、耗时、`.body.artifacts` 的 planned 数量、`bytes`、`heldBytes`、`skippedByReason` 和 `scan`。生产 `--apply` 另行批准。#478 同 attempt 的付费验收已通过，证据见 Batch 69。
2. **待部署与设计**：核对生产面板 pin。ccmem 先在副本演练 schema 021 和回退，生产 stop → migrate → start 另行授权。#498/#508 的验收策略、#501 的结构化交付图和 #497 的 CLI 读取性能留后续。另有本地日志中曾出现的 API 密钥需由持有人轮换。#445 阈值、基线 #466 和 syncskill `agents` 目标已获确认并实施。
3. **登记的余项**（不急）：#478 的 A2 拦截 lineage 与 `task continue` 扣减；#468 大 store 上的阻塞时长（请测试者在其 5 GB store 上给 dry run 计时、看 `--apply` 时面板卡多久）；#469 handoff 停止 run 的降级；#470 spec §2.2（被删项目的组在 `group show` 里标 `project.removed`）；syncskill `npm ci` 的 lock 不同步；ccmem `daemon status | head` 的 EPIPE。
   **Batch 71 新登记**：#513 的「auto-continue 只在 task 能资助一次尝试时置 ready」与「自动 top-up policy」待人裁；#497 的 `status` 轻量健康端点；#501 的 "AFTER both" 边覆盖（可能要做成结构化 expectation）；#498+#508 需 brainstorm + spec（review-fix 改既有测试、acceptance 已知 flaky）；#493 余项（链接的 config.toml 与 Orca「run 不加载记忆」文案）。
4. **残留（归人，命令见本会话最终汇报）**：`.wt-repin-465`（worktree，需 `--force`）、`.wt-466-mut`、`.wt-launchd-mut`、`.wt-ss-462-mut`、`.wt-ccloop-f8d368e`、`.wt-final-ccloop-pin`、`.wt-ccloop-276114a`（**已被 `.wt-ccloop-305dad1` 取代，可删**）、本会话的 `.wt-470-mut`、`.wt-batchA-mut`、`.wt-469-mut`、`.wt-478o-mut`、`.wt-478o-orig`、`.wt-478-ab-main`、`.wt-478-ab-br`，以及 `.wt-*.log`。`.wt-ccloop-305dad1` 是 Batch 69 的历史构建，当前配对测试按本仓实际 pin 选择。
5. **沿用的结论**：跑门前 `launchctl bootout gui/501/dev.orca.panel`，跑完 `launchctl bootstrap gui/501 ~/Library/LaunchAgents/dev.orca.panel.plist`＋`orca panel restart`；`TMPDIR=/tmp`；`ORCA_CCLOOP_BIN` 指向与当前 pin 代码一致且含 tests 的 ccloop 构建，使用前核对 `dist/build-info.json`；load 高时超时红先单跑三次、再和未改动 main 对照；本机 `cp`/`rm` 是 `-i` 别名；**子 agent 用 node_modules 软链时，ccmem／ccloop／syncskill 的 `.gitignore` 只写了 `node_modules/`（syncskill 已补裸名），提交前必须看 `git status`**；session scratchpad 由多个子 agent 共用，日志要放各自子目录；repin 用 §3.最新「repin 的坑」那组环境变量。

### 4.1 人保留的操作与授权边界

- **push** 由人择时做，或人在消息开头授权且闸门识别后由 agent 做；`365ff5f9` 那轮的拒绝只限那次会话，本轮人的 `allow-push` 已被闸门识别，Orca 普通 main push 成功。授权不跨会话；远端一律以 `/usr/bin/git ls-remote` 现测（本文不写当前哈希）。
- **审与裁**：见 §八「待人审的控制器裁定」。
- 已办（会话 `ffec7b28`，人授权）：`~/.orca/control/flow-attachments` 的 5 个测试残留已删；`~/.cache/ccloop/agent-catalog` 只删了能归到 0e13a9b7 沙箱时段的两条缓存行（`codex-home/` 与其余行保留）。
- `~/.syncskill/config.json` 的 `runskills`、`aifusion` 本地源仍指已搬走的路径（人的文件未动）；ccmem embedding 账号无额度；想开「纠正写回 ccmem」用面板 flag `--ccmem-corrections`。

### 4.2 agent 的活

旧 §4.2（会话 `ffec7b28` 收尾时的建议顺序）各条都已做完（各轮合入、装上，见 §3.A「其余已落地」）；还没做的已并入 §4.0 第 4、5 条。付费验收（每次先问人）的候选在 §八。

## 五、已经拍板过的事（**不要重开**）

### 5.1 语言与记法

- **对话与 `docs/handoff/**` 用中文；代码、注释、CLI help、README、commit message、新建的 SDD 台账／spec／plan 一律英文**（人 2026-09-29 收窄）。已有的中文台账／spec／plan 不翻译，追加更正保持原语言。
- **handoff 不是给人读的** —— 人读对话里的摘要。本文不写 HEAD、不写「领先几笔」；唯一例外是标明了的**观测锚点**。
- 计划里的 `- [ ]` 照勾；改某个 Task 的内容才要另起具名更正。**skill 与 `CLAUDE.md` 冲突 ⇒ `CLAUDE.md` 优先；计划与 spec 冲突 ⇒ spec 优先。**
- **Orca 在 ccloop／ccmem 的 handoff 里只保留一节，就地滚动，不新增编号章节**（人 2026-09-02）。

### 5.2 系统设计

1. **方向不重开**（人 2026-09-19）：Orca 控制 ccloop，agent 适配留在 ccloop；Web 是人的主要入口（Web > CLI）；ccmem 是决策记忆系统。长期 agent 优先级 Claude Code > Codex CLI > OpenCode > oh-my-pi > pi。G1–G6 全文在 `goal.md` §8（引用引编号）。
2. **权限模型**：Tier 0 机制禁止／Tier 1 自决留痕／Tier 2 不记录；`undo.how` 说不清 ⇒ 降级 Tier 0。**人裁的触发条件是「两个事实打架且能摆出两边」**，不是「agent 不确定」。
3. **台账**：git 为真相源＋DB 做索引；每个 agent 只写 `.decisions/<run-id>.jsonl`（⚠️ 2026-10-18 的决定 spec 改为 **agent 在结果里报、由 Orca 写**，agent 不直接写账本）；不存 commit hash——**已收窄**（人 2026-10-18 会话 `1710772d` 同意：Orca 落地时写的不动 sha `attemptSha` 可进 `evidence` 与生成的 `undo.how`，agent 自填 hash 仍禁；台账 spec ERRATUM 8）；按做决策那轮的 run id 署名。**`overturned` 不许 agent 写**（要 `correctionId`，correction 是人的日志）。对照样本由 decision＋correction 拼出。`projectKey`＋`decisionId` 联合键；⚠️ Orca 抄了一份 `normalizeRemoteUrl`，**改任一侧要双方核对**。
4. **依赖**：ccloop 走 npm GitHub 依赖（`github:blrbiran/ccloop#<commit>`，只用 `scripts/pin-ccloop.mjs` 重钉，**且只在人推了 ccloop 之后**——npm 装不到 GitHub 没有的东西）；`ORCA_CCLOOP_BIN` 只是本地覆盖。ccmem 不 vendor；都不用 submodule。`CLAUDE.md` ≤ 200 行（verify 断言）。
5. **并行**：写集＝`targetPaths ∪ allowlistPaths`，相交 ⇒ 串行；但冲突检测／分类／解决／验证才是主干，写集判据只是优化。解冲突的不能是当事任务本身。合并进集成分支＝Tier 1，进 main／push＝Tier 0。
6. **面板**：后端 express、前端 React；~~六个分区始终挂载，非当前区只由 CSS 隐藏~~ **已被人裁 R1（#219，2026-11-10「同意改裁定」）取代：非当前分区与 Settings 分类卸载**（`Shell.tsx` 只渲染当前区；`web/DESIGN.md` 已更正）；组详情只渲染当前 region 的内容，其余是空的 `hidden` marker（`web/DESIGN.md` §Layout、`web/src/GroupDetailRegions.tsx`；2026-11-12 更正）；有副作用的分区按「第一次激活」才请求。`orca panel` 的 ready 行一个字节都不能改（`verify-panel.ts` 正则、`endToEnd`、`controlShutdown` 都钉着），给人看的提示写 stderr。深色 token 被 `web/tests/contrast.test.ts` 按 WCAG 比值钉着，**别往暗里调**。kind 重要性只是 UI 序（`web/src/kindRank.ts`）。**改 UI 先读 `web/DESIGN.md`**（2026-10-14 精修两轮的规则本）：颜色只由 `data-tone="info|ok|warn|danger"` 给（role 只管语义，无 tone 的 `role=alert` 仍红）；只有 `.btn-primary` 填色、每个视图一个主按钮；字号 14/18/22；浅色暖纸被 `lightTheme.test.ts` 钉、深色中性石墨被 `contrast.test.ts` 钉。导航红点只对真告警亮：「无执行端口」是琥珀 note，连它引出的 agents 读 422 也不算面板告警；info 色的 `refetchRequired` 也不点红点（提交 `fix(web): stop a projection refetch from lighting the red tasks dot`）；唯一已知例外：每次加载头 3–5 s 闪一下红色「server reset required」（首次 summary 读按规格就是 resetRequired；人在会话 fb98aa31 裁定保留规格行为）。
7. **控制面**：读视图排序用 `compareText`（code unit），**不用 `localeCompare`**；会持久化或进哈希的排序不动。不带 `sinceChangeSeq` 的 summary 恒回`resetRequired:true` 是规格，前端对「自己要的完整重读」不 purge。
8. **Orca 不许自造对端观测**；跨仓的空值／词表语义修在**产生观测的那一端**（ccloop）。`ContextObservationV1` 在 Orca 无生产者 ⇒ 真 ccloop 下`contextWindowTokens:null`，预估是 `estimate-blocked-capability`（人裁：等 ccloop 能实时观测上下文时加显式关闭值，不放宽 `null`）。G1：`targetVersion` 是正安全整数，写字符串的 plan 被 `loadPlan` 以 `malformed` 拒，不做静默转换；`handoffControl:"durable"`、`handoffExecution:"mechanical-in-run-v1"`；旧的 `durableAccept`／`ownershipIsolation`／`evidenceRetention` 是删掉的，不是迁到别的字段。
9. **预算**：`--task-tokens` 是一个任务全部阶段／尝试／续跑的**累计**上限，实际工作设 ≥1,000,000；估算 grant 是常量 `ESTIMATE_GRANT`（250k／900 s）。⚠️ Web 派活在 `blocked-capability` 时给每个任务 `complex-1m-default`（3M token、3 attempts、4 h）并覆盖 contract ⇒ **真钱跑前先 `proposal-edit` 封顶，并在 ccloop 实际收到的 `loop-contract.json` 里核**。花费上限命令只进命令台账；对账花费记 `unattributed`；`POST /api/chains` 不受花费上限约束（政策问题，未改）。
10. **skills**：只对带 skill 集的 claude run 去掉 `--disable-slash-commands`；skill 集声明在 loop 方案上、不进 ccloop 合约；profile 在 confirm 时冻结；已确认任务上声明没变就沿用冻结名单、不起 syncskill；agent kind 取自 ccloop `listAgents`，在 confirm／set-task-loop 就拒不支持的 kind。三个 skill 字段（plugin／codex／omp）互斥。**OMP 永远带 `--no-skills`／`--no-extensions`**：开 OMP 自己的发现会加载操作者机器上的任意 skill，run 不可复现。claude 下 plugin skill 以 `orca-run-skills:<名>` 出现，提示词要点名 skill 就得用这个带前缀的名字。
11. **OMP**：作为可选安装进 detect、精确模型解析、受保护 preview/apply、面板选择；模型从每台机器的 OMP 配置探测，**不把任何本机选择器（如 `local-litellm/…`）设为默认**。Git 忽略文件与主机侧写入不在 changed-path 检查内 ⇒ **不是沙箱**；一次验收是 pilot，不是可靠性。**OMP single-call（estimate／clarify／split）**：旧结论「OMP 没有逐次输出上限、会自动重试 ⇒ `singleCallExecution` 保持 null」已被人 2026-10-14 选定的方案 A＋Orca 按目录上限预占取代（选项调研 `docs/superpowers/specs/2026-10-14-omp-single-call-options.md`，设计 `…-omp-single-call-design.md` §1）：**不建计量代理**（很多人的 omp 直连 https provider，正向代理拒 `CONNECT` 会全挂）；上限与窗口**信 `omp models --json` 所选行**（含 omp 自己编的默认值，人知情）；spawn 前复核、叠加配置关掉重试／回退；omp 只服务 soft 模式。实现见 §3.3c（已在 main）。
12. **合入方案**：仓库默认＋组拷贝＋确认即批准；方法只有 `merge`／`squash`；冲突经 owner 批准后派 agent 解。改密码成功作废该用户全部会话。
13. **Results／保存成果**：按真实 owner／attempt／revision 展示；可选 token 的 `null` 只表示上限无限，不表示用量为零；保存验证只跑新的 check／verifier、只记新用量，不改写原失败与历史；旧 archive 缺真实发布命名空间 ref 时明确不可用，**不能从当前仓伪造历史证据或批准**；缺 marker／ready／worker 不证明零用量或自动执行授权。
14. **D-launch（`orca chain`）**：外部监督进程；`--goal` 必填；四条硬上限；停链＝当前会话跑完再停；闸门被改即停；拒绝嵌套；`--max-budget-usd` 是**软上限**。

### 5.3 边界

- *** **push 由人做，或人在消息开头敲 `allow-push` 后由 agent 做**（人统一择时推，agent 不提醒；2026-11-13 起，闸门 spec §12）。*** 自 `feat(gate): let agents do the forms git protects; …` 起，agent 在 Orca 里可以 `git merge --ff-only`（含进 main）、`git branch -d`、不带 force 的 `git worktree remove`；强制形式（`-D`、`-d -f`、`remove --force`、`prune`、非 ff 合入 main、`gh pr merge`）仍被闸门拦（CLAUDE.md Rule 15，闸门 spec §11）。ccloop／ccmem 已对齐同一组形式（会话 `1710772d`）。
- **操作原则**（`goal.md` §1.1、§1.2，人 2026-10-18）：agent 能做的替人做、人少填、保留改默认值；所有动作在 Web UI 能完成、agent 通路能走完，不依赖命令行。
- **本仓库的规则不外溢**到 ccloop／ccmem／syncskill；对姊妹仓**先报再动、守它们自己的规则**（人 2026-09-03「需要时允许改」），push 仍每次单独授权。ccloop 改既有判据要人**逐条点名**（ccloop 人裁 88／Rule 15）——「按你的建议办」不是改判据的授权。
- **Rule 17**：写仓库外（`~/.orca`）的判据必须改道；新建目录 0700、文件 0600 显式给；已存在的文件不改 mode。仓库外路径的缺省值一律从**传入的 env** 推，不用 `os.homedir()`。
- 付费 claude、真 codex、真 provider、删用户数据、杀非己进程：**每一次都要人重新开口**；授权不跨会话延续。

---

## 六、坑（**每一条都真栽过**；出处在 git 历史，见 §十）

### 6.1 「绿」为什么会是空的

*** **一条判据在被【看到】打红之前，它不是判据。** *** 已知的独立形状（不要合并它们）：
1. 判据本身空（断言 `status >= 400`，POST 的根本不是路由，404 照绿）。
2. 守卫冗余：旁边还有一道 ⇒ 写变异表先问「这个分支是不是【唯一】挡住它的东西」，钉不住就**登记为冗余守卫，不编假判据**。
3. 从错的地方看（按事件名选 schema 的路上 literal 不可观测）⇒ 有办法看见就不许登记成看不见。
4. 链式依赖证明不了一行路由承重 ⇒ 要一个只有那一行会挡住的对象。
5. 判据拿代码和自己比（断言 == 被测代码里的常量）⇒ 钉字面量。**期望值一律写字面量**，不由被测函数算。
6. 中间隔着一条先炸的断言 ⇒ 用**故障注入**，不是删除式变异。**「红在哪条断言」不可靠，要量什么就直接量什么。**
7. 一个变量同时「被判断」又「被展示」：任一端的规范化会静默解除另一端的守卫 ⇒ 拆成两个变量；判别法：删掉新守卫，看行为变不变。
8. 一个守卫可以被它前面的 schema 完全遮蔽 ⇒ 变异打承重的那一处（schema literal）。「对生产对端恒真」≠「无判据覆盖」，中间隔着夹具。
- 涉及时钟的判据只断言「拒绝了」一定空 ⇒ 断言**哪个时钟被问了**。形状断言旁边要有**值**断言。只断言 verdict 不断言理由的看不见整支变异。
- 「什么都没发生」没法轮询到完成 ⇒ 观测有界窗口；立刻读「0」对异步写入稳定假绿（vitest 里 fire-and-forget 写约 500 ms 才落盘）。
- 排在被测调用【之前】、读回测试自己刚写的值的断言，永远不可能红。RED 阶段就绿的判据几乎一定是空的。
- 夹具对所有输入答同一常量会让「张冠李戴」不可见；夹具默认值要两个方向都量（删闸门见红、翻转默认值见红）；夹具要覆盖**默认路径**。
- fake 只认形状，不认真 API 的约束（fake claude 不校验 `--json-schema`）⇒ 交给真 CLI 的参数至少一条判据直接读 runner 实际传了什么；真付费跑前先让 tee 留原始回包。

### 6.2 变异怎么做才算证据

- **变异只在 `git clone --local` 副本里做**，主工作树全程零触碰（不许 `stash`／`reset`／`checkout`）；还原证明看 `git diff` 与 `git diff --cached` 的**字节数**。副本只克隆**已提交**状态；副本无 `node_modules`（软链主树，删副本前 `/bin/rm -f` 软链本身）；副本里跑 spawn 场景要带 `ORCA_CCLOOP_BIN`。
- 变异落没落上去用 `shasum -a 256` 前后比；每组变异先跑出一次**绿基线**；靠崩溃（`no tests`、模块加载失败）变红不是证据。
- 表齐 ≠ 覆盖齐：每个 `finally`／失败路径也点名变异；变异表带「喂它的场景」一列；改构建配置的变异要量**产物**。
- 「零杀伤」只相对于跑过的文件范围成立 ⇒ 判「无覆盖」前在全套上跑一次。跨 Task 的红证要两个 Task 都落地后**真的重跑一次**。
- 变异会留孤儿进程 ⇒ 前后各 `pgrep -fl "ccloop-agents-version|worker.js"`，杀进程要人授权。变异运行器自己会坏 ⇒ 先喂坏输入自检。
- Tier 0 闸门在 clone 里也拦 `git pull`／`merge`／`reset`／`restore`／`checkout`／`clean`／`worktree remove` ⇒ 要新版本就重新 clone；还原用 `cat 原文件 > 目标`；合并预演用只读 `git merge-tree --write-tree`。被当作 `ORCA_CCLOOP_BIN` 的 clone 不许同时做变异。
- 写实现与验变异不能是同一个上下文。改写既有判据的注释要写「这条现在编码什么」，复审对可疑改写跑 BASE vs HEAD 同一变异。验收改写类提交时扫 diff 里被删的注释行：已发布的只许追加（ERRATUM），不许替换。

### 6.3 预言「红在哪」

防假（脑内跑到底，X 之前有没有别的断言先炸）、防不全（被删的那一行还有谁在走；写「红在 X 且仅 X」，不留「至少」）、防同名（点名断言里的字面量从哪个字段来）。
**普查写成命令，不靠脑补。** 条件预言（「若…也会红」）要量；「冗余守卫」的预言两个方向都会错。

### 6.4 spec／计划／评审／派席

- 凡是够不着的动作只能**检测＋降级**，不能声称禁止。多子句谓词每一支要有独占判据。「照抄 X」是可现测的断言；措施对 ≠ 理由对，分别验。
- 同一轮的修法会互相拆台 ⇒ 修完一批两两对撞；评审修法本身；评审员的修法与顺带论断都要现测，**不照抄评审员的数字**。
- 计划正文里的 shell 自审看不见：未赋值变量用 `"${VAR:?msg}"`；`<占位符>` 会被当重定向。计划代码块会 import 未来、调用不存在的 helper、用不存在的 API ⇒ 开工逐个现核。
- 扫描器要有**必抓**与**必不抓**两组样本；恒命中全部行与恒返回 0 一样没用（`grep` 配 NUL 会截断模式）；扫控制字节用 python 读字节；扫描词要覆盖语料的语言（中文活文档）。
- 改线上 schema 的轮次，收尾要在最终树上跑**被改代码的整个镜像目录**（不是逐文件挑），改哪个仓就在那个仓跑。⚠️ 全量门只在人说打 tag 前（`CLAUDE.md` Rule 18，人裁 2026-10-19／20；本条旧文「收尾全量门不能省」被它取代，会话 `3831d12f`）。
- 跨模块新流程至少一席复审＋一席终审；**别跳过全分支终审**——它找的全在任务之间的缝上（「两条合理设计叠出死路」分开审看不见）。
- 子代理：会动主树（stash、临时撤文件）、会杀进程、会试 amend、会替人署名、会把自己的模型写进 `Co-Authored-By`、会自扩范围（无上限轮询）、报告的计数／行号／「跑过变异」会错 ⇒ 派发里写死禁令、提交消息用 `git commit -F` 给全文、收货时核原始日志、`git status` 与 `git log -1 --format=%B`。子代理写不了报告文件，让它放在最终消息里。API 周额度会中途打断子代理（429）⇒ 先现核两仓状态，零改动就原样重派。
- 给人建议前，理由里的每个事实都现核；给人审的清单要落盘、带编号、计数可复算；erratum 里不写计数，点名。
- 成本形状（只抄工具报数）：单席 60k–850k token；一个 Task 三到五席；SDD 一轮约 40 席；历轮钩子报 $60–$277。控制器做 2–3 个 Task 就该交接。大动作前先跟人报工具给出的预估。

### 6.5 文档与「写下即过期」

- 「本文未发布」「现测 X 不存在」写下那一刻就开始过期 ⇒ 引用前去来源现看。改任何文档前先 `ls-remote`＋`merge-base --is-ancestor` 判发布，检查失败即停写。
- 「已就地更正」「已修」也是预言 ⇒ 引用前去被修的那一行看。「顶层找不到」不是「已离开」：据缺席移走／删除人的数据要正向证据。
- 🔴 **压缩活文档最常见的错是丢结论** ⇒ 写完整节替换，必须把 `git diff` 的 `-` 行单独抽出来逐条过一遍（不是可选项）。撤回一条规则要 grep 全文逐处改。
- markdown 表格中间插内容会切断表 ⇒ 改表后整份读回。注释里写「会答 500」之前先量。

### 6.6 工具骗法

- **rtk**：`git status --porcelain` 空时打印 `ok`（`| wc -c` 下 rtk 报 2、`/usr/bin/git` 报 0）；`git diff | wc -c` 把 0 报成 1；长 `grep` 截断成 `[+N more]`；含括号的正则报错；`rtk proxy git log` 会漏 HEAD 那一笔；目录列表漏 `dist/`；**`grep` 会静默漏行且不提示**（1 行 vs 实际 5 行）。⇒ *** **验证性 git 一律 `/usr/bin/git`；目录列表与计数一律 `rtk proxy`／python＋重定向＋整份读回。派给子代理的 brief 里也写明。** ***
- **git**：`git checkout -- <file>` 从索引恢复不是 HEAD；`git diff` 看不见未跟踪文件 ⇒ `shasum`；`git add <已跟踪> <被 ignore>` 加一半且非 0 退出 ⇒ **`.superpowers/sdd/**` 必须单独 `git add -f`**；`rev-parse --absolute-git-dir` 返回 realpath（`/tmp`→`/private/tmp`）；监督进程的 git 一律`-c core.hooksPath=/dev/null -c core.fsmonitor=false`；`core.hooksPath` 是本地 config，由 `npm prepare` 装、`verify` 断言；`orca checkpoint write` 要求干净树。
- **shell**：zsh 吃掉无引号 glob、对无引号变量不分词（`kill $pids` 一个都没杀）⇒ 后台进程写成 bash 脚本＋数组，结束逐个 `ps -p`；管道与复合命令吞退出码；shell 状态不跨 Bash 调用；**本机 `rm`／`cp` 有 `-i` alias ⇒ 一律 `/bin/rm -rf` 与 `cat 原件 > 目标`**；`rm -rf $(…)` 被安全检查拦，先打印再删字面路径；macOS 没有 `timeout(1)`；后台任务通知报的退出码是最后一条命令的，真 RC 写进日志再读。
- **字节**：工具调用里写 NUL 类转义会落成裸字节（git 判二进制，评审包只剩 `Binary files differ`）；写文件工具会把 NFD 规范成 NFC、把 `\u` 转义换成字面字符⇒ 这类源码用 python 写并按字节核。读人的配置只打印需要的键，**不打印 `env`**。
- **Claude Code 钩子**：子代理工具调用的钩子 stdin 里 `session_id`／`transcript_path`／`cwd` 都是父会话的，只有 `agent_id`／`agent_type` 能区分；PreToolUse `exit 2` 拦父子代理，钩子出错／超时则放行；`deny` 看得穿 `&&`、看不穿 `sh -c`。transcript 的 `message.model` 分不出 1M。
- **SQLite**：`mode=ro` 仍会改 `-shm` 的 mtime，不是零触碰证明。真实库只用 backup API／`VACUUM INTO` 做副本再动。

### 6.7 测试与构建

- 全新 clone／worktree 跑 `tests/panel` 前先 `npm run build --workspace web`，否则 `panel-dist-missing` 假红；改了 web 要重 build 再重起面板（旧进程服务旧 `web/dist`）。
- *** **worktree 的软链 `node_modules` 永远不要 `git add -A`。** *** 并行时收工前看一眼 `git status`（后台进程曾往工作树写重复行）。
- 🔴 *** **软链着主仓 `node_modules` 的 worktree 里绝不能跑 `npm ci`：它会穿过软链清空主仓的 `node_modules`**（会话 `3ea8a21e` 实测：主仓只剩空目录，钩子的 `tsx` 消失、面板服务靠已加载模块撑着），之后才删软链、往 worktree 自己装。⚠️ 那次的 `unlink` 本来写在同一条命令里，但闸门因为子 shell／分组**整条拒掉**，`unlink` 根本没跑——**被闸门拒的复合命令里每一步都没执行**，重发前先核前置状态。恢复：主仓 `npm ci`（锁文件相同即可复现）＋重启面板。worktree 要真依赖：`/bin/cp -Rc <主仓>/node_modules <wt>/node_modules`（APFS 克隆，秒级），再 `npm install <包> --prefer-offline`（不加 `--prefer-offline` 时 npm 卡住 >10 分钟无子进程）。
- **临时目录泄漏护栏**：每个测试文件一个临时根（`tests/setup/scopeTmpdir.ts`），`node scripts/check-tmp-leak.mjs`（两仓都有）要 0 残留；`TMPDIR` 要**短、真目录**（如 `mktemp -d /private/tmp/cl-XXXX`）——放 scratchpad 下 tsx socket 超 104 字节、用软链则路径判据红。
- `verify:control` 必须配**只指向 fake** 的 `ORCA_AGENTS_TABLE`，fake codex 用 `integration` 模式（`ok`／`script` 会让 `ccloopProtocol.integration` 红）。
- `npm run verify` 是 `&&` 链：有预期红时**逐段单跑各取 RC**；它打印多档计数，别混着比；跨 Task 比红集合要同一套 env（skip 变 run 不是新红）。
- 改 runner／fixture 后跑它的整个镜像目录（`npm test` 会按镜像目录选；会话 `3831d12f` 实测：只挑点名文件漏了 ccloop `claudeSkillPluginDir.test.ts` 里嵌着的 `--json-schema` 金样）；逐 Task 只跑点名文件会漏别处嵌着的同形夹具。「少跑一条」在 vitest 里是绿的 ⇒ 另加 `.length` 判据。
- vitest 5 不认 `--minWorkers`；`useEffect` 在 `renderToStaticMarkup` 下不跑；`vi.resetModules()` 后类身份不同；jsdom 不加载 CSS ⇒ 只靠 CSS 的行为要直接读样式表；i18next `addResourceBundle` 会改写你 import 的对象；伪语言判据会被插值剥掉；新 `t()` 位置要在中文下断言完整文字并跑「放回英文」变异。
- web 测试默认超时 15 s（`web/vite.config.ts`）；Node `setTimeout` 超过 2,147,483,647 ms 变 1 ms，「不设限」的时长要先截断。
- `fetch` 测不了路径穿越（客户端折叠 `..`）⇒ 用 `node:http` 发原始 path；省略 `bind` 会绑所有网卡；「空 env」在本仓库等于真的 `~/.orca` ⇒ 起服务器的判据显式改道。
- express 5：注册在错误处理器之后的路由照样匹配（`src/panel/api.ts` 里相反的那句注释实测为假，按 Rule 3 没动，别据它改路由顺序）。
- Node 22.13.1 上 `execFile` 的 ENOTDIR／ENOEXEC 同步抛，ENOEXEC 的 `code` 是 `"Unknown system error -8"`；判 spawn 失败看 `error.syscall === "spawn"`。
- `npm audit` 文字报告会折叠 high／critical ⇒ 用 `--json`。真进程判据要显式 teardown，「杀掉 tsx」≠「杀掉在监听的进程」⇒ detached＋对负 pid 发信号。
- 本机 claude 会被随时重装（同版本也会）⇒ 付费跑前后记装目录 mtime；ccloop 不留结果包，报花费套 `scripts/claude-tee.mjs`。`--no-session-persistence` 仍会建空 `~/.claude/projects/<cwd>/memory/`。把 `ANTHROPIC_BASE_URL` 指向无人监听端口可零成本量启动期副作用。
- 手动起面板时 `ORCA_*=…` 不 `export` 就传不进子进程，会写进真 `~/.orca`。
- **web 文案受两处跨包判据约束**：web 的英文 metrics 说明必须与服务端句子逐字一致（根 `tests/metrics/noteCodes.test.ts`，句子在 `src/metrics/compute.ts`，金样 `tests/fixtures/metrics/golden.json` 跟着变）⇒ 改 web 文案后跑根 `tests/metrics`；根测试 `tests/panel/scanPanelText.test.ts`（`scripts/scan-panel-text.mjs`）把 `web/src` 里带空格的字符串字面量当未翻译文案（CSS 选择器也算）——**只跑 `--ws check` 看不见这两条**。jsdom 不实现 `isContentEditable`；新 DOM 测试文件首行要 `// @vitest-environment jsdom`（web 默认 node）；locale 是具名导出。

### 6.8 ccloop 侧（Orca 用到时要知道）

- `run`／`resume` 退出码 `succeeded ? 0 : 2`，四个非成功终态压成 2 ⇒ 读 `loop-state.json` 的 `status`；`blocked_waiting_human` 是终态且不可 resume。
- `scripted` adapter 不产 `diffPatch`；`readDiffPatch` 有三条静默空补丁路；`evaluatePathPolicy` 是纯事后检测器，`denylistPaths`／`maxFilesTouched` 只查 agent 自报。
- 驱动正常落地的 run 在视图里显示为 `settled-recoverable`（`landed` 是中间态），落地看 `RunViewV1.git.landedCommit`。
- 两仓 canonical JSON 排 key 算法不同（ccloop `localeCompare`，Orca 按 code unit），且 ccloop accept 会按自己的算法重写 envelope ⇒ 跨仓比哈希只对单个字符串可靠。
- ccloop 的安装表读取要求文件 0600、属主是自己、组／他人不可写（父目录同样）、`realpath` 等于自身（写 `/private/tmp/…`）；`version` 必须等于 fake 对 `--version` 的回答。
- 本机 `kern.maxprocperuid` 5,333、`kern.maxfiles` 245,760（2026-10-02 现测）；每个在飞任务至少 3 个进程；约 1,700 并发是**推算**——大规模并行前要实测定「同时启动任务数上限」。
- fake codex 恒报改了 `answer.txt` ⇒ loop task 的 E2E 要把它放进 `targetPaths`；CLI 遇到 loop task 拒 `loop-plan-cli-unsupported`。
- 按工作目录找夹具的判据（`subprocessClaudeAdapter` 的 `fake-claude.mjs`）在别处用 `--root` 跑会假红 ⇒ 变异和全量一律 `cd` 进 clone 再跑。

### 6.9 其它单条教训（各栽过一次，仍成立）

- 🔴 **`/tmp` 会被 macOS 周期清理吃掉整棵树**（2026-09-24 实测一棵树只剩目录骨架、`.git` 没了）——**本会话的两个分支工作树就在 `/private/tmp`**，长期不合会丢。
- 任何 catch 兜底都要问「它吞的是不是会连锁的失败」（曾让全 store 发布卡死）；判据要正向观测副作用（outbox `delivered=1`），不只看终态。
- 跨仓词表／空值语义不一致反复是根因（`null` 用量、`missing`、`complete`／`partial`、「isolated」、退出码约定）⇒ 接字段前逐个问「对端这个词是什么意思」。
- 宣称一条链路「能跑」前，逐个函数数 `src/` 里的调用方（只有测试调用的函数会让冒烟绿、生产到不了）。同名不同义是一类根因（`targetVersion`）。
- `capabilitiesSchema` 住在 `src/control/webProtocol.ts`，不是 `schema.ts`——反过来 import 会成运行期 ESM 环（typecheck 看不出）。
- 写验收判据前先问：这条判据的红因在本轮范围内吗（会从描述改动前状态的基线继承到达不成的目标）。核守卫先核终点走的是哪个守卫。「1:1」假设去数两边的字段。
- 「已知红名单」本身会过期 ⇒ 名单机械判（ccloop `scripts/check-known-reds.mjs`），引用前确认是哪一轮测的。
- 在「关闭某类缺陷」的那一波里顺手多修一处，正是新引入该类缺陷的地方 ⇒ 派发写明「看见了就报，不要顺手修」，收货问「有没有修清单之外的东西」。
- 「BASE 红、HEAD 绿」也会把设计上有意去掉的交叉核对判成放宽；改夹具转绿的既有判据没有机械检查 ⇒ 夹具 diff 单列给人。
- 并行写计划 ⇒ 后面 Task 的 before 锚点是前面 Task 落地前的代码 ⇒ 写「树是真相：增量改、不重建」。两席并行起草要先写共享接口契约。
- 声称「不改持久化 schema」前数一遍所有写入点（展开 `{...x}` 还是逐字段）。修「某检查挡住了 X」要找齐所有同类检查，判据量被宣称的那一层。
- 计划给的夹具可能在方法已被绑定走之后才替换 ⇒ 「先红」这一步是在量夹具本身。子代理建议的修法里用到的 API 先在本机量。
- 传输类判据至少放一个跨读块边界的多字节字符；清理派生进程的判据先等进程退出；人给的判据也可能量不出来 ⇒ 先跑修复前的量测确认能分出修前修后。
- 能在一处兜住的不要逐个改（一个 setup 文件让泄漏归零）；模块顶层副作用随 import 扩散。
- 「env 原样透传」这类标题承诺要用只可能从错误来源出现的哨兵值去量。真 verifier 会引用规则原文 ⇒ 子串匹配的 `rejectOn` 是毒药（已改为交 verifier 判断）。
- 在 worktree 里改代码时别同时在同一棵树上跑全量（基线作废）；按子串做锚点的替换会误中更深缩进的同形行 ⇒ 整行相等匹配。
- `Record`＋`as` 构造的对象类型里的必填字段是空话 ⇒ 展开进带类型的字面量，用「删字段」变异确认 tsc 真红；调用方给「没有」是 `null` 还是 `undefined`，先读调用方。
- 「期望零命中」的扫描先排除本轮故意喂的反例；正则定位 helper 不准时换 AST（`beforeEach` 间接调用仍是盲区）。
- 生成 golden 后整份读一遍对着夹具条数核（宽容读取器会悄悄吞坏行）；数判据条数按行首匹配。
- git 细节：`commit -m … -- <未跟踪>` 报 pathspec ⇒ 先 `git add`；cherry-pick／merge 进行中 `commit -- <path>` 得 exit 128；带路径时 `--only` 本来就是默认；没配身份不足以让 commit 失败（要 `user.useConfigOnly=true`）。Claude Code 只记有 stdout 的钩子；`ls -t | head -1` 取「最新 transcript」会选到别的会话。

---

## 七、代码／协议在哪

- `src/{agents,chain,checkpoint,control,corrections,entry,gate,ledger,level,memory,metrics,panel,scheduler,service,skills}/`＋`src/cli.ts`；前端 `web/`（根 `workspaces`）；agent 用的 skill 在 `skills/orca-control/`。CLI 退出码 0/1/2，另有 3（plan 级）、5（提交被钩子拒）、6（metrics 有坏行）。
- `npm run verify`（发版门，spec `2026-10-20-test-scope-and-release-gate-design.md`，会话 `3831d12f`）串：`check-release-gate`（无 `ORCA_RELEASE_TAG` 即 exit 2）、typecheck、build、`check-gate-env`、`verify-suite`（整套只跑一遍，带 `ORCA_CONTROL_VERIFY=1` 与 chain 两变量）、台账校验、`CLAUDE.md` 行数、hooksPath、web build、`verify:ccloop-pin`、`verify:panel`、`--ws check`。`verify:control`／`verify:scheduler`／`verify:chain` 仍可按名单跑，已不在链里。日常 `npm test`＝按改动选测试（`scripts/test-affected.mjs`），整套是 `npm run test:all`。另有 `verify:saved-result`。
- ⚠️ **`.superpowers/sdd/` 整个被 gitignore** ⇒ 留存物必须单独 `git add -f`。不删 SDD 工作区。
- **ccloop 测试副本**（不要建 worktree）：
  ```sh
  /usr/bin/git clone --local /Users/biran/code/skills/orca/ccloop "${DEST:?set DEST}"
  ln -s /Users/biran/code/skills/orca/ccloop/node_modules "${DEST}/node_modules"
  cd "${DEST}" && npm run build      # dist/ 被 gitignore，不 build 会假红
  ```
  安装表 `ORCA_AGENTS_TABLE`（schema `ccloop-agents-table-v1`）的 `command` **只能指向副本里的 fake**（`tests/fixtures/fake-codex.mjs`／`fake-claude-cli.mjs`／OMP 的 `tests/fixtures/fake-omp.mjs`）；现成写法看 `tests/control/fixtures/ccloopWorld.ts` 的 `agentsTable`。
- **控制协议**：ccloop `control` 方法集 `capabilities`／`accept`／`inspect`／`handoff`／`collect`／`read-evidence`，一次一进程的 JSON-over-stdio，状态全在文件里。`capabilities` 答 v2 八字段；唯一的 schema 例外：ccloop `requestBoundProof.*Dimensions` 是任意字符串数组，Orca 要求排序去重的枚举（将来非 null 写错时 fail closed）。envelope protocol 3／4，`work` 分 `loop`／`single-call`，`singleCallExecution` 兄弟字段（claude `"v1"`，codex `null`；omp 在 single-call 分支上按目录行给 `"v1"`／`null`，并多一个 `singleCallOutputCap`，Orca 侧 `.nullable().optional()`）。
- **水位／检查点**：水位＝transcript 最近主链消息的 input＋cache_read＋cache_creation，T1 330,000／T2 450,000；`orca dev level --hook claude-code` 挂 PostToolUse；子代理调用完全静默、自己的水位不测。`orca dev resume` 重跑检查点里记录的 shell 命令。
- **Tier 0 闸门**：`.claude/settings.json` 的 PreToolUse `orca dev gate --hook claude-code`＋`permissions.deny`，拦 push、非 fast-forward 合入 main、强制删分支（`-D`／`-d -f`／删 main）、强制删 worktree／`prune`、`gh` 对外写；`merge --ff-only`、`branch -d`、不带 force 的 `worktree remove` 放行（2026-10-18）。改 deny 列表要同步 `src/gate/settings.ts`，`tests/gate/settings.test.ts` 钉着它的 sha256。已知放行：写成脚本再执行、`python3 -c`、git alias、`-c core.hooksPath=`、`--no-verify`、`ExitWorktree`、`rm -rf` worktree 目录；有 `allow-push` 授权时放行普通 `git push origin <ref>`（2026-11-13，`src/gate/pushGrant.ts`；`permissions.deny` 已不含 push）；已知过度拦：main 上 `git branch -f`、`merge --abort`、`rebase --continue`。威胁模型是合作型 agent 的失手，不是对抗。
- **关键环境变量**：`ORCA_CCLOOP_BIN`（本地覆盖）、`ORCA_AGENTS_TABLE`、`ORCA_SYNCSKILL_BIN`、`ORCA_CCMEM_BIN`、`ORCA_CORRECTIONS_DIR`（都是绝对路径，空＝未配置）。

---

## 八、什么在等人（awaitingHuman）

> 2026-11-11 压缩：删去已了结的条目——各轮的 push 请求（2026-11-11 `ls-remote` 现核三仓本地 main＝`origin/main`）、已做的 repin（当时 pin 是 `chore(deps): pin ccloop to the zero-usage and prompt-mode exhausted fixes`）、`~~划掉~~` 的条目、已答复的问题（UI 信息架构四问、#158／#138 方向、#162／#173 取舍、#212、profile 升 v4、#168／#179／#157、流程第一期安全裁定、soft／failover D1–D6、F5／F6、O9 claude 付费段）、已查清的 `multiDirLandingD` 间歇红与 `dev checkpoint write`「挂住」（见 §3.A）、已不存在的清理路径（`/tmp/orca158-*`、`/tmp/chk-x`、`/private/tmp/orca-{ffec7b28,0e13a9b7,b37f7ce9}`、`.claude/worktrees/tester-followup-20261108`、ccloop 的 prunable worktree，2026-11-11 现测都已不在）；同类项各并成一条。更早（会话 `a3b2a7a7`）删过的见 git 历史。

1. ~~push~~ **已推（会话 `57896c64`，2026-11-20）**：Orca、ccloop、ccmem 本地 main＝远端（`ls-remote` 现核）；syncskill 的 #398 本地提交未推（授权只到三仓）。测试者台账 `orca_archived_files/issue-20261023.md` 本会话未动；对本会话已修项已过期：#382 #383 #384 #386 #387(证据) #388 #389 #390 #391 #392 #393 #394 #396 #397 #398 #399。**会话 `9299e610`（2026-11-20 第三批）已修**：#400（working-tree `core.symlinks`）、#389（operator set-limit 旁安装）、#390（选择框位置/文案）、#393（前端增量游标；服务端全局 `dispatchBlocked` 缺口登记）、#370（归档清 wake＋unarchive 重新 arm continuation）、#383（reported＋两绿记 flaky）、#369 残余（`provider-error` 豁免、stalled 文案）；ccmem #396 代码已生效（daemon 已重启，日志未轮转）、syncskill #398 已重 build 并实测 0.18–0.28s。**三仓推送已完成**（`/usr/bin/git ls-remote` 现核本地＝远端）。台账状态表仍待测试者更新。
   - **会话 `c8fc876f`（2026-11-20 第四批）新增已修**：#401（hint 读 code 前缀＋点名候选）、#402（brief 列未答行＋`--command` 可写 suite 名）、#387（验收证据＋tip 测试数不足一半判 failed）、#393（服务端 cursor）、#385（requirement 单元提示，v9 暂缓）；ccloop #369（静默 run 1 s ceiling tick，已推＋repin）、ccmem #396（日志轮转已执行＋vec_backfill 退避，daemon 待重启）。#370 只出设计（状态模型）。**请测试者更新**：#369 可收窄为「模型目录健康未接入」；#370 转设计；#395 转设计；#401/#402 转为已修待现场复核。
   - **会话 `cc03e171`（2026-11-20 深夜）新增**：syncskill **#421 #422**、ccmem **#413 #418 #416 度量**、Orca **#418 #419 #366** 上本地 main；ccmem／ccloop 已推，Orca 待 wide 后推；面板 wide 后重装。**请测试者更新**：#421/#422 已修待现场复核；#413 已实现原生 ollama provider（本机无模型，未切配置）；#415 仍只修 P1；#418 读路径已实现、写回/纠正默认仍按设计；#419 生命周期已修（历史组 panel start 自动收敛）；#366 `orca gc`＋`status --disk` 已实现（workspace 的 no-checkout 情况仍跳过）。**待人**：#417 `work.memory` bundle 实现、#413 真实 Ollama 链路、#363 settle lane 分片、#419 `--all-derived`、#416 codex P0。
   - **2026-11-22 syncskill #426/#427 已修**：失败 push 的 staging 树清理＋`syncskill prune`（默认 24 h dry-run）、远端 `manifest.json` 改 temp+rename 并保留 `manifest.json.bak`、损坏时给具名 `manifest-invalid`。代码在 syncskill 本地 main（主题行 `fix(receiver): failed pushes clean up their staging tree…`），**未 push**。**请测试者更新**为已修待现场复核（真 ssh/rsync 失败注入未跑，仅 fake runtime／临时目录）。

2. **看真面板**（人此前「先默认通过，之后有问题我会再找你」——不催）：G 轮新 UI——Settings → Agents 首次使用检测与安装、`--repo` 面板的「怎么换多项目」、模型不在目录时禁用提交、「按零结算并关闭」、accept-attempt 表单的 diff 统计与检查、组详情只渲染当前区域、依赖图层内排序与「N 条隐含依赖已隐藏」、无改动标记与「撤销并重跑／按无改动接受」、需求复核面板与三个出口、Problems 里的落地回归行、本组放行按钮与放行列表——都只在 jsdom 测过；F、E、D 轮的同样没在真浏览器看过（F 轮：低频功能收进 More／「⋯」、需求表单「选项」、Board 无主按钮等）。
2d. ~~审 H 轮与 G 轮控制器与各席的可逆决定~~ 人已审（I 轮开轮「未评论的部分同意」，原话在 I 轮台账）；I 轮的可逆决定人 2026-11-13「同意」（J 轮台账）；J 轮的人 2026-11-14「同意」（K 轮台账）。K 轮是否仍待审须以对应台账的 `Ruling:` 行现核；旧 §4.0 第 2 条指针已失效。
3. **付费真跑（每一次先问）**：
   - #162／#173：一次真跑比较 v4 估算与 task run 的实际用量（v4 至今没被付费验证）。
   - prompt-mode exhausted 的验收：需人先在 agents 配置里加一个 `structuredOutput:"prompt"` 的 codex 安装。
   - `orca chain` 真钱活体验收：要人提交 `.orca/chain.json` 选 model（不存在时开链被 `chain-config-missing` 拒）。
   - 纠正 ⇒ debug task 的付费端到端，推送类合入方案（`push-*`／`github-pr`）的关闭（§3.1 记为没验过）。
4. **只能等外部事件／证物**：自然额度耗尽时的真 `quota-probe`；第三方 provider 的 `structuredOutput:"prompt"`；#237（测试者已给 catalog 条目与 `model_reasoning_effort`＝`high`；还要他在自己的 magpie 开请求存档复现一次，看实际发出的 `reasoning.effort`）；#241 后半（测试者 T7 的 `loop-contract.json`）；#191（按人裁不再要测试者原始数据，定论仍缺真样本）；#195（同配置 live 样本）；25 万 input 差的那部分（可选：测试者机器上只读量 overview 大小与 prompt 长度的两条命令在 git 历史里本文会话 `663fb68e` 的待人条）。
5. ~~先 brainstorm 再写 spec：#227、#208；#226(ii)~~ 会话 `29b4e843` 已做：两份设计稿（见 2b）；#226(ii) 已实现。
6. **magpie 实验**：「请求存档」人 2026-11-11 已打开（本机目录，当天即有文件）；实验本身按 ccmem handoff §6.5 在**干净会话**里跑（真模型调用每次先问），做完关存档、删目录。
7. **检查点写入**：`dev checkpoint write` 被 auto 模式审批拦（用会话转录当来源，聊天授权不解除），需人在终端跑或给该命令加一条 Bash 允许规则。
8. **待人审的控制器裁定**（人回复后删对应项）：
   - **会话 `5d3d0c09` 的可逆决定（人「执行过程中如果有问题，先按你的建议执行…最后阶段报给我审核」）**：①#478 续跑不多扣 attempt（被 ceiling 打断后续跑算同一个 attempt；否则 1–2 次 attempt 的 task 永远停不住）；②#479 平分不改，只在「已声明分配之和 > 限额」时拒绝确认（`--accept-shortfall`），Orca 自己的确认豁免，lane 份额按 funding preview 最大的那行近似；③syncskill #474 `status` 也只读；④#477 dry-run 的 `pushed`/`data.pushed` 改为列计划推送（JSON 破坏性变化）；⑤#469 决策路径保留各自的拒绝码、细节带 `artifact-data-missing:<ids>`；⑥#468 `--apply` 不要 person token（同 `orca gc --apply`），面板启动后发布过的 id 一律保留，先删目录后删行；⑦#470 closed 组算已归档，`--archive-groups` 遇第一个拒绝即停（之前已归档的保持归档）；⑧ccmem #475 用第二个文件 `daemon.wake.now` 做立即唤醒、Stop 去抖 30 s；⑨ccmem #452 off/shadow 时不计数；⑩FTS OR 校准后不翻默认；⑪#289 path B 判据改写（见 §3.最新）；⑫ccmem plist 的 `PATH` 被改写后保留新值（去掉 cmux 会话级 shim）；⑬#478 付费验收移到下一轮。
   - **会话 `6add92a5` 的可逆决定（人「卡住先按建议做，最后报审」）**：①#466 只核实「逐字等于 task 已确认 required check」的报告命令（不是的仍按旧行为等人），base green ⇒ 未证实、不等人，red/unknown ⇒ 旧行为，review 在 base run pending 时等待；②launchd：非 Aqua shell 先探 `gui/<uid>/<label>`，已加载就用 gui（未加载仍按 spec §4 用 user）；③~~#469/#468 没有按原 spec 实现，先写修订建议等人审~~ **人 2026-11-25 已答「同意，删除由面板执行，也可以提供一个 cli 命令」，会话 `5d3d0c09` 已实现**；④ccmem #445 的阈值「连续 3 次非额度失败」、超时不计、只报不切；⑤ccmem #452 以「hook 是否跑到」而非「是否注入」判定，Orca 派发的 hook 关闭会话会计入（噪声）；⑥syncskill #462 保留 install 默认链 `agents`，改为 doctor 认它（`isKnownLinkTarget` 共用）。
   - **#385 v9 付费评测（2026-11-23，会话 `ec9efff6`）**：人已提供 goal 原文（`orca_archived_files/evidence-385-goal-text.md`）。**本轮三条模型通道全不可用**（claude 周额度用尽、omp 的 LiteLLM 未起、codex 无单次调用能力），实测已记在 §3.最新。**零花费**。恢复后按 §3.最新「重跑方法」跑三个现场。
   - **本轮控制器裁定（人「有问题先按建议执行」）**：①#432 按「显示＋next」修，不按「派发丢了」修（下游不可领是正确的）；②#439 的 ccloop 超时用 env 变量、缺省值不变；③#434 只分析未改（第二现场未复现）；④#433 未动；⑤#437 未动。
   - **会话 `48bc4690` 的可逆决定（人「有问题先按你的建议执行」）**：①#417 按人裁「明确不支持＋写清」：`orca status` 的 ccmem 行改为常驻 **warn**（面板与纠正导出照常），README 同步；②#419 把卡在 group cap 的 judge 读成 `failed`（复用现有终态枚举，未加新 state），历史派生组不自动归档；③syncskill #404 在 `links` 与 `include` 都未声明时维持「全部本地」旧行为；④syncskill #411 的 `--config` 只接受 `config.json`/`config.yaml` 两类文件名，其余拒绝；⑤syncskill 测试基建改了两个「真实 `~/.syncskill` 快照」的实现（sha256 → size+mtime）与三条 5 s 边缘用例的时限；⑥ccmem daemon 已重启（备份 `.bak.1795183564694`，G1 未重写 plist）。
   - **C-1（会话 `48bc4690`，需人裁）**：A3 里两次失败的需求调用各以 `charge-remaining-grant` 记满 1M grant（组 2M 耗尽）。读码：这是 D2 明文策略（未知用量不静默记零；`singleCallSettlement.ts` 记 `run.remaining.work`）。候选：(a) 维持 D2，只把 CLI/recovery 的 hint 带上金额并优先推荐 `charge-observed-floor`；(b) 失败调用在**无任何输出**时按 `release-known-zero`（要 ccloop 给 `usageKnownZero`，SIGKILL 的 claude 拿不到）；(c) 把 requirement call 的 grant 从 1M 降低（cap 而非估算，影响 clarify/split 的大 prompt）。**未改码**。**2026-11-21 人「同意」**：按 (a) 实现并加金额门槛 —— 单次调用 `charge-remaining-grant` 超过 250,000 tokens 时 agent 无 person token 即拒 `large-charge-needs-person:<n>`，person 仍可结算；`singleCallUsageLowerBound` 也让视图给出 `charge-observed-floor` 选项。见 §3.最新。
   - **会话 `c8fc876f` 的可逆决定（人「有问题先按你的建议执行」）**：①#401 hint 剥 code 前缀并点名已安装候选（一个 perAgent 分支仍是旧文案）；②#402 brief 只加未答行、card 的 `pendingDecisions` 未计入（轮询成本）；`--command` 先前缀后包含、歧义拒绝；③#387 tip `# tests` 不足 base 一半即 `failed`（阈值粗糙，合法删测试可能误伤）；`acceptanceProblem` 的 command 在合并 base 后取最后一条（旧行为）；④#385 只做单仓提示、v9 暂缓；⑤#370 只写设计（状态模型变更）；⑥#395 只写设计；⑦A3 用 claude 起跑、失败后归档 scratch 组；⑧ccmem 的日志轮转已对真实日志执行一次（616 MB→0 B），退避未重启 daemon。
   - **会话 `9299e610` 的可逆决定（人 2026-11-20「有问题先按你的建议执行…最后报给我审核」）**：①#400 跟 git `core.symlinks` 语义（false 时普通文件按同 oid 匹配，双向；替换文件时权限位走 `modeFor`）；②#393 空增量在 cursor 上视为未变、严格前进做全量读（服务端全局 `dispatchBlocked` 的缺口登记未修）；③#390 选择框移到卡片起始、带可见标签（390px 浏览器未看）；④#389 operator `set-limit` 在 active unbounded run 旁安装（spend-cap／agent group-cap 仍拒；spec 追加 Correction 1）；⑤#370 archive/close 清 wake，unarchive 重新 arm continuation（estimate wake 跨 archive 保留）；⑥#383 reported+两绿记 `flaky:true`，reviewer prompt 改绿确认措辞；⑦#369 `provider-error` 进 auto-debug 豁免、stalled 文案点名 `idleTimeoutMs`／默认 10 分钟。
   - **会话 `57896c64` 的可逆决定（人说「有问题先按你的建议执行…最后报给我审核」）**：①#382 只做 review／验收排除，账本仍留在交付树（第二刀另立设计，spec Correction 已记）；②#384 候选＝「声明边＋宽泛路径声明已排序的对」，`--pair`／`--all`，Web 按钮 `all:true` 保持旧语义；③#389 当时保留 `active-unbounded-budget-conflict` 的拒绝（装限额会与在跑 run 的无上限 grant 竞态），只把消息改成可执行——**已被会话 `9299e610` 取代**（operator set-limit 现在安装在上限旁）；④#392 的 plan 下一步换成 `orca requirement open --idea`；⑤#394 只做 gzip、不拆 chunk；⑥ccloop #397 用合批而非每行一次写（每行一次 syscall 在本机仍要 ~1 s），`finish()` 后的 chunk 不再落盘已登记；⑦A3 付费面板小任务未跑（要往人的面板加 scratch 项目）。
   - ~~会话 `3ba26002` 的控制器裁定~~ **人已「同意」（2026-11-20，会话 `57896c64`）**；全文在 `.superpowers/sdd/2026-11-19-tester-issues/progress.md` 的 `Ruling:` 行：①**#365 改了已发布的 H4**：与人存的项目默认逐字节相同的 `working-tree` 组自动确认照常放行（否则选了它之后每个组都要人确认）；②#365 项目级交付设置一律要 person token、依赖组等工作树前置／遇 keep/push 前置即拦、写回时只改组自己改过的可执行位、大小写重命名按名拒、Web 首问写出具体路径；③#381 `framingTokenOverhead` 默认 12000、整块 `null` 仍＝不估算；④P2「只在 ccloop 宣告 attemptRef 时走新路」（偏离 spec §5.8 第 2 行，好处是 P2 可先合）；⑤P1：agent 在 worktree 里自己提交过的 run 不能按 saved-result 恢复；settle-lost 带键时不跑两个清理循环；⑥#337 folder／多目录组所有不过的结果都记 `noted`、只许 `review-accept`、Board 卡不显示 `noted`；⑦#379 只对已接受未确认的组、参数名 `--text`、有组依赖即拒；⑧#377 很小的剩余额度也开（带上限的）自动修复；⑨`offPlanWritesE2E` 验收 4 改了测试的准备步骤（断言不变）。会话 `543e800e` 的裁定人已整体「同意」（`3ba26002` 开头）。
   - 会话 `0e0846ae` 的待审项人已答（stuck-runs ⇒ 下一轮独立审阅，见 §四.0 第 1 条；#346 W4、#335／#322／#332 ⇒「按建议走」；paired 文件 ⇒ 已删）。
   - 会话 `ffec7b28`（台账 `.superpowers/sdd/2026-10-24-session-ffec7b28/progress.md`）：已完成的 run 不给 skip/defer；转录 C2（窗口 4 MiB）、C3（展开前只脱敏头部＋4096）、赋值名大小写不敏感、超大行展开显示解码文本；计划库放控制库而不是文件；dir 需求 D3 窄碰撞规则；R2 D7（自动确认即开跑）、D11（估算超额时非 token 维度上限随之增长）、M5（修复迁移后的旧不限 token 草稿组会被自动确认开跑）；H7 W1–W15。
   - 会话 `9ec98639`（台账 `.superpowers/sdd/2026-10-21-session-9ec98639/progress.md`）：每条线的「Criteria changed」与其余控制器决定（三处偏离——L2 是叠栈的 debug 组、系统 debug 不经估算、审阅员是完整 run——与 ccmem SIGTERM 次序修复人已同意）。
   - F13：前台 `orca panel` 保留 Web-only（agent entry spec §3／C15），要不要拒绝启动等人定（2026-11-07 只改了提示与 socket 绑定失败退出 78）。
   - 门提速候选 `.superpowers/sdd/2026-10-20-repin-w2-test-split/gate-speed-survey.md`（人还没裁）。
   - 未审完的历史轮次裁定（各台账 `Ruling:` 行）：面板项目过滤（`.superpowers/sdd/2026-10-06-panel-project-filtering/progress.md`）、Task control 刷新＋项目切换（会话 `08011394`）、syncskill 跟进（`9d95e6c8`）、面板 HTTP＋syncskill 补三件（`16ab00f2`）、UI 一轮改写的四条判据（`REWRITTEN … U1–U4`）、会话 `b39a5527` 的六条可逆决定（结清按保守额记组账、`recovered` 扣额排除出谱系等）。
9. **一揽子／历史决定**：「第二个 panel 不挂控制面」维不维持；裁决甲 `plan` 那一半未获指名授权；子系统 B 暂缓到有 `not_my_taste` 行（`~/.orca/corrections.jsonl` 2026-10-18 仍不存在）；`import-plan` 的上限按 agent 定的 task 数算；ccloop 的 `setTimeout` 溢出防护要不要对别的客户端也设。
10. **归属行**：若干提交的 `Co-Authored-By` 写的是实施席自己的模型；两笔 trailer 格式小瑕疵——**都不 amend，由人决定**。
11. **安全**：2026-09-17 一把 API key 明文进过 transcript ⇒ 建议轮换，只有人能确认。
12. **人的数据与仓库外残留（留不留、删不删、杀不杀归人）**：
    - **会话 `48bc4690` 新留**：syncskill 的对比 worktree `/tmp/ss-baseline`（node_modules 是软链到主仓、`dist/` 已建；agent 的 `rm` 被权限层拒，未删）；syncskill 本地领先远端 7 笔（人未授权该仓 push）。
    - `~/.Trash/orca-real-data-2026-09-27`、`~/.orca/backups/` 下的备份集（清单见 §3.A「仓库外的写」）、ccmem 的 `global.db.bak.*` 与 `com.ccmem.daemon.plist.bak.20261013`。
    - `~/.codex/config.toml` 里 codex 0.167.0 报已失效、被忽略的 `features.rmcp_client` 一行。
    - nvm 的 22.13.1 可以卸（Orca／ccmem／ccloop 的现行配置都不再引用它）；卸之前先关掉旧终端开的会话。
    - 临时目录（可删）：本轮各席与门的日志、变异副本 `/private/tmp/orca-f1112/`（含 `w*/mut`）。E 轮的 `/private/tmp/orca-e1111/` 与其 worktree、分支已由人在会话 `5abcad7d` 用脚本删掉（含旧 `codex/criteria-checked-input`、`codex/o19-saved-result` 两支）。
    - **会话 `57896c64` 已把清理命令交给人**（`.wt-*` 克隆与日志、`.wt-g-req.evidence`、`docs/spec-337`／`docs/spec-365` 两支 `-D`）；`.wt-p2-ccloop-pin` 在重钉后也可删。另有本轮 agent 的变异副本：`/tmp/orca-mut-394-11518`、`/tmp/orca-384-mut.d8Pawx`、`/tmp/ccloop-397-mut.HVqycP`、`/tmp/syncskill-398-fixture`、`/tmp/orca-gate`（门日志）。删不删归人。
    - **留下的克隆与临时目录（会话 `3ba26002` 末；全部已合入或是变异／对照克隆；删不删归人）**：`/Users/biran/code/skills/orca/` 下 `.wt-*-mut*`、`.wt-*-rev`、`.wt-dbg-offplan`、`.wt-ccloop-p1-mut`、`.wt-ccloop-p1-old`、`.wt-ccloop-p1-base`、`.wt-ccloop-p1-rev`、`.wt-ccloop-p1-fixmut`、`.wt-p2-ccloop-pin`（**repin 之前门还要用它**）、`.wt-*.log`、`.gate-*.log`、`.ccloop-p1-build.log`、`.reinstall*.log`、`.wt-*.evidence/`（**`.wt-g-req.evidence/c.sqlite` 是你控制库备份的副本，含你的数据**）、`.dbg-offplan.*.log`、`.wt-337.mutrun.py`；废纸篓里 A2 基准的克隆（`.wt-p2-bench`）。这些克隆里有指向主仓 `node_modules` 的软链：删目录前先 `/bin/rm -f` 软链本身。ccloop 主检出的未跟踪 `undefined.version-calls`（他人假 codex 留下）。Orca 的 `docs/spec-337`、`docs/spec-365` 两支是变基前的提交，`-d` 删不掉（内容已在 main）——要 `branch -D` 由人做。
    - 原有 codex worktree（`/private/tmp/orca-d1-kMINyw/{orca-criteria,orca-o19}`、`~/.codex/worktrees/` 下仍有多支）的强制清理需人点头。
13. **ccmem embedding 账号无额度**。
14. `docs/handoff/handoff_ui.md`：UI 的活交接（§七＝当前 UI 状态与待人项）。

### 已知缺口（挂账，登记不修；出处在各台账）

- 执行驱动／④：驱动环启用前被冻结的 run 启用后不会自动解冻；非驱动环组被 shutdown 冻结后面板没有出口；`handoff-partial` 与剩余 grant 某维为 0 的 held 任务永久停住；一个发布一直失败的 Web run 下次重启会让 recovery 置全 store `dispatchBlocked`（m6）；超额 breach 的组只能 stop／recover；`replenishStartWakes`／`blockRun` 抛错中止整轮；冻结的 `budget-estimate` run 的 handoff 请求在 `src/` 无消费方（只静态核过）；`recovery-retry` 绕过 N2 可能两个解冲突并跑；`continuation-input.json` 不进 ccloop 任何 prompt。
- 用量：spawn 失败或出流前退出 ⇒ 用量 null ⇒ 组 `usageUnknown` 卡住（需先定义「可证明零花费」）；需求上的用量一旦未知清不掉；冻结时已完成的估算调用照样记 `interrupted`。
- 26(a)（⑤ 一轮，要先做设计）；单 profile 给所有角色时 confirm 强制数值 handoff 阈值（今天的绕法：estimator 与 worker 选不同 profile）。
- agent 选择：`ccloop resume`／`sweep` 不支持 `--agents` 起的 run；claude 工具进程另开进程组时杀不到；claude model 以 `[1m]` 结尾可绕过上下文档位；安装记录的`configDir`／kind 改了已开跑的组没有出路；claude 自动升级后旧 run 被 `agent-version-drift` 拒续；派活不与确认快照比对。
- 生产部署的 execution profile 快照：spec §5.3 要求、计划与执行都没接（真实环境有 `~/.orca/profile.json` v2 快照，`contextWindowTokens:null`）。
- 面板：web 生产 build 单 chunk 709 kB（gzip 215 kB）超 Vite 500 kB 提示——人裁不修（本机面板，依赖只有 react／i18next；要放公网或 gzip 过 500 kB 再看）；Memory 页曾报 `ccmem-failed:1`（ccmem 侧缺陷，未修）；Web `BudgetEditor` 不显示决定派活的 `handoffControl`／`handoffExecution`；N2 延后小项（socket 属主 uid 不校验、状态目录可写不告警、mcp stdin 结束不 close 等，见 `.superpowers/sdd/2026-10-07-agent-entry/progress.md`）；整合时卡住的远端会让驱动等到 `ORCA_INTEGRATION_TIMEOUT_MS`。
- loop 方案：`evidenceRequired` 子串问题；分钟级收尾窗口要和 ccloop 一起改；`reconcile.ts` 的 `rejectOn: ["nonzero exit"]` 无效（无害）。
- ccloop 侧：恢复窗口不可用时 60 s 不是真上限；`PARTIAL_FLUSH_MARGIN_MS` 在 Orca 手抄一份；`agent-selection.json` 只冻结选择与 hash；stream 用量一轮有四处删了不红（`setEncoding`、写观测的 `catch`、`total !== null`、`observedUsagePath`）、`message_delta` 配对不看 `parent_tool_use_id`；`src/runtime/codex/protocol.ts`／`types.ts` 注释把「真 codex 只在阶段末报 usage」写成事实（已发布，只能追加具名 ERRATUM，未做）；Codex skills 在真模型被杀后的续跑未验。
- 判据层（登记为冗余或弱，未编假判据）：`webFixture`／`createHarness` 的 `capabilities()` 没有独立钩子，用 `setObserved` 写「认领时能力不符」会假绿；`assertCapabilities` strict 分支不查 `requestBoundProof.workDimensions.includes("tokens")`；`ccloopPort.ts` 已发布 ERRATUM 指错段落；`webProtocol` 外层 `.strict()` 冗余；`capabilitySchema.test.ts` 标题证伪不了；旧 `ControlService` claim／continue 路径生产不可达无判据；handoff 宽限在冻结值无效时退回 0；`recoveryBlockers` 等几处换比较器无会红的判据；ccloopProtocol 的 SIGKILL 两行、controlReadApi 键数、controlConfigPort `defaults` 本来就弱；各轮 `minor (deferred)` 行（syncskill 集成、项目过滤、N1 概况串行等）见各自台账。
- 看板：图上不画写集冲突；`orca/<组>` 是否已并入 main／已 push 不显示；run 无开始时间戳故无耗时。Linux `status`／`logs` 不顺手 `enable-linger`。
- 容量：大规模并行前需要实测出的「同时启动任务数上限」（§六.8）。性能：M5／M6 已按 `docs/superpowers/specs/2026-10-09-control-poll-performance-design.md` 做完，其它 N+1 按实测单列。
- **2026-10-18 → 11-10 各轮登记、未修的残余**（2026-11-11 从 §三 的历轮小节移来；后来已修的不再列）：
  - 任务准备命令（会话 `af2ceee1`）：setup 超时的 stop reason 一律 budget 措辞；`setup` 的 `-w` 只认 npm；npm 默认脚本 `start`／`restart` 未豁免；多目录 `writes[].checks` 不核对；嵌套 git 仓库躲过清理会进归档；失败检查命令／证据尾巴之外的详情只在归档里；目标仓 `npm ci` 的 prepare 会改 clone 共享 git config 的 `core.hooksPath`。
  - 依赖与唤醒（会话 `86352010`）：已有依赖指向后来才归档、没做完的组 ⇒ 下游永远等，只能人删边；额度探针 P11 没做、P14 的护栏在实际流程里到不了；`recovery list` 的 `deferredWakes[]` 没有年龄（`scheduler_wakes` 无时间列，加列是迁移）。
  - 面板／转录（会话 `4ed8eb65`、`b999cc81`、`e236bbe4`）：转录自动读取在飞时按展开，答案回来仍打开最新一条；Task control 面板加载中也说「不可用」（`App.tsx` 约 1781）；`fetchRunTranscripts` 不校验空响应体；Radix 的滚动按钮没在截图里见过（种子世界没有长列表）；需求页每行「…」按钮压出行边框；ChecksSettings 没有「选了什么值」的判据；FlowSettings 预设与 AgentFields 上下文在值不在选项里时显示空触发器、不加占位；项目设置刚保存后「Run now」报 `revision-conflict` 且文案说「this group」；`requirement-next` 的 `<p data-tone>` 无内边距／圆角；需求文档开头标题是 h6、低于 h5 小节标题；`.btn-danger` 未接到任何危险操作；隔离 QA 环境里一次见过面板重启后驱动归档整 clone 工作区耗时数分钟、SIGTERM 80 s 停不下（未复现）。
  - 拆分（会话 `a9f9d6de`）：flow 宿主的 clarify 轮次编号未跟随链上位置；omp／openrouter 走 `context-unavailable` 的边角；多目录拆分非主仓的路径形状只按主仓规则核（`2026-10-28-split-prompt-v3-design.md` §6、`2026-10-28-recovery-cli-design.md` §4）。
  - 多目录／流程／定时（会话 `7753e97d`、`ffec7b28`）：暂停中 run 被 stop 时已落地子任务的结果记在 vault、不复制回人的文件夹；`.orca-<hex>` 临时名不从快照排除；完成的 take-folder 的 resolution 下一轮被清（trailer 与 drift ref 仍在）；定时 condition-8 的 waiting fire 在人确认后不收尾；流程边界留言：accept 的超时分支无独立变异保护、两个并发 accept 可重复应用 mid-run 通道、已停／已完成 run 的 `lastError` 不清；dir-requirements 的 6 条 minor 与 H7 接受的偏差在各自计划文末；测试者 #22 延后；ccmem 没有 un-archive 命令。
  - 控制 run 写决定（会话 `1710772d`，台账 `.superpowers/sdd/2026-10-18-control-run-decisions/progress.md`）：不同身份并发 reject 可各记一条、reject 输给 approve 时留孤儿 correction（交给了 debug 计划，未逐条核是否已收）、E/D 的 reconciling 检查与 CAS 之间有窗口、approve/reject 串行只在单进程内。纠正 ⇒ debug：reconcile 后自动生成的 `git revert --no-edit <attemptSha>` 可能撤不干净。Decisions 页撤回：写入方并发守卫变异 M4b/c/d 无确定性判据等延后 minor 在台账 `.superpowers/sdd/2026-10-18-decisions-review-withdraw/progress.md`。

---

## 九、本目录其他文件

| 文件 | 是什么 | 状态 |
|---|---|---|
| `known-load-flakes.md` | 全部已登记的负载型 flake 与判别规则 | 现行，**看到红先查它** |
| `2026-10-12-oh-my-pi-acceptance.md` | OMP 隔离真任务验收的证据索引（成功与两次中间失败） | 证据索引，保留 |
| `2026-10-12-live-service-cutover.md` | 正式服务切换：备份清单、schema 升级、launchd、**回退步骤** | 证据索引，保留 |
| `2026-10-12-followup-acceptance.md` | ccmem 迁移备份修复、真 Codex strict wire、Linux VM、GitHub 验收的证据 | 证据索引，保留；其「尚未完成」一节以本文 §四 为准（ccmem 已 push、strict wire 已进 OMP 分支） |
| `2026-10-10-ccmem-local-integration.md` | ccmem 本地整合归档包的 SHA256 索引（唯一人可读的那份） | 证据索引，保留 |
| `2026-10-14-feedback-triage.md` | 外部反馈 `issue-20261008.md`（10-14 版）对照当时 main 的分诊、优先级 1–7 与不采纳理由 | 历史分诊参考 |
| `2026-10-10-feedback-status.md` | 37 条外部反馈的分诊与延后清单 | 保留，历史分诊参考 |
| `goal.md` | 方向与诉求 | 按需读 |
| `handoff_ui.md` | UI 各批的过程交接 | 现行（§七＝当前 UI 状态与待人项）；稳定结论已并入本文 |
| `worktree-archives/`（本目录与仓库根各一个） | 清理前保全的 review diff、ccmem 合并证据、旧 worktree 的忽略证据（各带 manifest） | 只读归档 |

旧 Results 5 WIP 的归档：`/Users/biran/code/skills/orca/orca_archived_files/results5-wip-20261012.tar.gz`（同名 `.manifest.json`）——main 已含其全部功能与更新的保护，无独有代码。

---

## 十、旧文怎么取回

本文每一轮被删掉的过程原文都在 git 历史里（`.superpowers/sdd/**`、`docs/superpowers/{specs,plans}/**` 从没动过——**那些才是证据链，本文只是索引**）。
取回某次压缩之前的完整版：先找到那次压缩的提交，再看它的父提交里的本文（两步分开跑：一条 Bash 一个 git，Tier 0 闸门会拦 `$(…)` 子 shell）。

```bash
/usr/bin/git log --oneline -- docs/handoff/handoff.md          # 挑出压缩那一笔，记下它的短哈希 <c>
/usr/bin/git show <c>^:docs/handoff/handoff.md
```

三次压缩的主题行（用 `/usr/bin/git log --oneline --grep='<主题行片段>' -- docs/handoff/handoff.md` 直接定位）：
- 2026-11-11：`docs(handoff): condense the Orca handoff -- drop finished rounds' process, keep rulings, traps and open items`（§三 的历轮小节 2026-10-18 → 11-10、旧 §4.0／§4.2、§八 已了结项都在它的父提交里）。
- 2026-10-18（会话 `a3b2a7a7`）：`docs(handoff): roll session a3b2a7a7 in and condense the history into conclusions`。
- 2026-10-13：`docs(handoff): condense Orca handoff and roll in OMP skill injection`。

某一轮原节的更早版本：同样先 `git log --oneline` 挑那一笔，再 `/usr/bin/git show <那一笔>:docs/handoff/handoff.md`。
**如果你发现某条结论在这里找不到、而你记得它存在——先去 git 历史里找，再补回来。补回来不需要授权；那正是本文允许就地改的用途。**

### Suggested skills

`superpowers:verification-before-completion`（每次说「做完了／绿了」之前）、`superpowers:brainstorming`（开新能力之前）、`superpowers:writing-plans`、
`superpowers:subagent-driven-development`（值这个钱，但是主要开销）、`superpowers:systematic-debugging`（出现红先用它）、`superpowers:receiving-code-review`
（评审员的承重主张自己复核）；UI 轮先读 `web/DESIGN.md`、跑 impeccable 检测器，可用 `frontend-design`、`playwright`（截图对比）；P0 修复先 `superpowers:test-driven-development`。skill 与 `CLAUDE.md` 冲突时 `CLAUDE.md` 优先。
