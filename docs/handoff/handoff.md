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
> 📄 本文于 2026-10-13（会话 `808feb6a`）由约 1540 行压缩到现在的长度；删掉的过程原文在 git 历史里，取回方式见 §十。

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
- ⚠️ **验证性跑一律重定向到文件再整份读回**。`npm run verify` 是 `&&` 链，整套现在要二十分钟上下（历史观测：2026-10-10 后端全量工具报 1179.86 s；2026-10-12 根级全量门约 22 分钟）⇒ **放后台跑**，不要指望 Bash 的 600000 ms。
- ⚠️ 普通沙箱下全量会大面积红成 `spawnSync ps EPERM`／`listen EPERM`（2026-10-10、10-12 两次实测），那不是业务红；要用本机进程权限、私有 HOME/XDG/`CCMEM_DATA_ROOT`、短 `TMPDIR` 重跑，原失败日志照留。

---

## 三、当前状态（2026-10-16，会话 `a852f96a` 滚动）

### 3.1 已经做成的（都已在 Orca／ccloop 的 main 上，除非下面另说）

- **CLI**：`orca validate／plan／correct／metrics／panel／compact-reviews／level／checkpoint write／resume／gate／chain／control／mcp serve／user`（完整用法 `src/cli.ts` 的 `USAGE`）。**`orca run` 已退役、不存在**；跑一轮只能走面板／控制路径。
- **面板服务**：`orca panel install|uninstall|start|stop|restart|status|logs`（launchd／systemd／detached），整个 Web 要登录（owner／member、CSRF），socket `<stateDir>/control.sock` 给 agent 用（`orca control get|send`、`orca mcp serve`、`skills/orca-control/`）。
- **执行链**：执行驱动（worktree／clone 工作区、落地到 `orca/<group>`、解冲突 run）、④ handoff 投递与续跑、N 路并行落地、⑤ 预估链（single-call）、N1 需求澄清→拆分→确认、loop 方案层（五个内置方案＋`set-task-loop`）、合入方案（`local`／`push-target`／`push-branch`／`github-pr`）、花费上限＋按模型 token 账、Results（保存成果、预览下载）、安装观察与 owner 显式应用、Activity。
- **面板分区**：需求→任务→决策→记忆→指标→链；项目切换＋全部项目视图；依赖图与 Git 区；中英双语；记忆区只读（`ORCA_CCMEM_BIN`）。
- **skills**：loop 方案可声明 syncskill 集，confirm 时冻结，每个 run 注入只读快照。claude 走 `--plugin-dir`，codex 走 `codexSkillsDir` （每 phase 临时链 `.agents/skills/<name>`），omp 走 `ompSkillsDir`（已在 main）。
- **agent kind**：claude、codex、omp（oh-my-pi，已在 main；omp single-call 已在 main，2026-10-15 真 provider 各跑一次，见 3.3d）。
- 控制库 **schema 13，单向**（旧版 Orca 打不开新库）。真实两份控制库已于 2026-10-12 备份后升到 13，正式 `dev.orca.panel` LaunchAgent 在 7777 应答（细节、备份清单与回退步骤：`docs/handoff/2026-10-12-live-service-cutover.md`）。
- **Linux**（2026-10-12，Ubuntu 24.04 arm64 临时 VM，现已停）：Orca typecheck／构建、systemd 用户服务安装／HTTP 200／重启／停止／再启动／卸载、Orca 跨进程 repo 锁、ccloop `/usr/bin/flock` 两进程串行均实跑通过；**两仓全量测试没在 Linux 上跑过**，本机（macOS）也验不了原生 `/usr/bin/flock`。证据见 `docs/handoff/2026-10-12-followup-acceptance.md`。

### 3.2 还不能说的（**诚实边界，原样保留**）

*** **「Web 派活可用」「claude 可用」「分层选择可用」「OMP 可用」都不是事实。** *** 能说的只有下面这些 **n＝1** 的跑通，各以所列台账为唯一可引表述：

| 什么在真 agent 下跑通过一次 | 时间／会话 | 唯一可引的表述 |
|---|---|---|
| 真 codex 单任务主链（gpt-6-luna，服务层不含 HTTP） | 2026-09-25 `af3dc0d3` | `.superpowers/sdd/2026-09-25-live-acceptance/progress.md` §5 |
| 真 claude 单任务主链（2.1.283、claude-opus-5-5） | 2026-09-27 `43e3e1d8` | `.superpowers/sdd/2026-09-26-agent-selection/progress.md` §14 |
| 真 claude 1M 窗口单任务；两任务一处冲突经 `ccloop run --agents` 解开 | 2026-09-27 `4d2e426e` | 同一台账 §20 |
| claude 阶段中止前的 stream 用量（第二次 `--task-tokens 400000` 跑通） | 2026-09-27 `5b01dbd9` | `.superpowers/sdd/2026-09-27-claude-stream-usage/progress.md` §3 |
| N1 澄清→拆分→确认→导出（落地两次都被挡，随后由 ccloop R-A／R-B 修） | 2026-10-02 `b5e8d368` | `.superpowers/sdd/2026-10-02-requirement-to-split/progress.md` |
| 杀掉 ccloop → runner 自退 → `ccloop resume` 续跑成功；R-A／R-B 再验 | 2026-10-02 `ece96b67`／`7fe6d61b` | ccloop 仓 crash-resume 台账末节 |
| 面板 HTTP 路径单任务（claude 2.1.288） | 2026-10-03 `16ab00f2` | `.superpowers/sdd/2026-10-03-panel-http-live/progress.md` |
| 带 syncskill（`names` 声明、standard 方案）的 claude 单任务 | 2026-10-03 `9d95e6c8` | spec `2026-10-03-syncskill-integration-design.md` §12 与该轮台账 |
| 真 Codex plan／execute／verify 落地（**用 ccloop 本地修复构建**，非正式 pin），102919 tokens | 2026-10-12 | `docs/handoff/2026-10-12-followup-acceptance.md` |
| 真 OMP（本机 LiteLLM 别名）plan／execute／verify 落地 `answer.txt`=`42\n`，27729 tokens，独立审计通过 | 2026-10-12～13 | `docs/handoff/2026-10-12-oh-my-pi-acceptance.md` |
| 真 OMP single-call：clarify、split 各一次通过；estimate 调用链路通过但答案被判 `estimate-output-invalid`（模型把任务列两遍） | 2026-10-15 `026d10e3` | `.superpowers/sdd/2026-10-15-omp-single-call-acceptance/progress.md`（分支 `test/omp-single-call-acceptance`） |
| 真 Codex single-call（gpt-6-luna，codex-cli 0.160.0，一行提示，经 ccloop `control accept` 的隔离单次调用，**不经 Orca**）：P1c（MCP 修复后）、P1d（终审 I4 后）各通过一次，input 10811／10109 token | 2026-10-16 `a852f96a` | `.superpowers/sdd/2026-10-15-every-agent-requirement-chain/p1c-report.md`、`p1d-report.md`（台账 P1c／P1d 行）|
| 真 OMP 需求链（Orca `live-driver-acceptance` 隔离世界）：open／clarify／split 通过；estimate 冷缓存 `ready` 一次、热缓存被判 `estimate-output-invalid` 一次；目录缓存：每个冷缓存 1 次 `omp models`、热缓存 0 次；14225 token | 2026-10-16 `a852f96a` | 同一台账目录 `p2-report.md`（台账 P2 行）|

**没在真 agent 下验过**：依赖、崩溃恢复、strict 组、真 codex 下的 handoff（真 codex 只在阶段末报 usage ⇒ deadline 中止多半不可续且挡整组）、真 claude 下的 single-call 估算（`--tools ""` 与输出上限只有静态证据）、混 kind、真 codex 下的冲突、带 skills 的 agent verifier／profile 声明／多任务、**OMP 带 skills 的任何真 provider 跑**、正式 owner 登录后的 Results／Memory。真 Claude 隔离任务 2026-10-12 撞周额度未跑完。
**驱动环只在 port `configured` 时挂；未配置时行为逐字节同前。**
**Codex 只支持 `phase-end`＋`soft`：任何地方不许宣称 strict token 封顶**；软 token 预算也不能说成严格金钱上限。Codex single-call 是 `"v1-soft"`：输出上限**事后核对、不封顶**（超界显示在记账旁），只在 soft 估算模式下被接受（会话 `a852f96a`，已在 main）。

### 3.2a 会话 `4de777f4`（2026-10-17）「花了钱就一定要拿到能用的估算」一轮 —— **先读这一节**

- **已由人合推进 main 并删了分支和工作树**（会话 `d0843ec0` 现核远端；之后人又经 agent 把 `~/.orca/profile.json` 切到 `instructionVersion: "2"`，备份 `~/.orca/profile.json.bak-20261017-v1`，面板已重启）。原分支 `codex/round-20261017`。依据：spec `docs/superpowers/specs/2026-10-17-estimate-usable-answer-design.md`（自审＋builder check＋独立审阅后修订）＋计划 `docs/superpowers/plans/2026-10-17-estimate-usable-answer.md`（7 个任务，subagent-driven，每个任务一席实施＋一席审阅，终审一席＋一波修复）。台账（全部 `Ruling:`、deferred minors、事故）：`.superpowers/sdd/2026-10-17-estimate-usable-answer/progress.md`（`git add -f` 入库）。
- **人的原话**：「花了钱就一定要拿到能用的结果」；Orca 自己修「能接受」；修不好「希望 Orca 自动再调一次」；「这个 session 中允许改必要的判据」；「这一轮都同意付费验收」；codex 只测 `gpt-6-luna`（`gpt-6-sol` 无额度）。
- **落了什么**：① 确定性修复（`src/control/estimateRepair.ts`：v2 换形、schema 名、planHash 照抄、assumptions 清洗、未知任务丢弃、重复任务取第一条可用的、重排；占位 rationale 名单钉死；模型文字一律过 `modelText` 去孤立代理对、按码点截 200 单元）；② 结算先修后判（`completeEstimateInStore`，记录 `repairs`）；③ 指令 v2＋按计划生成的、以 taskId 为键的响应 schema（v1 字节不变，哈希钉住）；④ **一次**自动重试（`src/control/estimateRetry.ts`：非抛出的判定、`retrySkipped` 码、新估算行＋带 `retryProblems` 的合同＋wake；不是命令台账条目）；⑤ 面板显示「已修复／第 N 版的重试／已重试为第 N 版／未重试：<码>」；⑥ 验收脚本 `--scenario estimate` 支持 `--codex`、`--instruction-version`、`--repeat`、tally，且默认把 `CCLOOP_CACHE_DIR` 放进 `--output`。同分支更早几笔：handoff、`taskResultPaired` 改写、默认 `testTimeout` 20 s、面板模型刷新改 owner-only POST＋75 s 读超时。
- **门**（全新 clone，观测提交＝主题行 `fix(acceptance): keep ccloop's cache under --output unless the caller set one`，即终审修复**之前**一笔；`ORCA_CCLOOP_BIN`＝ccloop `02cbacc` build；负载 15→55）：ci／web build／typecheck／build／pin／scheduler 0；全量 3950：3912 过、36 跳过、2 红＝`schedulerBridge` 30 s 超时（登记形状）＋`loopPlanE2E` 在负载 42 下 `git worktree add` 失败（待单跑）。两条单跑 2×10/10 绿；`verify:control` 2042 过／30 跳过／0 红，`verify:chain` 第二次全量 3914 过／36 跳过／**0 红**，panel／`--ws check` 1141／claude-md／tmpleak 0，`~/.orca` 哈希不变 ⇒ **门过（分类后）**。**5 s 超时形状已不再出现**（20 s 默认生效）。终审修复（主题行 `fix(control): keep model text in estimate codes canonical so the settlement never throws`）之后只跑了 9 个受影响文件 94/94＋typecheck。
- **付费验收已跑**（会话 `d0843ec0`，2026-10-17，clone 在主题行 `docs(handoff): hand off at T2 with the paid acceptance and the post-fix gate next`，ccloop `02cbacc` build，`--instruction-version 2`；报告 `.superpowers/sdd/2026-10-17-estimate-usable-answer/paid-acceptance-report.md`）：
  - omp 别名 ×5：tally firstCallReady 4／readyAfterRepair 0／readyAfterRetry 1／failed 0；第 1 次首调 `field-invalid:groupRationale`，**自动重试一次即 `ready`**；6 次调用里没有一次「任务列两遍」（v1 时此别名 4 次里 3 次）；6 次调用合计 17854 token（in 14122／out 3732）。
  - claude 1M ×1：firstCallReady 1，6354 token，claude 自报 `total_cost_usd` 0.057268。
  - ⚠️ **codex gpt-6-luna ×1 没测成：账号额度用完**——codex 自己答 `You've hit your usage limit … try again at Oct 22nd, 2026 2:13 PM`，用量 null ⇒ Orca 按既定处理阻塞为 `estimate-usage-unknown:codex-exit-error`、估算停 `running`，脚本等满 900 s 退 1。人裁「codex 额度没了就记下来，先跑全量门」⇒ **codex 这一项欠着，额度恢复后补跑一次**（付费，先问人）。
  - `~/.orca`、`~/.cache/ccloop` 前后只差家目录自身的 mtime；`~/.codex` 凭据 `cmp` 0。
