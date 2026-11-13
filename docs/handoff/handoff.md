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

### 3.最新（2026-11-13，会话 `d467cbd2`，测试者反馈 I 轮）—— push 闸门可经 `allow-push` 放行；test-affected 收窄；Part B 按观测下界结算；#273 复审修复；付费 dogfood 揪出并修好 4 个 P0 级卡死；#278／#243／#263／#230／#272／#265；**Orca main 有 repin 以外的全部，ccloop 三笔在其本地 main，都未推**

- **人的话（原话全文在台账 `.superpowers/sdd/2026-11-13-tester-followup-i/progress.md`）**：开轮「这次批准改写所有必要的判据。这一轮允许必要的付费真跑。…临时允许你push…先按你的建议执行」；四问「Part B 的结算算术 => 按你的建议走」「#262 后半段（在 ccloop 里） => 时间预算只算真正在干活的时间」「#261 后半段 => 按你的建议走」「cacheRead 计费口径要不要这轮先 brainstorm？ => 下一轮做」「上面那个 push 授权的识别方式行不行？ => 可以」；#273「派独立subagent review 然后实现」。
- **已在 Orca main（主题行按 `git log --grep` 取）**：
  - **push 闸门**（`feat(gate): admit a plain git push when the human typed allow-push`；Rule 15、闸门 spec §12）：人在**自己消息的开头**敲 `allow-push` ⇒ `UserPromptSubmit` 钩子写 12 h 授权（`${ORCA_GATE_DIR:-~/.orca/gate}/push-grants/<session>.json`）⇒ 该会话只放行 `git push origin [<ref>…]`（另允许 -u/-q/-v/-n/--porcelain/--follow-tags）；force／删除／mirror／裸 push／非 origin／`-c`／`GIT_CONFIG*` 仍拦；`deny-push` 收回；chain 会话永不得授权；`permissions.deny` 去掉了 push 三条（§12 风险 13：钩子超时被杀时 push 无兜底）。**本轮人没敲 `allow-push` ⇒ 本会话 push 全被拦，控制器未伪造授权。**
  - **test-affected**（`feat(test-affected): a pin-only repin selects only the tests that run the real ccloop`）：只改 pin 时只选读 `ORCA_CCLOOP_BIN` 或直接 import 读它的 helper 的测试；真 repin `09497063` 上 503 → 102 个文件。spec 2026-10-20 §10。
  - **Part B 结算**（`feat(control): an expectation-model run's unknown usage may settle at ccloop's observed floor, explicitly`；G spec §16）：未知用量期间照旧扣住整份未用 ceiling；结算时**额外**允许显式 `charge-observed-floor`（没有下界 ⇒ `observed-floor-unknown`，继续扣住）；自动路径仍是 remaining-grant。不按一半扣（人「按你的建议走」）。
  - **#273 复审**（独立 subagent 复审 → 修）：连丢计数按认领顺序（`runs.rowid`）而非随机 run id 顺序（`fix(control): count a task's worker-lost streak in claim order…`）。**stepC 认「有 candidate 无停止证明」的 `worker:lost` 那一笔留在分支 `i/worker-lost-fixes`（worktree `.claude/worktrees/i-worker-lost`），等 repin 再合**（其 E2E 只在新 ccloop 下过）。
  - **付费 dogfood 揪出的（seat K、L，已修）**：
    - worker-lost 期望模型 run 用 `charge-remaining-grant` 结算后存成 `grant.tokens null`＋`remaining 0` ⇒ `validAccounting` 拒 ⇒ **整组 `group show`、`task retry` 都 423 `recovery-blocked:run-identity`**；写端改为 null 保持 null、标记按 live ceiling 校验；读端接受旧写法的行（remaining-grant＋live ceiling＋有效标记）与 known-zero 形状（#215 同类）——**真组无需改库即恢复可读**。
    - 该结算原来把未用的时间（约 4 h）、attempts、sessions 也扣光 ⇒ 阶梯 `authored-budget-exhausted`、不重启；现在 worker-lost 只扣 token，由 `workerLostPass` 重启。
    - 被杀 worker 的 run 没有 ccloop 下界 ⇒ `observed-floor-unknown`；现在已观测过 token 的 worker-lost run 下界＝0（在已观测量之上）。
    - 暂停线 `decide-usage continue` 时被停的 run 没有完整 checkpoint（codex 执行中途停）⇒ 续跑 run A2 `resume-predecessor-unrecoverable`、`recovery retry`／`task retry`／`close-run` 互相指回去的**死循环**，且 brief 说 running、0 blockers；现在 stepA2 只在 `exportResumeBundle` 前提成立时续跑，否则全新开始；`recovery list` 新增 `blockedRuns`，`recoveryBlockerCount` 计入（`claimBlocked` 不计）。
    - 显示：apply-estimate 不再说「没有 token 上限」并点名 1M 期望下限（期望＝估算，下限 1,000,000，`EXPECTATION_FLOOR_TOKENS`，#266——**不是缺陷**）；期望模型组的估算按建议性显示；草稿任务的资金预览、`dependencies-pending`、null 额度读作 unlimited；retry 回执 `nextRun.because`。
  - **#278 余项**：landing watch 与 requirement review 对已删工作分支走验收同一套 `work-branch-missing` 记录（一次 rev-parse、一行日志）。
  - **面板日志 262 行 `control-peer-exit:ENOENT`**：H 轮 repin 时 `npm ci` 在面板运行中改写了 `node_modules/ccloop`（库里没有 flow，pump 每轮 `refreshAgents` 起 ccloop）；数据无损。错误现带路径、只记一次、打开的 flow run 有 `lastError`。**repin／`npm install` 前先停面板或之后重启。**
  - **#282** `task note` 判据（主线已过）；**#243** Live 笔记 Enter 发送／Shift+Enter 换行／输入法组合不发；**#263** `run show` 与 Web 说明「执行已完成、只差验证」并给 `run eligibility`／`task verify-saved-result`；**#230** 不改码（brief 计数本来就按当前 run 推导；加判据）；**#272** `task retry`／`close-run` 拒绝带 `next`，>50 KB 的人读 `group show` 末尾一行提示；**#265** 草稿 `impliedPathsOutsideTargets` 非阻断提示＋拆分指令一句。
  - **配对验收漂移**（seat I）：`savedResultWorld` 当前生产者世界改用 `preRelease`（H 轮默认期望模型后 V10／exhausted 的源 run 直接 succeeded）。
  - 文档：`docs/superpowers/specs/2026-11-13-weighted-token-ledger-proposal.md`（cacheRead 加权提案，**未实施**，人「下一轮做」）。
