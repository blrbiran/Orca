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

### 3.最新（2026-11-12，会话 `5abcad7d`，测试者反馈 F 轮）—— #195 改裁、#116 有限组按观测下界结算、#81 收起低频功能、#183／#173／#162／empty-result 说清楚、E 轮无判据处补齐（顺带修了组级验收的 worktree 竞态）、#252 Orca 半边；全部 `--ff-only` 在本地 main；**没有 repin、没有 push**

- **人的话（原话，全文在台账 `.superpowers/sdd/2026-11-12-tester-followup-f/progress.md`）**：E 轮按「先按你的建议执行」定的各项「同意」；#243「这个本轮不做，留到下一轮做」；E 轮 UI「先默认通过，之后有问题我会再找你」；分诊后「需要你多做一些task…但是这次我们不做需要brainstorm的部分」；#195 与 #116（都与旧裁定冲突）「要改」；#81「要收起来」；后又一揽子：「这次批准改写所有必要的判据」「这一轮允许必要的付费真跑」「如果需要repin ccloop…临时允许你push ccloop」「Orca仓库repin完成后临时允许你push Orca」「遇到卡住必须等人的事情，请继续做不必等人的部分」「有问题先按你的建议执行…在最后阶段报给我审核」。**本轮没 repin（见 W6）⇒ 两条 push 授权都未触发，push 归人。付费真跑没跑**（没有非付费不可的验证）。
- **分诊**：测试者文档自 E 轮未变（mtime 早于 E 轮收尾）；三席只读核对旧积压项，结论与本轮范围在设计 `docs/superpowers/specs/2026-11-12-tester-followup-f-design.md` 与台账。
- **已落地（主题行按 `git log --grep` 取）**：
  - W1 #195：confirm（Web／socket／CLI）收 `handoffAtContextTokens:null`，非 null 仍按冻结 worker 窗口校验；自动确认与 flow 子组不再拿窗口填它；CLI `group confirm`／`proposal show` 与 Web 预算编辑器说明「上下文交接未生效（没有已装 agent 报上下文用量）」，Web 字段空即「未设置」。⚠️ 开轮时控制器把它报成「与 §5.2.8 旧裁定冲突」是**误认**：§5.2.8 的「不放宽 `null`」管的是 profile 的 `contextWindowTokens`（估算能力），本轮改的是确认时的交接阈值 `handoffAtContextTokens`，§5.2.8 原样仍成立（更正已追加在本轮 spec §8）；spec `2026-09-19-web-recoverable-control-design.md`、`2026-10-24-tester-round2-design.md` §26 已追加更正。下游没有任何地方需要非 null（座位核过）。
  - W2 #116：有限组未知用量可 `orca task settle-usage … --acknowledge charge-observed-floor`、单次调用 `orca recovery retry --run <r> --acknowledge charge-observed-floor`：只在剩余有限且 ccloop 有下界时准入（否则 `run-usage-not-settleable:observed-floor-unknown`），按下界记账、标近似（marker `method:"observed-floor"`），agent 可用、Orca 自派的 run 拒、flow 调用拒 `flow-call`；Web 结算处多一个「按观测用量记账（N，近似）」。**显式、非自动**（台账 C3，控制器决定）。soft-mode 两份 spec 已追加更正。
  - W3 #81／D21：Overview「导入计划」进 More；组头「存进计划库」「定时」进「⋯」；新需求表单 token 上限与语言收进「选项」（agent＋模型摘要仍在首屏）；拆分草案「存入计划库」进「⋯」；Board 无主按钮；member 看不到项目增改控件，服务端 `PATCH /api/projects/:id` 也改成 owner 专用；没装 agent 时需求表单提示并链到 Settings → Agents；`web/DESIGN.md` 追加一条。
  - W4：#183 `run results` 首行改为「task explanation and outputs: …」与 `recoverable:` 分开，`--json` 加 `recoverability`；#173 旧估算指令警告进 `--json`（`warnings`）与 Web 预算编辑器；#162 有限组应用估算时 attempts ≥2 并说明；empty-result 在 CLI／Web／skill 用人话解释。**发现**：empty-result 的任务**在本组内没有出路**（`retry-task` 拒 `task-not-retryable:run-state:settled`，`set-task-loop` 拒已开始任务），文案如实写「换新组」。
  - W5：E 轮无判据处补 12 条（验收停止守卫、tip 移动中止、Problems 位置与计数）；`no-required-checks`／`no-task` 两种 why 由代码证明不可达（未编判据）；**修了真竞态**：tip 移动时被中止的检查晚到的清理会删掉下一次检查的 worktree（同一路径）⇒ 每次检查用 `group-acceptance-<g>.check-<n>` 并清扫遗留。控制器顺带：`executionDriverE2E` E1 等验收记录后再读现场（本轮基线上就红）；`RunReason` 不再写死码字（`scanPanelText` 拦）。
  - W6 #252 Orca 半边：转录调用接受可选 `startedAt`、全有时按它排序、Web 每行显示时间；**当前 pin 不输出它 ⇒ 不生效**。ccloop 半边**停在人这里**（见 §4.0 第 1 条）。
- **改写的既有判据**（一揽子授权下、各在自己的提交里、带 `Ruling (2026-11-12, tester follow-up F)`）：`agentWalk`、`budgetI18n`、`tokenInput` 两条、`writesMore` 标题一条、`schedules`／`archiveGroup`／`sectionUnmount`（走菜单）、`humanOutput`／`reads`／`estimateInstruction`／`applyEstimate` 与 web `estimateStale`／`loopBudgetRows`／`loopSuggestionApply`（attempts 1→2 与 `--json` 只加字段）、`groupAcceptance`（每次检查独立路径）、`executionDriverE2E` E1。清单在台账各 W 节。
- **变异**：W1 15、W2 24、W3 19、W4 20、W5 13、W6 14（Orca），全红；表在 `/private/tmp/orca-f1112/w*/mutations.md`。
- **门（现测，全部合入后的 main，`TMPDIR=/tmp ORCA_CCLOOP_BIN=<ccloop 主树 dist/cli.js> node scripts/test-affected.mjs --base=<本轮开轮 spec 提交>`，日志 `/private/tmp/orca-f1112/round-gate.log`）**：选 **938 文件（根 724、Web 214）**，typecheck 0；根 6,248 过／39 跳过／1 红＝既有 `orchestration`「admits a debug group…」；Web **1,867/1,867**。**全量门未跑（Rule 18）。**
- **装进 7777**：`npm run build`＋`npm run build --workspace web`＋`launchctl kickstart -k`；锁文件未变；`orca status` 全 ok（ccloop 仍报 pin `2af2fb7`）。**本轮 UI 都没在真浏览器看过。**
- **坑**：① 六席并行跑门时负载 60–127，`startForm`／`criteriaBaseRun`／`driverReconcileN`／`schedulerBridge`／`executionDriverE2E` 等反复超时，单跑都绿；② 有一席的 web 测试夹具在 rebase 后 web typecheck 红（`as never` 包错层），控制器修；③ ccloop 实现席照 ccloop Rule 15 拒用转述的一揽子改判据授权——那边改既有判据要人逐条点名。