- **终审修复之后的全量门已过**（会话 `d0843ec0`，全新 clone、观测提交同上）：全量 3958＝3922 过／36 跳过／**0 红**；`verify:control` 2050 过／0 红；`verify:chain`／panel／claude-md／tmpleak 0；`~/.orca` 哈希不变；`--ws check` 1140/1141，唯一红是登记过的 `taskLabelsDraftBase` `findByRole` 超时，单跑 3/3 ⇒ **门过（分类后）**。门脚本的 `~/.cache/ccloop` 比对 RC 1：真 codex 安装键的目录条目 11:17 被重写，键指真 `~/.codex/config.toml`，而判据全部改道了 `CCLOOP_CACHE_DIR`／`CODEX_HOME` ⇒ 是**正在跑的面板服务**写的（服务 env 没设 `CCLOOP_CACHE_DIR`，按设计用 `~/.cache/ccloop`），不是门。
- **会话收尾**：会话 `4de777f4` 越过 Rule 6 的 T2（451599／450000，检查点已记这次越线）后交接。本地 main 上的两笔检查点（主题行 `chore(checkpoint): orca-dev-4de777f4, …`）已由 agent 合进本分支（主题行 `Merge branch 'main' into codex/round-20261017`），所以门过后人可以直接 `--ff-only`。**下一会话先做 §4.2 第 0 条，再在本分支 tip 上跑一次全量门**（上一次门没覆盖终审修复）——两件都已于会话 `d0843ec0` 做完（见上，codex 一项欠着）。
- ⚠️ **已知缺口**（登记不修）：排队中的自动重试（会话 `a3b2a7a7` 2026-10-18 读码更正，**未跑测试**）：①**提案被确认**或②**被人的新估算取代**之后，`claimEstimate`（`src/control/webService.ts`）不复查 `decideEstimateRetry` 的那几条，**照样领取并真跑**（花钱但结果用不上）；③**组已开跑**时并不会真跑——`prestart(group)` 抛 `grant-amendment-unsupported`，`deliverSchedulerWakes` 吞掉异常、wake 每轮重投，估算**永远停在 `queued`、它的 grant 一直算在 `committedRemaining` 里**（人的排队估算同样如此）。修法**人已裁**（2026-10-18，会话 `a3b2a7a7`，人原话「同意你上面所有的建议」）。控制器建议原文：①新增终态 `withdrawn`，带原因码 `group-started`／`proposal-confirmed`／`superseded`，释放 grant、不触发重试，面板显示「已撤回：<原因>」（不复用 `failed`——那表示答案不合格且会走重试判定；不删行——留证据链）；②**所有排队估算一起管**，不只自动重试（判据是「结果还能不能用」，与谁排的队无关；卡死问题人的估算本来就有）；检查放在领取时、用代码。**尚未实施**：要改 spec（`2026-10-17-estimate-usable-answer-design.md` §4.3「保持既有排队估算行为」那句需另起一节更正）、估算记录与视图 schema、面板两种语言；空白 rationale 能过（占位名单是 spec 钉的，改要人裁）；fake codex／claude 不走 retryOutput，`readyAfterRetry` 只有 fake-omp 覆盖。
- ⚠️ **事故（Rule 17）**：Task 7 实施席有一次 fake codex 跑在改道缓存前，往**真** `~/.cache/ccloop/agent-catalog/` 写了 8 个路径（`769de7de….json` 与 `codex-home/bf533527…/`，内含指向 `~/.codex/auth.json`／`config.toml` 的软链；凭据本身未改）。清单 `/private/tmp/acc-xpI0/ccloop-cache-new.txt`。未删，归人（§4.1）。脚本已修成默认改道。
- **人用真面板时跑门**：真面板写 `~/.orca/control/panel` 会让测试的 Rule 17 守卫在文件级报红（会话 `4de777f4` 上一轮门约 50 个文件），不是测试写的；跑门挑人不用面板的时段。

### 3.3 会话 `a852f96a`（2026-10-15～16）「每个 agent 都能跑需求链」一轮 —— **先读这一节**

- **上一轮已收口**（本会话 `ls-remote`＋`merge-base --is-ancestor` 现核）：会话 `ec9ce319` 的 Orca `codex/round-20261015b`（repin 到历史 pin `71053e3`、终审 m2／m6、spec＋计划、验收脚本 `--estimate-only`）与 ccloop `codex/attempt-commit-no-hooks` **人都已合推**。那一轮的台账 `.superpowers/sdd/2026-10-15-round-b/progress.md`（m5／m7 人裁不修的理由在那里）；它的门过了（只剩登记的负载 flake 与固定红），数在 `known-load-flakes.md` 的 `ec9ce319` 条；spec R1–R9 与零成本实测在本轮 spec 头与 §2；ccmem `core.hooksPath` 已 unset（没改成新绝对路径，免得再搬家又坏）；**现有 codex 阶段调用仍带着人的 skills／AGENTS.md**（spec §11.5，登记未修）；真 OMP estimate「任务列两遍」见下面 P2。
- **依据**：spec `docs/superpowers/specs/2026-10-15-every-agent-requirement-chain-design.md`（⚠️ 末尾 **§11「实现后的更正与登记」与正文不一致处以 §11 为准**：codex 私有 home 的 Rule 17 登记、§2.5 最终 `-c` 列表、真探针发现、哪些读保持实时、残余）＋计划 `docs/superpowers/plans/2026-10-15-every-agent-requirement-chain.md`。台账（全部 `Ruling:`、人的原话、付费跑、门的原始数）：`.superpowers/sdd/2026-10-15-every-agent-requirement-chain/progress.md`，整个目录（brief、报告、评审 diff、`final-review.md`）`git add -f` 进本分支。
- **落了什么**（两条分支**都已由人合推**，会话 `4de777f4` 现核；合并后的收尾见 §4.1 第 1 条）：
  - **ccloop** 分支 `codex/every-agent-chain`（工作树 `ccloop-wt/every-agent-chain`，**人已合推进 ccloop main＝`02cbacc`**（会话 `4de777f4` 现核），代码 tip＝主题行 `fix(agents): codex single call also turns off the other on-by-default tool flags and notify`，其上一笔 handoff）：
    - 目录与 `--version` 的**文件缓存**（`feat(agents): cache file for agent catalogs, keyed by binary and config stamps`、`feat(agents): read every catalog and version through the file cache`）：`$CCLOOP_CACHE_DIR`（缺省 `~/.cache/ccloop`），键含二进制与配置 stamp，30 分钟；**版本号也缓存**（人裁）；检测、`agents validate`、`updates.ts` 的版本探测与 Apply 的复核**按设计保持实时**（spec §11.4）。
    - 探测进调用方时限与 abort、失败报阶段（`feat(agents): catalog probes honour the caller's deadline and abort and name their stage`、`fix(omp): the spawn-time re-check and the single call share one deadline`）。
    - 新 control 方法 `models`／CLI `agents models [--refresh]`（`feat(control): list an installation's models (control models, agents models)`）。
    - codex `singleCallExecution: "v1-soft"`＋取 `codex debug models` 的窗口（`feat(agents): codex resolves a soft single call and its catalog window`）；codex 单次调用（`feat(runtime): codex single call, tools off in a private home, bound checked after the fact`），之后几笔修：私有目录是软链即拒、**从不删正规凭据**（挪成 `<名>.displaced-<epoch ms>`）；codex 的 `error` item 当诊断；链进来的 MCP 服务按名 `-c mcp_servers.<名>.enabled=false`；MCP 名单在调用同一隔离下列、列失败不丢目录；终审 I4 再关掉其余默认开的工具类 flag＋`notify=[]`（都按已装的 `features list` 过滤）。
    - claude 默认档窗口报 200000（`feat(agents): report claude's 200000 default window (ERRATUM on the unknown-window note)`）。
    - 夹具改动（点名给人）：`tests/setup/relocateCatalogCache.ts` 给每个测试文件一个空 `CODEX_HOME`（否则判据读到人的真 `~/.codex/config.toml`）。
  - **Orca** 分支 `codex/every-agent-chain`（工作树 `Orca-wt/every-agent-chain`，自带真实 `npm ci`；从 main 上本会话第一笔检查点切，main 之后又多两笔：检查点＋人的 `handoff_ui.md` 提交）：R7 声明 null 的窗口取 ccloop 观测值（`feat(control): a declared-null context window takes ccloop's observed window (R7)`）；soft 估算模式下才接受 codex 软单次调用（`feat(control): accept codex's soft single call in soft estimate mode only`）；单次调用输出超界显示在记账旁（`feat(control): show a single call's output overrun beside its booked usage`＋修：估算契约不可读即拒读）；面板模型清单 API（`feat(panel): serve an installation's models from ccloop`，缺安装 422 `agent-installation-missing`、未具名的 ccloop 失败 424）与 web datalist（`feat(web): offer omp and codex models as a datalist with refresh and the unavailable reason`＋修）；README 两笔、spec §11、删已不成立的死文案 `codexUnsupported`。**Task 15（repin）已做**（会话 `4de777f4`，2026-10-16 晚）：人推了 ccloop（H1，`ls-remote` 现核 main＝`02cbacc`），`chore(deps): repin ccloop to 02cbacc for the every-agent requirement chain`，`pin-ccloop.mjs` 7/7 ok；repin 门过（§3.4）。
