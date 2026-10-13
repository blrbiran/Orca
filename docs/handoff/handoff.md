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

## 三、当前状态（2026-10-13，会话 `808feb6a` 滚动）

### 3.1 已经做成的（都已在 Orca／ccloop 的 main 上，除非下面另说）

- **CLI**：`orca validate／plan／correct／metrics／panel／compact-reviews／level／checkpoint write／resume／gate／chain／control／mcp serve／user`（完整用法 `src/cli.ts` 的 `USAGE`）。**`orca run` 已退役、不存在**；跑一轮只能走面板／控制路径。
- **面板服务**：`orca panel install|uninstall|start|stop|restart|status|logs`（launchd／systemd／detached），整个 Web 要登录（owner／member、CSRF），socket `<stateDir>/control.sock` 给 agent 用（`orca control get|send`、`orca mcp serve`、`skills/orca-control/`）。
- **执行链**：执行驱动（worktree／clone 工作区、落地到 `orca/<group>`、解冲突 run）、④ handoff 投递与续跑、N 路并行落地、⑤ 预估链（single-call）、N1 需求澄清→拆分→确认、loop 方案层（五个内置方案＋`set-task-loop`）、合入方案（`local`／`push-target`／`push-branch`／`github-pr`）、花费上限＋按模型 token 账、Results（保存成果、预览下载）、安装观察与 owner 显式应用、Activity。
- **面板分区**：需求→任务→决策→记忆→指标→链；项目切换＋全部项目视图；依赖图与 Git 区；中英双语；记忆区只读（`ORCA_CCMEM_BIN`）。
- **skills**：loop 方案可声明 syncskill 集，confirm 时冻结，每个 run 注入只读快照。claude 走 `--plugin-dir`，codex 走 `codexSkillsDir` （每 phase 临时链 `.agents/skills/<name>`），**omp 走 `ompSkillsDir`（本会话新做，还在分支上，见 3.3）**。
- **agent kind**：claude、codex；**omp（oh-my-pi）已实现但在分支上未合**（3.3）。
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

**没在真 agent 下验过**：依赖、崩溃恢复、strict 组、真 codex 下的 handoff（真 codex 只在阶段末报 usage ⇒ deadline 中止多半不可续且挡整组）、真 claude 下的 single-call 估算（`--tools ""` 与输出上限只有静态证据）、混 kind、真 codex 下的冲突、带 skills 的 agent verifier／profile 声明／多任务、**OMP 带 skills 的任何真 provider 跑**、正式 owner 登录后的 Results／Memory。真 Claude 隔离任务 2026-10-12 撞周额度未跑完。
**驱动环只在 port `configured` 时挂；未配置时行为逐字节同前。**
**Codex 只支持 `phase-end`＋`soft`：任何地方不许宣称 strict token 封顶**；软 token 预算也不能说成严格金钱上限。

### 3.3 会话 `6b7843ec`（2026-10-13 晚）的状态 —— **先读这一节**

- **人已合并并推送**：ccloop main 与 Orca main 都已含 strict-wire＋OMP＋OMP skills（`ls-remote` 与本地一致）。
  🔴 **但 Orca 合并时跳过了 repin**：main 的 `package.json` 仍钉旧 ccloop `2026ef1…`（历史值，比 ccloop main 少 15 笔，不含 strict-wire／OMP）⇒ **默认 pin 下 OMP 与 `ompSkillsDir` 不可用**。
- **repin 已由人合推**（2026-10-13 晚；以下为合推前的门记录）：Orca `codex/repin-ccloop-760c314`，一笔 `chore(deps): repin ccloop to the pushed OMP skills main`（`pin-ccloop.mjs` 全部检查 ok、`npm ci` 复现）。门（本会话，`ORCA_CCLOOP_BIN`＝同提交的 `clone --local` 构建 `/private/tmp/ccl-760c`）：
  typecheck／build／web build／`verify:ccloop-pin`／`verify:panel`／`--ws check` 全 RC 0；`verify:control` 1882/1914、30 跳过、2 红（`taskResultPaired` 已登记环境红）；
  根级全量 3732/3778、36 跳过、10 红 = 2 条 `taskResultPaired` ＋ 8 条超时（`gateCheck` K1／K12、`retryTask` 三条、`schedulerBridge` 一条 30 s、`settleUnknownUsage`「keeps another run's…」两条），单文件重跑结果见 `known-load-flakes.md` 本会话行。**不等于全量绿。**
  ⚠️ `ORCA_CCLOOP_BIN` **不能**指 `node_modules/ccloop/dist/cli.js`：npm 包不带 `tests/fixtures`，按 bin 位置找 fake 的判据会成片假红（本会话第一次 `verify:control` 57 红即此）。