### 3.上一轮（2026-11-11 深夜，会话 `e43cd52d`，测试者反馈 E 轮）—— #241 组级验收、#245 合并后检查留证、转录一批、#249（ccloop）、待裁项按控制器建议落地；Orca 全部 `--ff-only` 在 main；ccloop #249 **人已推**，Orca **已 repin** 到它（主题行 `chore(deps): pin ccloop to the codex usage kept after a mid-stream error row (#249)`）；推到哪一笔以 `ls-remote` 现核

- **人的话（原话，全文在台账 `.superpowers/sdd/2026-11-11-tester-followup-e/progress.md`）**：D 轮三组答案「同意」；#125(a)「你看下 Orca 和 ccloop 整体如何调整最优，先不要顾虑之前裁定的部分」；待裁项「其他都按你的建议走」、#200「加」；组级验收与 #251「其他都同意」；#243「这一轮先不做，下一轮我们讨论一下」；真浏览器「暂时不看，我之后发现问题会再找你」；本 session 范围「同意」；清理脚本人已执行；后又一揽子：「这次批准改写所有必要的判据」「这一轮允许必要的付费真跑」「…临时允许你 push ccloop…」「Orca 仓库 repin 完成后临时允许你 push Orca」「遇到卡住必须等人的事情，请继续做不必等人的部分」「有问题先按你的建议执行…在最后阶段报给我审核」。**agent 的 `git push` 被 Tier 0 闸门拦（聊天授权不解除）⇒ ccloop 没推 ⇒ 不能 repin ⇒ Orca 也没推。付费真跑没跑**（没有非付费不可的验证）。
- **设计**：`docs/superpowers/specs/2026-11-11-tester-followup-e-design.md`（§0 裁定原话、§1–§10 各项、§12 授权的判据改写）；被推翻的旧 spec 各追加了带日期的更正节。七席并行实现（W1 ccloop、W2–W7 Orca），控制器逐个 rebase、重生成 CLI 文档、typecheck、重跑该席判据后 `--ff-only` 合入。
- **分诊（按当前代码）**：#246 设计如此（测试者把提示读错了）；#247／#248／#259／#260 是测试者目标仓里 agent 生成的代码的缺陷、不是 Orca；#257 默认视图是 spec 定的；其余 #242–#258 当前代码都能复现。顺带抓到：Web 活动白名单漏了 `saved-result-top-up`（追加过额度的 run 在 Web 上活动整个读不出）；Live 跟随按名字排序的「最后一条」＝plan 而不是在跑的 execute。
- **已落地（主题行按 `git log --grep` 取）**：
  - W2 §2 Web 活动类型与服务端集合一致（`webParity` 钉）；§4 #245 每次单仓干净合并落地都记 `drive.postMergeCheck`（passed／failed／not-needed＋`fast-forward`／`tree-equal`）与 activity `post-merge-check`，`run show` 与 Web run 详情一行；§5 #241 **组级验收**：组内所有任务落地后，在组分支末端临时 worktree 里跑各任务 setup 并集＋必需检查并集（去重），过了才交付／done；记录在组 body 的 `acceptance`（按 tip 键，无迁移），tip 动了自动重跑，重启不重跑已记 tip；红 ⇒ 问题 `group-acceptance-failed:<cmd>`（Board、Problems、`group show`）；`orca group recheck <g>`（谁都可）、`orca group waive-acceptance <g> --note`（人专用）；D1 规则的 spec 已追加更正。
  - W3 转录：服务端按 attempt → plan／execute／verify → seq 排（Live 因此跟随 execute）；单调用阶段去掉「call 1」；字段换行、列表不横滚；run 详情从表格行移到 runs 表下方整宽（Live 与 Runs 字号一致——#243 字号那半随之修掉）；工具调用与结果按 `meta.id` 合成一行带 tone；结果行显示用量（codex 多 cached／reasoning），无内容的行不可展开；‹ › 分页带范围与「已到最新／最早」（范围数的是已加载事件，API 只有字节偏移）。
  - W4 #242 `run show --group` 校验归属（`run-not-found: run <r> is not in group <g>`）；#246 只有一个 `perAgent` 时提示点名 `--agent <它>`；#250 confirm 拒绝信息先给 `--slot worker`（一次设满）、`plan save --requirement` 带上估算 agent；#125 调用失败的 round／draft 记 `clarify-call-failed`／`split-call-failed`（`lastInvalidReason` 仍 `no-output`；flow 侧同样），Web 显示码与 detail；#251 `requirement answer --finish`（同一事务里回答＋共识，Web「回答并结束澄清」）。
  - W5 编排 agent 可用 `charge-remaining-grant` 或已证明的 `release-known-zero` 结算未知用量（记在 `agent:<client>` 名下；`release-unmetered` 仍人专用；单次调用的 `recovery-retry` 同一形式也开放）；不限额组里显式 `task retry` 拿新的 attempts／活动时间（`work_grant_top_ups` 里一行 `fresh-start`，被组自身余量封顶，否则 `authored-budget-exhausted`），阶梯自动重试仍按 lineage 计；有限组由改前捕获的金样钉住字节不变。
  - W6 D21 `orca project add <name> --path|--dirs`（owner 的 person token；派出 run／MCP 拒），Web `POST /api/projects` 只许 owner；#168 拆分校验 `check-docs-only-suite:<task>[:<dir>]`（任务目标全是文档、检查却跑全仓测试 ⇒ 退回重拆）。
  - W7 #256 Overview「已完成（N）」折叠；#258 Memory `offset` 分页＋「加载更多」（切片在 Orca 侧，ccmem export 不变）；#257 列表上「高层级之外还有 N 条重要决策」＋一键查看（`/api/todo` 多答 `majorOutsideHighTier`）；#84 浮层淡入缩放 120 ms（reduced-motion 关）；#200 `lilac` 主题（主色 `#5a4ee0`）。
  - W1（ccloop）#249：codex 流中途出现 `error` 行、后面仍有 `turn.completed` 时，失败的阶段带上该回合用量（`failure-cause.json` `usageObserved:true`、run 记账）；见 ccloop handoff「最新」节。