- **人的裁定**（2026-10-15～16，本会话）：计划第 8 条＝**缓存版本号**（shim 背后的升级最多 30 分钟看不见）；subagent-driven；Task 0 与 Task 8 的凭据软链批准——人问「每次都要重建吗」⇒ **每个安装键复用一个私有 `CODEX_HOME`**：`<cache root>/codex-home/<sha256(安装键)>/{home,codex-home}`，目录 0700／文件 0600 显式给，每次调用复核链接；两个写入方（目录 miss 探测与单次调用）都在 spec §11.1 登记；无 cache root 时退回 run 目录下。E1–E6 六条改写全部批准。人点名 ccloop `tests/runtime/omp/ompSingleCall.test.ts`「stops the call at the request's time limit…」改写（先热缓存、仍断言 `omp-timeout`），并新增「冷缓存＋复核超过调用截止 ⇒ spawn 前拒、报阶段与耗时」。人一揽子授权「改其他必要判据也同意」——本轮只用了三处，都在本分支新建的文件里、仍是精确 `toEqual`、旁边有 `Ruling: rewritten under the human's blanket naming…` 注释：ccloop `tests/agents/agentCatalog.test.ts:42`（codex 热缓存 spawn 数 `[2,4]`→`[2,5]`，多一次 `mcp list`）、`tests/agents/catalogProbe.test.ts:150`（答案多 `mcpServers: []`）、`:153`（多 `mcpError: null`）。P1／P2 付费验收人答「=> 授权」，随后「重跑也授权，这一轮不要再问我」（**只限本轮**）。人还说本会话不计上下文、执行中有问题按控制器建议做、最后报人审。
- **付费跑**（只抄工具报数；没有任何工具报美元）：
  - **P1**（gpt-6-luna，真 codex-cli 0.160.0，经 ccloop `control accept`，不经 Orca）：失败 `codex-single-call-not-single:tool`——codex 发了 3 个 `error` item（人 `config.toml` 的 `features.rmcp_client` 被忽略 ×2、我们自己设的 `skip_host_skill_discovery` 的 under-development 警告 ×1），且链接进来的 `config.toml` 的 MCP 服务**被启动**。input 11590／cached 0／output 15，ccloop 记 11605。
  - **P1b**：codex RC 1、245 ms，无工具报出模型请求、无 token 报数（ccloop 记 null）——MCP 名单是在真 `~/.codex` 下列的（含 plugins 共 6 个名字），给隔离配置里没定义的服务下关闭项让 codex 配置加载失败。
  - **P1c**：**通过** `{"answer":"Paris"}`，一个 turn、1 agent_message＋3 error、无 MCP 启动；input 10811／output 15，ccloop 记 10826，activeMs 5491。
  - **P1d**（终审 I4 之后）：**通过**，29 个 `-c` 键 exec 全收，无 MCP 启动、stderr 0 B；input 10109／output 15，ccloop 记 10124，activeMs 10502。四次 P1 的 `~/.codex` 凭据与 `mcp-oauth-locks` 前后 0 字节差、私有链接完好、无 displaced 文件。
  - **P2**（omp 18.10.1＋人的 LiteLLM 别名；Orca clone 在 `fix(control): refuse a models answer that does not echo the requested installation`，ccloop 为 `test(agents): count catalog entries apart from codex-home in the relocated-HOME criterion` 的 build）：open、clarify（2425）、split（2649）通过；冷缓存 estimate **`ready`**（3946，此别名上第一次）；热缓存 estimate 被判 `estimate-output-invalid`（3205，任务列两遍＋`"placeholder"`——此别名 4 次真估算里第 3 次同形，记为模型质量）。合计 14225（in 8075／out 4150），omp `cost.total` 0。**缓存实测**：每个冷缓存恰 1 次 `omp models`（约 3.4 s），热缓存 0 次（`agents models` 0.14 s、`source: "cache"`）；spec §2.2 估同样步骤无缓存约 10 次。每次运行时启动仍有 1 次不走缓存的 `omp --version`（安装观察，按设计实时）。`~/.orca` 不变、`~/.cache/ccloop` 不存在。
- **门**（都在 clone 里、各段单取 RC；原始日志在会话 scratchpad，会话结束即失效，结论只在这里与台账）：
  - ccloop run 3（主题行 `test(agents): count catalog entries apart from codex-home…`，负载 9–15）：typecheck／build 0；全量 1824/1826；`check-known-reds` RC 1（roster 6／failed 2／unexpected 2）；`verify:control` 866/866；tmpleak 0。2 红＝`verifySavedResult`「r1 command interruption modified=true…」与 `codexAdapter`「outer watchdog kills… TERM-ignoring detached Codex」，各单跑 3/3、run 2 里也红过 ⇒ 负载 flake。
  - ccloop run 4（代码 tip，负载 7→19，与控制器的 web 检查重叠）：全量 1810/1826、16 红；`check-known-reds` RC 1（6／16／14）；`verify:control` 865/866（`extractFinalObject` 3 s 阈值）；tmpleak 0；10 个红文件单跑各 3/3 ⇒ 全判负载 flake（明细在 `known-load-flakes.md` ccloop 段）。控制器裁：ccloop 以 run 3＋run 4 接受（I4 的增量是 `-c` 列表，有自己的判据，P1d 在真 codex 上过）。run 1（陈旧 tip、负载到 184）不计；run 2 抓到唯一真红（本分支新判据 `agentCatalog.test.ts:110` 没把 codex-home 分开算），已修后才有 run 3。
  - Orca Task 16（主题行 `fix(web): number model-list reads, skip a background read in flight, keep a read list on screen`，**旧 pin**，`ORCA_CCLOOP_BIN`＝ccloop run 3 那笔的 build，fake-only 安装表）：typecheck／build／web build 0；全量 3842/3889、33 跳过、14 红＝12 条超时＋`taskResultPaired`×2；`verify:control` 1978 过／3 红（同形）；`verify:scheduler` 202/202；`verify:chain` 只剩 paired×2；`verify:ccloop-pin` 0（旧 pin）；`verify:panel` 0；`--ws check` 1137/1137；`CLAUDE.md` 行数 0；hooksPath 1＝新 clone 没设 `core.hooksPath`（环境）；tmpleak 0；七个新的真 ccloop／特性文件全过、无跳过；`~/.orca` 32 个哈希不变。⇒ **门过（分类后）**。其后的 Orca 提交只有 README／spec／删 locale 死键（web build／tsc／vitest 1137/1137 另跑）。⚠️ 这个门的 ccloop **不是**最终 tip（I4 改了 `-c` 列表）⇒ repin 门要拿最终 ccloop 的 build 重跑真 ccloop 判据（§4.2）。
- **登记的残余**（以 spec §11.5 为准，下面是它没写全的）：
  - refresh token 经 `auth.json` 软链轮换**未验**：P1c 时没发生刷新。codex 若以临时文件＋rename 写新 token，它落在私有目录；下一次调用把它挪成 `.displaced-<ms>`（保留不删）再链回 `~/.codex` 里较旧的那份 ⇒ 人用 `codex login` 恢复。能人为触发轮换时再测。
  - keyring 存凭据（`cli_auth_credentials_store`）没有 `auth.json` 可链 ⇒ 调用以认证错误 fail closed。
  - control worker 的 `ccloop-agent-catalog:` 日志行**没有生产 sink**（`workerLauncher` 以 stdio `ignore` 起 worker），只有判据看得见。
  - ⚠️ **框架开销（归人，`~/.orca/profile.json` 的 profile 级值，`~/.orca` 本轮未动）**：codex 一行提示词的单次调用，工具报 input **10109–11590** token（P1 11590、P1c 10811、P1d 10109），spec 原估约 1.5k；OMP 约 2047（上一轮 Task 0）。
  - spec §11.5 末条「I4 的 flag 与 `notify=[]` 只在渲染期核过、没有付费调用跑过」写于 P1d 之前：**P1d 之后** exec 收下全部 29 键并通过；但 `notify=[]` 是否真挡住人的 notify 程序**仍未量**。
  - 合并顺序（终审）：Orca 分支在旧 pin 上运行期安全（旧 ccloop 不发 `"v1-soft"`），但每次读 agents 都发 `control models`，旧 ccloop 拒 ⇒ omp／codex 的模型框全显示「model list unavailable」、每个安装起一个失败的 ccloop 进程 ⇒ **与 repin 同落**。⚠️ **R7 一合进 main 就生效、与 pin 无关**：真实 profile 声明 null 窗口时，omp 与 claude-1M 的导入会开始**真跑付费估算**（原来是 `blocked-capability`）——人要预期合并之后开始花钱。
- **值得留的 deferred 小项**（全文在台账 `minor (deferred)` 行）：点号 MCP 名的 codex 单次调用直接拒；lstat 与建链之间的同用户 TOCTOU（最坏：真 `auth.json` 被挪开、字节保留）；已存在的世界可写 `<cache>/codex-home` 不动（不改已存在的 mode）；codex 安装键只用 `command[0]`；两条 7500 ms 界的冷复核判据只留约 0.7–1 s 余量（负载下红就放宽）；`readAgentCatalog` 的 `env` 只影响缓存目录与键；Orca `GET …?refresh=1` 不带 CSRF 头（SameSite=Strict cookie 挡跨站，要更严就改 POST）；`controlGet`／`fetchAgentModels` 无超时（卡住的后台读会挡住该安装的后台重读，直到 owner 点 Refresh）；严格的 `ccloop-models-v1` schema 要求 ccloop 先升 literal 再加字段；ccloop 历史 spec／plan 里「claude 窗口 null」的文字是 ERRATUM 候选（`docs/superpowers/specs/2026-09-24-g1-control-wire-contract-design.md:134,165-166`、`docs/superpowers/plans/2026-09-24-g1-capability-vocabulary.md:76,123,173,288,293`），未改。
- **仓库外与进程**：控制器杀过本会话自己的 3 个挂起 fake-omp 与 14 个孤儿 `worker.js`（路径都在本会话 clone 下）；一席实施子代理为比对跑过一次只读 `codex mcp list` 对真 `~/.codex`（`auth.json`／`config.toml` 大小与 mtime 不变，已报人）；Task 0 的两条凭据软链已删。
- **上下文**：本会话越过 T1、T2（检查点 `chore(checkpoint): orca-dev-a852f96a, …` 两笔在 Orca main 上，本地未推）。

### 3.3d 会话 `026d10e3`（2026-10-15）的结论（三条线已由人合推，会话 `ec9ce319` 开工时现核）

人授权本会话不考虑上下文大小（检查点记了 T1／T2 越线），并授权「执行中有问题先按 agent 的建议执行、最后报人审」——本会话的全部 `Ruling:` 在 `.superpowers/sdd/2026-10-15-error-codes-and-start-guard/progress.md`（本分支 `git add -f` 入库）。

**已在 main（人已合推）**：repin（`chore(deps): repin ccloop to dc51022 for the omp single-call and catalog diagnostics`）。门的结论见 §3.4。

三条线的内容：Orca 错误码显示（A1–A8）＋#53 start 守卫（B1–B3）＋#61＋`VIEW_REASONS`＋终审修复波次＋Task 13 验收证据（cherry-pick 自 `test/omp-single-call-acceptance`，原分支作废待删）；ccloop attempt 提交关钩子＋registry 标题；ccmem handoff 一笔。repin 在会话 `ec9ce319` 的 round-b 分支上，已由人合推。

- **错误码显示（spec `docs/superpowers/specs/2026-10-15-ccloop-error-codes-design.md`，#58 Orca 半＋omp single-call spec §8「上限拒绝看不见」）**：
  - ccloop 进程失败（`control-peer-exit`）在 HTTP 上答 **424 `ccloop-failed`**，消息 `ccloop-failed:<ccloop 码|unknown>[: <细节≤512>]`，web 当作确定的拒绝（≥500 才是「不确定」）。⚠️ 例外（计划更正 K2）：`apply-agent-update` 在保留 outbox 行之后才调 ccloop ⇒ 那里的 peer exit 仍答 500（不确定，待对账）；`hasPendingAgentUpdate` 那一合取登记为冗余守卫。
  - 存储码改存 ccloop 原码（`peerCode`），分类仍按 `error.code`（预览 unavailable／rejected 不混）；`describeError`／`accept-refused` 存截断形式；single-call 记录的 `errorCode` 规范化后进 estimate 的 `reasonCode`（`estimate-call-failed:<码>`）、clarify／split 的调用记录（`outcome: "failed"`）与 usage-unknown 的阻塞原因；**送进下一次提示词的文字不变**（`lastInvalidReason` 仍是 `no-output`）。
  - `omp-single-call-cap-exceeded`／`omp-single-call-unavailable`：clarify／split 不自动重试、需求直接失败；**人点 group 重试时按冻结的 `agentSlot.selection` 重算上限**，profile 或探测失败则照旧用冻结上限并记一行日志（不新增拒绝）。
  - web：`web/src/ccloopCodes.ts` 统一解释（ccloop 表 → Orca 表 → 中性的 `<码>: <细节>`，人裁 R3：兜底文案不说「ccloop」），所有显示面「解释与码相同时只显示一次」；424 通知同时显示 ccloop 码与细节（终审 I1）。
  - 仍「未知」的 ccloop 失败路径各写一行 `orca-driver: <runId>: ccloop <码>: <细节>` 日志；其中 6 处无判据（人裁 R4，登记缺口）。
- **#53（spec `…-start-guard-and-running-plan-edits-design.md`）**：
  - 「组在执行」只有一个判定（`src/control/executionPending.ts`，视图与服务端共用）：未投递的 `start`／`no-start`／`resume` wake，或 `phase === "work"` 的活跃 run，或 BUSY_WORK（含 `held`）。estimate／clarify／split 的单次调用 run **不算**。
  - 组在执行时 `start` 答 **409 `group-execution-pending`**（HTTP、socket、CLI、MCP 同一码），在调 agent 探测**之前**就进命令台账、事务内再查一次；优先级：preflight → `requirement-not-split` → `group-execution-pending` → 其余。
  - `set-task-loop`：组在 `running`／`review`／暂停时也可改**未开始**的任务；交接停止、关闭中、`stopped` 无 intent、`done`、`blocked` 仍拒；已开始的任务仍 `task-already-started`。LoopPlanCard 同步。
  - ⚠️ 测试夹具改动（人裁 R1，点名给人）：`tests/control/fixtures/driverHarness.ts` 的 `claim()` 在已有待投递 wake 时走驱动的投递路径、没有时才补发，挡住的 40 条既有判据因此回绿；`handoffFailedRetry` 的 `reopen()` 同理；`shutdownHealing` 那条改成「愈合后投递队列里的 wake 答 `claimed`、再 start 答 `group-execution-pending`」。
- **小项**：#61 Runs 表的 attempt 写明「本 run 内第 N 次」并在旁显示任务第几个 run；`codex-rate-limited` 进 `VIEW_REASONS`；ccloop registry 标题更正（在 ccloop 分支）。
- **改写的既有判据**（每条都由 spec／计划／人点名／台账 `Ruling:` 覆盖，终审核过 12 条全有出处）：`agentSelectionApi.test.ts`（500→424）、`driverEstimate.test.ts` 两处、`driverRequirementSplit.test.ts:57`、`setTaskLoop.test.ts:24-31`、`loopPlanEdit.test.tsx`、`budgetI18n.test.tsx:150`、`controlI18n.test.tsx` 两处（#61）、`agentsI18n.test.tsx:126`（被拒槽位多一句 Orca 解释，台账裁定）、`shutdownHealing.test.ts:142`（台账裁定）。
- **Task 13（真 OMP single-call 付费验收，人同意）**：omp 18.10.1＋人的 LiteLLM 别名 `local-litellm/ep-20261012204110-nvhqw`（窗口 128000、上限 16384），隔离世界里 estimate／clarify／split 各一次：每次恰一条 assistant `message_end`、`stop`、工具关、叠加生效、Orca 记账＝ccloop usage（3226／3327／3431 token）。clarify／split 通过；**estimate 被 Orca 判 `estimate-output-invalid`：模型把任务 `a` 列了两遍（第二份 rationale 为 `"placeholder"`）——模型质量，不是传输**。没有重跑（新的付费调用要人单独点头）。验收不读 `~/.orca/profile.json`（脚本自写 profile 并核 `~/.orca` 不变）。
- **`~/.orca/profile.json` 没改**（人授权了，agent 判断后搁置）：它是全局单一 profile（id `all`），`contextWindowTokens` 一旦非 null，所有 kind 的估算都会开始真跑（每次导入计划多一次付费估算），而且单 profile 绑所有角色时 confirm 会强制数值 handoff 阈值（§八已知缺口）。要不要改、改成多少归人。
- **仓库外的动作（人授权）**：三仓 `.git/hooks/post-commit`、`post-checkout`（全是 Qoder CN 的 tracker 块）备份后删除；ccloop 主仓 164 个 `refs/ccloop/ccloop-cli-scripted-*` 测试残留已删（列表备份在会话 scratchpad）。⚠️ ccmem 的 `core.hooksPath` 指向搬家前的旧路径（未改，归人）。
- **ccmem 钩子 5 s 超时**（人报）：不是代码回归，embedding 429＋机器负载；人先不关 embedding、在处理额度（详情在 ccmem handoff §5.2）。

### 3.3c 会话 `02f047f6`（2026-10-14～15）的结论（分支已由人合推）

- OMP single-call（spec `docs/superpowers/specs/2026-10-14-omp-single-call-design.md`，计划 `…/plans/2026-10-14-omp-single-call.md`，现都在 main，Task 0–13 完成）：方案 A＋Orca 按目录上限预占（人裁 spec §1）；ccloop 从 `omp models --json` 所选行算窗口／`singleCallExecution`／`singleCallOutputCap`，spawn 前复核、argv 关工具／规则／LSP、`--config` 叠加关重试等五项，解码 fail-closed；Orca 把 `max(preflight, cap)` 写进契约与信封并据此判 `input-too-large`。Task 0：`config get` 不认 `--config` 但运行时认；**框架开销约 2047 token**。spec §8 残余里「上限拒绝看不见」「clarify／split 冻结上限」已由本轮处理，**spawn 时目录探测不在时限与 abort 内仍未修**（与模型下拉框一起放到 ccloop 那一轮）。
- 反馈 1–7：#53（根因：Web 起的组在首个 run 期间一直是 `ready`）、#56／#57、README（#54／#63／#64／#60）、#59（`createdOrdinal` 只用于显示排序）、#62（`codex-rate-limited` 文案）都在 main；#61 本轮完成；#58 的 Orca 半本轮完成，**模型下拉框（要 ccloop 新命令）未做**。
- 该会话的台账（全部 `Ruling:` 行、事故、门的原始数）：`.superpowers/sdd/2026-10-14-omp-single-call/progress.md`、`.superpowers/sdd/2026-10-14-web-start-running/progress.md`。它的裁定人已于 2026-10-15 同意；仍约束后人的两条：目录行不可解析 ⇒ 用量 null、spawn 前中止 ⇒ neverStarted 记 0（与既有 phase adapter 一致）；README 用 `orca …`（tsx 别名）写法并带别名说明。
- 零成本探针：omp 18.10.1 对 `127.0.0.1` 也走 `HTTP_PROXY`，启动时探测本地 ollama／llama.cpp（fake 上游要能吃掉意外请求）。

### 3.3b 会话 `b39a5527`（2026-10-14 早）的结论（分支已由人合推）

- 已在 main：ccloop pin `3069dbf…`（含 C）；「交接停止＋未知用量」的出路 `recovered`（spec `docs/superpowers/specs/2026-10-14-handoff-stop-unknown-usage-design.md`：结清后 run／请求转 `settled-recoverable`、work 与分配 `held`，`resume-from-handoff` 从检查点续跑；D spec 末尾有更正节）；`savedResultRecovery` 谱系判据；`agentUpdatePaired` 运行期跳过（修 tmp 泄漏）；预览对 `recovered` 校验检查点。变异证据：22 条 15 红，绿的 M2/M3/M4/M10/M15 补了判据；M1、M17 登记为冗余守卫。门的数见 §3.4。
- **沿用的结论**（仍有效）：
  - ⚠️ `ORCA_CCLOOP_BIN` **不能**指 `node_modules/ccloop/dist/cli.js`（npm 包不带 `tests/fixtures`）⇒ 指一份已 build 的 ccloop `clone --local`。
  - 真 Codex 只用 `gpt-6-luna`（付费，**每次先问人**）；LiteLLM 端点人已于 2026-10-14 起（OMP 真跑同样先问人）。
  - work 剩余为 null 只在任务 ceiling 为 null 且无组上限、无花费上限时出现 ⇒ 不计量放行绕不过任何在执行的上限。
  - 谱系只继承实测用量：`lineageWorkUsage()`（`src/control/usageSettlement.ts`）是唯一规则，新的谱系求和必须走它。
  - D 推翻 `2026-10-11-token-policy-design.md` 对 null 剩余的那半句（原文不改，更正在 D spec §A.1）。
  - `worktree` 里的 `node_modules` 软链指主仓：`pin-ccloop.mjs` 会 `npm install`，**只在装了真实依赖的工作树里跑**。

### 3.3a 会话 `808feb6a`（2026-10-13 早）的结论（分支已由人合并）

- **OMP skill 注入**（spec `docs/superpowers/specs/2026-10-13-omp-skill-injection-design.md`）：新 work 字段 `ompSkillsDir`（protocol 3、4），与 `skillPluginDir`／`codexSkillsDir` 三选一；非 omp kind 在 accept 拒 `skills-unsupported-agent`；OMP 仍带 `--no-skills`／`--no-extensions`，由 ccloop 在每个 phase 的私有 system prompt 末尾加 `<skills>` 清单（名字、≤1024 字符的一行描述、`SKILL.md` 绝对路径）；快照不合法在 spawn 前失败 `omp-skills-source-invalid:<detail>`。Orca 的 confirm／set-task-loop／A2 接受 omp，驱动传 `<snapshot>/skills`。证据：ccloop 12 条变异全红（clone，基线 20/20，还原 0/0 字节）；Orca 5 条变异全红（基线 51/51）；`tests/control/ompSkillsE2E.test.ts` 对本地 ccloop 构建通过，路由变异让它以真 ccloop 的 `accept-refused:2:skills-unsupported-agent` 变红。**没有任何真 provider 跑**（Codex 额度耗尽、LiteLLM 端点已停）。
- **ccloop 全量证据**（`codex/omp-agent-integration`，omp-skills 之前）：两笔授权改写后三次原生全量 1632/1639、1635/1639、1635/1639；每个红文件单跑 3/3 绿（负载 10–33），列表见 `known-load-flakes.md` 的 ccloop 段。`ompUpdates` "preserves the unavailable reason…" 单跑 3.1–3.3 s、负载下超时一次，**未改写**（不在人的授权内），已标记。
- **本会话最终门**（两仓 `codex/omp-skills` 顶上，2026-10-13；本机同时有别的会话，负载 6–27，每行都记了）：
  - ccloop：typecheck／build 过；全量 1655/1659，4 红 —— `cli` parseArgs 超时、`savedResultRecovery.native` 撞上 dist 重建的撕裂读、`codexAdapter` watchdog 三个文件单独各 3/3 绿；`ompUpdates`「preserves the unavailable reason…」单独在负载 10–12 下 2/3 红（实测 6.4 s，放宽超时后 5/5 绿）——**它要人点名才能改超时，没改**。`verify:control`（只含 fake codex `integration` 的表）805/806，唯一红是 `extractFinalObject` 的 3 s 性能阈值（3.16 s，负载 13），单独 3/3 绿。
  - Orca：typecheck／build／web build 过；根级全量（`ORCA_CCLOOP_BIN`＝本地 ccloop 构建）3725/3778、36 跳过、17 红：15 条是 5 s／30 s 超时，分布在 `gateCheck`、`driverRecovery`、`integrationKeep`、`retryTask`、`schedulerBridge`、`settleUnknownUsage` 六个文件，单独各 3/3 绿；2 条 `taskResultPaired` 硬编码旧配对二进制、不收本地构建（同上一轮）。Web `--ws check` 990/990。
  - **以上不等于全量绿**；原始日志在会话 scratchpad，会话结束即失效，结论只在这里。
- **仓库外的修复**（人授权「三处都按你说的改」）：`~/.claude/plugins/ccmem` 软链改指新 ccmem 路径；`~/Library/LaunchAgents/com.ccmem.daemon.plist` 先备份为 `com.ccmem.daemon.plist.bak.20261013`，改了 daemon main 路径和 `CCMEM_CLAUDE_P_COMMAND`（旧值是已不存在的 cmux shim）；改前 `sqlite3 .backup` 到 `~/.claude/ccmem/global.db.bak.1791853763689`（integrity ok）；daemon 用 launchctl bootout／bootstrap 重启，`ccmem admin daemon status` 报 alive、schema 16、新路径。
- **发现未修**：ccmem `admin daemon status` 在磁盘 plist 与 `renderPlist()` 不同时仍报 `plist=in_sync`（疑似 `scripts/lib/admin/daemon.mjs` `describePlistDrift` 的漂移检测缺陷，n＝1，根因未查）；daemon.err.log 末尾的 `vec_backfill failed: 403 …`／`Connection error.` **早于重启**（会话 `6b7843ec` 现测：plist 的 StandardErrorPath 就是它，文件 mtime 2026-09-08，重启后零新行）。
  **重启后行为复验（`6b7843ec`，只读 `~/.claude/ccmem/{daemon-cost,metrics}.jsonl`，以备份文件名里的毫秒 epoch 1791853763689 为重启时刻）**：`summarize_pending` 11 次、10 次 `exit_code=0`、1 次 1 ⇒ daemon 的 `claude -p` 已恢复；
  但 hook 检索 9 次全是 `B-fail`／`B-circuit`，`retrieval_embed_error` 为 `429 You have no credits remaining` ×3、`Request timed out.` ×3 ⇒ **embedding 账号无额度，属人的账号，agent 不碰凭据**。
- 面板服务曾指旧路径 `/Users/biran/code/skills/loop/Orca/dist/cli.js`；已于 2026-10-13 晚由人从新路径重装（§4.1 第 3 条）。注意 `ORCA_CCMEM_BIN`／`ORCA_SYNCSKILL_BIN` 当时也指着搬迁前的软链目标，重装时一并改成了新仓路径。
- 本机：`/opt/homebrew/bin/node` 坏（缺 libsimdjson）；nvm Node 22.13.1 在 PATH 首位；`/usr/local/bin/node` 是 24.13.0（正式服务用它）。
- 上下文：本会话越过了 Rule 6 的 T1（330k），人明说本会话不考虑上下文大小；检查点记了越线。

### 3.4 最近一次可引的门（**历史观测，引用前现测**；日志都在 `/private/tmp` 下，会话结束即失效，结论只在这里）

- **最新＝repin 门**（会话 `4de777f4`，2026-10-16 晚，全新 clone，主题行 `chore(deps): repin ccloop to 02cbacc…`，`ORCA_CCLOOP_BIN`＝ccloop `02cbacc` 的 build，fake-only 安装表，负载 5.7→28）：ci／web build／typecheck／build 0；`verify:ccloop-pin` 3/3；`verify:scheduler` 202/202；七个真 ccloop／特性文件 26/26 passed、0 skipped；全量 3839/3889、36 跳过、14 红＝12 条 5 s 超时＋paired×2；`verify:chain` 与 `verify:control`（1979/2011）都只剩 paired×2；claude-md／hooks-path／tmpleak／panel／`--ws check` 0；`~/.orca` 哈希不变；9 个超时文件单跑各 3/3（明细 `known-load-flakes.md` 的 `4de777f4` 条，台账同名节）⇒ **门过（分类后）**。零付费调用。
- 会话 `a852f96a` 的 ccloop run 3／4 与 Orca Task 16 门（旧 pin）见 §3.3「门」。下面是更早的。
- **本分支终门**（会话 `026d10e3`，2026-10-15，`feat/error-codes-start-guard` 在终审修复波次之前的头 `test(web): order the uncounted run after a counted one…`，`ORCA_CCLOOP_BIN`＝dc51022 的 build clone、fake codex `integration` 表；日志 `/private/tmp/oec/gate/`）：typecheck／build／web build／台账／`CLAUDE.md`／hooksPath／pin／panel／`--ws check` 0；scheduler 202/202；全量 3807/3865、33 跳过、25 红（23 条 5 s 超时＋`driverReconcileN` 截止超时＋`taskResultPaired` ×2）；第二次全量（`verify:chain` 段）3830/3865 **只剩 `taskResultPaired` ×2**；`verify:control` 1958/1991（`taskResultPaired` ×2＋1 条超时）；tmpleak 0。超时文件逐个单跑见 `known-load-flakes.md` 的 `026d10e3` 条。终审修复波次（`fix(web): show ccloop's code and detail on a ccloop-failed refusal…`）之后只跑了受影响文件＋web 全量 1125/1125、typecheck。
- **repin 门**（同会话，`chore(deps): repin ccloop to dc51022…` 上）：不设 `ORCA_CCLOOP_BIN` 时 scheduler 那 39 条必红（它们要一份 ccloop checkout 的 build，默认去找兄弟目录）——⚠️ **更正上一版本节的预言**：`taskResultPaired` 两条硬编码了两条 `/private/tmp/…` 路径，**不设变量也红**（`undefined`），它是固定的环境红，与 repin 无关。设了变量后：全量 3766/3812、10 红（8 超时＋paired ×2）、第二次全量只剩 paired ×2、scheduler 202/202、超时文件单跑各 3/3。
- **ccloop 门**（同会话，`fix(workspace): run the attempt commit…` 上，clone 里，日志 `/private/tmp/ccq4-gate/`）：全量 1710/1712、`verify:control` 818/820、tmpleak 0；4 红所在 4 个文件单跑各 3/3（两条断言形状记 n＝1 候选，详见 ccloop handoff）。
- 更早（会话 `02f047f6`，round 分支）：根级全量 3767/3812、12 红（10 超时＋paired ×2），第二次全量只剩 paired ×2；`verify:control` 1913/1945。再早的（`b39a5527` repin、OMP 分支、feedback-followup Task 14 的 3742/3772 零失败、10-12 切换后 3739 过）都已被取代，flake 判别在 `known-load-flakes.md`，Task 14 证据仍在 `.superpowers/sdd/2026-10-11-feedback-followup/`。