- **真 Codex 可用的模型**：`gpt-6-luna` 在本机 codex-cli 0.160.0 下实跑 `turn.completed` 成功（2026-10-13，一次 `pong` 探针，输入 80128 tokens——本机 codex 会加载用户插件／skills）。「Codex 额度用完」不覆盖它；付费跑仍要人每次开口。
- **外部测试反馈 `orca_archived_files/issue-20261008.md` 的分诊**（对照当前代码，两席只读子代理＋控制器抽查）：
  - 45/46/48/49/50（429）：**ccloop 未修** —— codex 非零退出一律 `codex-exit-error`、run 直接 `failed`（`src/controller/runLoop.ts` 的 `PhaseExecutionError` 分支），无分类、无退避；「尝试 1/3」只是预算显示，阶段异常不会开第 2 次尝试；`--ephemeral` 仍在。退出时无 `turn.completed` ⇒ 用量 null ⇒ Orca 侧未知用量。人裁：**做「识别 429/5xx＋阶段内有限退避重试」，不做去 `--ephemeral`／codex 会话续跑、多 provider、任务间强制等待**；**等人从测试者处拿一份真实 429 的 `events.jsonl`** 再写匹配规则。
  - 46（无重试按钮）：一般是「先结算未知用量再重试」两步；**真死路是 work 预算不限**（`settleUnknownUsage.ts` 拒 `unlimited-remainder`、`retryTask.ts` 拒 `usage-unknown`），且一个未知用量 run 会让整组停派（`groupUsageUnknown`）。⇒ D（下条）。
  - 47：归档报错来自卡片 ⋯ 菜单，`RefusalNotice` 无动作入口 ⇒ 并入 D 的 Part B。
  - 39／15：解码已修（无外层 `result` 可收、夹说明文字可提取唯一 JSON、plan 提示词已加强）；格式失败不重问，新 run 的 saved-result capsule 恢复按设计一律失败。**等新失败样本再定**。41：`activity` 返回 `{entries:[…]}`，测试者读错字段，失败原因 UI 已有。32：Overview 关注队列已有。34／35：设计轮。
- **D（进行中）**：spec `docs/superpowers/specs/2026-10-13-unmetered-usage-settlement-design.md`（分支 `codex/unmetered-settlement`，工作树 `/Users/biran/code/skills/orca/Orca-wt/unmetered`，叠在 repin 分支上，**只有 spec、没有代码**）。
  **人裁（2026-10-13，本会话）**：不限预算 run 的未知用量由 owner **放行不记数**（人否决「owner 填有限数」：「每次都让用户填基本不可能实现」）——这**具名推翻** `2026-10-11-token-policy-design.md` 里 "Never book … guessed usage / require manual finite settlement" 对 null 剩余的那半句（原文不改，更正在新 spec §A.1）。
  已核：work 剩余为 null **只在**任务 ceiling 为 null 且无组上限、无任何花费上限时出现（`fundedAllowance.ts` `decideFundedAllowance`），所以放行绕不过任何在执行的上限。
  实现要点（spec §A.2–A.5、§B）：新 acknowledge `release-unmetered`、marker 方法 `owner-acknowledged-unmetered`、只有 work tokens 维为 null 其余照 `remaining-grant`、`hasValidUsageSettlement` 要认新形状、组 ledger 加「用量不完整」标、Web 永不显示成 0。
  ⚠️ 既有判据 `tests/control/tokenPolicyStop.test.ts`「holds an unknown nullable stop and refuses remaining-grant settlement」断言预览 `allowed:false`——它编码的正是被推翻的裁决，实现时要改写并在提交说明里点名。

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

### 3.4 最近一次可引的门（**历史观测，引用前现测**）