- **改写的既有判据**（都在一揽子授权下、各在自己的提交里、带 `Ruling (2026-11-11, tester follow-up E)`）：`i18nPseudo` 枚举数 207→210（lilac、`post-merge-check`、`group-acceptance`）；`singleCallErrorCode` 两条（#125）；转录 5 条（`agentTranscript`、`taskDetailTranscript`、`liveRegion`、`runsTableOrder`）；`memoryView`、`decisionsApi` 的 `/api/todo` 字节钉、`themes` 顺序；W5 的 `settleUnknownUsage`、`singleCallUsageSettle`、`testerStuckStates`、`accessMatrix`、`overGrantExit` 13、`retryTopUp` T1–T4／T7／T15（移到有限组）、`tokenPolicyStop`；夹具 `driverHarness` 在 dispose 前停掉它发出的 driver。ccloop 侧**没改**既有判据。
- **变异**：各席在 `git clone --local` 副本里打红（W1 4、W2 27、W3 22、W4 37 中 35 红＋2 条登记为不可达／冗余、W5 26、W6 31、W7 40），表在 `/private/tmp/orca-e1111/w*/mutations.md`。
- **门（现测，合并 W2 前的组合树＝本轮最终树，`TMPDIR=/tmp ORCA_CCLOOP_BIN=<ccloop 工作树 dist/cli.js> node scripts/test-affected.mjs --base=<D 轮 handoff 提交>`，日志 `/private/tmp/orca-e1111/round-gate.log`）**：选 **944 文件（根 727、Web 217）**，typecheck 0；根 6,477 过／40 跳过／2 红＝既有 `orchestration`「admits a debug group…」＋`criteriaBaseRun`「a restart while the re-run is in flight…」（git `index.lock`，单跑 18/18）；Web **1,915/1,915**。**全量门未跑（Rule 18）。**
- **装进 7777**：`npm run build`＋`npm run build --workspace web`＋`launchctl kickstart -k`；锁文件未变；`orca status` 全 ok（ccloop 仍报 pin `095dbdf`）。**本轮 UI 都没在真浏览器看过。**
- **坑**：① 有一席的 worktree 路径在工具输出里被脱敏成 `{{SECRET_…}}`，控制器只好在新 worktree `e-w2-acceptance` 上从它的末笔开分支再 rebase；② 并行七席同时跑门，负载下 `startForm`、`schedulerBridge`、`allowanceHeldSettlement`、`criteriaBaseRun` 等反复超时／`index.lock`，单跑都绿；③ 子 agent 把控制器转述的「人的一揽子授权」当可疑输入标出来（ccloop 那席据其 Rule 15 不用）——转述授权时附人原话出处；④ `cd $VAR` 的 Bash 会被闸门判「不能判定」拦下，用绝对路径。

### 3.上上轮（2026-11-11 晚，会话 `f958ec3f`，测试者反馈 D 轮）—— 两份设计稿按控制器建议落地、#208 浏览器登录、测试者 issue 一批修复；已在 `origin/main`（人已推，会话 `e43cd52d` 开轮 `ls-remote` 现核）；本节「待人审」三组答案人已「同意」