---

## 四、⛔ 下一件事（按顺序）

### 4.1 人在自己终端跑的（agent 被 Tier 0 拦；每一件都要人单独点头，非门合并一律 `--ff-only`）

每一步前 `ls-remote` 现核；删分支前 `git merge-base --is-ancestor <分支> main`（或 `git cherry`）现核。

1. **会话 `a852f96a` 那一轮的收尾都已由人做完**（会话 `4de777f4` 2026-10-17 现核）：H1 推 ccloop；H2 合推 Orca（主题行 `Merge branch 'main' into codex/every-agent-chain`）；ccloop 名单分支（主题行 `test(roster): add the outer-watchdog load flake to the known reds (ERRATUM)`）；面板重建与重启；`profile.json`；两仓 every-agent 与 round-b／attempt-commit 分支和工作树删除；`/private/tmp` 清单（`find` 现核 0 条）；面板服务去掉 `--repo`。仍有效的结论：
   - ⚠️ **R7 已生效**：真实 profile 下 omp 与 claude-1M 的导入**真跑付费估算**。`framingTokenOverhead`＝12000（人裁），`contextWindowTokens` 仍 null。
   - known-reds 名单只加了 `codexAdapter` outer watchdog；`verifySavedResult`「r1 command interruption…」**不加**（断言形状、疑真竞态，下次红先按 `systematic-debugging` 在 clone 里查）。
   - **面板命令**：现在有全局 `orca`（主题行 `feat(cli): add a bin/orca shim so npm link gives a global orca command`，人已 `npm link`）：`orca panel restart && orca panel status`。shim 优先用 `/usr/local/bin/node`（`panel install` 会把跑它的 node 记进服务配置）；`orca` 跑的是 `dist/`，pull 之后先 `npm run build`。只 `npm run build` **不更新依赖**：合进新 pin 后主仓先 `npm ci`（实测主仓曾停在 `3069dbf`，而服务未设 `ORCA_CCLOOP_BIN`，用的就是这份）。
   - **重装服务**（`panel install`）只记录当前 shell 里具名的 `ORCA_*` 等变量：少写一个服务里就少一个，先 `--dry-run` 比对 `service.json`。
   - 仓库外由 agent 经人授权改的（会话 `4de777f4`，2026-10-17，Rule 17）：`~/.orca/agents.json` 先备份为 `~/.orca/backups/agents.json.bak.20261017`，claude 版本改 2.1.301（原表因 `agent-version-drift` 被拒）、加入 `orca agents init` 探测出的 omp 条目；claude／codex **保留 nvm 稳定路径**，没用探测给的 cmux 临时 shim 路径（换终端会话即失效）；`orca agents show` exit 0。新建 `~/.orca/projects.json`（0600，项目 id `orca` 与原 `--repo orca=…` 同 key，`controlStateDir`＝`~/.orca/control/panel`）⇒ 控制库不换；服务由人重装、`panel status` exit 0。
   - 现核时控制库 `work_items`／`groups`／`requirement_drafts` 都是 0 行（Task 页空是真空，不是读不到）。
   - 不确定归属、留给人：Codex 建的 `/Users/biran/.codex/worktrees/feedback-followup-20261011/Orca`（detached）；`ui/panel-taste` 是 UI 线的。