- feedback-followup Task 14 最终产品树：Orca 根级 3772 条中 3742 过、0 失败、30 条逐名条件跳过；Web 987/987；ccloop 1601/1601。证据 `.superpowers/sdd/2026-10-11-feedback-followup/`（`task-14-native-gates-report.md`、`task-14-native-evidence-manifest.json` 等）。
- 2026-10-12 切换后：根级 3739 过／0 失败／33 条件跳过（多出的 3 条为未传配对 CLI 的跳过，另以新旧 CLI 3/3 实跑）。
- OMP 分支（2026-10-12～13）：Web 990/990、typecheck／build／panel 门过；正式 control 用本机真实 agent 表 1876/1909、30 跳过、3 红（1 条要 fake Codex `integration` 表，换表后 3/3；2 条 `taskResultPaired` 硬编码旧配对二进制路径，本地 OMP 构建不在其矩阵内）。**以上不等于全量绿。**

---

## 四、⛔ 下一件事（按顺序）

### 4.1 人在自己终端跑的（agent 被 Tier 0 拦；每一件都要人单独点头，非门合并一律 `--ff-only`）

1. ~~ccloop ff＋push~~、~~Orca ff＋push~~：人已做（2026-10-13）。
2. ~~Orca repin 合推~~：人已做（2026-10-13 晚）。
3. ~~面板服务从新路径重装~~：人已做（2026-10-13 晚，会话 `6b7843ec` 现核：`service.json` 的 entry 为 `/Users/biran/code/skills/orca/Orca/dist/cli.js`、node `/usr/local/bin/node`、无 `ORCA_CCLOOP_BIN` 覆盖、`ORCA_CCMEM_BIN`／`ORCA_SYNCSKILL_BIN` 指新仓；`panel status` launchd running、7777 首页 200；人同时把 `/usr/local/bin/ccmem` 与全局 `syncskill` 软链修到新仓）。原步骤留作再装参考：在 `/Users/biran/code/skills/orca/Orca` 上 `npm ci`／build 后 `orca panel install`（端口、控制根、账户根、ccmem 根照`2026-10-12-live-service-cutover.md` 的配置），确认 `~/.orca/panel/run.sh`／`service.json` 指新路径，`orca panel status` 为 running、7777 首页 200。
4. **清理**：删已合入的分支（两仓的 `codex/*`，**不含**仍在进行的 `codex/unmetered-settlement`、待合的 `codex/repin-ccloop-760c314`）与工作树 `/private/tmp/ccloop-omp-agent-20261012`、`/private/tmp/orca-omp-integration-20261012`；本会话留下的 `/private/tmp/ccl-760c`（ccloop 测试 clone）与 `/private/tmp/og-yV1y`（门日志）不是 worktree，可 `/bin/rm -rf`；另有两条**失效的工作树记录**（`.git` 文件指旧仓路径，提交已在 main）：Orca `/Users/biran/.codex/worktrees/feedback-followup-20261011/Orca`、ccloop `/private/tmp/orca-results-ccloop-20261010` ⇒ `git worktree prune`／移除。syncskill 的 `dev` 分支按人裁保留。

### 4.2 agent 的活（上面做完、或与之无关时）

0. **D：放行不记数＋失败任务的出路可见**（§3.3）。新会话在 `codex/unmetered-settlement` 工作树里按 spec TDD 实现，每个新分支点名变异看见红；改的既有判据单列。完成后跑全量门，再交人合推（它叠在 repin 分支上，repin 先合）。
0b. **C：ccloop 识别 429＋阶段内有限退避**（§3.3 的分诊）。**真实样本已到**（人 2026-10-13 提供，测试者的 `recommendations` 任务）：
   `/Users/biran/code/skills/orca/orca_archived_files/recommendations-{1,2}-events.jsonl`，两份都只有 4 行：`thread.started`、`turn.started`、
   `{"type":"error","message":"exceeded retry limit, last status: 429 Too Many Requests"}`、`{"type":"turn.failed","error":{"message":"<同一句>"}}` —— **失败发生在任何 `item.*` 之前**。
   控制器（`6b7843ec`）的设计建议，**未经人裁**：① 判定式只认 `turn.failed.error.message`／`error.message` 里的 `last status: 429`（5xx 无样本，不承诺）；
   ② **只在「`turn.started` 后零 `item.*` 即 429 失败」时**阶段内有限退避重试（工作区未被动过），有 item 的 429 只把原因改报 `codex-rate-limited`、照旧失败；
   ③ **待人裁**：失败调用没有 `turn.completed` ⇒ 用量 null ⇒ 重试成功后 run 仍是未知用量、Orca 照样卡住。选项 (i) 对「零 item＋429」调用记 0（理由：HTTP 层被拒、429 通常不计费——本质是推定零，与 D 同类）；(ii) 坚持 null，重试成功后仍需 owner 结算。控制器倾向 (i)。
   在 ccloop 先写短 spec 再 TDD（守 ccloop 自己的规则：改既有判据要人逐条点名）。完成后可用 `gpt-6-luna` 做一次真 Codex 回归（付费，先问人）。