- **人的话（原话）**：开轮「推三个仓库，再装进 7777…」（开轮 `ls-remote` 现核：三仓本地 main＝远端，人已推）；两份设计稿「派 subagent review」；上轮三条可逆决定「同意」；#237「先忽略这个问题，之后你实际测试看看」；#241 后半「暂时拿不到，之后我再问」；清理「帮我做」；测试者 issue「站在用户的角度看应该如何做…跟我之前的裁定有冲突可以提出来」；后又一揽子：「这次批准改写所有必要的判据」「这一轮允许必要的付费真跑」「需要 repin ccloop…临时允许你 push ccloop」「Orca 仓库 repin 完成后临时允许你 push Orca」「遇到卡住必须等人的事情，请继续做不必等人的部分」「有问题先按你的建议执行。执行完在最后阶段报给我审核」。**本轮没 repin ⇒ 两条 push 授权都未触发，push 归人。付费真跑没跑**（没有非付费不可的验证）。
- **两份设计稿：各派一席独立审阅，审阅结论全部采纳，答案按控制器推荐取**（人不在，按「先按你的建议执行」），各以追加节落地、原文不动：`2026-11-11-cli-browser-login-design.md` §6、`2026-11-11-budget-defaults-and-reviewed-acceptance-design.md` §7（实现席另追加 §8「as built 与 §7 的偏差」）。**这些答案都待人审**（§八 2c）。
- **#208 `orca auth login`**（主题行 `feat(auth): CLI login requests an owner approves in the browser (#208)` 起 4 笔）：本机 socket 上的设备码——CLI 拿一次性码（8 位、`XXXX-XXXX`）与 `<panel url>/#cli-login/<码>`、开浏览器（`--no-browser`／SSH／无 DISPLAY 时只打印），已登录的 **owner** 在页面批准（member 拒 `owner-required`），**token 在 CLI 收取时才铸**（收取时复核批准人仍是启用的 owner），码与 requestId 各单次用；短轮询（1 s，不挂长连接，不拖面板关闭）；打标的派出 run 两端都拒、MCP 拒；面板重启 ⇒ `cli-login-unknown`。`orca login` 照旧（member 与隔离面板还要它）；help／skill／生成的 CLI 文档指向 `auth login`。实现席超出 §6 的选择：批准人收取前被停用或降级 ⇒ `cli-login-denied`；只绑非回环地址的面板用不了 `auth login`；Ctrl-C exit 130。Node 读不到 Unix socket 对端凭据 ⇒ 页面只显示请求方**自报**的 pid／cwd（标「未验证」），同 OS 用户的进程分不开（与 cli-v2 2026-10-22 更正同一边界）。
- **预算 A 方案**（主题行 `feat(budget): an estimate's task work is an expectation in an unlimited group` 起 9 笔）：`limit.tokens` 为 null 的组里，估算的任务 work（tokens／attempts／activeMs）**只作预期、不写成上限**：共享 transform 不再给这三维建议，**服务端**对这三维的 `model` provenance 拒 `estimate-advisory-in-unlimited-group`（proposal-edit 与 set-task-loop 都拒，旧 Web bundle 也绕不过）；人手设的有限 token 照收、保留 #225 中途停。预期**读时派生、不存**（最新 ready 且 planHash 相符的估算），组视图 `workItems[].expected{tokens,estimateId,stale,usedTokens}`、Board 卡 `card.expectation`（组内求和）、CLI `group show` 显示「预期 N · 已用 ×比值／unknown」。**有限组字节不变**（建议输出与冻结／派发 policy 的金样在改前提交上捕获）。实现席选择：`sessions` 仍给建议（spec 只点名三维）；不限额组的「to estimate」提示不再提 `apply-estimate`。§7 item 7 的两条后果**未改**：attempts／活动时间按任务整条 lineage 计（首个 run 用满默认 3 次后无 top-up 就不能再试，#234 的 attempts 维版本，待人裁）；不限额组的集成冲突 run 拿 3,000,000 默认。
- **`orca task accept-attempt <g> <t> --run <r> --note <why>`**（人专用、socket tier token；#227；主题行 `feat(control): accept-attempt records an owner's intent…` 起，含 Web）：两段式——命令只记意图（`operatorAcceptance` pending，钉住最新归档快照）；driver 在 `settled-failed` run 清理后从**归档快照**重建 attempt（不读会被覆盖的 `refs/ccloop/run/attempts/N`）、跑写集收割与判据分类、带账本合并到组分支 tip、在合并树上离线跑 setup＋必需检查、CAS 落地（tip 动了重合重查；CAS 前先落 proof，崩溃后补完不重合），一次写入 acceptance、`attempt-accepted` activity、经新的具名 writer `completeAcceptedAttempt` 置 done；账不动。失败 ⇒ `refused`＋具名原因（`check-failed:…`、`out-of-bounds:`、`criteria-<kind>:`、`merge-conflict:`），可再发。Web：任务详情的 run 列表里、owner 才见的「Accept this attempt after checks」（note 必填 ≤2048），显示 pending／landed／refused。**§8 偏差待人审**：被弱化的检查文件**拒**而非 flag；只收 `settled-failed`（`recovered` 的不收）；命令后组变 stopped／reconciling 时 driver **等**而非拒；账本记一条 code-authored `criteria`（major）决定，undo＝`git revert -m 1`。**缺口**：Web 不显示 diff stat（视图没有）；非 loop 任务的必需检查不在 Web 视图里，表单只列 loop 任务的检查；`confirmedLadderFor` 的接线无判据。**落地时抓到的真缺陷已修**：`persistedRunSchema` 是 strict 却没有 `operatorAcceptance` ⇒ 一旦记了 acceptance 整个组视图读不出（`recovery-blocked:run-invalid`），主题行 `fix(control): the group view reads a run with a recorded acceptance, and names its state (#227)`。
- **测试者 issue（按当前代码分诊后修的，四席实现）**：
  - 拆分校验（不再只靠 prompt）：#130 无 lockfile 时 setup 用 `npm ci`／不带 `--no-package-lock` 的 `npm install` ⇒ `setup-lockfile:<task>:<cmd>`；#135 `type:module` 包里 `node -e … require(` 检查 ⇒ `check-module-system:<task>[:<dir>]`；#136 读 git 历史／diff 的检查（`git diff --name-only|--stat`、`git rev-parse`、`git log`）⇒ `check-git-state:<task>[:<dir>]`，`git diff --exit-code` 放行。三条都进 `explainSplitReason`，重试提示带原因；拆分 prompt 字节不变（仍 v5）。
  - #164 `plan save --group` 把面板选的 worker／reconcile／任务 agent 折进保存的 plan（按 R7 层规则）。#125 Orca 半边：需求调用失败把 ccloop `failureCause.detail`（≤512 B）记进 call record、Web 显示在码旁；**round 的 `lastInvalidReason` 仍是 `no-output`**——改它与 ccloop 错误码 spec 2026-10-15 §4.5 冲突（`singleCallErrorCode.test.ts:37,47` 钉着），**待人裁**；flow 侧未覆盖。
  - D6 归档 staging 泄漏：bundle 与 blob 临时文件归档后（含失败）删除；**实测**：`archiveRun` 的 `captureTree(source)` 会把 ccloop `run/worktrees/attempt-N` 整棵收进归档（未改，归档体积的另一来源）。D10 落地提交正文带 `Orca-Group:`／`Orca-Task:` trailer（主题行不变；scheduler 那条落地路径没有组／任务身份，未改）。#183／D17 `run results` 人类输出逐 attempt 一行＋`recoverable: yes|no (<原因>)` 与下一条命令。D19 run 视图带 `agent{installation,model}`，`run show` 与 Live 区显示，`agent list` 标「default model」。#189 `decision list` 人类输出带 pendingId 与 approve／reject 命令。#144(b) 已确认组的 confirm 拿到面板的 `no-op-command`。#149 同一 `--command-id` 重跑：查询答多一个 `argumentsHash`（verb＋target＋payload，不含 revision），参数相同 ⇒ CLI 打印已记的结果、stderr `replayed`、不再发送；参数不同照旧 `command-id-conflict`。#122 provider 拒 `text.format`／`response_format`／`output_schema`／`json_schema` 的 400 ⇒ `run show` 与 Web 原因旁提示在该 codex 安装上设 `"structuredOutput": "prompt"`。
  - UI（#220／#221／#81／#228／#94／#219）：任务控制加载中显示中性「读取中」而非「没有任务控制面」；新需求表单显示实际会用的 agent＋模型（与服务端 `resolveSelection` 同序，`requirementAgentParity` 逐组合对拍）、拒绝先显示文字后显示码；每视图一个主按钮（无组打开时 Tasks 无主按钮、Confirm 只在 proposal 可编辑时为主）；组首屏的版本／投影号、plan hash／图版本移进 Technical；Board 卡先显示 goal、带 pause／resume／archive 菜单（只在拖拽也允许时给）；Settings → Agent 摘要显示生效的默认 agent／模型、Save 为主按钮；Problems／Live 标签带计数徽标；`web/DESIGN.md` 与注释按 R1 改成「非当前区卸载」（组详情的 region 仍挂载＋`hidden`，未改）。