2. **ccmem**：embedding 额度／换 key（`core.hooksPath` 已于会话 `ec9ce319` 经人授权 unset）。
3. ~~本轮分支合推~~、~~profile 切 v2~~、~~`orca` 命令~~：**都已做完**（会话 `d0843ec0`，见 §3.2a）。
4. ~~Orca／ccloop／ccmem 的 handoff 分支合推、删分支与工作树~~ **人已做**（会话 `a3b2a7a7` 里人逐条回报「已执行」）。
5. ~~ccmem Codex／OMP 适配合并与真实安装~~ **已做**（细节 ccmem handoff §1.0）；人已重启 Claude 会话、在 codex 里 `/hooks` 批准三个钩子。真 Codex 会话（10-17，ccloop 目录）实测：SessionStart ✅（注入 `## ccmem context`、写出 context 文件、`session_context` 记 `codex`）、UserPromptSubmit ✅（走 B-circuit）、**Stop 未触发**——那一轮因模型额度报错终止、模型没回答；「Codex 出错的轮次不触发 Stop」是推断，未验。要在一轮模型正常回答的会话里再看一次（10-22 额度恢复后，付费，人点头）。OMP 扩展的真加载仍未验。
6. **删**（人做；会话 `a3b2a7a7` 2026-10-18 现核的清单，`du -sh`／`find` 实测）：
   - `~/.cache/ccloop/agent-catalog/` **整个目录不能删**——Task 7 之后它已被正常使用（现有 `1fe8b83f…`、`1c7cfb0c…`、`811b06f8…`、`bb8da9aa….json` 与 `codex-home/6c50abdd…`）。原清单 8 条里该删的只剩两项：`agent-catalog/769de7de3225c97b1234142ba6835ab7aaecfd0d77e371c662ca57bf9607b532.json` 与目录 `agent-catalog/codex-home/bf5335273626c4675a00cca1a384456ab917ed8333815b54b89e45b57670b993`（内含指向 `~/.codex/auth.json`、`config.toml` 的软链；`rm -rf` 只删链不碰目标）。
   - `/private/tmp`：`mutp-swWu`（121M）、`acc-xpI0`（32M）、`mut-*` ×10（各约 121M）、`org6-nP1k`／`org7-3oVo`／`org8-ulmF`（各约 367M）、空目录 `cc-r-*` ×2、`cc-t-*` ×25、`cc-gate3-iAXn`、`cc-gate4-hiS2`、`cc-gate5-c5er`。`est-sLx8`（含凭据副本那个）**已不在**。
   - `ccb6-qswQ`（100M，pin 的 ccloop build）**留到 codex 估算补跑之后**。