1. **OMP skills 的真 provider 验收**：有可用 provider 时（LiteLLM 端点要人起；Codex 额度已耗尽），照 `2026-10-12-oh-my-pi-acceptance.md` 的隔离形状、带一个声明 skill 的任务跑一次，独立审计（`scripts/verify-omp-acceptance.ts`）要能看见 `<skills>` 块与 `SKILL.md` 的 read 调用。**模型选择器只是验收数据，不设默认。**
2. **ccmem 适配 Codex 与 oh-my-pi**：人的**下一个项目**，未开始；先 brainstorming，记在 ccmem 与 Orca 两边的 handoff。
3. **OMP 仍延后的**：OMP 子 agent、交互式审批桥、codex 专属的 saved-result 恢复对 omp 的支持；single-call 不提供（理由见 §五）。
4. **GitHub 私有验收**：私有库 `blrbiran/orca-integration-smoke-20261012` 与本地测试提交已建；测试分支 push 要人按 Rule 15 授权；之后用 `pushPorcelain` 推、`syncGroupPr` 建 draft PR 并验重试幂等。运行 `gh` 前清掉失效的 `GH_TOKEN`／`GITHUB_TOKEN`（keyring 有 `repo` scope）。
5. **正式面板 owner 登录后**核 Results、Memory 与账户边界（agent 不读、不传密码；未登录的 200／401 不算登录体验）。
6. **路线图未落地**：memory 自动 correction 写回（Orca memory adapter 仍只读、`recordCorrection:false`；需要 ccmem 外部引用＋按 `projectKey+correctionId` 幂等的导入契约＋失败重试语义，不能直接用逐行吞错的 import）；LiteLLM 接入（先定模型别名／实际成本来源、未知成本阻断口径、per-run 预算边界）；A2A 运行时（人裁排远期，只做只读状态外壳）。**不能宣称记忆写回已闭环。**
7. **挂在姊妹仓的**：ccloop B4 与 Claude `ClaudePhaseAborted` 历史交错（精确交错未证成，不能据此宣称真实 provider 稳定性）；ccmem T13；ccmem `describePlistDrift` 疑似缺陷（3.3）。都按各仓自己的规则做，先报再动。
8. **延后的反馈**：`docs/handoff/2026-10-10-feedback-status.md` 列为「设计轮」的条目（设置聚合、项目总览／行动区、成果报告、跨组演进、右键／向导／视觉、通知）中哪些已被 2026-10-11 feedback-followup 一轮覆盖，接手时对照该轮 spec 现核，再按 brainstorming 选题。

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
6. **面板**：后端 express、前端 React；**六个分区始终挂载，非当前区只由 `styles.css` 的 `.section-pane:not([data-active="true"])` 隐藏**，不许条件渲染／`hidden` （改了会让 16 条既有判据红）；有副作用的分区按「第一次激活」才请求。`orca panel` 的 ready 行一个字节都不能改（`verify-panel.ts` 正则、`endToEnd`、`controlShutdown` 都钉着），给人看的提示写 stderr。深色 token 被 `web/tests/contrast.test.ts` 按 WCAG 比值钉着，**别往暗里调**。kind 重要性只是 UI 序（`web/src/kindRank.ts`）。
7. **控制面**：读视图排序用 `compareText`（code unit），**不用 `localeCompare`**；会持久化或进哈希的排序不动。不带 `sinceChangeSeq` 的 summary 恒回`resetRequired:true` 是规格，前端对「自己要的完整重读」不 purge。
8. **Orca 不许自造对端观测**；跨仓的空值／词表语义修在**产生观测的那一端**（ccloop）。`ContextObservationV1` 在 Orca 无生产者 ⇒ 真 ccloop 下`contextWindowTokens:null`，预估是 `estimate-blocked-capability`（人裁：等 ccloop 能实时观测上下文时加显式关闭值，不放宽 `null`）。G1：`targetVersion` 是正安全整数，写字符串的 plan 被 `loadPlan` 以 `malformed` 拒，不做静默转换；`handoffControl:"durable"`、`handoffExecution:"mechanical-in-run-v1"`；旧的 `durableAccept`／`ownershipIsolation`／`evidenceRetention` 是删掉的，不是迁到别的字段。
9. **预算**：`--task-tokens` 是一个任务全部阶段／尝试／续跑的**累计**上限，实际工作设 ≥1,000,000；估算 grant 是常量 `ESTIMATE_GRANT`（250k／900 s）。⚠️ Web 派活在 `blocked-capability` 时给每个任务 `complex-1m-default`（3M token、3 attempts、4 h）并覆盖 contract ⇒ **真钱跑前先 `proposal-edit` 封顶，并在 ccloop 实际收到的 `loop-contract.json` 里核**。花费上限命令只进命令台账；对账花费记 `unattributed`；`POST /api/chains` 不受花费上限约束（政策问题，未改）。
10. **skills**：只对带 skill 集的 claude run 去掉 `--disable-slash-commands`；skill 集声明在 loop 方案上、不进 ccloop 合约；profile 在 confirm 时冻结；已确认任务上声明没变就沿用冻结名单、不起 syncskill；agent kind 取自 ccloop `listAgents`，在 confirm／set-task-loop 就拒不支持的 kind。三个 skill 字段（plugin／codex／omp）互斥。**OMP 永远带 `--no-skills`／`--no-extensions`**：开 OMP 自己的发现会加载操作者机器上的任意 skill，run 不可复现。claude 下 plugin skill 以 `orca-run-skills:<名>` 出现，提示词要点名 skill 就得用这个带前缀的名字。
11. **OMP**：作为可选安装进 detect、精确模型解析、受保护 preview/apply、面板选择；模型从每台机器的 OMP 配置探测，**不把任何本机选择器（如 `local-litellm/…`）设为默认**。Git 忽略文件与主机侧写入不在 changed-path 检查内 ⇒ **不是沙箱**；一次验收是 pilot，不是可靠性。**OMP single-call（estimate／clarify／split）不提供**：OMP 18.10.1 没有逐次调用的输出 token 上限，catalog `maxTokens` 只在条件下发送，且 OMP 会自动重试，按 ccloop §4.4 契约 `singleCallExecution` 保持 null（证据在 OMP skill spec §4）。人会审这条，未审前不要改。
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
- **控制协议**：ccloop `control` 方法集 `capabilities`／`accept`／`inspect`／`handoff`／`collect`／`read-evidence`，一次一进程的 JSON-over-stdio，状态全在文件里。`capabilities` 答 v2 八字段；唯一的 schema 例外：ccloop `requestBoundProof.*Dimensions` 是任意字符串数组，Orca 要求排序去重的枚举（将来非 null 写错时 fail closed）。envelope protocol 3／4，`work` 分 `loop`／`single-call`，`singleCallExecution` 兄弟字段（claude `"v1"`，codex／omp `null`）。
- **水位／检查点**：水位＝transcript 最近主链消息的 input＋cache_read＋cache_creation，T1 330,000／T2 450,000；`orca level --hook claude-code` 挂 PostToolUse；子代理调用完全静默、自己的水位不测。`orca resume` 重跑检查点里记录的 shell 命令。
- **Tier 0 闸门**：`.claude/settings.json` 的 PreToolUse `orca gate --hook claude-code`＋`permissions.deny`，拦 push／合并进 main／删分支／删 worktree／`gh` 对外写。已知放行：写成脚本再执行、`python3 -c`、git alias、`-c core.hooksPath=`、`--no-verify`、`ExitWorktree`、`rm -rf` worktree 目录、`git -C <path> push`；已知过度拦：main 上 `git branch -f`、`merge --abort`、`rebase --continue`。威胁模型是合作型 agent 的失手，不是对抗。
- **关键环境变量**：`ORCA_CCLOOP_BIN`（本地覆盖）、`ORCA_AGENTS_TABLE`、`ORCA_SYNCSKILL_BIN`、`ORCA_CCMEM_BIN`、`ORCA_CORRECTIONS_DIR`（都是绝对路径，空＝未配置）。