- **ccloop 本地 main（未推，Orca 未 repin）**：#262 只算干活时间（空档超过 120 s 的部分不计）、#273 复审修复（candidate 写后死掉、UTC lstart、重跑补记用量）、**saved-result 校验认 handoff 目录**（G 轮 `afb9a51` 起生产上 OMP 坏 final／codex 未知用量的已存结果恢复全被 `saved-result-config-mismatch` 拒——真回归）。见 ccloop handoff。
- **付费 dogfood**（项目 `orca-dogfood-a9c43a99`，组 `g-28d9b560`，codex gpt-6-sol，限额 4M → 人身份抬到 4.6M）：澄清 1 问→`--finish`；拆分 draft 1 被 `check-write-scope` 正确拒、draft 2 tags∥search 并行（#284 ✓；但 `parallelCandidates` 把 cli 对 search 的真依赖也列成可删边——误报）；杀 worker 约 10 s 判 `worker-lost` ✓；组上限超 81k（codex 只能在回合之间停）；抬上限后 readme 自己续上（O4 ✓）；**组级验收跑了 `npm test` 全过（#279 ✓）**；落地主题＝任务目标＋trailer（#277 ✓）；**需求复核失败 `codex-single-call-not-single:messages`**（gpt-6-sol 同一回合先发一句前言再发 JSON；ccloop 拒多条消息，`codexSingleCall.test.ts:229` 钉着 ⇒ 改要人点名），控制器 `group review-rerun` 一次，**同样失败**（组停在 `requirement-review-not-passed:failed`，留给人）。用量只按工具账本记：组 4,387,239 token（复核重跑前）；没有工具给的美元数。
- **门（现测）**：整轮 `test-affected --base=<本轮起点>` 1047 文件：根 804/812、web 235/235、typecheck 0；红全在负载名单或单跑过，`startForm` 与本轮起点 A/B 同形（各 失败,失败,通过）；之后 seat I／K／L 各自门只剩已知 `orchestration`。**全量门未跑（Rule 18）。** 日志 `/private/tmp/orca-i1113/`。
- **装进 7777**：seat L 合入后 `npm run build`＋web build＋kickstart；`orca status` ok（`ccloop: 26b3127 pinned and installed`）。

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