### 4.2 agent 的活

0. ~~**付费验收**~~ **omp、claude 已跑、全量门已过**（会话 `d0843ec0`，§3.2a）。**只剩 codex gpt-6-luna 一次**：额度 2026-10-22 恢复后、先问人，命令照下面原文（`--codex /Users/biran/.nvm/versions/node/v22.13.1/bin/codex --model gpt-6-luna`，不设 `CCLOOP_CACHE_DIR`，脚本默认放进 `--output`）。原文：**付费验收（spec §6，人已授权「这一轮都同意付费验收」——跨到下一会话执行，范围就是这三项，不扩大）**：用 `scripts/live-driver-acceptance.ts --scenario estimate --estimate-only --instruction-version 2`：omp 别名 `local-litellm/ep-20261012204110-nvhqw` `--repeat 5`（照 `p2-report.md` 的隔离：私有 HOME／XDG、`--omp-config-dir` 用 `~/.omp/agent/{config.yml,models.yaml}` 的副本）；codex `--codex <bin> --model gpt-6-luna` 一次（soft）；claude 1M 一次。报 tally（firstCallReady／readyAfterRepair／readyAfterRetry／failed）与工具报的 token；`~/.orca` 与 `~/.cache/ccloop` 前后 `ls -laR` 不变。之后补跑终审修复之后的全量门。

0. **ccmem Codex／OMP 适配的付费验收**（会话 `d0843ec0` 实施完、未跑付费项）：清单与命令在 ccmem handoff §1.0；每一次付费调用先问人。

0. **repin 的做法**（不变）：装了真实 `node_modules` 的工作树里 `node scripts/pin-ccloop.mjs <40 位 sha>`（它会 `npm install`，**别在软链 `node_modules` 的树或主仓跑**），scheduler 段设 `ORCA_CCLOOP_BIN` 指 ccloop build clone；**全新 clone 跑门先 `npm run build --workspace web`**。
1. ~~**Task 15**~~ **已做**（会话 `4de777f4`：repin 提交与门见 §3.3／§3.4；下一步只剩人的 H2）。原文：`ls-remote` 确认 ccloop main 已是 H1 推的那笔（主题行见 §4.1 第 1 条）；在 `Orca-wt/every-agent-chain`（自带真实 `npm ci`）里先 `export CCLOOP_CACHE_DIR="$(mktemp -d /private/tmp/cc-XXXX)"`，再 `node scripts/pin-ccloop.mjs <ls-remote 得到的 40 位 sha>`，提交 `chore(deps): repin ccloop to …`。repin 门：typecheck／build／web build；`verify:ccloop-pin`（新 pin）；ccloop 那个 sha 的 `clone --local`＋`npm run build` 作 `ORCA_CCLOOP_BIN`，跑 `verify:scheduler` 与七个真 ccloop／特性文件（`codexRequirementOpen`、`ccloopModels`、`webCcloopSmoke`、`estimatorSoftExecution`、`agentModelsApi`、`singleCallOutputBound`、`declaredNullWindow`，用 JSON reporter 证明 passed 不是 skipped）；Task 16 门用的 ccloop 不是最终 tip（§3.3「门」）⇒ 再跑一次根级全量。过了交 §4.1 的 H2。计划 Task 15 的原文在计划里；spec §8.2：Orca 与 repin 同落。
2. ~~「每个 agent 都能跑需求链」一轮~~：会话 `a852f96a` 实施完（§3.3），只剩上面第 1 条与 §4.1 的 H1／H2（旧条目「只 OMP 下拉框＋内存缓存短 TTL」已被 spec R3／R4 取代）。**真 OMP estimate**：P2 得到此别名上第一次 `ready`（4 次真估算里 1 次），答案质量仍不稳——要么换模型，要么 instruction v2 写明任务数（设计活）；再跑是付费的，**先问人**（本轮的重跑授权不跨会话）。
3. **OMP skills 的真 provider 验收**：照 `2026-10-12-oh-my-pi-acceptance.md` 的隔离形状、带一个声明 skill 的任务跑一次，`scripts/verify-omp-acceptance.ts` 要能看见 `<skills>` 块与 `SKILL.md` 的 read（付费，先问人）。
4. **登记的小项**（终审／任务评审的 deferred minors，台账里有全文）：~~驱动日志行截断~~、~~cap-exceeded 文案~~ 已修（会话 `ec9ce319`）；`recoveryRetry` 探测在闸门外——人裁不修（与 `setIntegrationScheme`「慢检查放闸门外」同型，Rule 7 两种写法并存，台账 `2026-10-15-round-b`）；计划卡对「stopped 无 intent」的组仍给编辑入口——人裁不修（要动 summary 协议）；m2 新加的三处日志调用点无判据（共用的 `logError` 有）；`peerFailureLog.test.ts:22` 用 Set 去重；`executionPending` 的 `kind === "task"` 过滤无判据；A8 的 6 处日志行无判据（人裁 R4）；`profiledService` 一次超时（单跑 3/3，候选 flake）。
5. **挂账（都小）**：C 的 `rate-limit.json` 只在被拒的调用目录里；可用 `gpt-6-luna` 做一次真 Codex 回归（付费，先问人）。
6. **ccmem 适配 Codex 与 oh-my-pi**：人的下一个项目，未开始；先 brainstorming。
7. **OMP 仍延后的**：子 agent、交互式审批桥、omp 的 saved-result 恢复（人：只是延后）。
8. **GitHub 私有验收**：私有库 `blrbiran/orca-integration-smoke-20261012` 与本地测试提交已建；push 要人按 Rule 15 授权；之后 `pushPorcelain` 推、`syncGroupPr` 建 draft PR 并验重试幂等。运行 `gh` 前清掉失效的 `GH_TOKEN`／`GITHUB_TOKEN`。
9. **正式面板 owner 登录后**核 Results、Memory 与账户边界（agent 不读、不传密码）。
10. **路线图未落地**：memory 自动 correction 写回（Orca memory adapter 仍只读、`recordCorrection:false`；需要 ccmem 外部引用＋按 `projectKey+correctionId` 幂等的导入契约＋失败重试语义）；LiteLLM 接入（模型别名／实际成本来源、未知成本阻断口径、per-run 预算边界）；A2A 运行时（远期，只做只读状态外壳）。**不能宣称记忆写回已闭环。**
11. **挂在姊妹仓的**：ccloop B4 与 `ClaudePhaseAborted` 历史交错（未证成）；ccmem T13；ccmem `describePlistDrift` 疑似缺陷（3.3a）。按各仓规则，先报再动。
12. **延后的反馈（设计轮）**：`2026-10-10-feedback-status.md` 的设计轮条目＋分诊的 #32／#34／#35／#55／#65／#66、#50（见分诊文件）。

---

## 五、已经拍板过的事（**不要重开**）

### 5.1 语言与记法

- **对话与 `docs/handoff/**` 用中文；代码、注释、CLI help、README、commit message、新建的 SDD 台账／spec／plan 一律英文**（人 2026-09-29 收窄）。已有的中文台账／spec／plan 不翻译，追加更正保持原语言。
- **handoff 不是给人读的** —— 人读对话里的摘要。本文不写 HEAD、不写「领先几笔」；唯一例外是标明了的**观测锚点**。
- 计划里的 `- [ ]` 照勾；改某个 Task 的内容才要另起具名更正。**skill 与 `CLAUDE.md` 冲突 ⇒ `CLAUDE.md` 优先；计划与 spec 冲突 ⇒ spec 优先。**
- **Orca 在 ccloop／ccmem 的 handoff 里只保留一节，就地滚动，不新增编号章节**（人 2026-09-02）。

### 5.2 系统设计

1. **方向不重开**（人 2026-09-19）：Orca 控制 ccloop，agent 适配留在 ccloop；Web 是人的主要入口（Web > CLI）；ccmem 是决策记忆系统。长期 agent 优先级 Claude Code > Codex CLI > OpenCode > oh-my-pi > pi。G1–G6 全文在 `goal.md` §8（引用引编号）。
2. **权限模型**：Tier 0 机制禁止／Tier 1 自决留痕／Tier 2 不记录；`undo.how` 说不清 ⇒ 降级 Tier 0。**人裁的触发条件是「两个事实打架且能摆出两边」**，不是「agent 不确定」。
3. **台账**：git 为真相源＋DB 做索引；每个 agent 只写 `.decisions/<run-id>.jsonl`；不存 commit hash；按做决策那轮的 run id 署名。**`overturned` 不许 agent 写**（要 `correctionId`，correction 是人的日志）。对照样本由 decision＋correction 拼出。`projectKey`＋`decisionId` 联合键；⚠️ Orca 抄了一份 `normalizeRemoteUrl`，**改任一侧要双方核对**。
4. **依赖**：ccloop 走 npm GitHub 依赖（`github:blrbiran/ccloop#<commit>`，只用 `scripts/pin-ccloop.mjs` 重钉，**且只在人推了 ccloop 之后**——npm 装不到 GitHub 没有的东西）；`ORCA_CCLOOP_BIN` 只是本地覆盖。ccmem 不 vendor；都不用 submodule。`CLAUDE.md` ≤ 200 行（verify 断言）。
5. **并行**：写集＝`targetPaths ∪ allowlistPaths`，相交 ⇒ 串行；但冲突检测／分类／解决／验证才是主干，写集判据只是优化。解冲突的不能是当事任务本身。合并进集成分支＝Tier 1，进 main／push＝Tier 0。
6. **面板**：后端 express、前端 React；**六个分区始终挂载，非当前区只由 `styles.css` 的 `.section-pane:not([data-active="true"])` 隐藏**，不许条件渲染／`hidden` （改了会让 16 条既有判据红）；有副作用的分区按「第一次激活」才请求。`orca panel` 的 ready 行一个字节都不能改（`verify-panel.ts` 正则、`endToEnd`、`controlShutdown` 都钉着），给人看的提示写 stderr。深色 token 被 `web/tests/contrast.test.ts` 按 WCAG 比值钉着，**别往暗里调**。kind 重要性只是 UI 序（`web/src/kindRank.ts`）。**改 UI 先读 `web/DESIGN.md`**（2026-10-14 精修两轮的规则本）：颜色只由 `data-tone="info|ok|warn|danger"` 给（role 只管语义，无 tone 的 `role=alert` 仍红）；只有 `.btn-primary` 填色、每个视图一个主按钮；字号 14/18/22；浅色暖纸被 `lightTheme.test.ts` 钉、深色中性石墨被 `contrast.test.ts` 钉。导航红点只对真告警亮：「无执行端口」是琥珀 note，连它引出的 agents 读 422 也不算面板告警；info 色的 `refetchRequired` 也不点红点（提交 `fix(web): stop a projection refetch from lighting the red tasks dot`）；唯一已知例外：每次加载头 3–5 s 闪一下红色「server reset required」（首次 summary 读按规格就是 resetRequired；人在会话 fb98aa31 裁定保留规格行为）。
7. **控制面**：读视图排序用 `compareText`（code unit），**不用 `localeCompare`**；会持久化或进哈希的排序不动。不带 `sinceChangeSeq` 的 summary 恒回`resetRequired:true` 是规格，前端对「自己要的完整重读」不 purge。
8. **Orca 不许自造对端观测**；跨仓的空值／词表语义修在**产生观测的那一端**（ccloop）。`ContextObservationV1` 在 Orca 无生产者 ⇒ 真 ccloop 下`contextWindowTokens:null`，预估是 `estimate-blocked-capability`（人裁：等 ccloop 能实时观测上下文时加显式关闭值，不放宽 `null`）。G1：`targetVersion` 是正安全整数，写字符串的 plan 被 `loadPlan` 以 `malformed` 拒，不做静默转换；`handoffControl:"durable"`、`handoffExecution:"mechanical-in-run-v1"`；旧的 `durableAccept`／`ownershipIsolation`／`evidenceRetention` 是删掉的，不是迁到别的字段。
9. **预算**：`--task-tokens` 是一个任务全部阶段／尝试／续跑的**累计**上限，实际工作设 ≥1,000,000；估算 grant 是常量 `ESTIMATE_GRANT`（250k／900 s）。⚠️ Web 派活在 `blocked-capability` 时给每个任务 `complex-1m-default`（3M token、3 attempts、4 h）并覆盖 contract ⇒ **真钱跑前先 `proposal-edit` 封顶，并在 ccloop 实际收到的 `loop-contract.json` 里核**。花费上限命令只进命令台账；对账花费记 `unattributed`；`POST /api/chains` 不受花费上限约束（政策问题，未改）。
10. **skills**：只对带 skill 集的 claude run 去掉 `--disable-slash-commands`；skill 集声明在 loop 方案上、不进 ccloop 合约；profile 在 confirm 时冻结；已确认任务上声明没变就沿用冻结名单、不起 syncskill；agent kind 取自 ccloop `listAgents`，在 confirm／set-task-loop 就拒不支持的 kind。三个 skill 字段（plugin／codex／omp）互斥。**OMP 永远带 `--no-skills`／`--no-extensions`**：开 OMP 自己的发现会加载操作者机器上的任意 skill，run 不可复现。claude 下 plugin skill 以 `orca-run-skills:<名>` 出现，提示词要点名 skill 就得用这个带前缀的名字。
11. **OMP**：作为可选安装进 detect、精确模型解析、受保护 preview/apply、面板选择；模型从每台机器的 OMP 配置探测，**不把任何本机选择器（如 `local-litellm/…`）设为默认**。Git 忽略文件与主机侧写入不在 changed-path 检查内 ⇒ **不是沙箱**；一次验收是 pilot，不是可靠性。**OMP single-call（estimate／clarify／split）**：旧结论「OMP 没有逐次输出上限、会自动重试 ⇒ `singleCallExecution` 保持 null」已被人 2026-10-14 选定的方案 A＋Orca 按目录上限预占取代（选项调研 `docs/superpowers/specs/2026-10-14-omp-single-call-options.md`，设计 `…-omp-single-call-design.md` §1）：**不建计量代理**（很多人的 omp 直连 https provider，正向代理拒 `CONNECT` 会全挂）；上限与窗口**信 `omp models --json` 所选行**（含 omp 自己编的默认值，人知情）；spawn 前复核、叠加配置关掉重试／回退；omp 只服务 soft 模式。实现见 §3.3c（已在 main）。
12. **合入方案**：仓库默认＋组拷贝＋确认即批准；方法只有 `merge`／`squash`；冲突经 owner 批准后派 agent 解。改密码成功作废该用户全部会话。
13. **Results／保存成果**：按真实 owner／attempt／revision 展示；可选 token 的 `null` 只表示上限无限，不表示用量为零；保存验证只跑新的 check／verifier、只记新用量，不改写原失败与历史；旧 archive 缺真实发布命名空间 ref 时明确不可用，**不能从当前仓伪造历史证据或批准**；缺 marker／ready／worker 不证明零用量或自动执行授权。
14. **D-launch（`orca chain`）**：外部监督进程；`--goal` 必填；四条硬上限；停链＝当前会话跑完再停；闸门被改即停；拒绝嵌套；`--max-budget-usd` 是**软上限**。