- **改写的既有判据**（都带 `Ruling (2026-11-11, session f958ec3f)` 注释）：`splitSetup`、`requirementSplitItems`（无 lockfile ⇒ setup 改 `npm install --no-package-lock`／夹具补 lockfile）；`applyEstimate.test.ts:30`、`controlApi.test.ts:97`、`estimateE2E` E1（不限额组改为验拒绝＋应用 handoff）；`commandLedger`、`panelSocketE2e` 与 5 个只断言查询形状的文件（多了 `argumentsHash`）；`i18nPseudo` 枚举数 205→207（两个新 activity kind）；UI 一批（`controlI18n`、`ccloopCodes`、`requirements`、`requirementsApp`、`template`、`reviewWording`、`liveRegion`）。**只加不改**的补丁：`archiveGroup` 的「每个组 verb 都有一行」判据在 accept-attempt 合入后红，补上 `accept-attempt` 行（也验了归档组拒它）。
- **门（现测，合并前最后一个分支上，`TMPDIR=/tmp ORCA_CCLOOP_BIN=<ccloop 工作树 dist/cli.js> node scripts/test-affected.mjs --base=<上轮 handoff 提交>`）**：选 **898 文件（根 694、Web 204）**：根 6,008 过／39 跳过／2 红＝既有 `orchestration`「admits a debug group…」＋`flow/startForm` `ECONNRESET`（单跑 9/9）；Web 1,822 过／1 红＝`schedules`「renders the project's schedules…」（单跑 39/39）⇒ 负载；根与 web typecheck 0。其后合入的 accept-attempt Web＋#122 与 #149 各在 rebase 后跑了 typecheck、邻居（180/180、364/364）与 Web 全套（1,955/1,955）。每条新判据都在 `git clone --local` 副本里被点名变异打红（各实现席的变异表在其日志目录）。**全量门未跑（Rule 18）。** 日志 `/private/tmp/orca-gate-f958/`、各实现席 `/private/tmp/orca-{cli-login,ui-first,split-validators,accept-attempt,estimate-expectation,cli-archive,accept-web,command-replay}/`（都可删）。
- **装进 7777**：`npm run build`＋`npm run build --workspace web`＋`launchctl kickstart -k`；锁文件本轮未变、未 `npm ci`；`orca status` 全 ok。**真浏览器还没看过本轮任何 UI**（§八 2）。
- **清理**：7788 隔离面板（pid 99304）已停；上轮压缩 handoff 的子 agent worktree 与分支已删。`rm -rf /tmp/fb-t*`、`/private/tmp/orca-gate-c` **被权限拒**，仍在（§八 12）。
- **坑**：① 本会话 hook 报的 `orca level` 是**父会话**的数，两席实现席读到它以为自己超预算、做到一半就停——派发里要写明「忽略它」；② worktree 跑 `npm test` 时 scheduler 套件按兄弟路径找 ccloop 构建、找不到就 `ccloop bin not found`（44 条假红）⇒ 一律带 `ORCA_CCLOOP_BIN`；③ 两个分支各自重生成过 CLI 文档时，rebase 后 `drift` 会红 ⇒ 合并前在 rebase 后的树上重跑 `npm run gen:cli-docs`；④ 新 verb 要同时进 `archiveGroup` 的 CALLS 表、`accessMatrix`、`refusalCoverage`、`i18nPseudo` 枚举数。

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
- **已存结果恢复**：可恢复的来源只有带完整证据的种类——`execution-complete-before-verification-v1`（exhausted，但 execute 已完成、未进 verify；spec `2026-11-07-exhausted-attempt-recovery-design.md`）与 `ccloop-execution-without-final-v1`（OMP 干净退出但 final 严格解码失败：只凭已发布 attempt 重跑必需检查，**不带 execution／normalized hash、不重建答案、不写 decisions**）。`execution-format-failure-v1` 仍不可恢复；**历史上没有胶囊的 exhausted run 仍不可恢复**。门是来源种类、不是 outcome；不要放宽严格解码、不要伪造 normalized hash。跨仓验收 V10（verify-only）与 V11（#158）都在 pin 提交上过过（`tests/control/savedResultRecovery.paired.test.ts`）。prompt-mode codex 的 exhausted 来源由 ccloop `fix(control): a prompt-mode codex exhausted run keeps its completion source` 保留（已在当前 pin）。
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
- **其余已落地、别重做**（按当时代码核过；issue 号见 `orca_archived_files/issue-20261023.md`，它是 2026-11-06 的旧快照，**不要按它的计数接手**）：#157／#159／#164／#166／#167／#168／#169／#171／#172／#179／#180／#181／#182／#183／#184／#185／#186／#187／#188／#189／#190／#198／#199、#201／#205／#211／#213／#214／#222／#223、UI #216–#221、#62、#98–#104，以及更早各轮的 #2–#156 各项（按主题行 `git log --grep='#NNN'` 取；I1–I7 逐条状态在 `.superpowers/sdd/2026-11-05-session-3cfc2e73/issue-status.md`）。#63 的裁定（归档组 unavailable）只对「已归档的 criteria-review 判官」放行只读。
- **按事实判过、不是缺陷**：#112 根因不成立（pin 与本机都报 `transcripts:"v1"`）；#99／#110 不是缺陷；#105 在本机不适用（8 个 codex 模型都报 100 万窗口）；#165 已有精确提示；#92、#78、#200 是产品选择；#20／#24／#29／#38 判不改、#22 延后（会话 `7753e97d`）；#60 的「自动确认无限循环」从代码复现不出（每个提案版本只拒一次，C22c／C24 钉着）。
- **组间依赖边 v2**（会话 `8b1469ea`）：只定方向——计划文件可声明组依赖，agent 在确认时提议边、先连后标红——**暂不实施**。
- **需要先量再说**（旧数字在别的条件下测，同条件复测前不要当成当前故障去改）：#193／#196／#197（转录写放大、plan 成本、task 间不复用 session）、#194（OMP RSS）。#192：settle ≥5 s 时 stderr 打一行 `orca-driver: <runId>: settle took N ms (archive …, acceptance …, commit …)`，慢在哪、要不要优化待真实数据（publish／cleanup 未计时）。
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
- 真 ccloop／配对判据的 `ORCA_CCLOOP_BIN` 用 ccloop 工作树或 pin 提交克隆的 `dist/cli.js`（npm 包没有 `tests/fixtures/*`，用它跑 `multiDirLandingD` 会造出 56 条假红）；配对夹具要求该二进制所在仓库的 HEAD＝`package.json` 的 pin。配对验收：`ORCA_SAVED_RESULT_VERIFY=1 ORCA_SAVED_RESULT_CCLOOP_BIN=<…/dist/cli.js>` 跑 `tests/control/savedResultRecovery.paired.test.ts -t 'V11:'`。**跑 Orca 配对门时不要同时 rebuild ccloop**（读到写了一半的 dist ⇒ `SyntaxError … does not provide an export`）。
- 根目录 `npm run typecheck` 不查 web：另跑 `cd web && npx tsc --noEmit -p tsconfig.json`。读 `npm test` 日志要看 typecheck 段（rc≠0 不一定是测试红）。
- `npm test --base <ref>` 会被 npm 吞掉 flag ⇒ `node scripts/test-affected.mjs --base=<ref>`。测试运行期间不要改源文件（会造出竞态红）。别同时开多个门（负载 100–400 时门失去判别力）。
- worktree 没有 `web/dist` 时 panel-socket 测试会 `panel-dist-missing` 假红（`ln -s <主仓>/web/dist web/dist`，或在 worktree 的 `web/` 里 `npx vite build`）；zsh 里多文件变量用 `${=files}` 或数组。
- Tier 0 闸门：一条 Bash 一个 git，用 `/usr/bin/git -C <绝对路径>`；`for`／子 shell／`cd $VAR`／`-C $VAR` 会被判「不能判定」拦下，被拦就停、不换写法重跑；被拒的复合命令里每一步都没执行。闸门不认聊天里的 push 授权。
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
- 控制库升级前备份（`~/.orca/backups/`）：`schema14-cutover-1792329773353`、`schema15-cutover-1792586473769`、`pre-schema18-20261023-230314`、`pre-schema19-20261024-062118`、`pre-schema20-20261025-023827`、`pre-schema21-20261029-135742`、`schema22-cutover-1793909239424`、`schema23-cutover-1793941018824`、`2026-11-07-d2-o19/`；另有 `~/.orca/control-bak-20261020` 与迁移自留在库旁的 `control.sqlite.pre-v*-*`。
- `~/.zshrc` 加了 `ORCA_CCMEM_BIN`（备份 `~/.zshrc.bak-20261023-orca`）；orca-control skill 经 syncskill 装上（备份 `~/.syncskill/config.json.bak-20261023-orca`）；`~/.claude/skills/tech-writer{,-deslop,-voice}` 软链改指 `/Users/biran/code/skills/skills/runskills/skills/*`；`~/.claude/skills/orca-control` 是指向仓内的软链（改仓即生效）。
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
- 控制库：**schema 23、单向**，真实 `~/.orca` 已迁到 23（2026-11-06 会话 `86352010`；各次升级前的备份清单见 §3.A「仓库外的写」；引用前现测）（切换与回退：`2026-10-12-live-service-cutover.md`）。Linux systemd 用户服务跑通过一次（两仓全量没在 Linux 跑过；`2026-10-12-followup-acceptance.md`）。

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