### 4.0 接手顺序（会话 `d467cbd2` 2026-11-13 收尾）

1. **等人：在消息开头敲 `allow-push`**（本会话没有授权 ⇒ 三仓都没推；一律 `ls-remote` 现核）。有了授权后按序做：
   1. 推 ccloop main（#262、#273 复审、saved-result handoff 目录三笔＋handoff）。
   2. Orca repin：**先停面板或之后立刻重启**（`npm ci` 改写 `node_modules/ccloop` 会让运行中的面板每轮 ENOENT）；`node scripts/pin-ccloop.mjs <ccloop main>`＋`npm ci`；rebase 并合分支 `i/worker-lost-fixes`（worktree `.claude/worktrees/i-worker-lost`；stepC 认「有 candidate 无停止证明」的 `worker:lost`）；`npm test`（新 `test-affected` 只选读 `ORCA_CCLOOP_BIN` 的约 100 个文件）＋配对 `ORCA_SAVED_RESULT_VERIFY=1 … savedResultRecovery.paired -t 'V10:|V11:|O19:|a real exhausted completion'`（pin 那笔的 clone build）；装进 7777；推 Orca、ccmem。
   3. Orca spec／文档里把 `used.activeMs` 写成墙钟的地方按 ccloop #262 改成「干活时间」（ccloop 只改了含义、协议不变）。
2. **要人点名的 ccloop 判据（ccloop Rule 15）**：
   - **`tests/runtime/codex/codexSingleCall.test.ts:229`（`not-single:${what}` 的 `messages` 一支）**：gpt-6-sol 做需求复核时同一回合先发一句前言再发 JSON ⇒ `codex-single-call-not-single:messages` ⇒ **codex 组的需求复核目前过不了**（dogfood 组 `g-28d9b560` 两次复核都失败、现停在 `requirement-review-not-passed:failed`）。建议：同一回合、无工具、`-o` 文件里有合 schema 的答案时容许前置消息。人点名后改。
   - 旧判据标题「a run with a candidate never carries worker」现在说多了。
   - `settle-lost-worker` 被杀留下的 `control/accepted.lock` 无陈旧回收（claim／seal 共用锁，改法要人定）。
3. **人审（都可逆，台账「Controller decisions」与各 seat 报告）**：push 闸门的设计（只认消息开头、白名单、授权覆盖子 agent 与别的仓、push 不再有 deny 兜底）；Part B 下界（超过扣住额的下界照记、可让组读数超限；worker-lost 无 ccloop 下界时取 0）；#262 的 120 s 门槛；ccloop「candidate 永远保留为结果」；seat K／L 的读端兼容旧行、`blockedRuns` 计入 `recoveryBlockerCount`；#230 不改码；#272 `next` 在 CLI 侧、恒为数组；#265 只提示；test-affected 的已知漏选（两层 helper、`process.env["…"]` 写法）；#261 判「决定不改」；dogfood 组 `g-28d9b560` 怎么收（`review-accept`／等 ccloop 修好后 `review-rerun`）。
4. **下一轮（人已定）**：cacheRead 计费口径 brainstorm（提案 `docs/superpowers/specs/2026-11-13-weighted-token-ledger-proposal.md`）。
5. **余项（agent 能做）**：组上限停住等充值时 `recovery list` 不列（只在 brief 显示 blocked 1）；`parallelCandidates` 把 import 关系的真依赖列成可删边（#284 误报，要看 import 图）；`orca` CLI stdout 被提前关闭时抛未处理 EPIPE；死 run 停在 C 仍占着未用 ceiling 且仍是抬上限候选（`planCeilingRaises`）；ccloop 可从被杀调用的转录算出真下界（要 repin）；配对 V10／O19 只覆盖发布前世界，期望模型世界没有对应验收；19 个 schema10／old11 配对场景需旧构建（配方：Orca `c2a1f422`、ccloop `5b0adea4`、Orca `f00bfdb7`，见台账 seat I）；`handoff.ts` 把被 block 的当前 run 报成 `active-run`；服务端与 Web 的状态词规则不一致；ccloop `savedResultRecovery.ts` ~358 omp 胶囊复核是松的 `indexOf`；多目录组的暂停线续跑仍 `multi-dir-continuation-unsupported`；`stalledCauseAndFloor`（ccloop）是否进 known-reds 名单。H 轮 §4.0 第 4 条余项里 #278（landing watch／requirement review）、#273 资金外拒绝已在本轮处理，其余（#285 依赖图 stalled 只看 `lastActivityAt`、Board「无改动」标记、`runs/<run>/{in,out}` 不清理、Web 计划导入不按写集排序、ccloop #193／#122）仍在。
6. **等证物／先量再说**：#237、#191、#195、#196 不变；预算期望模型、worker-lost、组级验收全量命令本轮在真 codex 组上见过（见 3.最新），**需求复核在 codex 下过不了**（见第 2 条）；claude／omp 下都没真跑过。
7. **其余不变**：#145／#160、#174 方向、#235 不重开；全量门只在发版时跑（Rule 18）。
8. **清理（人做，需要 `--force` 或属别的会话）**：Orca worktree——G／H 轮的 `agent-*` 13 个、`g-repin`、`h-fix-282`、`h-repin2`（都已合入；内含未跟踪的 `node_modules` 软链）；本轮的 `i-worker-lost` 等 repin 后合；ccloop worktree `g-ccloop-bc`、`g4-small`、`g7-stalled`、`h-ccloop`；临时目录 `/private/tmp/orca-g1112/`、`/private/tmp/orca-h1112/`（`ccloop-pin3` 是 pin `26b3127` 的 build，repin 前还要用）、`/private/tmp/orca-i1113/`（本轮各席日志、变异副本、基线 clone）。

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