### 5.3 边界

- *** **push、合并进 main、删分支或 worktree：每一次都要人单独点头，且 Tier 0 闸门下由人在自己终端做。** *** 非门合并一律 `--ff-only`。
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
- 改线上 schema 的轮次，收尾全量门不能省，且门要在最终树上重跑；**改哪个仓就在那个仓跑全量再提交**。
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
- **临时目录泄漏护栏**：每个测试文件一个临时根（`tests/setup/scopeTmpdir.ts`），`node scripts/check-tmp-leak.mjs`（两仓都有）要 0 残留；`TMPDIR` 要**短、真目录**（如 `mktemp -d /private/tmp/cl-XXXX`）——放 scratchpad 下 tsx socket 超 104 字节、用软链则路径判据红。
- `verify:control` 必须配**只指向 fake** 的 `ORCA_AGENTS_TABLE`，fake codex 用 `integration` 模式（`ok`／`script` 会让 `ccloopProtocol.integration` 红）。
- `npm run verify` 是 `&&` 链：有预期红时**逐段单跑各取 RC**；它打印多档计数，别混着比；跨 Task 比红集合要同一套 env（skip 变 run 不是新红）。
- 改 runner／fixture 后全量；逐 Task 只跑点名文件会漏别处嵌着的同形夹具。「少跑一条」在 vitest 里是绿的 ⇒ 另加 `.length` 判据。
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
- `npm run verify` 串：typecheck、build、全量测试、台账校验、`CLAUDE.md` 行数、hooksPath、`verify:control`、`verify:scheduler`、`verify:chain`、web build、`verify:ccloop-pin`、`verify:panel`、`--ws check`。另有 `verify:saved-result`。
- ⚠️ **`.superpowers/sdd/` 整个被 gitignore** ⇒ 留存物必须单独 `git add -f`。不删 SDD 工作区。
- **ccloop 测试副本**（不要建 worktree）：
  ```sh
  /usr/bin/git clone --local /Users/biran/code/skills/orca/ccloop "${DEST:?set DEST}"
  ln -s /Users/biran/code/skills/orca/ccloop/node_modules "${DEST}/node_modules"
  cd "${DEST}" && npm run build      # dist/ 被 gitignore，不 build 会假红
  ```
  安装表 `ORCA_AGENTS_TABLE`（schema `ccloop-agents-table-v1`）的 `command` **只能指向副本里的 fake**（`tests/fixtures/fake-codex.mjs`／`fake-claude-cli.mjs`／OMP 的 `tests/fixtures/fake-omp.mjs`）；现成写法看 `tests/control/fixtures/ccloopWorld.ts` 的 `agentsTable`。
- **控制协议**：ccloop `control` 方法集 `capabilities`／`accept`／`inspect`／`handoff`／`collect`／`read-evidence`，一次一进程的 JSON-over-stdio，状态全在文件里。`capabilities` 答 v2 八字段；唯一的 schema 例外：ccloop `requestBoundProof.*Dimensions` 是任意字符串数组，Orca 要求排序去重的枚举（将来非 null 写错时 fail closed）。envelope protocol 3／4，`work` 分 `loop`／`single-call`，`singleCallExecution` 兄弟字段（claude `"v1"`，codex `null`；omp 在 single-call 分支上按目录行给 `"v1"`／`null`，并多一个 `singleCallOutputCap`，Orca 侧 `.nullable().optional()`）。
- **水位／检查点**：水位＝transcript 最近主链消息的 input＋cache_read＋cache_creation，T1 330,000／T2 450,000；`orca level --hook claude-code` 挂 PostToolUse；子代理调用完全静默、自己的水位不测。`orca resume` 重跑检查点里记录的 shell 命令。
- **Tier 0 闸门**：`.claude/settings.json` 的 PreToolUse `orca gate --hook claude-code`＋`permissions.deny`，拦 push／合并进 main／删分支／删 worktree／`gh` 对外写。已知放行：写成脚本再执行、`python3 -c`、git alias、`-c core.hooksPath=`、`--no-verify`、`ExitWorktree`、`rm -rf` worktree 目录、`git -C <path> push`；已知过度拦：main 上 `git branch -f`、`merge --abort`、`rebase --continue`。威胁模型是合作型 agent 的失手，不是对抗。
- **关键环境变量**：`ORCA_CCLOOP_BIN`（本地覆盖）、`ORCA_AGENTS_TABLE`、`ORCA_SYNCSKILL_BIN`、`ORCA_CCMEM_BIN`、`ORCA_CORRECTIONS_DIR`（都是绝对路径，空＝未配置）。

---

## 八、什么在等人（awaitingHuman）