### 4.0 接手顺序（会话 `5abcad7d` 2026-11-12 收尾）

1. **等人：ccloop 的 #252 `startedAt`**（Orca 半边已在 main、无 pin 不生效）。补丁在 ccloop worktree `.claude/worktrees/f-transcript-started`（分支 `f/transcript-started-at`，未提交；副本 `/private/tmp/orca-f1112/w6/ccloop-startedAt.patch`）：`listTranscripts` 已读 `process.json` 的 `startedAt`，补丁只是把它输出成 ISO 字符串并在 collect 的 strict schema 里加可选字段。它让 `tests/control/collectTranscripts.test.ts` 里 4 条 `toEqual` 整条比对的既有判据变红（「orders a phase's calls by startedAt…」「marks a call without outcome.json final…」「is absent when the run has no agent call…」「leaves out a directory it cannot read…」），改写只是在期望里加上 `startedAt`；**ccloop Rule 15 要人逐条点名**这 4 条。人点名后：提交＋新判据＋变异 → 人推 ccloop → `node scripts/pin-ccloop.mjs <sha>` repin（§3.3 做法）→ 装 7777。
2. **push 归人**：用 `ls-remote` 现核后推 Orca main 上尚未推的提交（本轮各席、控制器修复、spec／台账、handoff）。ccloop／ccmem 本轮只有 handoff 提交。
3. **人审本轮按「先按你的建议执行」定的事**（§八 2c，都可逆）。
4. **下一轮先 brainstorm 的**（人裁本轮不做需要 brainstorm 的）：
   - **empty-result 的出路**（W4 实测：在本组内**没有任何出路**，只能换新组——比开轮估计的严重，建议排第一）；
   - 需求验收标准复核（P0-1：组 done 时没有任何东西拿需求的 AC 对照交付物；`goal-review` 只是预算槽位、无调用方）；
   - plan 阶段预算（#196／#224：有限组里 plan 能吃光任务额度，ccloop 只在约 1.2× 处停、不给 execute 留额度，codex 不在内）；
   - 落地后早领下一个任务（#192：stepE 串行）；
   - 未落地决定的通用「允许这一条」（#189）；criteria-review 200k 常量的校准（#174）；
   - #243 Live 输入框（人裁「留到下一轮做」）。
5. **agent 能自己做的余项**：W2 的 `observed-floor` marker 进不了 ccloop 的已存结果恢复（`savedResultRecovery.ts` 只认 `remaining-grant`／`approximate-floor`，与 known-zero、agent principal 同一限制）；`refusalCoverage` 的 Web 文案不显示 `run-usage-not-settleable` 的细节；#193 ccloop 的 omp／codex 每段输出写两份（events＋transcript）；#170 只影响直接查库的人（outboxKinds 注释与事实不符）；合并后检查的进行中状态只在内存；accept-attempt Web 的 diff stat 与非 loop 任务检查；组详情 region 卸载（#219 残余）、依赖图层内排序（#232 残余）；D6 归档收进整棵 `run/worktrees/attempt-N`（先量）；scheduler 落地不带组／任务身份；failover 的单次调用与 flow 调用改派；第一次使用的死路：没装 agent 只能 CLI `orca agent init`、面板用 `--repo` 起时加项目要重启（违背「Web 能完成所有动作」）。
6. **等证物／先量再说**：#237（人裁先忽略）；#191、#195（context 观测要 ccloop 先能报）缺样本；#193–#197 同条件重测；#192 慢 settle 等真实数据；组级验收未在真 agent 组上见过红／绿。
7. **其余不变**：#145／#160、#174 方向、#235 不重开；全量门只在发版时跑（Rule 18）；付费真跑每次先问。

### 4.1 人做的（agent 不提醒、不代做）