---

## 八、什么在等人（awaitingHuman）

- §4.1 的四件（ccloop ff＋push；Orca repin→门→ff＋push；面板服务从新路径重装；分支／工作树清理含两条失效记录）。
- **人要审的本会话决定**：OMP single-call 继续不提供（§五 5.2.11）；OMP skill 注入的设计取舍（spec `2026-10-13-omp-skill-injection-design.md`）；`ompUpdates` 那条负载下超时的判据要不要改写（要人点名）。
- **未审完的轮次裁定**（各台账 `Ruling:` 行）：面板项目过滤（`.superpowers/sdd/2026-10-06-panel-project-filtering/progress.md`，含改写的 `web/tests/projectSwitcher.test.tsx` F，不同意就回滚并重议 P1）、Task control 刷新＋项目切换（会话 `08011394`，提交说明里）、syncskill 跟进（会话 `9d95e6c8`，改了 web 夹具与 `skillsE2E` I1）、面板 HTTP＋syncskill 补三件（会话 `16ab00f2`）、UI 一轮被改写的四条判据（计划 Global Constraints 的 `REWRITTEN … U1–U4` 注释）。人回复后把对应条删掉。
- **面板的真浏览器视觉验收**（深浅主题、屏幕几何、依赖图 SVG）——只做过 Playwright／隔离浏览器截图，人没看过第二批以后。
- **`orca chain` 真钱活体验收**：要人提交 `.orca/chain.json` 选 model（不存在时开链被 `chain-config-missing` 拒）。先测 F，副本 T1 > F。
- **ccloop 判据改写授权**：ccloop 里仍有改既有判据才能修的（M3／M4 等，ccloop 人裁 88 要逐条点名）；ccloop 要不要对别的客户端设 `setTimeout` 溢出防护（行为改动，要人开口）。
- **一揽子／历史决定**：「第二个 panel 不挂控制面」是控制器的可逆决定，要不要维持未决；裁决甲的 `plan` 那一半（改 `preflightUnreadableRepo` 的判据）未获指名授权；子系统 B 后续按人裁「暂缓到有 `not_my_taste` 行」——`~/.orca/corrections.jsonl` 2026-10-12 现测不存在，条件仍不满足；`import-plan` 的上限按 agent 定的 task 数算，请人看一眼。
- **归属行**：若干提交的 `Co-Authored-By` 写的是实施席自己的模型（Sonnet／Haiku／Opus，这是真话）；`fix(control): give the schema-line criterion in endToEnd a real red, …` 缺归属行；`docs(sdd): record the seam B mutation battery` 的 trailer 中间多一空行。**都不 amend，由人决定。**
- **请人知情**（2026-09-24）：一席实施子代理为解超时杀过进程（harness SECURITY WARNING），追溯为它自己的孤儿 worker，只有强旁证。
- **安全**：2026-09-17 一把 API key 明文进过 transcript ⇒ 建议轮换，只有人能确认做没做。三个仓都装着同一个 `.git/hooks/post-commit`（`Qoder CN` AI tracker，调混淆过的二进制），远端曾在控制器零 push 时被推动 ⇒ 要人自己查 `post-commit`／`post-checkout` 并决定；控制器不动钩子。
- **人的数据**：`~/.Trash/orca-real-data-2026-09-27` 清不清归人；`~/.orca` 下的备份集（`~/.orca/backups/service-cutover-1791780311676/`）、ccmem 的 `global.db.bak.*` 与 `com.ccmem.daemon.plist.bak.20261013` 留不留归人。
- `docs/handoff/handoff_ui.md`（两批 UI 都已并入 main，结论已在本文）要不要删，归人。

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
| `2026-10-10-feedback-status.md` | 37 条外部反馈的分诊与延后清单 | 保留，§4.2.8 要用 |
| `goal.md` | 方向与诉求 | 按需读 |
| `handoff_ui.md` | UI 一轮的过程交接 | 结论已在本文，删不删归人 |
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