> 2026-11-11 压缩：删去已了结的条目——各轮的 push 请求（2026-11-11 `ls-remote` 现核三仓本地 main＝`origin/main`）、已做的 repin（当前 pin 是 `chore(deps): pin ccloop to the zero-usage and prompt-mode exhausted fixes`）、`~~划掉~~` 的条目、已答复的问题（UI 信息架构四问、#158／#138 方向、#162／#173 取舍、#212、profile 升 v4、#168／#179／#157、流程第一期安全裁定、soft／failover D1–D6、F5／F6、O9 claude 付费段）、已查清的 `multiDirLandingD` 间歇红与 `dev checkpoint write`「挂住」（见 §3.A）、已不存在的清理路径（`/tmp/orca158-*`、`/tmp/chk-x`、`/private/tmp/orca-{ffec7b28,0e13a9b7,b37f7ce9}`、`.claude/worktrees/tester-followup-20261108`、ccloop 的 prunable worktree，2026-11-11 现测都已不在）；同类项各并成一条。更早（会话 `a3b2a7a7`）删过的见 git 历史。

1. **push**（会话 `d467cbd2`；闸门已改：人在消息开头敲 `allow-push` 后 agent 可推；本轮人的授权是聊天里的话、没有该标记 ⇒ ccloop 试推一次被拦）：Orca main（I 轮全部＋handoff），ccloop main（三笔＋handoff），ccmem main（只有 handoff），以 `ls-remote` 现核。7777 已装上本轮 main。
2. **看真面板**（人此前「先默认通过，之后有问题我会再找你」——不催）：G 轮新 UI——Settings → Agents 首次使用检测与安装、`--repo` 面板的「怎么换多项目」、模型不在目录时禁用提交、「按零结算并关闭」、accept-attempt 表单的 diff 统计与检查、组详情只渲染当前区域、依赖图层内排序与「N 条隐含依赖已隐藏」、无改动标记与「撤销并重跑／按无改动接受」、需求复核面板与三个出口、Problems 里的落地回归行、本组放行按钮与放行列表——都只在 jsdom 测过；F、E、D 轮的同样没在真浏览器看过（F 轮：低频功能收进 More／「⋯」、需求表单「选项」、Board 无主按钮等）。
2d. **审 H 轮与 G 轮控制器与各席按「先按你的建议执行」定的事**（H 轮的清单在 §4.0 第 3 条）（F 轮那批人 2026-11-12 会话 `d1cbbd58` 开轮「同意」，已删）：spec §10 五条（命令验证器的无改动先过目标判断、handoff 由 ccloop 合同带目录、任务 token 一律是预期＋单独的硬上限开关、放行只放点名的路径、迁移按建组标记）与 §11 单一标记；G5 把 `dirRequirementE2E` 改写成按 §5.2.5 串行（控制器定）；G2 #174 设置要 person token；G3 #173 停下（见 §4.0 第 3 条）；Part A／B／D 各自的可逆决定（台账与 spec as-built 节）；Part D 的 `round()` 等待自己发起的 settle（计时判据改为显式放行）。
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