- **push** 由人统一择时做；远端一律以 `ls-remote` 现测（本文不写当前哈希）。
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
6. **面板**：后端 express、前端 React；~~六个分区始终挂载，非当前区只由 CSS 隐藏~~ **已被人裁 R1（#219，2026-11-10「同意改裁定」）取代：非当前分区与 Settings 分类卸载**（`Shell.tsx` 只渲染当前区；`web/DESIGN.md` 已更正）；组详情的七个 region 仍挂载＋`hidden`（未改）；有副作用的分区按「第一次激活」才请求。`orca panel` 的 ready 行一个字节都不能改（`verify-panel.ts` 正则、`endToEnd`、`controlShutdown` 都钉着），给人看的提示写 stderr。深色 token 被 `web/tests/contrast.test.ts` 按 WCAG 比值钉着，**别往暗里调**。kind 重要性只是 UI 序（`web/src/kindRank.ts`）。**改 UI 先读 `web/DESIGN.md`**（2026-10-14 精修两轮的规则本）：颜色只由 `data-tone="info|ok|warn|danger"` 给（role 只管语义，无 tone 的 `role=alert` 仍红）；只有 `.btn-primary` 填色、每个视图一个主按钮；字号 14/18/22；浅色暖纸被 `lightTheme.test.ts` 钉、深色中性石墨被 `contrast.test.ts` 钉。导航红点只对真告警亮：「无执行端口」是琥珀 note，连它引出的 agents 读 422 也不算面板告警；info 色的 `refetchRequired` 也不点红点（提交 `fix(web): stop a projection refetch from lighting the red tasks dot`）；唯一已知例外：每次加载头 3–5 s 闪一下红色「server reset required」（首次 summary 读按规格就是 resetRequired；人在会话 fb98aa31 裁定保留规格行为）。
7. **控制面**：读视图排序用 `compareText`（code unit），**不用 `localeCompare`**；会持久化或进哈希的排序不动。不带 `sinceChangeSeq` 的 summary 恒回`resetRequired:true` 是规格，前端对「自己要的完整重读」不 purge。
8. **Orca 不许自造对端观测**；跨仓的空值／词表语义修在**产生观测的那一端**（ccloop）。`ContextObservationV1` 在 Orca 无生产者 ⇒ 真 ccloop 下`contextWindowTokens:null`，预估是 `estimate-blocked-capability`（人裁：等 ccloop 能实时观测上下文时加显式关闭值，不放宽 `null`）。G1：`targetVersion` 是正安全整数，写字符串的 plan 被 `loadPlan` 以 `malformed` 拒，不做静默转换；`handoffControl:"durable"`、`handoffExecution:"mechanical-in-run-v1"`；旧的 `durableAccept`／`ownershipIsolation`／`evidenceRetention` 是删掉的，不是迁到别的字段。
9. **预算**：`--task-tokens` 是一个任务全部阶段／尝试／续跑的**累计**上限，实际工作设 ≥1,000,000；估算 grant 是常量 `ESTIMATE_GRANT`（250k／900 s）。⚠️ Web 派活在 `blocked-capability` 时给每个任务 `complex-1m-default`（3M token、3 attempts、4 h）并覆盖 contract ⇒ **真钱跑前先 `proposal-edit` 封顶，并在 ccloop 实际收到的 `loop-contract.json` 里核**。花费上限命令只进命令台账；对账花费记 `unattributed`；`POST /api/chains` 不受花费上限约束（政策问题，未改）。
10. **skills**：只对带 skill 集的 claude run 去掉 `--disable-slash-commands`；skill 集声明在 loop 方案上、不进 ccloop 合约；profile 在 confirm 时冻结；已确认任务上声明没变就沿用冻结名单、不起 syncskill；agent kind 取自 ccloop `listAgents`，在 confirm／set-task-loop 就拒不支持的 kind。三个 skill 字段（plugin／codex／omp）互斥。**OMP 永远带 `--no-skills`／`--no-extensions`**：开 OMP 自己的发现会加载操作者机器上的任意 skill，run 不可复现。claude 下 plugin skill 以 `orca-run-skills:<名>` 出现，提示词要点名 skill 就得用这个带前缀的名字。
11. **OMP**：作为可选安装进 detect、精确模型解析、受保护 preview/apply、面板选择；模型从每台机器的 OMP 配置探测，**不把任何本机选择器（如 `local-litellm/…`）设为默认**。Git 忽略文件与主机侧写入不在 changed-path 检查内 ⇒ **不是沙箱**；一次验收是 pilot，不是可靠性。**OMP single-call（estimate／clarify／split）**：旧结论「OMP 没有逐次输出上限、会自动重试 ⇒ `singleCallExecution` 保持 null」已被人 2026-10-14 选定的方案 A＋Orca 按目录上限预占取代（选项调研 `docs/superpowers/specs/2026-10-14-omp-single-call-options.md`，设计 `…-omp-single-call-design.md` §1）：**不建计量代理**（很多人的 omp 直连 https provider，正向代理拒 `CONNECT` 会全挂）；上限与窗口**信 `omp models --json` 所选行**（含 omp 自己编的默认值，人知情）；spawn 前复核、叠加配置关掉重试／回退；omp 只服务 soft 模式。实现见 §3.3c（已在 main）。
12. **合入方案**：仓库默认＋组拷贝＋确认即批准；方法只有 `merge`／`squash`；冲突经 owner 批准后派 agent 解。改密码成功作废该用户全部会话。
13. **Results／保存成果**：按真实 owner／attempt／revision 展示；可选 token 的 `null` 只表示上限无限，不表示用量为零；保存验证只跑新的 check／verifier、只记新用量，不改写原失败与历史；旧 archive 缺真实发布命名空间 ref 时明确不可用，**不能从当前仓伪造历史证据或批准**；缺 marker／ready／worker 不证明零用量或自动执行授权。
14. **D-launch（`orca chain`）**：外部监督进程；`--goal` 必填；四条硬上限；停链＝当前会话跑完再停；闸门被改即停；拒绝嵌套；`--max-budget-usd` 是**软上限**。

### 5.3 边界

- *** **push 由人做**（人统一择时推，agent 不提醒）。*** 自 `feat(gate): let agents do the forms git protects; …` 起，agent 在 Orca 里可以 `git merge --ff-only`（含进 main）、`git branch -d`、不带 force 的 `git worktree remove`；强制形式（`-D`、`-d -f`、`remove --force`、`prune`、非 ff 合入 main、`gh pr merge`）仍被闸门拦（CLAUDE.md Rule 15，闸门 spec §11）。ccloop／ccmem 已对齐同一组形式（会话 `1710772d`）。
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
- **Tier 0 闸门**：`.claude/settings.json` 的 PreToolUse `orca dev gate --hook claude-code`＋`permissions.deny`，拦 push、非 fast-forward 合入 main、强制删分支（`-D`／`-d -f`／删 main）、强制删 worktree／`prune`、`gh` 对外写；`merge --ff-only`、`branch -d`、不带 force 的 `worktree remove` 放行（2026-10-18）。改 deny 列表要同步 `src/gate/settings.ts`，`tests/gate/settings.test.ts` 钉着它的 sha256。已知放行：写成脚本再执行、`python3 -c`、git alias、`-c core.hooksPath=`、`--no-verify`、`ExitWorktree`、`rm -rf` worktree 目录、`git -C <path> push`；已知过度拦：main 上 `git branch -f`、`merge --abort`、`rebase --continue`。威胁模型是合作型 agent 的失手，不是对抗。
- **关键环境变量**：`ORCA_CCLOOP_BIN`（本地覆盖）、`ORCA_AGENTS_TABLE`、`ORCA_SYNCSKILL_BIN`、`ORCA_CCMEM_BIN`、`ORCA_CORRECTIONS_DIR`（都是绝对路径，空＝未配置）。

---

## 八、什么在等人（awaitingHuman）

> 2026-11-11 压缩：删去已了结的条目——各轮的 push 请求（2026-11-11 `ls-remote` 现核三仓本地 main＝`origin/main`）、已做的 repin（当前 pin 是 `chore(deps): pin ccloop to the zero-usage and prompt-mode exhausted fixes`）、`~~划掉~~` 的条目、已答复的问题（UI 信息架构四问、#158／#138 方向、#162／#173 取舍、#212、profile 升 v4、#168／#179／#157、流程第一期安全裁定、soft／failover D1–D6、F5／F6、O9 claude 付费段）、已查清的 `multiDirLandingD` 间歇红与 `dev checkpoint write`「挂住」（见 §3.A）、已不存在的清理路径（`/tmp/orca158-*`、`/tmp/chk-x`、`/private/tmp/orca-{ffec7b28,0e13a9b7,b37f7ce9}`、`.claude/worktrees/tester-followup-20261108`、ccloop 的 prunable worktree，2026-11-11 现测都已不在）；同类项各并成一条。更早（会话 `a3b2a7a7`）删过的见 git 历史。