- 本轮分支合推与删除：见 §4.1（`ls-remote` 与 `git status -sb` 现核）。上一轮的 H1／H2／面板／profile／名单／删除已全部由人做完。
- **人已裁（2026-10-17，会话 `4de777f4`）**：授权改写 `taskResultPaired` ×2 与登记的负载超时判据；面板两处小隐患（`controlGet`／`fetchAgentModels` 无超时、`?refresh=1` 不带 CSRF）顺手修；「每导入一次计划就真付费估算、omp 答案不稳」要**根治**；真 codex 只测 `gpt-6-luna`（`gpt-6-sol` 无额度）；**本轮**付费验收全部同意（不跨会话）；ccmem 适配 Codex／OMP 放下一会话；UI 线本轮不做；真 agent 下没跑过的功能由人自己跑、有问题反馈。
- **ccmem 的 embedding 账号无额度**（`429 You have no credits remaining`，§3.3a）⇒ 语义检索不可用，要人充值或换 key。
- **人已裁（2026-10-15～16，会话 `a852f96a`）**：版本号缓存、私有 `CODEX_HOME` 复用、E1–E6、点名的 `ompSingleCall` 判据、一揽子改判据授权（本轮用了三处）、P1／P2 及其本轮重跑——全文与改写清单见 §3.3。
- **人已裁（2026-10-15，会话 `ec9ce319`）**：`026d10e3` 的全部裁定同意；其终审 4 条小项按 agent 建议（m2／m6 修、m5／m7 不修）；ccmem `core.hooksPath` unset；真 OMP estimate 重跑同意（未跑）；Qoder 重写钩子不管；spec R1–R9（见 spec 头）。那时列的待人三件都已了结（会话 `a852f96a` 现核）：round-b 已合推；计划第 8 条人裁缓存版本号；`/private/tmp/omp15-sUh0`、`/private/tmp/o15` 已不存在。
- **人已裁（2026-10-15，会话 `026d10e3`）**：#53 服务端拒绝执行中的第二次 start、运行中可改未开始任务的 loop 方案（允许动既有判据）；设计轮八问全部按推荐（范围 A+B 一份 spec、C 另起；码名＋细节＋已知码双语；下拉只 OMP 且可自由输入；人点重试重算上限；#53 只对未开始任务生效、具名拒绝码三入口一致；目录按需取＋短 TTL；探测时限放进 C 那一轮）；Q3 `codex-rate-limited` 进 `VIEW_REASONS`；Q4 `ATTEMPT_IDENTITY` 关钩子＋三仓移除 Qoder 钩子；#61 改写那两条；registry 标题改名；清 `refs/ccloop/*`；Task 13 付费验收先做；测试按组跑、合并前跑全量。上一会话 `02f047f6` 的其余裁定人已同意。
- **人已裁（2026-10-14，会话 `7ea088aa`）**：OMP single-call 走 A＋Orca 按目录上限预占、信目录（含 omp 默认值）、spec 与计划批准；下一轮 = single-call ＋ 反馈优先级 1–7；同意分诊里不采纳的各条（`2026-10-14-feedback-triage.md`）。
- **人已裁（2026-10-14，会话 `b39a5527`）**：`7f37d261` 的五个决定全部同意，其中「交接停止的未知用量 run」改为放开（已实现，§3.3b）；OMP skill 注入方案同意；`ompUpdates` 超时同意放宽（已做）；OMP single-call 要找绕法（调研完，待选方案，§4.2 第 0 条）。
- **人要审的 `b39a5527` 决定**（都已按控制器建议做了、可逆）：① 交接停止的 run 结清后**按保守额记组账**，续跑另占新额度（legacy 组因此要约两倍余量，余量不够拒 `group-reserve-insufficient`）；② `lineageWorkUsage` 把 `recovered` 的 remaining-grant 扣额也排除出谱系（否则续跑 `budget-overrun`）；失败 run 的 remaining-grant 扣额仍计入谱系，未动；③ 这类 run 的结清证据取自交接检查点，marker 的 `report` 字段记的是检查点的 handoff 包；④ 闸门拦下 `rebase --onto … main` 后，改用逐笔 cherry-pick 把同一批提交叠到 repin 分支（旧分支 `codex/unmetered-handoff-stop` 作废待删）；⑤ M1、M17 登记为冗余守卫而不编判据；⑥ OMP single-call 只出调研文档、未实现（是 ccloop 契约层面的新能力，要人先选方案）。
- **未审完的轮次裁定**（各台账 `Ruling:` 行）：面板项目过滤（`.superpowers/sdd/2026-10-06-panel-project-filtering/progress.md`，含改写的 `web/tests/projectSwitcher.test.tsx` F，不同意就回滚并重议 P1）、Task control 刷新＋项目切换（会话 `08011394`，提交说明里）、syncskill 跟进（会话 `9d95e6c8`，改了 web 夹具与 `skillsE2E` I1）、面板 HTTP＋syncskill 补三件（会话 `16ab00f2`）、UI 一轮被改写的四条判据（计划 Global Constraints 的 `REWRITTEN … U1–U4` 注释）。人回复后把对应条删掉。
- **面板的真浏览器视觉验收**（深浅主题、屏幕几何、依赖图 SVG）——只做过 Playwright／隔离浏览器截图，人没看过第二批以后。
- **`orca chain` 真钱活体验收**：要人提交 `.orca/chain.json` 选 model（不存在时开链被 `chain-config-missing` 拒）。先测 F，副本 T1 > F。
- **ccloop 判据改写授权**：ccloop 里仍有改既有判据才能修的（M3／M4 等，ccloop 人裁 88 要逐条点名）；ccloop 要不要对别的客户端设 `setTimeout` 溢出防护（行为改动，要人开口）。
- **一揽子／历史决定**：「第二个 panel 不挂控制面」是控制器的可逆决定，要不要维持未决；裁决甲的 `plan` 那一半（改 `preflightUnreadableRepo` 的判据）未获指名授权；子系统 B 后续按人裁「暂缓到有 `not_my_taste` 行」——`~/.orca/corrections.jsonl` 2026-10-12 现测不存在，条件仍不满足；`import-plan` 的上限按 agent 定的 task 数算，请人看一眼。
- **归属行**：若干提交的 `Co-Authored-By` 写的是实施席自己的模型（Sonnet／Haiku／Opus，这是真话）；`fix(control): give the schema-line criterion in endToEnd a real red, …` 缺归属行；`docs(sdd): record the seam B mutation battery` 的 trailer 中间多一空行。**都不 amend，由人决定。**
- **请人知情**（2026-09-24）：一席实施子代理为解超时杀过进程（harness SECURITY WARNING），追溯为它自己的孤儿 worker，只有强旁证。
- **安全**：2026-09-17 一把 API key 明文进过 transcript ⇒ 建议轮换，只有人能确认做没做。三个仓都装着同一个 `.git/hooks/post-commit`（`Qoder CN` AI tracker，调混淆过的二进制），远端曾在控制器零 push 时被推动 ⇒ 要人自己查 `post-commit`／`post-checkout` 并决定；控制器不动钩子。
- **人的数据**：`~/.Trash/orca-real-data-2026-09-27` 清不清归人；`~/.orca` 下的备份集（`~/.orca/backups/service-cutover-1791780311676/`）、ccmem 的 `global.db.bak.*` 与 `com.ccmem.daemon.plist.bak.20261013` 留不留归人。
- `docs/handoff/handoff_ui.md`：UI 的活交接（第三批及其第二轮的状态与待人项在它的 §七）；前两批结论已在本文，第三批结论已并入 §五 5.2.6 与 §六 6.7。

### 已知缺口（挂账，登记不修；出处在各台账）

- 执行驱动／④：驱动环启用前被冻结的 run 启用后不会自动解冻；非驱动环组被 shutdown 冻结后面板没有出口；`handoff-partial` 与剩余 grant 某维为 0 的 held 任务永久停住；一个发布一直失败的 Web run 下次重启会让 recovery 置全 store `dispatchBlocked`（m6）；超额 breach 的组只能 stop／recover；`replenishStartWakes`／`blockRun` 抛错中止整轮；冻结的 `budget-estimate` run 的 handoff 请求在 `src/` 无消费方（只静态核过）；`recovery-retry` 绕过 N2 可能两个解冲突并跑；`continuation-input.json` 不进 ccloop 任何 prompt。
- 用量：spawn 失败或出流前退出 ⇒ 用量 null ⇒ 组 `usageUnknown` 卡住（需先定义「可证明零花费」）；需求上的用量一旦未知清不掉；冻结时已完成的估算调用照样记 `interrupted`。
- 26(a)（⑤ 一轮，要先做设计）；单 profile 给所有角色时 confirm 强制数值 handoff 阈值（今天的绕法：estimator 与 worker 选不同 profile）。
- agent 选择：`ccloop resume`／`sweep` 不支持 `--agents` 起的 run；claude 工具进程另开进程组时杀不到；claude model 以 `[1m]` 结尾可绕过上下文档位；安装记录的`configDir`／kind 改了已开跑的组没有出路；claude 自动升级后旧 run 被 `agent-version-drift` 拒续；派活不与确认快照比对。
- 生产部署的 execution profile 快照：spec §5.3 要求、计划与执行都没接（真实环境有 `~/.orca/profile.json` v2 快照，`contextWindowTokens:null`）。
- 面板：Memory 页曾报 `ccmem-failed:1`（ccmem 侧缺陷，未修）；Web `BudgetEditor` 不显示决定派活的 `handoffControl`／`handoffExecution`；N2 延后小项（socket 属主 uid 不校验、状态目录可写不告警、mcp stdin 结束不 close 等，见 `.superpowers/sdd/2026-10-07-agent-entry/progress.md`）；整合时卡住的远端会让驱动等到 `ORCA_INTEGRATION_TIMEOUT_MS`。
- loop 方案：`evidenceRequired` 子串问题；Web 卡片「Acceptance: N check commands」不计文档检查；分钟级收尾窗口要和 ccloop 一起改；`reconcile.ts` 的 `rejectOn: ["nonzero exit"]` 无效（无害）。
- ccloop 侧：恢复窗口不可用时 60 s 不是真上限；`PARTIAL_FLUSH_MARGIN_MS` 在 Orca 手抄一份；`agent-selection.json` 只冻结选择与 hash；stream 用量一轮有四处删了不红（`setEncoding`、写观测的 `catch`、`total !== null`、`observedUsagePath`）、`message_delta` 配对不看 `parent_tool_use_id`；`src/runtime/codex/protocol.ts`／`types.ts` 注释把「真 codex 只在阶段末报 usage」写成事实（已发布，只能追加具名 ERRATUM，未做）；Codex skills 在真模型被杀后的续跑未验。
- 判据层（登记为冗余或弱，未编假判据）：`webFixture`／`createHarness` 的 `capabilities()` 没有独立钩子，用 `setObserved` 写「认领时能力不符」会假绿；`assertCapabilities` strict 分支不查 `requestBoundProof.workDimensions.includes("tokens")`；`ccloopPort.ts` 已发布 ERRATUM 指错段落；`webProtocol` 外层 `.strict()` 冗余；`capabilitySchema.test.ts` 标题证伪不了；旧 `ControlService` claim／continue 路径生产不可达无判据；handoff 宽限在冻结值无效时退回 0；`recoveryBlockers` 等几处换比较器无会红的判据；ccloopProtocol 的 SIGKILL 两行、controlReadApi 键数、controlConfigPort `defaults` 本来就弱；各轮 `minor (deferred)` 行（syncskill 集成、项目过滤、N1 概况串行等）见各自台账。
- 看板：图上不画写集冲突；`orca/<组>` 是否已并入 main／已 push 不显示；run 无开始时间戳故无耗时。Linux `status`／`logs` 不顺手 `enable-linger`。
- 容量：大规模并行前需要实测出的「同时启动任务数上限」（§六.8）。性能：M5／M6 已按 `docs/superpowers/specs/2026-10-09-control-poll-performance-design.md` 做完，其它 N+1 按实测单列。

---

## 九、本目录其他文件

| 文件 | 是什么 | 状态 |
|---|---|---|
| `known-load-flakes.md` | 全部已登记的负载型 flake 与判别规则 | 现行，**看到红先查它** |
| `2026-10-12-oh-my-pi-acceptance.md` | OMP 隔离真任务验收的证据索引（成功与两次中间失败） | 证据索引，保留 |
| `2026-10-12-live-service-cutover.md` | 正式服务切换：备份清单、schema 升级、launchd、**回退步骤** | 证据索引，保留 |
| `2026-10-12-followup-acceptance.md` | ccmem 迁移备份修复、真 Codex strict wire、Linux VM、GitHub 验收的证据 | 证据索引，保留；其「尚未完成」一节以本文 §四 为准（ccmem 已 push、strict wire 已进 OMP 分支） |
| `2026-10-10-ccmem-local-integration.md` | ccmem 本地整合归档包的 SHA256 索引（唯一人可读的那份） | 证据索引，保留 |
| `2026-10-14-feedback-triage.md` | 外部反馈 `issue-20261008.md`（10-14 版）对照当时 main 的分诊、优先级 1–7 与不采纳理由 | 现行，§4.2 第 12 条要用 |
| `2026-10-10-feedback-status.md` | 37 条外部反馈的分诊与延后清单 | 保留，§4.2 第 10 条要用 |
| `goal.md` | 方向与诉求 | 按需读 |
| `handoff_ui.md` | UI 各批的过程交接 | 现行（§七＝当前 UI 状态与待人项）；稳定结论已并入本文 |
| `worktree-archives/`（本目录与仓库根各一个） | 清理前保全的 review diff、ccmem 合并证据、旧 worktree 的忽略证据（各带 manifest） | 只读归档 |

旧 Results 5 WIP 的归档：`/Users/biran/code/skills/orca/orca_archived_files/results5-wip-20261012.tar.gz`（同名 `.manifest.json`）——main 已含其全部功能与更新的保护，无独有代码。

---

## 十、旧文怎么取回

本文每一轮被删掉的过程原文都在 git 历史里（`.superpowers/sdd/**`、`docs/superpowers/{specs,plans}/**` 从没动过——**那些才是证据链，本文只是索引**）。
取回 2026-10-13 压缩之前的完整版：

```bash
c=$(/usr/bin/git log --format=%H -n1 --grep='docs(handoff): condense Orca handoff and roll in OMP skill injection' -- docs/handoff/handoff.md)
/usr/bin/git show "$c^:docs/handoff/handoff.md"
```

更早的版本：`/usr/bin/git log --oneline -- docs/handoff/handoff.md` 先挑那一笔，再 `git show <那一笔>:docs/handoff/handoff.md`。
**如果你发现某条结论在这里找不到、而你记得它存在——先去 git 历史里找，再补回来。补回来不需要授权；那正是本文允许就地改的用途。**

### Suggested skills

`superpowers:verification-before-completion`（每次说「做完了／绿了」之前）、`superpowers:brainstorming`（开新能力之前）、`superpowers:writing-plans`、
`superpowers:subagent-driven-development`（值这个钱，但是主要开销）、`superpowers:systematic-debugging`（出现红先用它）、`superpowers:receiving-code-review`
（评审员的承重主张自己复核）。skill 与 `CLAUDE.md` 冲突时 `CLAUDE.md` 优先。