1. **push**（会话 `5abcad7d`；agent 的 `git push` 被 Tier 0 闸门拦，聊天授权不解除；本轮没 repin，人给的 push 授权本就未触发）：Orca main 上尚未推的提交（以 `ls-remote` 现核）；ccloop／ccmem 只有 handoff 提交。7777 已装上本轮代码。
2. **看真面板**（人 2026-11-11「暂时不看，我之后发现问题会再找你」、2026-11-12「先默认通过，之后有问题我会再找你」——不催）：F 轮新 UI（低频功能收进 More／「⋯」、需求表单「选项」、Board 无主按钮、member 隐藏项目控件、没装 agent 提示、交接阈值空即「未设置」、按观测下界记账按钮、empty-result 解释、预算编辑器的估算指令与 attempts 提示）与 E 轮新 UI 都只在 jsdom 测过；E 轮：转录换行／工具调用合并成一行／结果行用量／‹ › 分页与范围／run 详情移到 runs 表下方（含 390 px 宽）；Overview「已完成（N）」折叠；Memory「加载更多」；Decisions「高层级之外的重要决策」提示；浮层淡入；lilac 主题；Problems 里的组级验收行（Recheck／Waive）；需求答题「回答并结束澄清」按钮。D 轮那批同样没在真浏览器看过。
2c. **审本轮（F 轮）控制器按「先按你的建议执行」定的事**（E 轮那批人 2026-11-12 已「同意」，已删）：
   - #195 的开轮框定有误：控制器说它与 §5.2.8 冲突、人据此裁「要改」；实际 §5.2.8 管的是 `contextWindowTokens`，不冲突（spec §8 更正）。改动本身照做了。
   - #116 是**显式**确认（`charge-observed-floor`），不像不限额组那样自动（台账 C3）；准入要剩余有限且有下界；预留检查按「下界＋其后剩余」算；已证明零用量的 run 有下界时也收这个形式；flow 调用拒 `flow-call`。
   - #81：Board 没有主按钮（开始流程对话框打开时其 Start 为主）；组头「⋯」是新菜单（不是卡片菜单）；没装 agent 的提示不禁用提交；「选项」摘要显示生效的语言与上限。D21 顺带：服务端 `PATCH /api/projects/:id`（改名、目录顺序）也改为 owner 专用。
   - empty-result 文案：如实说「本组内无法重试或接受」，出路是换新组（与设计「提示重试」不同，因为重试被拒）。
   - #162 下限只管任务 work 的 attempts；handoff／goal-review 的照估算；已确认为 1 的提案照收。
   - W5 修的组级验收 worktree 竞态（每次检查独立路径＋清扫遗留）。
   - 改写的既有判据清单在台账各 W 节与 3.最新。
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
   - 会话 `ffec7b28`（台账 `.superpowers/sdd/2026-10-24-session-ffec7b28/progress.md`）：已完成的 run 不给 skip/defer；转录 C2（窗口 4 MiB）、C3（展开前只脱敏头部＋4096）、赋值名大小写不敏感、超大行展开显示解码文本；计划库放控制库而不是文件；dir 需求 D3 窄碰撞规则；R2 D7（自动确认即开跑）、D11（估算超额时非 token 维度上限随之增长）、M5（修复迁移后的旧不限 token 草稿组会被自动确认开跑）；H7 W1–W15。
   - 会话 `9ec98639`（台账 `.superpowers/sdd/2026-10-21-session-9ec98639/progress.md`）：每条线的「Criteria changed」与其余控制器决定（三处偏离——L2 是叠栈的 debug 组、系统 debug 不经估算、审阅员是完整 run——与 ccmem SIGTERM 次序修复人已同意）。
   - F13：前台 `orca panel` 保留 Web-only（agent entry spec §3／C15），要不要拒绝启动等人定（2026-11-07 只改了提示与 socket 绑定失败退出 78）。
   - 门提速候选 `.superpowers/sdd/2026-10-20-repin-w2-test-split/gate-speed-survey.md`（人还没裁）。
   - 未审完的历史轮次裁定（各台账 `Ruling:` 行）：面板项目过滤（`.superpowers/sdd/2026-10-06-panel-project-filtering/progress.md`）、Task control 刷新＋项目切换（会话 `08011394`）、syncskill 跟进（`9d95e6c8`）、面板 HTTP＋syncskill 补三件（`16ab00f2`）、UI 一轮改写的四条判据（`REWRITTEN … U1–U4`）、会话 `b39a5527` 的六条可逆决定（结清按保守额记组账、`recovered` 扣额排除出谱系等）。
9. **一揽子／历史决定**：「第二个 panel 不挂控制面」维不维持；裁决甲 `plan` 那一半未获指名授权；子系统 B 暂缓到有 `not_my_taste` 行（`~/.orca/corrections.jsonl` 2026-10-18 仍不存在）；`import-plan` 的上限按 agent 定的 task 数算；ccloop 的 `setTimeout` 溢出防护要不要对别的客户端也设。
10. **归属行**：若干提交的 `Co-Authored-By` 写的是实施席自己的模型；两笔 trailer 格式小瑕疵——**都不 amend，由人决定**。
11. **安全**：2026-09-17 一把 API key 明文进过 transcript ⇒ 建议轮换，只有人能确认。
12. **人的数据与仓库外残留（留不留、删不删、杀不杀归人）**：
    - `~/.Trash/orca-real-data-2026-09-27`、`~/.orca/backups/` 下的备份集（清单见 §3.A「仓库外的写」）、ccmem 的 `global.db.bak.*` 与 `com.ccmem.daemon.plist.bak.20261013`。
    - `~/.codex/config.toml` 里 codex 0.167.0 报已失效、被忽略的 `features.rmcp_client` 一行。
    - nvm 的 22.13.1 可以卸（Orca／ccmem／ccloop 的现行配置都不再引用它）；卸之前先关掉旧终端开的会话。
    - 临时目录（可删）：本轮各席与门的日志、变异副本 `/private/tmp/orca-f1112/`（含 `w*/mut`）。E 轮的 `/private/tmp/orca-e1111/` 与其 worktree、分支已由人在会话 `5abcad7d` 用脚本删掉（含旧 `codex/criteria-checked-input`、`codex/o19-saved-result` 两支）。
    - 本轮 agent worktree（已全部合入 main；内含未跟踪的 `node_modules`／`web/dist` 软链 ⇒ 普通 `worktree remove` 删不掉，要 `--force` 归人；Agent 建的还带 `locked`）：Orca `.claude/worktrees/agent-a855bae9ef1c9256e`、`agent-a20991a0c77f310a7`、`agent-a1694570fa7033927`、`agent-a69b4e9d72aaf3776`、`agent-aecf7f626ef81daef`（分支 `worktree-agent-<同名>`）与 `f-transcript-started`（分支 `f/transcript-started-at`）；**ccloop 的 `.claude/worktrees/f-transcript-started` 不要删**——里面是待人点名的 #252 补丁（§4.0 第 1 条）。分支合入后可 `branch -d`（rebase 过的要 `-D`，先 `git cherry -v main <branch>` 核全是 `-`）。
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
