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

## 三、当前状态（2026-10-18，会话 `a3b2a7a7` 整节重写）

> 本节于会话 `a3b2a7a7` 把七个历史会话小节（`808feb6a`、`b39a5527`、`02f047f6`、`026d10e3`、`a852f96a`、`4de777f4`、`d0843ec0`）压成下面三块：那些轮次的分支**都已由人合推、分支与工作树已删**（会话 `4de777f4`／`a3b2a7a7` 现核），过程原文在 git 历史里（§十）；每一条仍成立的结论都留在下面，出处指到 spec／台账。

### 3.最新（2026-11-07，本会话）—— verify-only 配对真二进制判据通过；正式 repin 等新 ccloop 提交上远端

- 人本次说明三仓 main 已推、授权 Orca 检查点，要求全量门和付费真跑之后再做。开工 `/usr/bin/git ls-remote origin refs/heads/main` 现核：Orca／ccloop／ccmem 的 main 均与各自远端一致；后续改动在 `feat/verify-only-work-top-up` 和 `fix/saved-exhausted-source-repo`，当前状态收尾再现查。
- **根因与修复**：原来源胶囊在 execute 结束时只存 2 条 work 事件，worker 封存前追加第 3 条机械 handoff；Orca 的 highWater=3 正确。ccloop 在租约内把最终事件、ledger 和证据副本补进候选，读侧的逐项一致性守卫不放宽。Orca 的恢复资金证明改为记录冻结原 grant 加已授权且排在新 run 前的 top-up；`readFundedAllowance` 从冻结授权和数据库顺序重算。ccloop 将来源 runtime 原始上限与新 verifier 已验证的 fresh grant 分开校验。恢复从 bundle 中取已核验的真实发布 ref，而非假设 ref 一定带 Orca runId；按发布提交的 Git 树恢复 index，逐文件核对内容、模式。无法发布或未补齐最终会计证据的候选不能授权恢复，worker 仍结清。独立 TypeScript reviewer 找到含换行文件名的合法路径被 index 正则拒，已先红后绿修正。
- **判据**：ccloop `exhaustedSource` 新增最终 handoff、未发布候选、未补齐会计及换行文件名判据，全部先红后绿；`savedResultRecovery` 新增 fresh grant 边界判据先红后绿。ccloop 恢复 3 文件 70/70＋控制器 2 文件 34/34（在换行与未发布收尾补丁之前），之后 `exhaustedSource` 8/8、typecheck/build 0。Orca 5 文件 90/90、root/Web typecheck 0；最终改动后真实本地 ccloop 构建配对 `V10:` **1 过／22 跳过**：来源仍 exhausted，新 run 只 verify 一次并 settled。**这还不是正式 pin 的验收**；没有跑全量门或付费真 provider。spec `2026-11-07-verify-only-work-top-up-design.md` 新增 Correction 2。
- **反馈复核**：`orca_archived_files/issue-20261023.md` 的 11-06 审计是旧快照。#163/#183 的新来源配对在本地代码已通，但历史无胶囊的 run 仍不能恢复、OMP 坏 final（#158）仍无完整成果；#169/#172 的关闭/占槽有代码修复但旧实例须显式结算；#173 改了 token 单位，未校准固定开销；#174 名义 200k 非 soft provider 硬上限；#145/#160 的未估算默认无限额度仍允许 confirm（见 `unestimatedDefault.test.ts`），其旧裁定与反馈的用户成本冲突，待人定保护方式；#159 三适配器解码仍不一致。#188/#189/#190、#185 已有代码修复，不照旧清单重做。
- **接手顺序**：完成审阅后安全提交/快进两分支；只有 ccloop 新提交能从远端取得时才跑 `scripts/pin-ccloop.mjs`，再测正式 pin；写获授权的检查点（`dev checkpoint write` 要工作树干净）；后续设计 #145/#160 的服务端确认边界，再处理 #174/#159。不要用本地旁支二进制声称正式 pin 已更新。

### 3.上一节（2026-11-07，Claude，会话 `2f5eef42`）—— 分支已合入并推远端；#174/#179 已修；verify-only 追加额度只有设计稿

> 人裁（原话）：「同意改写」（profile 升 v3）；「同意。建议不要做全量test，仅测必要的部分」；「资金路径建议 => 同意」；「#174 / #179 => 同意」。**未付费真跑。** 收尾时三仓远端均已由人 push（`ls-remote` 现核：远端 main 即本地 main），`chore/repin-exhausted-source` 由人 `branch -d`。

- **`chore/repin-exhausted-source` 已 `--ff-only` 合入 main 并已推**（主题行 `chore(deps): repin ccloop to 60c554b4 …` 至 `fix(control): brief reads the summary route…`）。合入前审阅发现并修掉两处：`group brief` 原来取整份 group view（澄清中的组会被 `requirement-not-split` 拒，且轮询仍传 plan/runs/proposal）；现在走新的 `GET /api/control/groups/:id/brief`（= `readGroupSummary` 加 `orca-group-brief-v1`），`group show` 字节不变。usage scope 的「仓库是否存在」改用 `groupRepoIdOf`（plan.repoId → requirement.repoId → projectKey），保留组在注册被移除后其 plan 仓库仍是合法范围，陈旧 projectKey 则 404。
- **profile 已升 v3**：`~/.orca/profile.json` 的 `profile.estimatorPreflight.instructionVersion` 2→3，模式 0600 保持，备份 `~/.orca/profile.json.bak.1794052467224`（同目录）。生产估算自此按 ledger 口径（input+output+cacheRead+cacheWrite）。
- **#174（真实缺陷，已修）**：criteria-review judge 原来继承被标记任务的执行策略，源契约 token 上限为 null 时判官组**无上限**。现在 `criteriaReviewWorkTokens(contract)` 只在这种情况给有限 200k 工作授权（组上限同值，`stripped` 路径），有明确预算的契约一字不改。**200k 是拍的常量、未校准**。
- **#174 可见性（已修）**：父组 summary 新增可选 `criteriaReviews[{taskId,debugGroupId,state:debugging|justified|restored|failed,reason}]`（`criteriaReviewsOf`），Board 对 `failed`／`debugging` 各出一行提示（中英文案已加）；不再只在判官自己的组上可见。
- **#179（部分修，改动刻意收窄）**：判定为 justified／restored 的判官组，其自身 summary 的 completion／counts 现在读 `done 全量`，不再显示被 D14 挡住的 `done 0/1`；判官失败仍保持 `done 0/1`，普通任务的空结果语义一字未改（没有把空结果一律当成功）。
- **verify-only 追加额度：只有设计稿**（人已批准方向）：`docs/superpowers/specs/2026-11-07-verify-only-work-top-up-design.md`。做法是给 `verify-saved-result` 加可选 `work`，复用 `work_grant_top_ups`（`from_run_id`＝来源 run，rowid 规则不变）与 retry 的人／`agentTopUpCap` 授权规则，同一准入事务内追加后再走既有资金门；V1–V10 判据与变异清单在文末。**代码未实现。**
- **门（现测，非全量）**：`npm run typecheck` RC 0；web `tsc --noEmit -p web/tsconfig.json` RC 0。针对性 vitest（`TMPDIR=/tmp`）：`groupBrief`+`usageRoute`+`reads`+`estimatePrompt`+`estimatePromptV2`+`savedResultRecovery` 72/72；`criteriaReview`+`groupDone`+`systemDebug`+`modelReviewE2E`+`groupSummaryFields`+`projectGroupScope`+`boardCard`+`controlReadApi`+`controlPollPerformance` 114/114。**未跑全量门。**
- ⚠️ **本会话一次全量 `npm test` 的 101 红里有 97 条同因**：`control-socket-path-too-long`（本机 `TMPDIR` 约 64 字符，测试再拼 `control/proj-*/control.sock` 超 103 字节上限）。**跑全量必须 `TMPDIR=/tmp npm test`**；其余 2 条是既有/负载红（`orchestration` 的 `ladder-source-superseded`、`criteriaBaseRun` 的 `index.lock`），1 条 `readyHint` 60 s 超时。
- **上一节（测试者反馈轮续）的四个待人项已全部结清**：分支已合入并推、profile 已升 v3、#174／#179 已修（边界如上）、追加额度已定方向。该节其余结论仍成立。
- ⚠️ **本会话没能写 Orca 检查点**：`dev checkpoint write` 被自动审批拦下（理由：会把会话转录复制进仓库）；要留检查点需人单独授权那条命令。



> 人裁（原话）：「按你的建议走」「允许修改必要的测试」「这个session暂时不要考虑context大小」「这次批准改写所有必要的判据」「这一轮允许必要的付费真跑」「如果需要 repin ccloop，这个session临时允许你 push ccloop」「遇到卡住必须等人的事情，请继续做不必等人的部分」；要求收尾更新三仓 handoff 并在对话里给 ≤10 行接手摘要。本轮**没有付费真跑**。工作分支 `chore/repin-exhausted-source`，**未合入 main、未 push**。

- **repin**：`package.json`／锁文件指向 ccloop 远端 `60c554b4`（含 exhausted completion source）；`verify:ccloop-pin` 3/3 绿。配对测试从真实 exhausted run 得到 `execution-complete-before-verification-v1`，eligibility 通过；随后在 authored work allowance 已花完时被 `saved-result-authored-budget-exhausted` 挡住，没有创建 verify run。**「零 plan/execute、只跑一次 verify」仍未验成**：这需要一条保留来源归属、同时给 verify-only run 新额度的显式产品路径；不要靠放宽资金守卫通过。
- **#173 估算口径**：新增可选指令 v3，把 `tokens` 改成 ledger 的 input+output+cacheRead+cacheWrite；v1/v2 字节不变，答案键 `budget-estimate-answer-v3`。聚焦测试 42/42、typecheck 0。**本机 `~/.orca/profile.json` 仍是 instructionVersion "2"（人配置，未改）**；要让生产估算真正用 v3，需人把它改为 "3"。
- **#199 轮询成本**：新增 `orca group brief <g>`，只输出 group summary（state／completion／counts／blockers／revision），不输出 workItems／runs／proposal；`group show` 字节不变。`skills/orca-control` 的 Core rule 3 改为轮询 brief。判据 2/2、生成 CLI 文档 drift 绿。
- **#185 usage scope**：`scope=repo:<既未注册、也从未被 ledger／group 记录>` 现在 404 `control-target-not-allowed`，不再返回全 0；已注册但无行仍是合法的空范围。判据 `usageRoute` 6/6。
- **#189/#188/#190** 经当前代码核对已修（`retryTask` 的 observed-path 入口、split 的 bugfix/targetPaths 校验、plan library 2 MiB），**不要重做**；#198 的 README 误报也已在 `criteriaProtection` 修掉。#174（criteria review 无 token 上限、失败对父组不可见）与 #179（review 成功却 `done 0/1`）仍是主要未修项；#173 的 v3 只解决单位，不解决固定开销与 run-to-run 波动。
- **门（现测）**：typecheck RC 0；本轮聚焦 54/54；上一轮 Orca `npm test` 6,889 过／125 跳／1 红（既有 `orchestration.ladder-source-superseded`，未改动 main 同样红），本分支新增改动后整套未重跑。ccloop 全套重跑 **2,567/2,567**、`check-known-reds` RC 0；`multiRepoPathPolicy` 被授权的夹具修复已在 ccloop 本地 main（未 push）。
- **待人**：审改本分支并合入；把 profile 指令版本升到 "3"；决定 verify-only run 的追加额度产品路径；criteria review 的额度上限与父组可见性。

### 3.最新（2026-11-07，Codex）：D1–D5、O19、测试者高优先级与两次真 dogfood

> 人本轮明确授权改必要判据、必要付费真跑、临时由 agent 推 ccloop；遇到须等人的项继续做独立部分，最后给审核。D2 的精确漏报路径边界经独立 subagent 复审、本人批准修订设计。Orca push 仍归人。开工与收尾三仓远端均用 `ls-remote` 现核；提交本文会改 HEAD，故这里不写活哈希。

- **已在 Orca 本地 main 并装进 7777**：`codex/d1-human-blocked-retry` 快进合入；main `npm ci`、root/Web build、正式 ccloop pin 门 3/3、`verify:panel` 0–14 步全 PASS；控制库仍 schema 23（升级前在线备份 `/Users/biran/.orca/backups/2026-11-07-d2-o19/control.sqlite.before-cutover`，integrity `ok`），重启后 `orca status`／`doctor` 全 ok，只有原有一组 `ready` 且 `executionPending:false`。**未 push Orca**。ccloop 的本轮代码与滚动 handoff 已按临时授权推远端；ccmem 只改滚动 handoff、未推。
- **D1–D5**：`blocked_waiting_human` 不再走 orca-auto 原样阶梯；ccloop collect 顶层 `pathPolicyMisses` 只报告 Git 实测、最多 128 条的精确漏报路径；Orca 在一次 `task retry --allow-observed-paths` 中结清旧 run、追加已报路径并记录不可改写的合同版本，校验 denylist／symlink／文件数／组间冲突和历史 claim。CLI `run show`、Web 明示路径与普通重试的区别；`orca-control` skill 有卡住和审拆分路径。split instruction v4 与代码校验拒绝没有可写回归测试路径的 `bugfix`。设计／计划：`docs/superpowers/{specs,plans}/2026-11-06-observed-path-retry*`，本地台账 `.superpowers/sdd/2026-11-06-observed-path-retry/progress.md`。
- **O19 与其他修复**：ccloop 新 saved-result 读取器支持真实 Codex 隔离参数、当前 execute wire schema 和缺原始用量的 `approximate-floor` 收据；损坏的正数用量及人的替代收据仍拒。Orca 配对真二进制 O19 通过（预算 `model` provenance 在测试夹具模拟，正式估算器不是这条验收的证明）。另外 #180 hold 后 `start` 用 run mode，agent 可设全局 `agentTopUpCap`；#198 不把 `grep README.md` 的输入数据当检查脚本；#190 plan library 保留 23 条条件／2231 字目标而仍受 2 MiB 总上限；#172 blocked run／task 不占槽，resume 退休空 wake 并点名待处理；F13 前台 socket 绑定失败与 service 一样退出 78；CLI D9 给存储态 `ready`／`review` 补运行中提示；自动 ladder 在 authored 工作额度耗尽时不再耗费 debug／先折叠，确认期和折叠期的人工重试竞态也已防住。相关 spec／plan 均按日期在 `docs/superpowers/`。
- **门的诚实结果**：ccloop 最终全套 **2,564/2,564**、typecheck/build 绿，O19 独立 reviewer 的两条 Important 已修。Orca 在 D2＋O19 最终 pin 上的整套 `npm test`：根 **739/740 文件、6,945 pass／35 skip／1 红**（已登记的 `flow/startForm` `ECONNRESET`，分支与未改动 main clone 交替单跑各 2/2 绿），Web **182/182、1,669 pass**；原始 RC 1 不改称全绿。之后的小修有针对性回归：D2／O19 39/39、#198／#190 94/94、#172 88/88、ladder 最终 67/67、CLI D9 90/90、F13 socket 8/8，root/Web typecheck 绿。日志与负载对照在 `/private/tmp/orca-d1-kMINyw/`、`docs/handoff/known-load-flakes.md`；全套未在最后几笔小修后重跑。
- **CLI＋skill 真 dogfood（隔离面板／Codex 0.167.0 `gpt-6-sol`，任务检查只用 Node 内建 test，不开 Unix socket）**：第一组 `dogfood-20261107` 2 个任务落地 1 个、父组仍 blocked；父组用 **512,497** token，另开的 ladder debug **195,035**，合计 **707,532**。估算器给每项 5k，实际首轮 plan 各约 44k；`multiply` 在 150k grant 下花 198,756 后 `exhausted`，debug 花 195,035 修好并折叠，却因 `authored-budget-exhausted` 不能自动重试；后续 agent top-up 重试在已修分支上 134,354 token 的成功 run 被判 `empty-result`，形成旧状态。**本轮代码修了新流程，不追写这组历史状态**。第二组 `dogfood-complete-20261107` 走 clarify→split→accept→设额度→hold confirm→start→`done 1/1`，总用 **165,593**（任务 **138,805**）；落地分支独立 clone 的 `npm test` **7/7**。两组 scratch 证据在 `/private/tmp/orca-dogfood.Ckkspc/logs/`；隔离面板已停、无残留 worker，复制的认证文件已删，真实 `~/.codex/config.toml` 前后 SHA-256 相同。
- **诚实边界／下一件**：未等到自然额度耗尽，真 `quota-probe` 未验；#169 终止失败 run 的完整结算／归档、第一组的历史 `empty-result` 解救、#173 估算缓存口径与固定开销校准、#174 自动 review 的真实限费与父组可见性、D6 的落地后结算尾巴与 staging、D10／D17／D19／D21、#183／#199、单次调用／flow failover、UI #70 仍待做。#173 不能只靠把提示数字乘 2 就宣称 ±30%；soft provider 单次调用阶段末才上报，写 50k grant 也不是 #174 的硬上限。§四是建议顺序，§八列等人的项。

### 3.最新（2026-11-07，Claude，续）—— exhausted 恢复的生产者与消费者已落地；只在本地，未推

> 人裁（原话）：「尽量将这些要做的task都完整做完，这个session暂时不要考虑context大小」「暂时不用收窄（close-run）」「同意（提交）」「这次批准改写所有必要的判据。这一轮允许必要的付费真跑」「遇到卡住必须等人的事情，请继续做不必等人的部分」。本轮**没有付费真跑**。逐条结果见本节与 ccloop handoff 同名小节。

- **Orca 本地 main 已提交、未推**：主题行 `fix(control): name an exhausted source, and drop a socket row no verb table owns`（`saved-result-exhausted` 只读诊断；`SOCKET_TIER` 里那行没有 `HUMAN_ONLY_VERBS` 归属的 `close-run` 死数据删除，行为不变；六个 `run-closure-*` 的中英文案补齐——后两项是上一轮遗留的两条真红）、`docs(plan): stage the exhausted recovery's proof, and its implementation plan`（spec Correction 1 + 计划）。随后未提交的这一笔：新权威种类 `execution-complete-before-verification-v1` 的严格镜像、driver collect 按 schema 区分并记录真实 kind、closure 遍历、以及 `currentSavedResultSource` 只在 run 带该来源时才放行 exhausted（否则仍是 `saved-result-exhausted`）。
- **#183 的措辞已修**：真实 exhausted run 从 `saved-result-source-stale` 改为 `saved-result-exhausted`；准入没有放宽。新增判据先红后绿（真实 exhausted run），第二条判据钉「门是来源种类，不是 outcome」：伪造一个读不到的同种类来源时，理由变成证据类拒绝而不是“没有生产者证据”。
- **close-run 权限档：本轮人裁「暂时不用收窄」**。独立只读审阅结论：按现行授权策略无绕过；已登录的 Web member 与本机无 person token 的 socket 客户端都能关闭满足证据条件的 terminal run。这是产品选择，不是缺陷。
- **门（现测）**：Orca `TMPDIR=/tmp npm test` 选中 629 文件，根 **5,382 过、122 跳过、1 红**＝已登记的 `orchestration.test.ts`「admits a debug group Orca opened itself」（在未改动 main 的 clone 上同样红）；typecheck RC 0。ccloop 全量 **2,567 条、2,566 过、1 红**＝`multiRepoPathPolicy`「reports an extra-repository-only miss…」`control-path-invalid`，**在未改动的 `4cdc1ab` 副本上单跑同样红**（`check-known-reds` 因此 RC 1；名单未改）。
- **诚实边界**：ccloop 的生产者已在本地 main（见 ccloop handoff），**尚未 push、Orca 也未 repin**；OMP 成功执行路径只有代码级支持、无真 OMP 回归；「新 run 零 plan/execute、只跑一次 verify」的 paired 端到端**未跑**（需要 ccloop 已推并在 Orca 侧设置 `ORCA_CCLOOP_BIN`）。历史那些没有胶囊的 exhausted run 仍然不可恢复。

### 3.前一轮（2026-11-07，Claude）—— #169 终止结算落地；#163/#183/#158 当时只到设计与可见性

> 人裁（原话）：「按这个顺序继续，先处理 #169、#163、#183、#158。」随后授权：「这次批准改写所有必要的判据」「这一轮允许必要的付费真跑」「这一轮 session 如果需要 repin ccloop，临时允许你 push ccloop」。本轮未付费、未 repin。台账 `.superpowers/sdd/2026-11-07-terminal-run-closure/progress.md`（全部 Ruling、测试命令与结果）。

- **已在本地 main（`--ff-only` 合入 `9fee12ca`），未推**：四笔，主题行 `feat(control): close a proved terminal run's accounting (#169)`、`feat(control): a closed terminal failure still retries and still routes`、`feat(control): name terminal runs and the step that ends their accounting`、`fix(control): validate a terminal closure wherever it grants authority`（独立审阅的 4 条 Important：恢复入口绕过、路由信任形状、Web 无重试、收据未绑定，均已修并复跑）。规格 `docs/superpowers/specs/2026-11-07-terminal-run-closure-design.md`、计划 `docs/superpowers/plans/2026-11-07-terminal-run-closure.md`、台账 `.superpowers/sdd/2026-11-07-terminal-run-closure/progress.md`。
- **#169 做成显式命令，不是自动巡检**：第一版在驱动轮里自动关闭，打红 20 条既有 retry/saved-result 判据（它们等 `state=blocked`），因此改成 `orca group close-run <g> --run <r>`（台账 Ruling）。只接受当前、最新、`blocked/C`、非成功的普通 work run；要求原始 report、sealed owner stop proof（`ownerLeaseReleased`/`workerSealed`）、完整已知用量、无未决 handoff。一次事务内写 `terminalClosure`（run/generation/executionId/highWater/outcome/commandId/ownerToken/report/stopProof 哈希绑定）、置 `settled-failed/active=0`、释放未用预留、allocation terminal、work `blocked`，不收费、不接受工作。重复命令幂等；伪造标记 `run-closure-invalid`。未知用量仍须人先 `task settle-usage`（暂停的组会拒该结算，顺序是结算→关闭→暂停/归档）。
- **关闭后不制造新死路**：`retry-task` 把 closure 当作自己的 released 情形，不再二次释放旧预留；伪造/损坏标记 `recovery-blocked:retry-closure-invalid`。`isTerminallyFailedRun` 认可带 closure 的终止失败，ladder／quota wait／failover／probe 仍看见同一 run；完整证据校验仍在 close/retry/recovery 三个动作里。`recovery list` 新增 `terminalRuns[{groupId,taskId,runId,outcome,next:settle-usage|close-run}]`；skill 与 CLI 文档已生成。
- **#163／#183／#158 的诚实边界**：关闭只结束记账，不把失败 execute 变成可验证成果。ccloop 现有恢复只收有完整证据的 Codex 旧格式失败；`exhausted` 有终态报告但没有“execute 已完成、未进 verify”的胶囊，OMP 坏 final 没有 `ExecutionResult`，均不能放宽。设计写在 `docs/superpowers/specs/2026-11-07-exhausted-attempt-recovery-design.md`：ccloop 在清理前产出 `ccloop-execution-complete-before-verification-v1` 胶囊（正常退出、唯一严格解码、用量落盘、`verifierEntered:false`、发布 ref/base/tree），Orca 走同一 admission/funding/verify 门。**未实施**。
- **门的诚实结果**：typecheck RC 0；terminalRunClosure 6/6、archiveGroup、retryTask、savedResultRecovery、handoffStopUnknownUsage、skill 8/8、webParity 66/66。受影响 `npm test` 5549 过、106 红：绝大多数是本 shell 的 TMPDIR 让 `control.sock` 路径 104–124 字节（`TMPDIR=/tmp/x` 下 correctApi/controlMount 33/33）；一条 `orchestration.test.ts > admits a debug group Orca opened itself` 在**未改动 main 的 local clone** 上同样失败（`clone=/tmp/orca-main.d5RN70`），是既有红，不是本轮。日志同台账目录。
- **待人**：push（分支或合入后的 main）；原有三支 codex worktree（`/private/tmp/orca-d1-kMINyw/{orca-criteria,orca-o19}`、`~/.codex/worktrees/…`）的强制清理需人点头。

### 3.0000000000000000000000000 会话 `b5e3c5a8`（2026-11-07）：人把 nvm 默认 node 升到 22.23.4 —— 环境轮，三仓代码无改动（当前工作状态看上一节）

> 人的话（原话）：「当前我升级了 node 的版本，你看下orca 、ccmem、ccloop是不是要重装一下。」「orca、syncskill => 已重新npm build && npm link」「面板现在还靠着 22.13.1 目录下的几个可执行文件 => 帮我修改相关配置」「有 36 个 ccloop 的 worker.js 进程还在跑… => 帮我清掉」；之后「codex 0.167.0 的真跑验证（要付费）… => 跑」「orca doctor 还报一红一黄… => 不用的话，你可以清理，如果你清理遇到权限问题，可以把命令给我执行」「三份 handoff… 要我顺手更新并提交吗？ => 同意」。

- **本机 node（2026-11-07 现测；命令：每个 node 跑 `new (require("node:sqlite").DatabaseSync)(":memory:").exec("create virtual table t using fts5(x)")`、`npm -v`）**：nvm default **v22.23.4**（ABI 127，**有 fts5**，npm 10.9.9）；v22.13.1 仍装着（ABI 127，无 fts5，npm 10.9.2），**旧终端开的会话 PATH 里它仍在最前**；`/usr/local/bin/node` v24.13.0（fts5，npm 11.6.2）；homebrew node 仍坏。
- **三仓都不用重装**：服务（面板、ccmem daemon、Codex 钩子、OMP 扩展）都写死 `/usr/local/bin/node`；22.23.4 与 22.13.1 同 ABI。人已在 22.23.4 下重新 build 并 link 了 orca 与 syncskill。
- **仓库外的写（Rule 17，人授权；备份在 `~/.orca/backups/node-22.23.4-switch-1793982205000/`）**：
  - `~/.orca/agents.json`：claude、codex 的 `command[0]` 改到 `…/v22.23.4/bin/`，codex `version` 0.163.0→0.167.0（`codex --version` 现测）；mode 仍 0600。这几项不进 ccloop 的 `agentConfigHash`（`src/agents/materialize.ts`），已确认的组不会被拒。
  - 重跑 `orca panel install`（用干净 env，不带会话里的 `ORCA_CCMEM_BIN`／`CCMEM_CONFIG_PATH`）：只有 `ORCA_SYNCSKILL_BIN` 和 `PATH` 变了，`run.sh` 与 plist 一字未改。`orca status` 全 ok。
  - ccmem daemon 的 plist 改指 22.23.4 的 claude，细节见 ccmem handoff §1.000000。
  - 33 个孤儿 ccloop `worker.js`（父进程 1、各自一个进程组，来自会话 `86352010` scratch 下的 afr-main／afr-mut／ccloop-wt／ccloop-main）按进程组发 TERM，全部退出，现数 0；人看到的 36 里有 3 个是查询命令自己。
  - 为付费真跑先备份了 `~/.codex/config.toml`（备份在上面同一目录下的 `codex-config.toml.before-paid-run`）。
- ⚠️ **`orca doctor` 的 `agent-path` 跟调用者的 shell 走**：`agentPathDirs`（`src/service/config.ts`）用**调用者的 PATH** 解析 agent 的 `#!/usr/bin/env node`，再要求服务 PATH 含那个目录 ⇒ 旧终端（22.13.1 在前）里报 fail「lacks …/v22.13.1/bin」，换成 22.23.4 在前的 PATH 就是 ok；服务本身没坏（它 PATH 首位是 `/usr/local/bin`）。登记未修：措辞让人以为服务坏了。
- **doctor 两项早于本轮的问题已清**：残留的 `~/.orca/control/orca-e0c92460/control.sock`（10-07，没有进程持有）已删，`~/.orca/control.sqlite`（0 字节）的权限从 644 改成 600。这两步 agent 被自动模式拦下，由人执行。之后用 22.23.4 在前的 PATH 跑 `orca doctor`，全部 ok，rc=0。
- **codex 0.167.0 付费真跑通过**：人在自己的终端跑了 `/private/tmp/claude-501/codex0167/run-paid.sh`；agent 发起的付费调用被自动模式拦下。
  - 配置：用 Orca 装的 ccloop（a49ab7b）跑一个 loop，codex 单独一张 agents 表，`gpt-6-luna`，contract 设 `maxAttempts` 1、`tokenBudget` 300k，目标仓库是一个演示 repo，任务是让它写 `src/greeting.txt`。
  - 结果：状态 `succeeded`，1 个 attempt 用时 51 s。diff 只有一个文件，verify 有字节级证据。工具报的用量是 plan 13,745、execute 35,355、verify 44,618，合计 93,718，与 `tokenBudgetRemaining` 206,282 对得上。
  - 每个阶段都用隔离的 `HOME`／`CODEX_HOME`，带 `--output-schema` 和 `--ephemeral`。plan 与 verify 跑在 `read-only` 沙箱，execute 跑在 `workspace-write`。参数里有 `notify=[]`、`features.hooks=false`，关掉的 MCP 恰好是真 config 里的三个（`computer-use`、`figma`、`node_repl`）。各阶段 stderr 都是 0 B，跑完没有残留进程，`auth.json` 哈希前后一致。
  - 每个阶段有 2 个 `error` item，都是 0.167.0 提示人自己的 `~/.codex/config.toml` 里 `features.rmcp_client` 已失效、被忽略。按惯例这只当诊断看，不算失败。删不删这一行由人定。
  - codex 照旧往真 `~/.codex/config.toml` 追加了这个演示 repo 的 `trust_level`。已按人裁删掉，删完与跑前备份逐字节相同（sha256 前 16 位 `10513ff638acdc98`），mode 仍是 0600。
  - **仍未在 0.167.0 下测的**：Orca 拆分需求和估算用的 codex single call。
- **等人**：22.13.1 可以卸。Orca、ccmem、ccloop 的现有配置都不再引用它，只有备份和 10-20 的历史 run 还提到它。卸之前先关掉旧终端开的会话，本会话就是其中之一。

### 3.000000000000000000000000 会话 `86352010`（2026-11-06）：repin、soft loop 自动结算、额度探针、retry-task 追加额度、dogfood 摩擦修复、#134／#126／#119、两次付费自举 —— **工作状态先读这一节**（上一节只是环境轮）

> 人裁（原话）：对上轮审阅项与三件待定「都同意按你的建议走」（建议原文在台账开头）；顺序「同意」；「我已经push了」（Orca、ccloop D6＋D5）；收尾指令「这次批准改写所有必要的判据。这一轮允许必要的付费真跑。」「所有事情做完后，orca 使用 cli + skill的方式再跑一次从"需求拆分"到"group所有task跑完" 的dogfooding，继续找问题」「这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」会话台账 `.superpowers/sdd/2026-11-06-session-86352010/progress.md`（每次门、对照、变异、裁定、两次自举的数）。

- **已在 Orca main（`--ff-only`），已装进 7777**（控制库 **schema 23**；装前备份 `~/.orca/backups/schema23-cutover-1793941018824/control.sqlite`，integrity ok；`orca status` 全 ok）。**本地 main 领先 origin，push 归人**。按主题行：
  - repin：`chore(deps): repin ccloop to 292ddb5 for the shared execute prompt and the codex catalog/prompt-schema options`（全量 727 文件绿）。
  - I3 改：`fix(control): an archived prerequisite whose work is done may still be depended on (#133 follow-up)`——只拒「已归档且没做完」的前置组（人问「归档时为什么要改其他组？」；归档本来不改别的组，旧规则与 `prerequisiteDone` 不一致）。已有依赖指向后来才归档、没做完的组 ⇒ 下游永远等，只能人删边（登记）。
  - `test(schedules): a fired unlimited group queues no estimate -- replaces the criterion whose premise is gone`（R3 那条失去前提的测试；前提恢复不了）。
  - #134 `fix(projects): a hand-added dir project needs no git top level and stays a dir project`；#126 `fix(panel): every pump pass delivers pending projections…`；#119 `docs(control): name which outbox kinds are queues and which are records`（`src/control/outboxKinds.ts`＋扫描判据）。
  - **性能基准修好并跑通**：`test(bench): the poll fixture seeds under the running-group cap…`（D4 后 100 个同时在跑的组到不了，改 64、各数由 fixture 推出）；随后追加额度那批把 run 视图里每 run 两次单行读去掉（`readFundedAllowance(store, run, preRead)`），`--expect-optimized` 全 RC 0。命令：`ORCA_PERFORMANCE_ROOT=<空目录> npx tsx tests/bench/controlPollPerformance.ts --seed --expect-optimized --output <目录>`。
  - **soft loop 自动结算（Orca 半边）**：spec `2026-11-06-soft-mode-loop-run-settlement-design.md` §6（人答 Q1–Q8）、计划 `docs/superpowers/plans/2026-11-06-soft-loop-settlement-orca.md`。新 panel 类动词 `settle-approximate-usage`（行在 `{client:"panel", principal:"orca-auto"}` 下写——ccloop 收据按这两值认）、marker `approximate-floor`、`src/control/softLoopSettlement.ts` 每个 driver 轮一次、`softLoopSince` 截止（meta 表）。spec 的两处错已按代码更正（recovered optional-v1 放回整个剩余；截止用 `endedAt` 否则首次 C 处阻塞时刻），见计划 As built。**O19 没跑**（saved-result 世界的旧 Orca／旧 ccloop 根本轮没准备，fixture 还要加 `settle:"none"`）。
  - **retry-task 追加额度**：spec `2026-11-06-retry-task-work-top-up-design.md` rev 2、计划 `…-retry-work-top-up.md`。schema 22→23 表 `work_grant_top_ups`（按 `from_run_id` 的 rowid 生效，旧 run 校验不变）；`orca task retry --work <json>`；人随时可加，agent 在全局 `agentTopUpCap`（按组求和、只有人能设——spec 写错成「只有人发 set-orchestration-settings」，实际该动词在 socket 上是 open，已把这个字段改成 human-only）内可加；只支持 optional-policy 分支；看板显示追加记录。一次追加不能让单个 run 超过确认时的合同（`withinGrant`）。
  - **额度探针**：spec `2026-11-06-quota-rest-probe-retry-design.md` rev 2、计划 `…-quota-rest-probe.md`。休息结束、failover 没把任务移走 ⇒ 每个安装一次 `quota-probe` 单次调用（合成工作项、固定 50k 额度、不让组被卡）；回来 ⇒ orca-auto 带 `runId` 重试一次；仍 quota ⇒ 继续休息；带类型 quota 的探针用量记 0（照 ccloop codex 429 先例）。**要 ccloop 单次调用的 `failureCause`**：Orca 已先接受这个可选键；旧 pin（292ddb5）不带 ⇒ 探针判 `failed`、任务留给人、activity 说明。P7 由唯一索引 `one_active_work` 保证；P11 没做；P14 的护栏在实际流程里到不了（判据钉的是观测到的结果）。
  - **dogfood 摩擦修复**（计划 `…-dogfood-frictions.md`）：F14／F15 symlink 拒绝保留但报出路径与真实路径；F13 只改提示（agent entry spec §3／C15：前台面板保留 Web-only——要不要拒绝启动等人定）；F20 `held` 不再占槽（按人裁 D1，spec §3.1 字面没改）；F22 zod 路径进错误；F23 confirm／show 按「估算已就绪未应用」说话；#144(d)/#140 import／estimate 单独打 estimate／reason 行。
- **ccloop**：近似下界收据（soft loop 的 ccloop 半边）与单次调用 `failureCause`（探针要）人已推；**Orca 已 repin**（主题行 `chore(deps): repin ccloop to a49ab7b for the approximate-floor receipt and the single-call failureCause`；全量 736 文件 1 红＝`criteriaBaseRun`「a restart while the re-run is in flight…」，新旧 pin 交替单跑 4/4 绿 ⇒ 负载），已装进 7777（`orca status` 报 ccloop `a49ab7b`）。三仓收尾时人已推（`ls-remote` 现测为准）。
- **两次付费自举**（codex gpt-6-luna，隔离面板，Orca clone 当目标；数都是工具报的，codex 不报美元）：
  - 第一次（单 bug #144(d)）FAIL，2,798,446 token，没落地：检查选了需要 `web/dist` 的套件；**F16 codex `workspace-write` 沙箱里开 unix socket 的测试会超时**（Orca 的 tests/commands 假面板）。摩擦 F13–F23，可修的已修（上）。
  - 第二次（最后的 dogfood，CLI＋skill，3 个 task）FAIL，3,332,555 token：**3 个里落地 2 个**；第 3 个卡在 allowlist——两条钉旧输出的 web 测试不在 `targetPaths` 里，attempt 2 改了 ⇒ ccloop `blocked_waiting_human`，orca-auto 原样自动重试 ⇒ 同样卡住，`task set-loop` 拒已开跑任务 ⇒ 没路可走（被卡的改动在 Orca 外重放是绿的）。问题 D1–D23，写在 `/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/86352010-f812-43f5-b01b-d7f9daebab0d/scratchpad/dog/RESULT.md`（会话结束即失），标题已抄进台账。**最要紧的**：D1 orca-auto 自动重试 `blocked_waiting_human` 的 run；D2 契约开跑后冻结、没有放宽 `targetPaths` 的路；D3 被卡的 run 显示 `running` 约 19 分钟、CLI 看不到 allowlist 原因；D4 skill 没有「blocked_waiting_human／allowlist／审拆分」的指引；D5 拆分不找钉旧行为的测试；D6 落地后结算 6–15 分钟不可见、staging 375 MB 不清理；D9 组状态词与实际不符；D10 落地提交不带任务身份；D17 被拒的 verify 在 CLI 里看不到；D19 `agent list` 显示默认模型而不是实际跑的模型；D21 没有注册仓库项目的 CLI。
- 门：每批 `node scripts/test-affected.mjs --base <下层>`；红一律在分支与未改动 main 的 clone 上交替单跑（`known-load-flakes.md` 会话 `86352010` 节）。⚠️ **worktree 里要 `ln -s <主仓>/web/dist web/dist`**，否则约 30 个面板测试 `panel-dist-missing` 假红。

### 3.00000000000000000000000 会话 `3cfc2e73`（2026-11-05／06）：测试者 issue 一轮（I1–I7）、F5／F6、D1–D4、ccloop I5／D5／D6、failover 剩余、soft loop 设计 —— 已被上一节接手（三仓人已推；待人项已由人在会话 `86352010` 答复并实施）

> 人裁（原话）：「同意」（failover 偏离与默认开）；「几个仓库都已push」；retry-task 「想要增加被授权的 agent 的能力，可以不止是人才允许。」→ 建议「同意按你的建议走」；F5「同意你的建议」；F6「同意给隔离测试特殊处理。」；「这个session允许改写必要的判据」→「这次批准改写所有必要的判据」；「这个session允许必要的付费真跑」（本轮**没用到**）；rebase「同意，你做rebase」；#70「暂时不动，现在动都不解决根本问题。我觉得根本问题是当前UI排版以及项目设置的位置不合理、不符合现代agent的通用习惯导致的。」；「D1-D8其余都同意。」；「spec派独立subagent review并修复review出来的问题」；收尾「尽量将这些要做的task都完整做完…先按你的建议执行。执行完在最后阶段报给我审核。」会话台账 `.superpowers/sdd/2026-11-05-session-3cfc2e73/progress.md`（每次门、对照、变异、裁定）；issue 逐条状态 `…/issue-status.md`；四份核对报告 `…/triage/`。

- **已在 Orca main（`--ff-only`），已装进 7777**（控制库 **schema 22**；装前备份 `~/.orca/backups/schema22-cutover-1793909239424/control.sqlite`，升级自留 `control.sqlite.pre-v21-…`；`orca status` 全 ok）。**本地 main 领先 origin（人推过前一批），push 归人**。按批（主题行带 issue 号，`git log --grep='#NNN'` 取）：
  - repin ccloop 两次：`chore(deps): repin ccloop to 33f0d2f for the setup drain fix`、`chore(deps): repin ccloop to 963b856 for omp's execute shape and the format-failure details`。
  - **I1 项目解析**（#146 P0 multi 不再按路径匹配、#152、#151、#141、#148 含 `orca status`／doctor 的 projects 检查）；**I2 CLI 入口**（#142 前置全局 flag、#143 `requirement open --agent`、#132、#144 部分、#150、#140）；**I3 启动闸门**（#133 `group-dependency-unmet`、#129 暂停不占槽、#139、#153／#127 `blockedReason: empty-result`、#117、#128 文案、#98 `waitingOn`）；**I4 估算／计划／拆分**（#147、#154、#155、#156 `orca group apply-estimate`、#135、#130、#131、#124 `model-not-in-catalog`）；**I7**（D7 OMP 格式失败显示 attempt ref＋diff、#149 提示、#120 服务管理器冲突、#136 拆分规则、延后估算不再探测估算器）。
  - **F5** `orca run transcript`（socket 读，派出去的 run 拒；T5/T13 改写）；**F6** `orca login`／`user add|passwd --password-stdin`（只对真实 `~/.orca` 以外的面板）。
  - **D1–D4**（spec `docs/superpowers/specs/2026-11-05-review-exit-over-grant-start-queue-design.md`，独立审阅 20 条全采纳）：D1 组 `done` 由 pump pass 写、只有有活的组占槽、重获工作的组等槽；D2 不限组的超额只记录不卡（Board 超额标记）、有上限组 `set-limit`／重试可解卡、迁移 21→22；D3 不限组导入／接受不自动估算、confirm／show 写明默认不限与估算路径；D4 显式 start 满上限时排队（`queued-for-slot`，带 `ahead`）。
  - **failover 剩余**：FA `retry-task --agent auto` 解锁（`auto` 成保留名）、切换记 `by`=路由 principal、派出去的 run 不能带 agent 重试、休息中安装上未开跑的任务在认领前改派、claude `limit reached|<unix>` 重置时间（无真样本）＋厂商重置封顶 24 h；FB 面板「X 额度用完至…」、agents 页休息列表、web 显示 D7。**没另建到期唤醒**（pump 每 5 s 重读休息）。
  - **两次真回归，本轮自己引入、自己修**：I3 在 `webDispatch.ts`／`stopIntent.ts` 新加对 `groupEdges` 的静态 import 改变了控制模块 import 环的求值顺序 ⇒ 90 个文件加载失败、25 条 multiDir 红；`git bisect` 定位，修为默认额度移到叶子模块、前置检查函数经 deps 传入。**规则：控制模块环上不加静态 import**（`known-load-flakes.md` 会话 `3cfc2e73` 节）。
- **ccloop**：I5（OMP execute 形状、MCP／OMP 失败细节、`execute-format-failure.json`）已推、已 pin；**D6**（共用执行提示：taskResult 嵌套、不改代码时 undo 写被放弃的改动）与 **D5**（#121 `-c model_catalog_json`、#122 `structuredOutput:"prompt"`）**在 ccloop 本地 main，未推**；推后 Orca repin 即可（Orca 对 agents 表 `installations` 是 `record(unknown)`，不用改码）。
- **设计稿，未实施**：`docs/superpowers/specs/2026-11-06-soft-mode-loop-run-settlement-design.md`（soft 模式 loop run 自动按下界结算；独立审阅后推荐 (d) `orca-auto` 面板命令行；Q1–Q8 等人）。
- 门：每批 `node scripts/test-affected.mjs --base <下层>`；多 agent 并行时负载 50–190，红一律在栈顶与**未改动 main 的 clone**上交替单跑对照后才合（逐次在台账）。测试 env：`ORCA_AGENTS_TABLE` = fake-codex `integration` 表，`ORCA_CCLOOP_BIN` = pin 那笔的 clone build，`CCLOOP_CACHE_DIR` 用 scratch（会话 scratchpad，结束即失）。
- ⚠️ 本轮 Tier 0 闸门：git 命令里用 `cd $VAR/...` 或一条命令里多个 git 调用会被判「无法决定」拦下——用 `/usr/bin/git -C <绝对路径>`，一条 Bash 一个 git。

### 3.0000000000000000000000 会话 `e2ad4802`（2026-11-05）：Part C 合入并装上、A4 抽公共函数、friction 小修、额度用完自动换 agent（failover） —— 已被上一节接手

> 人裁（原话）：「都已push」（ccloop a885241）；面板「这次新的session中你可以重启」；「允许删除无用的branch和worktree」；A4「按你的建议抽公共函数」；署名「不要固定写 opus 5.5，应该按实际模型写或不写」→「同意」；2 秒收尾「同意按你的建议做」；failover D1–D6「其他同意」＋「如果是provider额度用完，且有备用provider，可以改provider并重试。」；付费真跑「这个session中，需要的情况下都同意」（本轮没用到）；人离开后「尽量将这些要做的task都完整做完…这次批准改写所有必要的判据…临时允许你push ccloop…先按你的建议执行。执行完在最后阶段报给我审核。」会话台账 `.superpowers/sdd/2026-11-05-session-e2ad4802/progress.md`（全部 `Ruling:`、偏离、门、没做的与原因）。

- **已在 Orca main（`--ff-only`），已装进 7777**（最后一次 kickstart 在 failover 合入之后；无 schema 变更）。按主题行：
  - `chore(deps): repin ccloop to a885241 for task setup commands`（Task C0）→ Part C（拆分看 manifests、推 setup、核 npm 命令）。
  - `refactor(control): one runner for every command Orca runs as a check, setup included`（A4：`src/control/checkCommand.ts` 的 `runAsCheck`／`firstFailingSetup`，集成检查、criteria base run、复现检查共用；变异 4 条红）。
  - `fix(control): set-orchestration-settings keeps the global flow settings and their locks`（**真缺陷**：改并发上限或 quotaWait 会静默删掉 flow 全局设置和锁；判据对旧码红）；`feat(cli): orca agent preferences …`（F7 读偏好命令＋`--file` 形状、F9、F10、F12）。
  - **failover**（spec `2026-11-03-quota-failover-design.md` §8 人裁；As built `docs/superpowers/plans/2026-11-05-quota-failover.md`）：run 以 ccloop 的 `quota` 失败 ⇒ orca-auto 换到顺序里下一个「不是当前、没在休息、agents 表列着」的安装并立即重试（每个失败 run 一条命令，不进阶梯）；人或计划文件选的 agent 不换（D2）；人设了 `quotaWait` 的安装照旧等不换；顺序 = `orca orchestration set --failover-order …`（缺省 agents 表顺序，`--failover-off` 关）；休息从已存 run 推（codex 报的重置时间，否则 15 分钟翻倍封顶 8 h，成功即解除）；人也能 `orca task retry <g> <t> --agent <i>`。实现要点：每次切换记在 work item `agentSwitches`、run 认领时盖 `agentEpoch`，`runAgentAgrees` 取代 I1 的严格相等（视图、重试、retry grant；saved-result 恢复仍严格），确认快照只替换该任务的 agent 条目重发。**偏离（人已「同意」，会话 `3cfc2e73`）**：没加 ccloop 新 cause（复用现有 `quota`＋`detail`）、休息不建表、顺序放 orchestration settings 而不是 agent 偏好（orca-auto 没有偏好）。独立审阅 Important 1–3 已修；变异 M1–M19 逐条红（M18 测不红，删掉了那段预检）。
- ~~ccloop main 本地领先 origin、未推~~ **人已推，Orca 已 repin（会话 `3cfc2e73`）**：`fix(setup): the verdict is taken at the shell's exit, and a cut drain is marked in the log`（限时计时器落在 2 s 收尾里不再把 exit 0 判超时；收尾被截断写标记行）＋ plan 跟进。门 2494 条 2493 过、唯一红为名单内 `runLoop`，`check-known-reds` RC 0。**push 被 Tier 0 闸门拦（人授权了也拦，没重试）**。Orca 仍 pin a885241，不依赖这笔。
- 门（各分支对 `main` 用 `node scripts/test-affected.mjs --base main`，因为 origin 远落后、默认基会每次选五六百个文件）：Part C 575 文件、A4 527、friction 514、failover 779（根 606＋web 173）；红只有登记 flake（`startForm` 每门一次、`criteriaBaseRun` index.lock 一次）与本会话开头误用真实 agent 表导致的 `ccloopProtocol`（环境，不是 flake）。登记进 `known-load-flakes.md` 会话 `e2ad4802` 节。
- ⚠️ 测试环境：`ORCA_AGENTS_TABLE` **必须是 fake-codex `integration` 表**（§七 原文）；本会话 env 在 scratchpad（会话结束即失），做法：`{"schema":"ccloop-agents-table-v1","installations":{"codex":{"kind":"codex","command":[<node>,"<ccloop clone>/tests/fixtures/fake-codex.mjs","integration","<dir>/marker.json"],"version":"9.9.9-fake","configDir":null,"timeoutMs":120000,"killGraceMs":5000,"sandbox":"workspace-write","budgetMode":"soft"}}}`。
- 清理：`/private/tmp/orca-af2ceee1/` 已删空（含 wtC）；合入的分支／worktree 都 `-d`／不带 force 移除；ccloop 已合并的 `fix/codex-strict-single-call` 删了；syncskill `dev` 有远端分支，未动。
- **没做**（F5、F6、failover 剩余件已在会话 `3cfc2e73` 做完）：F5（转录 CLI/socket 路由，推翻实时转录 ruling 3 与 T5/T13，要人定）、F6（`orca login` 非 TTY，CLI v2 spec §15.3 有意如此，要人定）、F8、F11、soft 模式 loop run 结算 principal（要和 ccloop 联合设计）；failover 的派活前改派、单次调用／flow 调用改派、休息面板与定时唤醒、付费验收（要一个额度真用完的账号）。

### 3.000000000000000000000 会话 `af2ceee1`（2026-11-04／05）：第一次 agent 自举测试 → 任务准备命令、检查要真实存在、阶梯只重试能修的 —— 已被上一节接手

> 人裁（原话）：soft D1–D6「允许没有下界也继续。新版本之前的不改没关系。」其余三条「其他都同意」；「你先跑一次看下」；预算「同意」（单个小 bug、3M token、$10）；codex trust 条目「备份后删掉」；「顺序同意，先做 F1–F3」；准备命令「每个仓库做不同方向的工作…」「自己推断。如果人愿意，也可以提前由人提供…」；重试「希望在遇到一些非常明显问题的情况下，带着之前的问题，自动再试一次」「对，就是第一类，这样分没问题」；「授权改写，派subagent review spec。修复完问题后继续写plan。」「subagent 逐任务做」；收尾「这次批准改写所有必要的判据。这一轮允许必要的付费真跑。这次在必要时临时允许你push ccloop到 origin main。…先按你的建议执行。执行完在最后阶段报给我审核。」台账：会话 `.superpowers/sdd/2026-11-04-session-af2ceee1/progress.md`（两次 dogfood 原始数、F1–F12）、计划 `.superpowers/sdd/2026-11-04-task-setup-and-check-retry/progress.md`（全部 `Ruling:`、变异、审阅、门）；ccloop 计划台账 `ccloop/.superpowers/sdd/2026-11-04-task-setup-ccloop/progress.md`。

- **第一次自举（付费 codex gpt-6-luna，隔离面板，Orca clone 当目标，同一个 web bug）**：澄清／拆分／估算都一次成；loop run 2 个 attempt 1,051,285 token 必败——检查命令 `npm test --workspace web` 不存在，attempt worktree 没装依赖（`vitest: command not found`），attempt 2 还越界改了 `web/package.json`；Orca 阶梯又自动重试（我停掉）。**转录在真数据上可读**（HTTP），事实（decisions）也收到；#112 不是 Orca／pin 的问题。agent 操作 Orca 的摩擦 F1–F12 在会话台账。
- **设计** `docs/superpowers/specs/2026-11-04-task-setup-and-check-retry-design.md`（builder check＋独立审阅；§10 是实施期更正）；**计划** `docs/superpowers/plans/2026-11-04-task-setup-and-check-retry.md`（As built 在文末）；ccloop 计划 `ccloop/docs/superpowers/plans/2026-11-04-task-setup-ccloop.md`。
- **Part A 已 `--ff-only` 合入 Orca main**（~~未装~~ 会话 `e2ad4802` 已装）（主题行 `feat(control): read a setup-phase failure and word setup-failed` 至 `test(control): the restart-during-re-run criterion waits on state, not time`）：任务可带 `setup`（计划文件／recipe／契约 `context.setupCommands`，缺省省略键、字节不变）；debug／系统 debug／冲突解决契约带 setup；Orca 自己跑检查的三处先跑 setup 并清掉它产生的忽略文件；集成检查 setup 失败 = `errored`（不开 debug 组）；认识 `phase:"setup"`／`setup-failed`；阶梯对 `setup-failed` 和「失败检查根本没跑起来」（exit 127/126、`command not found`、`Missing script:`）两级都不重试并留 `ladder-skipped` 行与命令，验证未收集时最多等 10 分钟；已存结果恢复与多目录遇 setup 以 `setup-unsupported-here` 拒。门 `npm test` RC 0（根 609 文件、5368 过、35 跳过按文件列在计划台账；web 173）。**装进 7777 被本会话自动模式拒（restart），归人**，无 schema 变更。
- **Part B（ccloop）已合入 ccloop main**（~~未推~~ 人已推，origin 即 a885241）：每个 attempt 在 agent 首阶段前跑 setup（日志 16 MiB 帽、进程组注册与收尾、改动 tree 即失败、超时、handoff 边界、用量观测 `attempt-N-setup`）；门 2492/2492、`check-known-reds` RC 0；**push 被 Tier 0 闸门拦（人授权了也拦），归人**。
- **Part C 在分支 `feat/task-setup-c`（分支在 Orca 主仓；worktree 已移除）**——~~未合~~ 会话 `e2ad4802` 已 repin（C0）并合入、已装：拆分看 `manifests`（各 package.json scripts／workspaces／lockfile）、产出 `setup`、代码核对 npm 命令（脚本／workspace 不存在 ⇒ `command:` 退稿）。**必须等人推 ccloop、Task C0 repin 之后再合**（main 仍 pin 026c571，它拒 `setupCommands`）。门（对 ccloop 5e10091）只有登记 flake 红。
- **第二次自举（C3，付费）通过**：同一需求，拆分推出 `setup:["npm ci"]`＋存在的检查 `npm run check --workspace web`，attempt 1 setup 33 s、检查 190 文件 1805 过、落地 `orca/<组>`；组 1/1 完成、共 1,421,886 token（工具报；codex 不报美元）。两次 `~/.orca` 都零改动；两条 codex trust 条目都已备份后删（`~/.codex/config.toml.bak-af2ceee1-20261104`、`.bak-af2ceee1-df2`）。
- **残余（登记未修）**：ccloop 2 s drain 截断无标记；setup 超时的 stop reason 一律 budget 措辞；`setup` 的 `-w` 只认 npm；npm 默认脚本 `start`／`restart` 未豁免；多目录 `writes[].checks` 不核对；嵌套 git 仓库躲过清理会进归档；失败检查命令／证据尾巴之外的详情只在归档里；目标仓 `npm ci` 的 prepare 会改 clone 共享 git config 的 `core.hooksPath`（命令自身行为）。

### 3.00000000000000000000 会话 `43913afc`（2026-11-03）：小修、clarify 不带 structure、flow 结算、soft 模式下单次调用按下界记账

> 人裁（原话）：663fb68e 的 7 条「同意」；迁移事故「按你的建议走」；#111「同意，等实际测试时再看是否有问题」；标签即存「同意」；overview「先 (a)，前后质量对比过了再 (b)」；flow D1 (a)；soft 模式「同意。我们之前的很多裁定在新的语义下可能有一些过期了，一些需要、可以修改。」；对比用「同意，使用 opus-5-5」；中途「尽量将这些要做的task都完整做完…这次批准改写所有必要的判据。这一轮允许必要的付费真跑…先按你的建议执行。执行完在最后阶段报给我审核」。台账 `.superpowers/sdd/2026-11-03-session-43913afc/progress.md`（变异、门、对比原始输出 `overview-a-comparison.txt`）。

- **已 `--ff-only` 合入 main、已装（7777 `index.js` 与 build 同为 1,161,352 B；schema 不变）**：
  - **迁移**：先写 `.pending` 副本 → 写表 → 改名成标记；写表失败不留标记，下次重试。`tests/service/build.test.ts`、`panelSocketE2e` 改用自己的表路径（前者曾以真 HOME 读人的表）。前台 `orca panel` 仍不迁移（人裁）。
  - **标签**：未答复时显示「正在保存标签…」、按钮禁用。
  - **overview (a)**：clarify 发的 overview 去掉 `structure`（单仓与多目录各成员）；split 照旧。记录、`run.overview.hash`、nonce 都是发出去的那份。clarify golden 重生成（只少 `structure` 键）。**付费对比（opus-5-5，Orca 仓三个想法）：prompt token −44%，单次 −43%，问题质量看不出损失**；工具报 $5.4493378。(b) 没做。
  - **flow 结算**：flow 调用用量未知时，owner 在 flow 运行页「按 grant 记账并重试」（`recovery-retry` + `charge-remaining-grant`）；执行拿到失败、不拿输出，池子保留整笔抽取。设计 §9 As built：没给 `syncWebBudget` 加 flow 分支（会让并行 flow 调用互相拒绝完成）；被 stop 关闭后再结算的那一路池子不计费，记在 activity（`poolNotCharged`），**没有判据**（找不到让 stop 关掉 flow 父组调用的路径）。
  - **soft 模式（单次调用）**：组 `limit.tokens` 为 null 时，clarify／split／估算的用量未知**不再停住**：按 ccloop 下界（总数；没有记 0）记账、标 `usageApproximate`，完整答案照用（spec `2026-11-03-soft-mode-approximate-usage-design.md` §7；D1–D6 是控制器定的，待人审）。有限组、flow 调用照旧停。runs 表与需求页显示「至少」。2026-10-27 spec 追加了具名更正。**loop run 没做**（见 §4.2）。
- **设计（未实施）**：额度感知的跨安装切换 `docs/superpowers/specs/2026-11-03-quota-failover-design.md`（参考 magpie／cc-switch／LiteLLM，D1–D6 待人）。
- **门**：最后一次 `npm test`（含全部提交）778 文件（根 605、web 173），5456＋1636 过，35 跳过（按文件：correctionExport 1、agentUpdatePaired 3、ccloopDefaultE2E 3、ccloopProtocol.integration 3、driverSkillsReal 1、savedResultRecovery.paired 20、savedResultRetryAuthorization.paired 3、realSmoke 1），typecheck 无错，RC 0。前一遍 118 红是 wt2 没 build `web/dist`（环境）＋ CLI 文档未重生成（已修）。变异共 31 条（M1–M20、S1–S10，M13 为绿 ⇒ 守卫冗余已删），都在 clone 里，`cmp` 证还原。独立审阅：1 Important（上面的池子缺口，按设计记名）、2 Minor（已修：只对真未知用量走近似路；下界按总数只记增量）。
- **核实**：#112 的根因不成立（`f4de340` 是 `ed5e4aa` 的祖先，转录早在）；本机真实库只有 10-17 的 6 个 run（早于转录），所以面板上没东西可看；本机 codex 目录 8 个模型都报 100 万窗口，#105 在本机不适用。

### 3.0000000000000000000 会话 `663fb68e`（2026-11-01）：需求页筛选、标签两个残余、25 万 input 查到来源

> 人裁（原话）：「Q1 a」「Q2 a」「Q3 a」；「这次批准改写所有必要的判据。这一轮允许必要的付费真跑。」「如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」台账 `.superpowers/sdd/2026-11-01-session-663fb68e/progress.md`（变异、门、替人定的 7 条）。

- **已 `--ff-only` 合入 main、已装（7777 的 `index.js` 与 build 同为 1,159,606 B，含新文案；schema 不变）**：
  - **需求页筛选**：「显示已归档」「显示已完成」两个勾选框换成一行单选「进行中（n）｜已完成（n）｜已归档（n）」，复用 `groupFilter` 样式，空的一项也保留。打开着的已完成需求留在列表里，已归档的只在「已归档」下。判据改写 4 个文件，都带 `Ruling:` 行。
  - **标签**：保存被拒时输入框保留内容；上一次改动未答复时，新的改动被忽略（没有可见的忙状态）。为此 `sendControl` 的结果一路传到 `TaskDetail`（`onCommand` 可返回 `Promise<number|null>`）。
- **门**：`npm test` 176 文件（根 4、web 172），38＋1629 过，0 跳过，typecheck 无错。12 条变异：10 条直接见红；M3 补判据后见红；M12 的守卫是冗余的，已删。真浏览器（构建产物＋假 API，中英 × 1280／390）一行筛选正常，英文 390 折两行，无溢出、无 pageerror；**真面板的真实数据没有看过**。
- **25 万 input**（`docs/superpowers/specs/2026-11-01-overview-token-cost-findings.md`）：**每次澄清和拆分都带整份仓库 overview，它随仓库变大，上限约 288 KiB**。Orca 仓 276,532 B 量出 134,691 prompt token（claude haiku，约 2.1 B/token），其中 `files` 65 k、`structure` 62 k、`docs` 14 k。备份库里的真实澄清：162–180 KB prompt、8.5–9.2 万 token，overview 占 88–98%。之前 12.6–13 k 那次是小仓。⚠️ 这**没有单独证明** 25 万：到上限也只约 14 万，差的部分要测试者的数（§8）。付费共 $0.16007721（工具报）；codex 额度用完（到 2026-11-04 16:12），两次在作答前被拒。
- **flow call 结算**：只写了设计 `docs/superpowers/specs/2026-11-01-flow-call-unknown-usage-settlement-design.md`，未实现。写设计时发现两点：`syncWebBudget` 对 flow 父组是空操作；结算后要防止抽取额退回池子。
- **没做**：overview 的上限没动（它改变模型看到的内容，要先做质量对比，待人定，§8）。

### 3.000000000000000000 会话 `4ed8eb65`（2026-10-31／11-01）：`correctionCoarseDebug` 挂住查清；测试者反馈第三轮做完

> 人裁（原话）：「按 (a)」；反馈文档「合理的部分采纳」「你先不要以我之前的裁定优先」；「同意你的建议，Q1–Q5 都按推荐走」；「这次批准改写所有必要的判据。这一轮允许必要的付费真跑」（**本轮没有付费真跑**）；ccloop push「临时允许」，闸门照拦，人手推了。设计与更正 `docs/superpowers/specs/2026-11-01-tester-round-3-design.md`；台账 `.superpowers/sdd/2026-10-31-session-4ed8eb65/progress.md`（门、变异、测量命令与原始数）。

- **已 `--ff-only` 合入 main、已装（7777 应答 200，服务的 `index.js` 与 build 字节数相同），Orca 已 pin ccloop `026c571`**：
  - **挂住**：Node 22.13.1 下 `execFileSync` 用 `input` 给 git 喂 16 KiB 偶发死锁，与 Orca 无关；夹具改路径参数＋60 s 超时。矩阵在 `known-load-flakes.md`。以后 `npm test` 不必再为它盯日志。
  - **#111**（ccloop）：`runLoop` 用 `changedFiles` 判路径策略，所以不能只放松比对。OMP execute 改为返回 git 观测到的列表，差异留 `changed-files-difference.json`。多报不再判失败，漏报的文件也进路径策略。
  - **#116**：collect 带可选 `usageLowerBound`（只展示、不计费），结算面板显示「至少 N tokens」。旧默认 30 分钟墙钟在**已安装的服务**启动时迁到 2 小时，只一次（标记 `<table>.bak-pre-2h-timeout`；人改回 30 分钟不会被再改）。⚠️ 只跑前台 `orca panel` 的人不迁移。
  - **#117** 文字跟颜色走（`shownWorkStatus`）；**#99／#110** 不是缺陷，日志行加了时间；**#112** 结论不成立（pin 和本机安装都报 `transcripts:"v1"`，测试者疑似 `node_modules` 旧），提示改成让人跑 `npm ci`。
  - **UI**：#114 标签一行 chip、改完即存（去掉草稿）；#115 已完成的需求折叠；#113 当前 run 自动打开最新转录；#77 看板加载中不再说不可用；#91 返回看板保留视图；#87 空状态给下一步；#80 需求成组后给链接；#75 依赖图 hover。**没开浏览器看过**，要人看。
- **事故（我造成，已修）**：迁移第一版放在所有 panel 启动路径上。`tests/service/servicePanel.test.ts`（`ORCA_AGENTS_TABLE: ""` 回落 HOME）跑了之后，**真实 `~/.orca/agents.json` 的三个 `timeoutMs` 被改成 7200000**，并写了标记。内容就是 Q2 定的结果，原字节在标记文件里，所以没回滚。修法：迁移只在 `mode.service === true` 跑，该测试改用自己的路径。证明：`HOME` 指向放了旧表的临时目录跑整个根套件，表字节不变、无标记。中途试过在 setup 里全局设变量，它覆盖发版门的真表，撤了。另有一次变异（`runFacts.ts`）误在主工作树做，已 0 差还原，违反 Rule 15，记在台账。
- **门**（最终提交前，`npm test`，全量 867 文件，因 lock 变）：typecheck 无错；web 182/182、1694 过；根 684/685 文件、6543 过／1 红／37 跳过。唯一的红是已登记的 `criteriaBaseRun`，单跑 3/3 绿。ccloop 全量 2440/2440、`check-known-reds` RC 0。独立审阅 0 Critical／0 Important。
- **决定不再查**：Q4 Board 与项目选择器裁定不重开；Q5 #109 不重开，等 token 数据。
- **残余（登记未修）**：（标签的两条已由会话 `663fb68e` 修掉）转录自动读取在飞时按展开，答案回来仍打开最新一条；迁移标记先于表写入，写表失败后不再重试；Task control 面板加载中也有同样的「不可用」（`App.tsx` 约 1781）；`fetchRunTranscripts` 不校验空响应体。

### 3.00000000000000000 会话 `65b4d067`（2026-10-30）：Radix Select 合入并装上

> 人裁（本会话开头，原话）：`fix/test-affected-web-css`「已做完」（人自己合并、推送）；Radix「同意，合入」；`b999cc81` 替人定的五处（焦点样式、两个 i18n 键、未知值不加占位、顺带修的两个缺陷、test-affected 修法）「同意」。台账 `.superpowers/sdd/2026-10-30-session-65b4d067/progress.md`（测量命令、原始数）。

- **已 `--ff-only` 合入 main 并装上、未推**：`ui/radix-select-trial` rebase 到 main（10/10 无冲突）后合入，主题行 `feat(web): drop the native select CSS; doc corrections (Radix Select batch 5)` 为末笔。装：`npm ci`（新依赖 `@radix-ui/react-select`）、`npm run build`、web build、`launchctl kickstart -k …/dev.orca.panel`；7777 应答 200，服务的 `index.js` 与新 build 字节数相同（1,157,515 B）。schema 没动。worktree 已 `remove`（不带 force），分支已 `-d`；主仓只剩 `main`。
- **合入前的 `npm test`**（rebase 后的分支，选中 868 文件＝全套，因为 `package-lock.json` 变了）：typecheck 无错；根 683/684 文件、6535 过／37 跳过，web 184/184（1758）；唯一的红是已登记的 `correctionCoarseDebug` **挂住**，这次挂了约 7 小时（`git hash-object -w --stdin` 子进程 0% CPU，杀掉后报 1 error），单跑 3/3 绿。分支不碰根 `src/`、`tests/`、`scripts/`。复现探针（16 KiB 输入的串行 `execFileSync` 共 2000 次）没复现，根因仍未查，登记更新在 `known-load-flakes.md`。⚠️ **以后跑 `npm test` 要盯着它**：日志长时间不涨时，先拿 vitest 参数里的文件对照已报告的文件，找出没报告的那个。
- 本轮没有付费真跑，没有改任何判据。

### 3.0000000000000000 会话 `b999cc81`（2026-10-29／30）：收据缺陷、Radix Select 全量换

> 人裁（本会话，原话）：Radix「(a) 全量换」；项目选择器「同意你的建议，换radix selector。但是不要合并成一个。」；收据「同意，按你的建议走。需要推 ccloop 时我可以push」；被删主题「按你的建议走。不加映射」；提问表单未选值「(a)，按你的建议走」（空触发器＋占位，不默认第一项）；「这次批准改写所有必要的判据」「这一轮允许必要的付费真跑」（**本轮没有付费真跑**）；「执行完在最后阶段报给我审核」。台账 `.superpowers/sdd/2026-10-29-session-b999cc81/progress.md`（每道门、变异、测量命令与原始数）。

- **已合入 main、已推、已装**（按主题行找）：
  - **socket 结算的已存结果收据**：会话 `3ea8a21e` 把它登记成「只是审计措辞」，实为功能缺陷——ccloop 按严格 schema 校验收据（`client` 必须 `"web"`、principal 必须等于 marker），`orca task settle-usage` 结算过的 run 永远走不了已存结果恢复。两仓修：ccloop `fix(control): a socket settlement's receipt backs the marker by its personPrincipal …`（Web 行按 `principal`、其它行按 `personPrincipal`；改前 4 条新判据全红）；Orca `fix(control): the saved-result receipt of a socket settlement names the person token's account`（`settlementReceipt`，只在 `person_principal` 非空时加键，Web 收据字节不变）＋ `chore(deps): repin ccloop to ed5e4aa …`。spec `2026-10-29-socket-usage-settlement-design.md` 追加 §5 更正。⚠️ `savedRecoveryAccounting` 调用 `settlementReceipt` 这一步没有判据（前置条件要真停止证明；paired 端到端默认跳过且夹具还停在 schema 14），已登记。
  - `test(control): type the settle-unknown-usage command builder …`：根 typecheck 自会话 `3ea8a21e` 起就是红的（TS2345，两个判据把 payload 传给 `never` 参数），上一会话与本会话前半都只看了 vitest 行。⚠️ **读 `npm test` 日志要看 typecheck 段**，rc≠0 不一定是测试红。
- **已在 main、已推（人自己合入，会话 `65b4d067` 开工时现测）**：`fix(scripts): a web/src stylesheet selects the web tests that read it by name`：`scripts/test-affected.mjs` 原来对只改 `web/src/styles.css` 的提交一个 web 测试都不选（styles／shellReflow／contrast 等按名读它）；修后选 8 个。判据在 `tests/scripts/testAffected.test.ts`，改前红；`npm test` 5 文件 70/70。
- **已合入 main 并装上（会话 `65b4d067`，见上一节）**：原分支 `ui/radix-select-trial`——全面板 55 个原生下拉都换成共用的 `web/src/ui/Select.tsx`（Radix 2.4.1），两个项目选择器都换、结构不动。spec `docs/superpowers/specs/2026-10-29-radix-select-everywhere-design.md`（独立审阅 13 条已并入）。分 6 批、每批一个子 agent、主会话审：批 0 组件＋helper（`web/tests/selectControl.ts` 的 `pickOption`／`optionsOf`／`shownText`，测试**绝不碰** Radix 在 `<form>` 里渲染的隐藏原生 select）；批 1 项目选择器＋需求＋控制；批 2 设置页；批 3 工作视图；批 4 其余；批 5 删原生 select CSS、文档更正。迁移顺带发现并修了两个真缺陷：FlowBoard 开始对话框按 Esc 关下拉会连对话框一起关掉；`reviewKeys` 不把按钮式下拉当输入框，焦点在下拉上按字母会触发「同意／重试」快捷键。门（批 5）：868 文件全绿（根 684、web 184／1758 条），typecheck 无错，37 跳过／10 个按环境开关的文件；两条完成判据 exit 0。bundle `index.js` +19,184 B（gzip +7.16 kB）。截图 41 张（1280／390、深浅、侧栏／设置·本项目／需求／用量，开与关）都无横向溢出、无 pageerror：`/private/tmp/orca-b999cc81/radix-shots/`。详见 `handoff_ui.md` §七.九。
- **残余（登记未修）**：种子世界没有长列表，Radix 的滚动按钮没在截图里见到；需求页每行的「…」按钮压出行边框（截图所见，主线就有，非本分支）；ChecksSettings 的选择没有「选了什么值」的判据（只有选项清单）；FlowSettings 预设与 AgentFields 上下文在值不在选项里时显示空触发器、不加占位（旁边已显示该值／有红框）。

### 3.000000000000000 会话 `3ea8a21e`（2026-10-29）：测试者反馈轮的三件后续

> 人裁（本会话）：主题「霜白，深色，浅色，蔷薇，紫夜，暮色，余烬。这几个配色还行，其他可以删掉」「terminal 主题不好看」；Radix Select「是不是可以换成 Radix Select 看下效果」；settle-usage 的 schema 变更「同意」；其余替人定的可逆项「没特别说明的部分都同意」；测试者数据「我去问问，不一定能拿到」；「这次批准改写所有必要的判据」「这一轮允许必要的付费真跑」（**本轮没有付费真跑**）；收尾临时授权 push 三仓（handoff 提交之后）。

- **已 `--ff-only` 合入 main 并装上**（按主题行找）：
  - `feat(web): keep the seven themes the human picked; drop ink, contrast, navy, lagoon and terminal`：`THEME_PREFS` 现为 system／light／dark／frost／rose／violet／dusk／ember；存过被删 id 的浏览器读成 `system`。判据改写：`themes.test.ts`（清单、被删 id 回落、侧栏计数徽标、删 high-contrast 块）、`i18nPseudo` 枚举 205 → 200。变异（`readTheme` 不校验）见红。门 `npm test` 172 文件（4 根、168 web）全绿、0 跳过。
  - `feat(control): orca task settle-usage works with a person token -- schema 20 -> 21 records the token's account`（spec `docs/superpowers/specs/2026-10-29-socket-usage-settlement-design.md`；恢复 spec 追加 §5 指过来）：`commands.person_principal`（可空）；socket 上有 person 权限的命令记 token 账号，Web 行为 NULL；`applySettleUnknownUsage` 用 `settlingPersonFor`；`hasValidUsageSettlement` 接受 socket 行的 `person_principal`。新判据 `tests/control/socketUsageSettlement.test.ts`；改写 `testerStuckStates`「stays the Web owner's」→ person token 能结算且读方认；`scheduleMigration` 前驱钉 "19"；12 个文件的当前版本 "20" → "21"、「未来版本」21 → 22（逐条在提交里）。变异 M1–M4（读方 socket 分支、写方写 NULL、服务回到只认 Web、20 路径不迁移）在 clone 里各打红、0 字节还原。门 `npm test` 571 根文件：541 过＋30 个 `panel-dist-missing`（worktree 没 build web，非业务）→ build web 后这 30 个单跑 262/262 绿；35 跳过（固定的 8 个真依赖文件）。
  - **装**：真库先 `sqlite3 .backup` 到 `~/.orca/backups/pre-schema21-20261029-135742/`（integrity ok、v20、61 行 commands），`npm run build`＋web build、`launchctl kickstart -k …/dev.orca.panel`；启动时自动迁移（另有 `control.sqlite.pre-v20-*`），现测 `schemaVersion=21`、7777 应答 200。⚠️ 旧版 Orca 不能再开这个库，回退用该备份。
- Radix Select 试样：人看后定「全量换」，会话 `b999cc81` 在同一分支上做完（见上一节）。
- **事故（已恢复）**：worktree 里 `npm ci` 穿过软链清空了主仓 `node_modules`（§6.7 新增一条）；已在主仓 `npm ci`（锁文件 0 字节差、ccloop 仍解析到 `e25381f`）、重启面板 200；`git status` 干净。
- 收据工件那条「登记未改」是误判，会话 `b999cc81` 已两仓修掉（见上一节）。

### 3.00000000000000 测试者反馈轮（2026-10-28 规划 → 会话 `a9f9d6de` 2026-10-28／29 实施）

> 台账 `.superpowers/sdd/2026-10-28-tester-feedback-round/progress.md`（人裁原话、每道门、变异、测量命令与原始数）。UI 细节在 `docs/handoff/handoff_ui.md` §七.七。
> 人裁（实施会话）：「尽量将这些要做的task都完整做完」「这次批准改写所有必要的判据」「这一轮允许必要的付费真跑」「遇到卡住必须等人的事情，请继续做不必等人的部分」「执行完在最后阶段报给我审核」；ccloop 若需 repin 临时允许 push ccloop（**本轮 ccloop 没动，没 repin、没推**）。规划会话的人裁（顺序、#69/#70 不改、不做跨调用 session 复用、Board 不加批量／触摸／列／WebSocket）照旧有效。

- **全部已 `--ff-only` 合入 Orca main 并装上**（`npm install` 只加包、`package-lock.json` 0 字节差；`npm run build`＋web build；`launchctl kickstart -k …/dev.orca.panel`，7777 应答 200；schema 不变）。按主题行找：
  - **P0 #98–#104**（spec `docs/superpowers/specs/2026-10-28-recovery-cli-design.md`，**§4 更正优先于 §2**）：判据 `tests/control/testerStuckStates.test.ts` 用真代码路径重建测试者的库状态。结论：#98 不是缺陷（Retry 起草的下一稿等在旧调用的未知用量上，面板给了结算出口）；#99 复现不了（C22 已钉住；要测试者的 commands 行）；**#100 是缺陷，已修**（停住／挂起的需求调用不再挡归档，归档同事务把它置 `interrupted`）；#101 是设计路径；#102、#104 是测试者手改库造成的（代码到不了）；#103 新 CLI `orca recovery retry --run <run> --acknowledge charge-remaining-grant`，单调用结算接受所有者的 person token（记到该账号）。**`settle-unknown-usage` 仍只限 Web**——审阅发现 socket 路径会留下读方都拒的标记；要让 `orca task settle-usage` 能用需要命令台账记 person token 的账号（schema 变更）——**会话 `3ea8a21e` 已做（schema 21）**。没做 force-archive／reset-dispatch。
  - **拆分线**：split 指令 v3（#107：loop plan 约束、trace id 规则、退回原因附人话）；#105 新原因 `context-unreported`（在目录但没报窗口）；轮次按链上位置编（id、文档、校验器三处）；拆分重试改**修订模式**（上一份有任务的稿＋点名的原因，只改点名的）。设计记录 `docs/superpowers/specs/2026-10-28-split-prompt-v3-design.md`（§6 是审阅后的更正与登记的 5 条 Minor）。
  - **付费量 token**（人批，codex `gpt-6-luna`，中等需求）：2 轮澄清 → 共识 → 第 1 稿一次过；3 次调用各一轮、无工具；input 约 12.6–13.0 k／次，组共 42335 token；codex 不报 USD（测量命令与逐次数字在台账）。**测试者每稿 28–30 万没复现**，要测试者那次拆分 run 的 `…/single-call/call-*/events.jsonl` 才能往下查；「探索笔记」按此证据不需要。
  - **UI**：Radix＋Tailwind v4 全量迁移（preflight 开、共享类成 `@utility`）、测试者 #73/#74/#76/#79/#83/#86/#90/#106/#107(面板)/#54、10 个候选主题重做／新增——详见 `handoff_ui.md` §七.七。
- **门**（`npm test`，最终提交）：865 文件（682 根、183 web），web 全绿，根 1 红 `startForm`（已登记，单跑 9/9）；37 跳过（固定 10 个文件）。本轮见到的负载红与一条**会挂住**的测试（`correctionCoarseDebug`，卡在 `git hash-object -w` 子进程）已登记进 `known-load-flakes.md`；`controlCommandRecovery` 的竞速已修。
- `~/.orca` 非面板树 326 个文件 `shasum -c` 全 OK（真库只用过 `.backup` 副本诊断，副本是干净的）。
- **残余（登记未修）**：flow 宿主的 clarify 轮次编号未跟随链上位置；omp／openrouter 走 `context-unavailable` 的边角；多目录拆分非主仓的路径形状只按主仓规则核；`correctionCoarseDebug` 挂住的根因；见 split 设计记录 §6 与恢复 spec §4。

### 3.0000000000000 会话 `e236bbe4`（2026-10-28）

> 台账 `.superpowers/sdd/2026-10-28-session-e236bbe4/progress.md`（人裁原话、每道门、变异、子代理报告要点）。
> 人裁：拆 import 环「同意修」；m5「同意按你的建议走」；组件「你直接按你的判断改…改完之后我统一看」；主题「可以多加几个主题让我可选…新的主题中动基调」；「这次批准改写所有必要的判据。这一轮允许必要的付费真跑」（本轮实际零付费）；测试者 issue 文件不改（测试者自己改）；flow call 结算「这一轮先不做」。

- **已合入 Orca main 并装上**（都 `--ff-only`；面板重启三次，最后 7777 应答 200；schema 不变）：
  - **import 环（m4）**：主题行 `refactor(control): move the estimate settlement out of webService to break the import cycle`。估算结算与它写穿的组／提案 helper 逐字节搬到 `src/control/estimateSettlement.ts`，`webService.ts` 原样转出，调用方零改动；判据 `tests/control/singleCallImportCycle.test.ts`（从 `singleCallPurposes.ts` 走值 import 不得到达 `webService.ts`）。
  - **m5（ccloop 对中止的单调用也带下限）**：spec §4 C2 原文就是「outcome 不是 complete 即带」，审阅员读窄了 ⇒ 行为保留，只补判据：ccloop W10（`tests/control/singleCall.test.ts`，已 ff 进 ccloop main）、Orca `singleCallUsageSettle.test.ts`「keeps an aborted call's lower bound…」；spec 追加 §11 更正。**无需 repin**（ccloop 只加了测试）。
  - **组件层重做＋六个候选主题**（子代理实施、控制器审）：统一间距／圆角／控件高度刻度，按钮（主／次／`.btn-quiet`／`.btn-danger` 已定义未使用）、表单控件、tab（设置分类、组详情、纠正三处同一组件）、pill／badge、表格、确认框、浏览器表面全部重做；默认 `system`／`light`／`dark` 基调不变。新主题 `frost`（冷中性浅）、`contrast`（高对比浅，全 ≥7:1）、`navy`（深蓝暗）、`ember`（暖暗）、`dusk`（柔暗）、`terminal`（绿黑等宽），在「设置 › 外观」下拉里选；`web/tests/themes.test.ts` 对每个主题循环钉对比度／token 全集／块顺序／`color-scheme`。390px 横向溢出改前组详情 392px、改后全 0。#49 看板卡片 `title`。控制器复核：impeccable 检测器唯一一条 `side-tab`（#21 的 3px 强调色左边条）⇒ 改为整卡浮起（Rule 7：#21 要的是分离不是竖条），检测器后 `[]`；组头链接与按钮贴边 ⇒ 补间距。截图 `/private/tmp/orca-e236bbe4/ui/shots/{before,after}/`。`web/DESIGN.md` 已更新。
  - **「待测试的功能」走查**（真浏览器、隔离面板、fake-codex、零付费；`/private/tmp/orca-e236bbe4/qa/NOTES.md`）：#76 revise、#95、#96、flow 看板卡／开跑对话框／运行页暂停恢复／设置与锁、checks 定时与 model review「Run now」都正常；**model review findings 与 dismiss 没测到**（要两个已落地组＋一次 findings run）。顺手修了三处：`control-argument-invalid` 的拒绝现在显示服务端 detail；flow 锁与锁拒绝用字段的话而不是原始键；需求文档开头的 front matter 分开显示、`# slug` 成标题。
  - 改写过的既有判据都带 `Ruling:` 行（清单在台账）：`i18nPseudo.test.tsx:366-367`、`detailRegions.test.tsx` #21、`flowSettings.test.tsx`「sets the global locks…」、`requirementsReadability.test.tsx` #77。
- **门**：每条线 `npm test` 0 跳过；唯一红是拆环那次的 `startForm`（已登记，单跑 3/3）。根 `scanPanelText`＋`noteCodes` 另跑全绿。
- **残余（登记未修）**：需求文档按存储序号编轮次（revise 后「Round 3/4」「Consensus round: 4」），面板按链上位置（「Round 1, revised」）——**设计选择，待人定**（`src/control/requirementDocument.ts:58`）；项目设置刚保存后「Run now」报 `revision-conflict` 且文案说「this group」；QA 环境里面板重启后驱动在 `captureSnapshot → archiveFile` 归档一个整 clone 工作区耗时数分钟、且 SIGTERM 80 s 停不下（只在隔离环境见过一次，未复现）；`requirement-next` 那条 `<p data-tone>` 没有内边距／圆角；文档开头标题是 h6、低于 h5 小节标题；`.btn-danger` 未接到任何危险操作上。

### 3.000000000000 会话 `3cd8fb02`（2026-10-27 晚 → 10-28）

> 台账 `.superpowers/sdd/2026-10-27-session-3cd8fb02/progress.md`（人裁原话、每道门、变异、审阅、残余）；测试者分诊表同目录 `tester-triage.md`。
> 人裁（原话在台账）：会话 `7753e97d` 的六条控制器裁定「都同意」；#63 需求页一侧「同意修改」；「全局设置」链接文案「同意修改判据」；「这一轮允许改必要的判据」／「这次批准改写所有必要的判据」；#62 方向「同意」、「本会话做完」（Rule 6 预算本会话豁免）；#64／#65「基于问题本身看…怎样做是最优的」；付费 omp「这一轮可以做」。

- **已合入 Orca main 并装上**（都 `--ff-only`；按主题行取；面板已重启、7777 应答 200）：
  - **两次 repin**：`chore(deps): repin ccloop to ae6fb71 …`，再 `chore(deps): repin ccloop to e25381f for omp-stalled and the single-call usage lower bound (#62)`。门：真 ccloop 文件＋scheduler 524 条 518 过／6 跳；`ORCA_CONTROL_VERIFY` 冒烟 9/9（`ccloopProtocol.integration` 要 `ORCA_AGENTS_TABLE`：fake-codex `integration` 模式的表，做法在台账）；`npm test` 677 文件只红已登记的 `startForm`（单跑 3/3）；`~/.orca` 哈希不变。**测试用 bin 现在是 `/private/tmp/orca-3cd8fb02/ccloop-e25381f/dist/cli.js`。**
  - **#62（测试者 P0）**：spec `docs/superpowers/specs/2026-10-27-single-call-unknown-usage-settlement-design.md`，**§9 修订 1、§10 修订 2 优先于正文**（两轮独立审阅：设计审阅 3 blocker 全采纳；代码审阅 0 blocker；复审 0 blocker）。做成的：受阻在 C、用量未知的 clarify／split／估算单调用，经 run 级 `recovery-retry` 带 `acknowledge:"charge-remaining-grant"`（仅所有者、仅 Web）按剩余额度结算后照常重试；被 stop 关掉的同类调用也能结算（只记 `used`、不再放预留、唤醒挂起的轮次）；结算算术与 `settle-unknown-usage` 共用 `chargeRunRemainder`；各用途 `complete` 拆出事务内核心；读模型两个新的 strict 可选键 `singleCallUsageLowerBound`／`singleCallSettlement`；Web `ChargeRetry`（额度、下限、确认文案）。ccloop 侧 `omp-stalled` 错误码与记录的 `usageLowerBound`（只在 >0 时出现）已随 repin 生效。**flow call 不在范围**（残余）。
  - **测试者 UI**：#63（任务页与需求页归档后关掉打开的详情）、#15（done 组不给暂停／交接停止）、「全局设置」链接改为「设置 › Agent」、#64（设置分类改成顶部一排 tab，取代 H6 的左侧分类列——人让按问题本身判）、#65（表单控件统一 CSS，不引 UI 库）、#66（会话列表：类型、登录与到期时间、本浏览器、「退出登录」）、#67（来源只在非内置时以灰字显示）、#68（副作用类别与级别按 flow spec §9.1／§9.2 用文字表述）、#69（「本项目」页内的项目选择，绑定侧栏同一范围）。决定写在 `docs/superpowers/specs/2026-10-24-tester-round2-design.md` §24、§24.1。
  - 改写过的既有判据都带 `Ruling:` 行，清单在台账（含一条人点名范围之外、同一文案的 `followupControls.test.tsx:186`）。
- **付费 omp 验收**（人批）：`/private/tmp/orca-3cd8fb02/o9-omp-e25/`（`local-litellm/deepseek-flash`，main 的 `e25381f` pin，ccloop `e25381f` build）**20/20 checks 全真**：open→clarify→consensus→跨目录 split→accept→估算（第 1 版 `single-call-output-invalid`，自动重试的第 2 版 ready——已登记的 omp 单调用答案质量）→导出→开跑→驱动崩溃→partial→retry-rest→三成员落地；plan／execute／verify 全程无 `tool-rule-violated`（#60 提示生效）。工具报用量 54386 token（omp 不报 USD）。崩溃点后三行 `orca-control: … pass failed: database is not open` 是脚本模拟崩溃时后台轮次撞上已关的库，不影响结果。真实 stall 无法稳定触发，#62 的结算路径以零成本实测与判据为证。
- **测试者分诊**：两份文档所有未结条目对照 main 判过（`tester-triage.md`，含可直接转给测试者的中文清单）；本轮之后 issue-20261023 只剩 #22（延后）。
- **残余**：flow call 的用量未知结算（仍未做，见 §4.2 第 7 条）；codex 需求拆分人自测中。~~import 环~~、~~m5~~、~~#64／#65 未在真浏览器看~~ 已在会话 `e236bbe4` 处理（见上一节）。

### 3.00000000000 会话 `7753e97d`（2026-10-27；中途续接的会话 id `03c89de8`）

> 唯一进度源：台账 `.superpowers/sdd/2026-10-27-session-7753e97d/progress.md`（两批人裁原话、接手边界、六路审阅的修复清单、各线结果、O9 两次付费）。
> 人裁（本会话）：「同意按你的建议走」；「审阅结论 => 按你建议的修复」；「forget 同意改成归档」；H6／H8／H10「同意你的建议」（已写进 `goal.md` G12–G14）；O9 claude「同意可以跑」「同意再跑一次付费真跑」；/handoff 轮：「这个session暂时不要考虑context大小。这次批准改写所有必要的判据。这一轮允许必要的付费真跑…先按你的建议执行。执行完在最后阶段报给我审核。」⚠️ 上下文越过 T2（人豁免，已在检查点记录）。

- **审阅**：接手 agent（从 T11 `perf(agentTranscript): T-F's script…` 起）的代码提交分六路独立审阅（不审文档提交），报告逐条由实现席先复核再修。整体判断：权限边界、崩溃回放、不覆盖人的文件这几块扎实；漏在边角状态与坏数据隔离。
- **已合入 Orca main 并已装**（都 rebase 后 `--ff-only`；按主题行取）：
  - `fix(systemDebug): a paused group is not escalated, and its open ladder waits`（测试者 #61）；`fix(dirPlacement): take-folder places the rest of the stopped landing in the same round`（审阅 blocker）。
  - 多目录 9 笔（只写非主目录的 run 落地后不再 blocked、pre-check 抛错即 `multi-dir-precheck-failed`、retry-rest 期间的 mark-resolved 不丢、`prerequisiteDone` 不在未搬运的 tip 上报完成、collect `resultRepo` 校验、多目录 `landedUnrecorded` 精确探测、harness `--add-dir` 解析与 python 探测）。
  - 流程暂停／留言 5 笔（子任务已结束后的暂停可恢复、pump 会过暂停中的 run、留言后暂停接管其 stop、resume 与记账同一事务、已落地子任务的留言标 `undelivered`、fake 端口对齐真端口；**控制器裁定**：人对暂停中的 run 发 stop 立即生效并结算各步，spec §14）。
  - 定时 10 笔（同趟被禁用／删除不再触发、坏 fire／schedule 行逐行隔离、step 9 让位 R2、`add group` 钉项目交付默认、写入时校验模板版本、DST 判据、永不确认的 fire 收尾；spec §23）。
  - 转录 12 笔（JSON 键值密钥脱敏、两条正则改线性、索引并发增长串行化、六个盲分支补判据、equal-size 头哈希、组件逐级 walk、web 窗口连续与请求排队；spec §12.6）。
  - 目录放置 9 笔（base 导入在文件夹锁内、第二个回答不被覆盖、`withheld` 不再存 Orca 自己的文件、目录级大小写冲突、按钮只在可答状态出现；spec §21）。
  - 拆分指令 v2（写明 `.orca/requirements/…` 与 `.decisions/` 会在目标里，检查不得断言目录只含某些文件；N1 spec §16、多目录 spec §22）＋ #60 Orca 侧（`omp-phase-tool-forbidden` 的下一步文案）。#60 的「自动确认无限循环」从代码复现不出（每个提案版本只拒一次，C22c/C24 钉着）。
  - Web：H6（侧栏三段、设置合一页左侧分类、`#settings/<分类>`，旧 hash 映射）、H8（组卡片状态灯、`.num` 等宽数字）、#56（快捷键按钮改图标、只在有快捷键的页面）、#57（依赖图选中只框一个节点）、#58（徽标 kind 有译名、长文字在框内换行）；其余测试者 UI 项 18 笔（准备页 Agent 在预算前、分配表折叠、需求页「下一步」行、拆分草案 4 列、新建需求表单置顶、Overview「Next」标记与空状态、拖拽时标出可放／不可放列、打开的组滚入视野等；逐项状态表在台账；#22 延后（与转录 run 详情重叠），#20／#24／#29／#38 判不改）。
  - 文档：live-transcript spec §15（L7 实测口径）。
- **ccmem 本地 main（未推）**：`forget` 改归档＋审计、id 严格解析；968/968（ccmem handoff §1.00000）。**ccloop 本地 main（未推）**：codex strict 投影修复、omp 单调用空停续跑、#60 plan 工具名单＋`tool-rule-violated`（ccloop handoff「本轮」节）。**Orca pin 仍是 `b97d5bd`**：repin 要等人先推 ccloop。
- **O9 claude（付费两次）**：第一次 `/private/tmp/orca-7753e97d/o9-claude-1/` 未过（模型检查断言 alpha 只含两个文件，而导出把需求文档放进了主目录；$1.725014）；修拆分指令 v2 后第二次 `/private/tmp/orca-7753e97d/o9-claude-2/` **22/22 全真**（含 `claudeAddDir`、崩溃→partial→retry-rest→三成员落地、`orcaHomeUnchanged`），工具报 $0.7925112。三家多仓端到端都已过。
- **门**：各实现线的门在 8 条并跑、负载 100–400 下跑，红全是超时类，逐个文件单跑全绿（日志 `/private/tmp/orca-7753e97d/fix-*-rerun*.log`）。合并后 main 上 `npm test`（负载约 35）：根 599 文件 2 红（`criteriaBaseRun`、`startForm`，已登记形状，单跑各 3/3 绿）、web 165/165；最后合入的 UI 线自己的门 164 文件全绿、`--ws check` 0。build＋web build＋`panel restart`，7777 应答 200，schema 仍 20（无迁移）。
- **残余（各线报的，登记未修）**：暂停中 run 被 stop 时已落地的子任务结果记在 vault、不复制回人的文件夹；`.orca-<hex>` 临时名不从快照排除（理由在台账）；完成的 take-folder 的 resolution 下一轮被清（trailer 与 drift ref 仍在）；定时 condition-8 的 waiting fire 在人确认后不收尾；ccmem 无 un-archive 命令；测试者 #22。
- **注意**：跑门的工作树要先 `npm run build --workspace web`（否则 `panel-dist-missing`）；zsh 里多文件变量要 `${=files}`；别同时开 8 个门（负载 400，门失去判别力）。测试用 bin：`/private/tmp/orca-7753e97d/ccloop-b97d5bd/dist/cli.js`。

### 3.0000000000 会话 `a98b77d2`（2026-10-26／27）—— 已合、已装

> 接着 `ffec7b28` 的文档／skill 收尾做。计划 `docs/superpowers/plans/2026-10-26-panel-small-gaps.md`（含门与 as-built）；spec `2026-09-30-loop-plans-design.md` §16（追加的具名更正）。

- **面板小缺口批已合入、已装、已清**：loop 卡的验收计数现在含配方（design／investigate，v2／v3）的 document checks。服务端视图 `loopPlan.documentChecks` 必填、Web 侧可选（缺省读 false，`tests/panel/webParity.test.ts` 的桥负责归一），卡片把 `inputs.checks` 与每个 target path 的存在性检查一起计数，折叠列表加一行「另有 N 条存在性检查」（en／zh `loopPlan.documentChecks_one/_other`）。三笔代码提交按主题行取：`feat(control): the loop plan view names the recipe's document checks`、`feat(web): the loop card counts the document checks it runs`、`test(panel): the parity bridge reads an absent documentChecks as false`。命名变异 M1–M3 在 `git clone --local` 副本里各红 9／4／1 条，恢复后 diff 0。
- **门与三条真红**：最终门根 578 文件 1 红（`startForm` ECONNRESET）、web 159 文件 1 红（`memoryLayout` scroll 时序），都是 `known-load-flakes.md` 已登记形状，单文件各连跑 3 次 3/3 绿（负载 14–17）；`npm run typecheck`、`npm run build --workspace web`、`npm run --ws check` 全绿。同门前几轮红的三条**不是负载**，已逐条修掉并登记：① `web/tests/schedules.test.tsx` 的导入用例**单跑必红**——jsdom 的 `File.arrayBuffer()` 给另一个 realm 的 `ArrayBuffer`，Node 的 `SubtleCrypto.digest` brand check 拒收（不是并发），`sha256Hex` 改喂本 realm 视图后 39/39（`fix(web): hash a plan file's bytes through a realm-local view`）；② `tests/service/command.test.ts` 的 skill 字面量停在主题行 `docs(skill): route orca-control to the current CLI` 之前（skill 已把 `status|logs` 并入同一句，`test(service): the skill's service line now names status and logs`）；③ `projectSwitcher` C 在 Requirements 表单挂载前就读 select（初始断言改 `waitFor`，`test(web): wait for the requirement form before reading its select`）。
- **装与清**：ff 合入 main，主仓装好（`npm run build`＋web build）；`panel restart` 后 7777 应答 200，`web/dist` 含新文案；schema 仍 20（无迁移，未动控制库）；本轮 worktree 与已合分支已删，只剩 `main`。收尾文档提交 `docs(loop): the batch is merged, installed and cleaned up`。人在本轮自行 push，`ls-remote` 现测与本地 main 同笔（本文不写哈希）。
- ~~仍待人：O9 claude 一段~~ 已在会话 `7753e97d` 跑过并通过（见上一节）。

### 3.000000000 会话 `ffec7b28`（2026-10-24）

> 唯一进度源：会话台账 `.superpowers/sdd/2026-10-24-session-ffec7b28/progress.md`（人裁原话两批、每个 spec 的审阅轮、控制器裁定、实施进度、文末「Handoff state」）。各实施计划在 `docs/superpowers/plans/2026-10-24-*.md`（均已随各自分支合入 main）。
> 人裁（本会话）：「这个session中，尽量将这些要做的task都完整做完…这次批准改写所有必要的判据。这一轮允许必要的付费真跑。这一轮如果要做 repin ccloop 的工作的话，临时允许你 push ccloop 仓库到 origin main。…先按你的建议执行。执行完在最后阶段报给我审核。」⚠️ ccloop push 被 Orca 的 Tier 0 闸门拦下（人的临时授权在 agent 会话里做不成，Rule 15），由人手推。会话结束原因：所有在飞 subagent 撞每周 API 限额（10-27 09:00 Asia/Shanghai 重置）。

- **已在 Orca main（人已推；以 `ls-remote` 现测）**：
  - Task 11 验收缺陷（`fix(web): Task 11 acceptance — cards, goal summary and run page details`＋`fix(web): a clarifying card keeps its row text…`）：`.sr-only` 规则缺失（测试者 #2/#11/#18 同因）、clarifying 卡显示目标、长目标摘要填满 120 字并带省略号、运行页花费行不重复、已完成的 run 不给 skip/defer、无默认值的图片参数「选一张图片」、可见 label。
  - 五份 spec（各两轮独立审阅）：`2026-10-24-tester-round2-design.md`（H1–H5、H11、H12；§19/§19.1/§20/§21 优先）、`2026-10-24-dir-project-requirements-design.md`（§20 优先）、`2026-10-24-scheduled-flows-and-groups-design.md`（§21、§22 优先；`autoConfirmBlocker` 以 R2 的三参签名为准）、`2026-10-24-multi-dir-projects-design.md`（H7，§21 优先）、`2026-10-23-live-transcript-design.md` §12（Revision 3：O2/O3/O4 关，C1–C8）。
  - **测试者第二轮（R2）server＋web 已合并并装上**：估算超限只警告、永不改组状态；schema 18→19 一次性修复迁移（只修唯一阻塞原因是估算超限的组，每组 SAVEPOINT，永不抛）；估算额度 min(1M, 剩余, 足够大的 cap 余量)、输入上限按模型窗口；需求的 agent 成为组 worker 默认；不限 token 且由人创建的组自动确认（单一确认者 `autoConfirmUnlimitedPass`，`createdByPerson` 戳）；确认清单（含 deficit 阻塞）；任务目标摘要；hash 路由（跨项目只给切换按钮）；`?` 快捷键列表对话框（无新单键绑定）。
  - **repin ccloop → `f4de340`**（实时转录的 ccloop 部分 + `work.operatorNote`）：Orca 先接受 features `transcripts:"v1"`、collect `transcripts`、envelope `operatorNote`，再钉；主仓已 `npm ci`。Orca 侧还**没有**消费者（读取器/UI 在飞，见下）。
  - `known-load-flakes.md` 新增会话 `ffec7b28` 一节（startForm 等；全量跑时真面板写 `~/.orca/panel/logs` 会触发 ~/.orca 写入护栏）。
  - **实时转录（Orca 侧）已合入并装上**（计划 `docs/superpowers/plans/2026-10-24-live-transcript-orca.md`，主题行 `fix(agentTranscript): the decoder splits like one whole-buffer decode…`）：11 笔 rebase 后 ff 合入。独立审阅的两个 should-fix 已修（torn UTF-8 下 `split` 与整缓冲解码不等价、`feedCount` 少算低代理单元），另有全量测试发现的真回归（面板严格的 `persistedRunSchema` 不认 D1 写在 run body 上的 `transcripts`，组视图 `run-invalid`）已修并加断言。`npm test` 根级 5885 过／3 红（`schedulerBridge`、`driverReconcileN`、`startForm`，全是已登记负载形状；各自单跑绿，负载 12–15），web 1388 全过；T11 `npm run perf:transcript` 峰值 51.9／48.3 MiB（门 64），0／359、0／527 泄漏；已 build＋web build＋`panel restart`，schema 仍 19。审阅 minor 4–8 的延后理由写在计划文末。
  - **目录项目需求（dir-requirements）已合入并装上**（计划 `docs/superpowers/plans/2026-10-24-dir-requirements.md`，spec `2026-10-24-dir-project-requirements-design.md`；15 笔 rebase 后 ff 合入，tip 主题行 `fix(review): the four route enumerations learn resolve-folder-change…`）：Task 1–8 完成，D5–D15 判据测试与命名变异全绿（D15 2 条、D8 4 条、D12 1 条；另 9 条变异红后恢复 diff=0）。独立审阅 0 blocker、1 should-fix 已修（D8 锁探针新增 `after-classify`，证明分类也在整趟一把锁内，变异 `classify-outside-lock` 红）、6 条 minor 延后（take-folder 丢弃 withhold 的归因边界、resolution 晚一轮清理、CI `skipIf(!realBinary)`、D12 只扫 TMPDIR、临时文件 chmod 早于 link 的字面、`dir-base-missing` 判定过宽）。全量 `npm test` 根级 4926 过／1 红（`criteriaBaseRun`：`index.lock File exists`，已登记文件的新形态；同 env 单跑 3/3、未改动 main 1/1 绿，负载 11–12），web 154 文件全过；已 build＋web build＋`panel restart`，schema 仍 19（本分支无 schema 改动，未动控制库）。
- **已装**：先 `sqlite3 .backup` 到 `~/.orca/backups/pre-schema19-20261024-062118/control.sqlite`（integrity ok，v18），再 build（tsc＋web）＋`panel restart`；`meta.schemaVersion=19`；修复迁移改了 0 个组。
- **scheduled 装库**：先 `.backup` 到 `~/.orca/backups/pre-schema20-20261025-023827/control.sqlite`（目录 0700／文件 0600，integrity ok，v19），再 build（tsc＋web）＋`panel restart`；`meta.schemaVersion=20`，`schedules`／`schedule_fires`／`plan_library`／`plan_library_versions` 四表齐全（迁移自己在库旁留了 `control.sqlite.pre-v19-*`）；面板 7777 应答 200。
- **付费实测（工具给的数）**：真 codex（gpt-6-luna）验收 ccloop strict wire schema（`debug.located`＋`flow`）**通过**；claude／codex／omp 都能读工作区外绝对路径（选择 (a) 前提成立）；三家都**不**遮蔽密钥（O2）；三家都能在 `--add-dir` 目录里写（H7 前提成立），claude 精确 `Bash(cd <dir> && <cmd>)` 规则放行复合命令。证据在 `/private/tmp/orca-ffec7b28/{evidence,o2,o3,adddir-probe}/`。⚠️ 已知副作用：真 codex 每跑一次会往人的 `~/.codex/config.toml` 追加一条 `[projects."<路径>"] trust_level="trusted"`（历次会话都有），登记未修（本轮 7 条 2026-10-26 已按人裁清掉：`adddir-probe/work`、`o9-codex-2..7/alpha`；备份 `.bak-o9-20261026`、`.bak-o9-20261026b`，清后重解析、`[projects]` 27→25）。
- **定时流程与计划库（scheduled）已合入并装上**（计划 `docs/superpowers/plans/2026-10-24-scheduled.md`，spec `2026-10-24-scheduled-flows-and-groups-design.md`；T1–T11，21 笔 rebase 后 ff 合入，tip 主题行 `fix(schedule): isolate a corrupt schedule row, cover the new verbs, and translate the durations`）：rebase 到 main 解了 7 处双方新增冲突（`errors.ts`、`planImport.ts`、`webProtocol.ts`、`controlAssembly.ts`、`webService.ts`、`controlViews.ts`、`controlTypes.ts`）；typecheck 顺带抓到 main 上已存在的缺陷（dir-requirements 漏改 web 的 `CommandSuccessV1.verb` 联合），已在 main 单独修（主题行 `fix(web): the command-success verb union learns resolve-folder-change`）。独立审阅 quality 在「损坏 schedule body 逐行隔离」修复后 PASS；本轮变异 M-C0（未选中路径 ⇒ exit 1）与 M-T11a（`pass.ts` 退回 `listSchedules` ⇒ scheduleCrash 红）均见红并恢复。门：`npm test` 726 文件（569 root、157 web）全绿、35 skipped；C0 的 12 路径 `assert-selected` rc 0。
- **ccloop `feat/multi-repo` 已合入并已推**（人已确认 P1–P7、M9 与 As-built 1–10；rebase 后 typecheck/build 绿、19 个多仓测试文件 55/55、C12 全 `A`；分支与 worktree 已清理）。Orca 侧 H7 随后在本会话完成：O1 把 pin 改到 `c205d55`，O2–O9 合入并装上（见下一条）。
- **多目录项目（H7）已合入并装上**（计划 `docs/superpowers/plans/2026-10-25-multi-dir-projects.md`，spec `2026-10-24-multi-dir-projects-design.md`；O1–O9 共 16 笔，ff 合入 main，tip 主题行 `docs(plan): O9's measured sites, refusals and accepted gaps`）：项目文件/注册与 API、打开与设置拒绝、跨目录概览与提示、拆分/写入集/契约/导出、派发与收集（`additionalRepos`）、D 每目录落地与台账、多目录落地趟（journal、folder 停止、两个回答），以及 O9 的命名拒绝（`multi-dir-plan-import-unsupported`／`flow-project-multi-dir-unsupported`／`debug-multi-dir-unsupported`）、访问表、`groupSummarySchema.multiDir` 与 Web「目录与落地」区域（§13 全码 en/zh）。门：根 `npm run test:all` 669 文件 6308 过／37 跳（含真 ccloop 的 M19 清理）、web 173 文件 1576 过、root typecheck、`npm run build`、web build、`verify:ccloop-pin` 3/3。在 main 树重新 build 后 `panel restart`；schema 仍 20（本分支无 schema 改动，未动控制库），面板 7777 应答 200，`web/dist/index.js` 含新文案。剩：O9 的 claude 一段（codex／omp 已过，见 2026-10-26 收尾轮后的那条）；推送已在 2026-10-26 收尾轮按人临时授权执行。接受的偏差记在计划文末（带后缀的成员列表错误码按服务端原句显示、overview 的 needs-you 复用 §13 拒绝句、伪语言扫描未覆盖该区域、集成趟的 multi skip 无测试、`landedUnrecorded` 对阻塞的 multi run 走「无法证明未落地」的保守分支）。
- **2026-10-26 收尾轮（本会话）**：六条登记缺陷 F1–F6 已修并各自提交（计划 `docs/superpowers/plans/2026-10-26-registered-fixes.md`）。ccloop 侧两条也修好并已推：主题行 `fix(omp): an empty stop that OMP retries is not the phase's answer`（实测 576 行 stream 现在解出 verify JSON，`tokenUsage` 13529；omp 18.10.1 把无 `thinkingSignature` 的 thinking-only stop 当空 stop 并续跑，所以第二个 `agent_start` 合法）与 `fix(perf): pin the young generation so L7 measures retention, not V8 slack`（Node 24 只给 `--max-old-space-size=64` 仍是 256 MB 堆，加 `--max-semi-space-size=1` 后 67 MB；`LIMIT_MIB` 32 未动）；计划在 ccloop 仓 `docs/superpowers/plans/2026-10-26-omp-empty-stop-and-perf-l7.md`；ccloop 分支与 worktree 已清理。
- **repin ccloop → `fe985b0`**（主题行 `chore(deps): repin ccloop to fe985b0 for the OMP empty-stop continuation`）：pin 脚本全 ok（默认解析 E2E 12/12、typecheck、`npm ci` 复现锁），`npm run verify:scheduler` rc 0，48 个真 ccloop 文件 317 过／3 跳（跳的只有 default-E2E，另由 `verify:ccloop-pin` 3/3 覆盖），`ORCA_CONTROL_VERIFY=1` 的 `ccloopProtocol.integration`＋`webCcloopSmoke` 9/9；主仓已 `npm ci`（hidden lock 指 `fe985b0`）。真 agent 验收未跑（见 §4.2 第 5 条）。
- **O9 真 agent 多仓端到端（2026-10-26）**：**codex（gpt-6-luna）与 omp（`local-litellm/deepseek-flash`）都过**。codex 的定稿证据是 `o9-codex-7/`，跑在 pin 上（pin 为 `b97d5bd`，即 `14e2080` 上 origin 后 repin，主题行 `chore(deps): repin ccloop to b97d5bd for the codex strict single call`；固定历史锚点），20 项 checks 全真（`crashAfterAlpha`、`partialObserved`、`retryRestAccepted`、三个 `*Landed`、`betaKeptPersonChange` 均 true），summary sha256 `e649498f…`；omp 证据 `o9-omp-5/`。claude 待额度＋新一次点头（2026-10-26 20:31 CST 探针 `--model opus` 回 429 `usage_limit_reached`：「You've hit your weekly limit · resets 9am (Asia/Shanghai)」）。脚本 `scripts/live-multi-dir-acceptance.ts`（主题行 `test(o9): a live multi-directory acceptance harness, codex and omp`，已进 main 并已推；以该主题行 `git log --grep` 取）。三次都走到「alpha 发布后崩溃 → 进程死亡 → 重启回放 → `partial`（`multi-dir-target-moved:beta`，`pending.landed=["alpha"]`）→ `retry-rest` → 三成员落地」：`drive.dirs` 三个工作区（primary＋`dir-beta`＋`dir-notes`）、alpha/beta 的 `package.json` 为 0.2.0、notes `VERSION` 为 `0.2.0\n`、人的 sibling 保留（`o9-codex-7` 的草稿一次过：单 task、三条写入、`python3` 校验）。验收顺带修掉：`archiveRun` 把 ccloop 的 `<sourceDir>/repos/<key>` 当源证据（多目录 checkpoint 全 `nested-git` → item blocked，主题行 `fix(archive): leave the extra directories' result repositories out of the source capture`）；fixture 的 plan 文件不能落在 alpha 工作树（落地预检 `integration-worktree-dirty` 是对的，改放 `alpha/.git`）；模型自拟的 `git diff/status` 型校验对未跟踪新文件必败（feedback 退回）；`python -c` 型校验在本机必 127（只有 python3；`o9-codex-6` 由此未落地），fixture 现在同样退回（主题行 `fix(o9): hand back a draft whose checks need a python this host lacks`）。`close()` 不等在飞 pump 趟，死亡模拟会打三行 `database is not open`（真关停走 `shutdown()`），属噪声，未改代码。
- ⚠️ **repin 要用 npm 10**：`scripts/pin-ccloop.mjs` 在 npm 11（`/usr/local/bin` 的 Node 24）下会重写锁文件里与本 pin 无关的一批 `peer` 标记，check「the lock pins the commit and changes only ccloop」因此红；用 nvm Node 22.13.1 的 npm 10.9.2 跑则只动 root 与 `node_modules/ccloop`。本轮的门也按 22.13.1 跑。
- **流程边界暂停＋操作者留言（A 程序）已合入 main**（计划 `docs/superpowers/plans/2026-10-26-flow-boundary-pause-and-note.md`，台账 `.superpowers/sdd/2026-10-26-flow-boundary-note/progress.md`；spec 实时转录 §10.5.1／§10.5.2／§10.5.3）：T1–T8 十笔 rebase 到 `7d43c5b3` 后 ff 合入，唯一冲突 `executionDriver.ts` 按 main 的 `skillEnvelopeKey`／`skillFilledRuntime` 重构解，只保留 `operatorNote`（该系列末笔是历史锚点 `a815335a`，已在 main 并已推；以主题行 `git log --grep` 取）。门：`npm test` 597 root 文件 5393 过／1 红（`startForm` ECONNRESET，已登记负载形状，单跑 9/9）、web 159/159；全量 `verify-suite` 675/675 文件 6379 过／34 跳（scheduler 57、chain 13 文件 collected）；web `check` 173/173；build＋web build；`verify:ccloop-pin` 3/3；`verify:scheduler` 209 过；`verify:panel` 14 项全 PASS。台账接受的残余：accept 时的超时分支无独立变异保护、两个并发 accept 可重复应用 mid-run 通道、已停／已完成 run 的 `lastError` 不清。
- **测这些分支用的 ccloop**：`ORCA_CCLOOP_BIN=/private/tmp/orca-ffec7b28/ccloop-fe985b0/dist/cli.js`，`CCLOOP_CACHE_DIR` 用 scratch（本轮 `/private/tmp/orca-ffec7b28/ccloop-cache-flow-note`；清理需人授权）。
- **文档与 skill 收尾（2026-10-26，本会话）**：三仓 README 均以英文重写并已推（Orca 主题行 `docs(readme): describe the panel as it behaves today`；ccloop `docs(readme): rewrite the operator reference`；ccmem `docs(readme): cover the config file, semantic search and maintenance`）。Orca 唯一的 skill `skills/orca-control/SKILL.md` 按当前 CLI 重写为英文：三种项目类型（repository／folder `dir`／multi-directory）及各自拒绝、flows 与其 steering 动词、计划库与 schedules、checks、集成与落地应答、`verify-saved-result` 与 settle-usage、spend caps 与 orchestration；person-only 清单对齐 `src/panel/humanOnly.ts` 的 `VERB_ACCESS`；文件仍 ≤120 行。生成的 references 本就与代码同步（`npm run gen:cli-docs` 写 0 个文件，drift 判据绿）。判据：`vitest run tests/entry/skill.test.ts tests/commands/drift.test.ts` 12/12。`~/.claude/skills/orca-control` 是指向仓内的软链 ⇒ 改仓即生效，无需重装。ccmem 侧另修 `forget`／`pin` 两个从未接线的 verb（ccmem handoff §1.0000）。三仓 `ls-remote` 现测与本地 main 同笔。

### 3.00000000 会话 `0e13a9b7`（2026-10-23）—— 已合、已推；它的待人项人已在会话 `ffec7b28` 全部回复（见那里）

> 唯一进度源：会话台账 `.superpowers/sdd/2026-10-23-session-0e13a9b7/progress.md`（人裁原话、反馈修复、分诊、转录 spec 讨论）＋计划台账 `.superpowers/sdd/2026-10-23-flow-phase1-gaps/progress.md`（每个 Task、裁定、修复轮、判据改写、测试数）。
> 人裁（本会话）：「这个session中，尽量将这些要做的task都完整做完，这个session暂时不要考虑context大小。这次批准改写所有必要的判据。这一轮允许必要的付费真跑。这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」「这一轮如果遇到卡住必须等人的事情，请继续做不必等人的部分……记录到 handoff.md 中。」附件「附件选 (a)」（存储区绝对路径，在工作区外）。越过 T1 已写检查点。

- **合进 Orca main（都 `--ff-only`；未推——以 `ls-remote` 现测）**：
  - **测试者反馈 #91–#96**（修复轮主题行 `fix(requirements): review fixes for the tester-feedback round`）：#92（并 #93）说清装的 ccloop bin 为何用不了＋`orca doctor` 的 `ccloopBinCheck`；#94 一条读不了的组体不再让所有组的概况空白；#95 采用推荐答案合成一行；#96 markdown 子集；#91 停止也给重试。随下面的 schema 18 重启一起装上。
  - **流程第一期缺口**（spec `docs/superpowers/specs/2026-10-22-flow-phase1-gaps-design.md`，**§21 as-built 优先**；plan `docs/superpowers/plans/2026-10-23-flow-phase1-gaps.md`）：46 笔，rebase 到 main 后 ff 合入。schema 17→18（`flow_feedback` 等）；重跑规划、「拿不准」超时＝接受为未变、`hints.equals`；skip／defer／fill 标记与被扣住的对外效果；反馈收取（锚点、分诊、附件存 `$ORCA_CONTROL_DIR/flow-attachments/<sha256>.<ext>`）；图片参数（按 (a)：work 步拿存储区绝对路径，single call 拿给定值）；澄清短标题、卡片显示标题否则两行目标截断；澄清轮修订（有修订在等时拒绝回退：`flow-step-waiting`／`flow-step-parked`）；工具报的花费（工具报 0 当未知、部分求和）；命令／权限／CLI／文案；Web 运行页；开始对话框（左上按钮，人要求；带类型的参数与选图）、FlowSettings、项目设置标题；终审修复。
  - **安全裁定（spec §21，待人审）**：释放被扣住的对外／不可撤回效果在**每条路径**上都要人的权限——defer proceed、替换扣住它的 defer 的 skip、释放效果的 fill、pool raise。人的权限＝Web 上的 owner，或 socket 上 owner 的令牌；member 与派出的 run 一律拒。这是缺口 spec §13「派出的 run 可 fill」的例外；在内核 apply 时强制，open 命令链上有穷举的性质测试。
  - **只给 Web 的读**：`GET /flows/images`、`/flows/settings?dir=` 与附件上传都拒派出的 run；Web 开始不送 `projectId`，服务端由文件夹推出项目（`dirProjectOf`）。
- **已装**：控制库先备份到 `~/.orca/backups/pre-schema18-20261023-230314/control.sqlite`（0600），再 `node dist/cli.js panel restart`；`meta.schemaVersion=18`；迁移自己的备份 `control.sqlite.pre-v17-*` 在库旁；面板在 7777 应答。
- **写好、未实施的 spec**：实时转录 `docs/superpowers/specs/2026-10-23-live-transcript-design.md`——§1–§9 草稿、§10 独立审阅后的 Revision 1、§11 Revision 2（每次调用 stdout 1 GiB 硬上限 ⇒ `output-limit`；`transcript.jsonl` 128 MiB、`events.jsonl` 16 MiB 到限只停记录）。未决：O2（每种 runtime 付费探测密钥遮蔽，先问人）、O3（脱敏成本）、O4（其它页面）；O5 已在 §11 定。**落地顺序**：Orca 先接受 ccloop collect 的 `transcripts` 键并装上，ccloop pin 才动。
- **测试者第二轮分诊**（`.superpowers/sdd/2026-10-23-session-0e13a9b7/tester-triage-20261023.md`，Issues 1–55＋旧条）：人已裁 H1–H5、H11、H12（原话在会话台账）；H6–H10 未裁。要做的在 §4.2。
- **付费与实测（工具给的数）**：claude 2.1.309 `-p --permission-mode acceptEdits` 不加 `--add-dir` 也读得到 cwd 外的绝对路径（两次 $0.00782816、$0.00844611；证据 `/private/tmp/orca-0e13a9b7/measure-read/`）；**codex、omp 未测**。Task 11 沙箱验收（`.superpowers/sdd/2026-10-23-flow-phase1-gaps/task-11-acceptance-report.md`）：A 通过——经 ccloop 的 claude attempt 读到存储区绝对路径（cmp rc 0），tokens 92,842（plan 21,359＋execute 71,483），USD 拿不到；B 开始对话框、运行页通过，卡片截断 PARTIAL（§4.2 第 1 条）。
- **改变了前提、下一位要知道的**：① Rule 17：真 `~/.orca/control/flow-attachments` 里 5 个测试残留文件（12–20 B）来自更早一笔提交的测试；HEAD 上没有测试写 HOME（fake-HOME 的整套 `npm test` 探针；终审前后真存储区逐字节相同）。② 沙箱里的 ccloop 写了真 `~/.cache/ccloop/agent-catalog`（两份 env.sh 都没设 `CCLOOP_CACHE_DIR`；只是缓存、未删）⇒ **以后的沙箱必须 export `CCLOOP_CACHE_DIR`**。③ 其它会话留下 1–3 天以上的 ccloop worker 在跑（未动）。④ 控制器的错（已记台账）：10A／10a 报告文件名在大小写不敏感的文件系统上撞名（从 transcript 找回）；10-B I2 裁定（送看板的 repoId）错了、已更正；之前说 ccloop 的 claude 跑 `--output-format json` 是错的（它流式读 stream-json 但一行不留；`--output-format json` 是 Orca 自己的 chain 启动）。⑤ 本会话没改钩子 ⇒ 合并后**不必**重启 Orca 树里开着的 Claude Code 会话。⑥ 经人要求：`~/.zshrc` 加了 `ORCA_CCMEM_BIN`（备份 `~/.zshrc.bak-20261023-orca`）；orca-control skill 经 syncskill 装上（备份 `~/.syncskill/config.json.bak-20261023-orca`）；`/private/tmp/orca-b37f7ce9/` 已删到只剩还要用的（`ccloop-fbd3512` 测试 bin、`ccloop-d02b9d2` 回退 pin 的 build、`wechat-acceptance`、`logs`）。⑦ `known-load-flakes.md` 新增三行（会话 `0e13a9b7` 一节）。⑧ scratch 在 `/private/tmp/orca-0e13a9b7/`。

### 3.0000000 会话 `b37f7ce9`（2026-10-22）—— 已合、已推、压缩

> 台账 `.superpowers/sdd/2026-10-22-session-b37f7ce9/progress.md`。人在会话 `0e13a9b7` 对它的审阅清单回「其他都同意」、`agents.json.draft.json`「旧草稿不用找回」、push「已做」；它写下的缺口 spec 已在 `0e13a9b7` 实施（见上）。

- 合进 main 的：**CLI v2**（spec `2026-10-21-cli-v2-design.md` §14–§16＋文末 Correction；一张命令登记表生成 CLI／单个 MCP 工具／skill references；`orca <domain> <action>`，旧名无别名；开发工具在 `orca dev`；socket 三档；`orca login|logout`；`by`／`via`；`ORCA_DISPATCHED_RUN`）；**检查与触发器**（schema 15→16，`orca check …`）；**流程引擎第一期**（spec `2026-10-22-flow-engine-design.md`＋§25 as-built；schema 16→17；vault `$ORCA_VAULT_DIR`；内置模板 `wechat-article`；`flow-start` 只接受已登记的 `dir` 项目、`--repo` 模式的面板起不了流程；流程子组不受判据保护；检查设置的 socket 分档——这三条控制器决定人已同意）；repin ccloop → `fbd3512`。syncskill 第二期的 spec 按人裁「直到原来这个session该做的task做完，我们就不继续开始做后续的spec」没开。
- **codex 额度 2026-10-27 14:49 恢复后的第一件事**：真 codex 验收 ccloop 新 strict wire schema（provider 拒收 ⇒ 修 schema 或 pin 回 `d02b9d2`）。
- 公众号流程沙箱验收后推草稿，第三次**成功**（人确认「我在公众号草稿箱已经看到了这篇」，发布由人）；各次付费数在台账。md2publish-skills（人的仓）的 `--confirmed-by-orca` 开关已推（cover 带开关也另存新文件，人裁），该仓 `check.sh` 的「SVG→位图降级链」一项改动前就红。claude 的 USD 拿不到（ccloop 不保留 `total_cost_usd`）。
- 仍成立：① 「合并后重启 Claude Code 会话」只在**钩子串变了**时适用（钩子在会话启动时读入；那次是 `src/cli.ts gate` → `dev gate`，旧会话会把所有 git 命令拦死）——钩子没变就不必。② 子 agent 看到的 `orca level` 报的是父会话的数，派活时要明说。③ `node_modules` 里有 `yaml`。④ 方向人裁「同意」：先做只读的实时转录＋边界干预，真正中途插话以后按能力逐家开放（从 omp、codex 开始）——已写成 spec（见上）。

### 3.000000 会话 `8b1469ea`（2026-10-21 晚 → 10-22）—— 已合；其四份 spec 已在会话 `b37f7ce9` 实施

> 唯一进度源：`.superpowers/sdd/2026-10-21-session-8b1469ea/progress.md`（人裁原话、每条线的提交、测试数、改过的判据、变异、付费数；末尾有一条 **CORRECTION** 记录被人否掉又被替换的「读写声明」做法）。
> 人裁（本会话）：本轮忽略上下文大小（越 T2 继续，检查点已记）；「现在是破坏性大改的最好时候…看如何做是全局最优的」——已写进 `docs/handoff/goal.md` P1。

- **合进 Orca main（都 `--ff-only`，未推——以 `ls-remote` 现测；按主题行 `git log --grep` 取）**：
  - 控制库备份 `~/.orca/backups/schema15-cutover-1792586473769/` 后面板已重启两次，现跑 main 上 `test(web): count the two new enum families…` 那笔的 build，`schemaVersion=15`（本会话没有 schema 变更）。
  - **repin ccloop → `76b098b`**（priorFailures）＋ **阶梯 L1**（失败任务自动重派一次并带上之前的失败）。
  - **#88** 隐式边按显式依赖的拓扑序定向（不再按 taskId 字典序，测试者那份 15 任务拆分不再成环）；**#89** 拆分校验里 `buildGraph` 抛错改为普通校验失败（草稿退回、run 关闭、可重试／归档）；「达成共识」前对未答问题弹确认（文案按真实行为：未答问题记为未决，拆分提示**不会**自动采用推荐答案）。
  - **#86 澄清分档**（spec `2026-10-21-clarify-scope-caps-design.md`）：模型首轮给 scope×clarity，代码按档定上限（小 1 轮/3 问、中 2/5、大或模糊 3/5），到上限停、人可「再澄清一轮」、人可改档；**旧需求按「大」档**（已超 3 轮的答完当前轮就停）。**#84** 中英文统一 K/M/B；**#81** 菜单点外面／Esc 关闭；**#83** 已答轮折叠、推荐答案只显示一次；**#87** 「正在起草第 N 轮问答／任务拆分」＋已等待时长。
  - 文档：`goal.md` 整篇重写为 P1–P7（主题行 `docs(goal): rewrite around principles`，旧全文从其父提交取）＋ P7 修订（重跑由代码划候选、模型只能提议跳过）；三份 spec＋两份调研（见下）。
- **付费（工具报的数）**：真 claude `--scenario decision`（`76b098b` build、claude 2.1.306、claude-opus-5-5，输出在 `/private/tmp/orca-8b1469ea/acc-claude-decision`）**通过**，$0.622287，203962 token，1 条 major 决定落账。
- **设计轮产出（都只是 spec，未实施）**：
  - **CLI v2**：`docs/superpowers/specs/2026-10-21-cli-v2-design.md`（**§14–§16 优先**）——一张命令登记表生成 CLI／MCP（只一个工具）／skill references；`orca <domain> <action>`；开发工具移到 `orca dev`；revision 改可选 `--if-revision`；只限人的操作分三档（放开／要人的令牌／Orca 派出的 run 一律拒），记录 `by`（担责的人）＋`via`（途径）。
  - **检查与触发器**：`docs/superpowers/specs/2026-10-22-checks-and-triggers-design.md`——集成检查（默认关）、模型审阅（**默认开**，只在组间冲突合并或组改了同一批文件且距上次 ≥7 天时跑，只审 Orca 合进本地目标的组，keep/PR 不审）、用户定时检查，统一为「检查种类＋触发器＋水位线」；设置项目 ＞ 全局。
  - **流程引擎（方案 B）**：调研 `docs/research/2026-10-21-flow-engine-research.md`、方案 `docs/research/2026-10-21-flow-architecture-options.md`、spec `docs/superpowers/specs/2026-10-22-flow-engine-design.md`。一套引擎跑开发／写作／办公／游戏／UI-UX；第一期＝写作／公众号模板跑在新内核上、开发流程不动；不要求声明读写（事后记录）；澄清（grilling 式）保留为核心、模板可选三层跳过；对外动作三档（默认执行并标红，不可撤回默认先确认）；模板分层 个人＞共用＞内置；skill 经 syncskill 按 git ref/SHA 钉版本、管理员安装；纠正两小项与 #76 并在其中。
  - **ccloop 每契约工具规则**：ccloop 仓 `docs/superpowers/specs/2026-10-22-per-contract-tool-rules-design.md`——流程引擎第一期的前置。
  - 组间依赖边 v2：只定方向（计划文件可声明组依赖；agent 在确认时提议边、先连后标红），**暂不实施**。
- **改变了前提、下一位要知道的**：① scratch 一律放 `/private/tmp/orca-8b1469ea/`（`~/.claude` 下 claude 拒写）；② **sqlite 打开源库一律 `file:<path>?mode=ro`**——本会话一次猜错路径，sqlite3 在 `~/.orca/panel/` 新建了空文件（已删，台账有记）；③ `~/.claude/skills/tech-writer{,-deslop,-voice}` 软链已改指 `/Users/biran/code/skills/skills/runskills/skills/*`（人授权）；`~/.syncskill/config.json` 里 `runskills`、`aifusion` 两个本地源仍指旧路径（未改，登记）；④ 台账漏记人的否决会让子 agent 拿旧版本写设计——每条人裁、包括「否掉某方案」都要当场记。

### 3.00000 会话 `9ec98639`（2026-10-21）—— 已合、压缩

> 台账 `.superpowers/sdd/2026-10-21-session-9ec98639/progress.md`。其 L1 分支、付费重跑、面板重启都已在会话 `8b1469ea` 完成。

- 合进 main 的：kanban＋自动编排 S1–S5（schema 14→15）；系统 debug 组＋阶梯 L2／L3；保护验收依据（自动审阅员是一次完整 debug run）；估算挂起；#65 仓库内计划路径登记；纠正写回 ccmem（面板 flag `--ccmem-corrections`，默认关）；repin `71d650c`；读 ccloop 的 `failureCause`／`contextWindowSource`、失败原因的下一步文案、额度等待；H2 harness 30 s 窗口。人已同意其三处偏离（L2 是叠在原组上的 debug 组；系统 debug 不经估算；审阅员是完整 run）与 ccmem SIGTERM 次序修复。
- 仍成立：闸门拦下 `-C $VAR` 后停下、不换写法重跑；工作树软链 `node_modules`／`web/dist` 时不许 `git add -A`；子 agent 单次 200 轮上限，长线分片落地；ccloop 全套在本机负载下不能当门，红了先和未改动 main 交错对比。

### 3.0000 会话 `308b874c`（2026-10-20 晚）—— 已合、压缩

> 台账 `.superpowers/sdd/2026-10-20-session-308b874c/progress.md`（人裁原话）。它留下的 spec 都已在会话 `9ec98639` 实施（见上）。

- 合进 main 的：`restart` 发现已存 PATH 缺 agent 目录时 warning（#72）；repin `86f6123`；门「唯一那遍按目录核对＋JSON 报告」；`panel install` 重装保留 shell 没设的已存捕获变量；**agent 版本自动刷新**（遇 `agent-version-drift` 自动改表里 `version` 并重派一次；`GET /api/control/agents` 至多 60 s 静默刷新；`orca agents refresh`；只改 `version`、保留表里其它未知字段）；估算被拒文案 #70／#73／#58；goal.md P2（原 §1.4；确认后自动开跑、一个组等人不拖住别的组、先落地再标红）。
- **仍成立的前提**：① Orca 闸门 hook 解析不了 `cd $VAR`／`-C $VAR` ⇒ 用绝对路径；② auto 模式分类器会拦「经 agent 转达的人的批准」与改 agent 权限的命令，被拦就停、交人；③ 沙箱里的 `ps`／`pgrep`／`launchctl` 看不全，判 ccmem daemon 活没活看锁行心跳；④ 给人 `panel install` 命令前先读已存的 `service.json`。
- 仓库外（Rule 17，经人同意或人执行）：`~/.orca/agents.json` claude 2.1.304→（人改）`bypassPermissions`（备份 `.bak-20261020`、`.bak-20261020-perm`；验收脚本仍用 acceptEdits）；`~/.codex/config.toml` 被真 codex exec 追加 `[projects."<worktree>"] trust_level`——人裁允许，2026-10-26 起每轮跑完按人裁清掉（见 §3 副作用条）。

### 3.000 会话 `3d229487`（2026-10-20）—— 已合、压缩

> 台账 `.superpowers/sdd/2026-10-20-repin-decisions-contract/progress.md`。人已在会话 `308b874c` 审过并同意其中的判据改写与三条未回复的裁定。

- 合进 main 的：repin `af4ad33`（decisions／debug）；控制 run 写决定 Task 12 契约测试（决定 spec §3.1 对真 ccloop 输出接通）；验收脚本 `--scenario decision`；undo.how 词法谓词剥标点；决定分级小项；排队估算 `withdrawn` 终态；`test-affected` 缺口。
- **仍成立**：真 claude 报决定少而准、omp 全报 minor；本机 `npm ci` 会卡在代理 ⇒ 杀掉加 `--fetch-timeout=60000 --fetch-retries=5`；工作树软链 `node_modules` 跑 `npm test` 还要软链 `web/dist` 并设 `ORCA_CCLOOP_BIN`（pin 那笔的 build）；zsh 里没加引号的 `$FILES` 不分词——批量传测试路径用数组。

### 3.000a 会话 `3831d12f`（2026-10-20）—— 已合、压缩

- 合进 main 的（台账 `.superpowers/sdd/2026-10-20-repin-w2-test-split/progress.md`）：repin `d5772fb`（#80）；W2（#47 常驻操作栏、#56 原因码说人话、#57 键 `r` 重试、#72、#15）；**测试范围＋发版门**（spec `2026-10-20-test-scope-and-release-gate-design.md`，`CLAUDE.md` Rule 18：`npm test` 按改动选、整套是 `test:all`、`npm run verify` 没有 `ORCA_RELEASE_TAG` 就 exit 2——**靠自觉的软限**）；**agent 报决定 Orca 那半**（collect 接 `decisions`／`debug`；账本 decision 行可选 `importance`，缺省读作 major；新 kind `implementation`；面板默认只显示 major；needs-human 计数只算 major）。ccloop 那半在 ccloop spec `2026-10-20-reported-decisions-and-debug-design.md`（§10 as-built 优先）。
- 仍成立：子代理**写不了** `.superpowers/sdd/` 下的报告文件（让它放在最终消息里、控制器落盘）；逐文件挑测试会漏，合入前跑整个镜像目录；人的 Chrome 有 Vimium，单键会被吞；门提速候选在 `.superpowers/sdd/2026-10-20-repin-w2-test-split/gate-speed-survey.md`（**人还没裁**）。

### 3.000b 会话 `f3a75a90`（2026-10-19 → 10-20）—— 已合、压缩

- 合进 main 的：「纠正 ⇒ debug task」15 个任务（spec `docs/superpowers/specs/2026-10-18-correction-debug-task-design.md`，§12 与文末「Correction (as built …)」优先；台账 `.superpowers/sdd/2026-10-18-correction-debug-task/progress.md`）；外部反馈 `orca_archived_files/issue-20261008.md` 第一批（分诊表 `.superpowers/sdd/2026-10-19-issue-convergence/triage.md`；#72 服务 PATH、#80 Orca 侧整块解码、W1）；ccloop `fix(control): decode control stdin once over all bytes`（#80 真根因）。门的数见 §3.4；Task 15 变异 212 条 209 红（3 条绿＝冗余的去重／被前置守卫遮住，台账勘误、不改代码）。
- **改变了前提、仍成立**：① 「已关闭」只看目标 ref 的树里有没有关闭行（`correctionState.ts`），`alreadyCommitted` 排除 `refs/heads/orca/*`、`refs/orca/*`、`refs/ccloop/*`；② 没有原契约时打开 debug 可带 `checks`（与原契约**取并集**，mark 记来源）；③ 复现命令按 ccloop 跑检查的方式执行（`sh -lc`、继承环境），**以 Orca 身份、在 ccloop 沙箱外**；④ reconcile 后自动生成的 `git revert --no-edit <attemptSha>` 可能撤不干净；⑤ 控制库仍是 schema 14，但合入后新建的 run 体旧版 Orca 读不了（人已于 2026-10-20 备份 `~/.orca/control-bak-20261020`）。
- **事故教训**：hook 报的「orca level」是**父会话**的数，子 agent 别据此停工；Orca 闸门会把带子 shell／`( … )` 分组的命令按 Tier 0 拦下（拆成简单命令即可）。

### 3.00 会话 `b304f167`（2026-10-18 晚）—— Decisions 页撤回（已合、人已审）

- **「Decisions 页：查看已审＋撤回审阅／撤回纠正」已合进 main**（首笔主题行 `feat(panel): reviews gain a withdrawn action and a latest-row review state`）。spec `docs/superpowers/specs/2026-10-18-decisions-review-withdraw-design.md`（**§10 优先**）；台账 `.superpowers/sdd/2026-10-18-decisions-review-withdraw/progress.md`。控制器替人定的点**人已审、同意**（会话 `3d44b2fb`，台账末节）。
- **做成了什么**：审阅行只追加 `withdrawn`，每人以文件顺序最新一行为状态（写入方、覆盖率、`orca compact-reviews` 共用）；纠正的撤回写进 `~/.orca/correction-withdrawals.jsonl`（0600，`ORCA_CORRECTIONS_DIR` 改道；`corrections.jsonl` 不动）；指标去掉撤回的纠正、多 `withdrawn_corrections`；`POST /api/reviews/withdraw`、`POST /api/corrections/withdraw`；**已关闭的纠正不能撤回**。该计划末尾 Amendment 的各项已由 debug 计划 Task 6／10／11 实施（在 §3.000 的分支上）。
- **门的 fake 表要点**（全新 clone，`ORCA_CCLOOP_BIN=/private/tmp/ccb6-qswQ/ccloop/dist/cli.js`，只指 fake 的 `ORCA_AGENTS_TABLE`）：每个 `command` 是单元素数组、包一层 shell 脚本；**codex 用 `integration` 模式并带 marker**、`version` 填 fake 自己答的 `--version`（codex `9.9.9-fake`、omp `18.10.1`）；**不要 export `GIT_AUTHOR_*`**。缺 marker 的 fake 会在 cwd 写出 `undefined.argv`（会话 `3d44b2fb` 在主仓根删过一个）。
- 未测：真浏览器里没看过；延后 minor（写入方并发守卫变异 M4b/c/d 无确定性判据等）在台账。候选清单「能用代码替代 agent 的尽量用代码」：`.superpowers/sdd/2026-10-18-decisions-review-withdraw/code-over-agent-survey.md`。

### 3.01 会话 `1710772d`（2026-10-18 下午）—— 控制 run 写决定

- **「控制 run 写决定」已合进 main**（22 笔，首笔主题行 `feat(control): read reported decisions through one adapter`；未 push）。台账 `.superpowers/sdd/2026-10-18-control-run-decisions/progress.md`（全部 `Ruling:`、延后 minor、已知缺口、门的数）。
- ✅ **控制库 schema 13 → 14（单向）已完成**：人在会话 `3d44b2fb`（2026-10-18）先备份到 `~/.orca/backups/schema14-cutover-1792329773353/`（`control.sqlite`＋`accounts.sqlite`，`sqlite3 .backup`，文件 0644、目录 0700），再 build 主树 `dist/` 与 `web/dist` 后重启服务；现测 `meta.schemaVersion=14`、`pending_decisions` 表在。旧版 Orca 已不能开这个库；回退用该备份（做法同 `2026-10-12-live-service-cutover.md` §撤销）。
- **没接通**：Task 12 阻塞在 ccloop 报 `decisions[]` ⇒ spec §3.1「agent 自己的决定」还没接通；`push-target`／`push-branch`／`github-pr` 合入未测；已知缺口：不同身份并发 reject 可各记一条、reject 输给 approve 时留孤儿 correction（交给 debug 计划）、E/D 的 reconciling 检查与 CAS 之间有窗口、approve/reject 串行只在单进程内。
- 人裁：`attemptSha` 进 evidence（台账 spec ERRATUM 8）；姊妹仓合并规则已对齐。

### 3.0 会话 `a3b2a7a7`（2026-10-18）—— 设计轮（其三份 spec 已全部实施）

**这一轮只做了设计与计划，产品代码一行没动。下一轮先实现**（人：「下一轮先实现再写后续的 spec」）。

- **三份 spec＋三份计划**（都按 brainstorming 走：人裁、builder check、独立审阅一轮、审后修订；修订是控制器在人的「这一轮有问题先按你的建议执行、最后报我审」授权下定的）：
  1. **控制 run 把决定写进账本**——spec `docs/superpowers/specs/2026-10-18-control-run-decisions-design.md`（**§10 审后修订优先于正文**）、计划 `docs/superpowers/plans/2026-10-18-control-run-decisions.md`（12 个任务，Task 12 等 ccloop）。**先实施这份。**
  2. **纠正 ⇒ 独立 debug task**——spec `…/2026-10-18-correction-debug-task-design.md`（**§12 审后修订优先**）、计划 `…/plans/2026-10-18-correction-debug-task.md`（15 个任务，依赖第 1 份的接口；两份计划末尾同一节「Cross-plan resolutions」裁了六处接缝）。
  3. **ccloop：Codex 阶段隔离**（item 3）——spec 在 ccloop main（`docs/superpowers/specs/2026-10-18-codex-phase-isolation-design.md`）；计划 `docs/superpowers/plans/2026-10-18-codex-phase-isolation.md`（会话 `1710772d` 已 `--ff-only` 合进 ccloop main，分支与工作树已删）。
- **人的裁定**（原话都在各 spec §2，不复述）：纠正派给独立 debug agent（默认原 agent＋模型、必须新 session、人可换）；`undo.how` 人填可选、不填由机器写；合入才算关闭、**不加「等待合并」状态**；纠正也可指向 run（本轮只做 `decisionId` 与「被拒决定」两种，裸 run 目标延后——人说「当前基本无效」）；以 agent 报的决定为主、代码模板这轮只接「自动调和」；账本在目标仓 `.decisions/`、随落地提交走；过不了撤销检查的决定 task 照常完成、UI 显示「需要人确认」；Codex 阶段不带任何个人 skills／AGENTS.md／hooks／MCP，命令仍用真 HOME。
- **`goal.md` 新增两条操作原则**：§1.1「agent 能做的尽量替人做、人少填、保留改默认值」；§1.2「所有动作在 Web UI 能完成、agent 通路能走完全流程、不依赖命令行」。新设计的完成判据要点名 UI 与 agent 通路。
- **Tier 0 闸门放宽**（主题行 `feat(gate): let agents do the forms git protects; keep push and forced forms Tier 0`，闸门 spec §11）：agent 现在可以 `git merge --ff-only`（含进 main）、`git branch -d`、不带 force 的 `git worktree remove`；**push 仍由人做，且人统一择时推——不要提醒人 push**。
- **核实过、改变了前提的事实**（都带出处，引用前现测）：控制路径**一个决定都不写**（唯一写者是 `src/scheduler/ledgerWiring.ts`，控制计划是 `out-of-repo` 且不经 round 函数）；控制派活**只看显式 `dependsOn`**、落地是谁先做完谁先合（老调度器的「隐含依赖」「落地顺序」在控制路径无对应）；`undoHowIsExecutable` 是**词法**谓词：`git revert 3f9c2a1b7e` 判 false、`git revert --no-edit <40 位 sha>` 判 true；`alreadyCommitted` 用 `git log --all`，会命中 group 分支，**不能当「已合入」判据**；`writeImportedPlan` 总会插估算行（「打开不花钱」要新模式）；`~/.orca/corrections.jsonl` 不存在（这台机器上一条纠正都没有）。
- **ccmem 侧本会话做完的**（细节 ccmem handoff）：plist「in_sync 却不同」不是误报，是 CLI 不打印差异（已修）；`run-tests.sh` 的 `TMPDIR` 泄漏（已修，925/925）；付费对照 A（claude＋omp）已跑，codex 一项与 OMP D/E 未测。
- **上下文**：越过 T1（检查点 `chore(checkpoint): orca-dev-a3b2a7a7, …` 在 main），人明说本会话不计上下文。

### 3.1 已经做成的（都在 Orca／ccloop main 上）

- **CLI**（CLI v2 Task 7 起，`src/commands/registry.ts`）：`orca decision validate|metrics|compact-reviews`、`orca plan preview`、`orca agent init|show|refresh`、`orca dev level|gate|checkpoint write|resume|chain start|stop|unlock|check-append-only|correct`，加 `panel／control／mcp serve／user`；旧顶层名到 Task 14 删除；**Task 7 之前分出的 worktree 过不了链的闸门检查（`src/chain/gateCheck.ts`），须重建或 rebase**；全局 `orca` shim（跑 `dist/`，pull 后先 `npm run build`；新 pin 后主仓先 `npm ci`）。**`orca run` 已退役**，跑一轮只走面板／控制路径。
- **面板服务**：`orca panel install|uninstall|start|stop|restart|status|logs`；整站登录（owner／member、CSRF）；`<stateDir>/control.sock` 给 agent（`orca control get|send`、`orca mcp serve`、`skills/orca-control/`）。重装服务只记录当前 shell 里具名的 `ORCA_*`，先 `--dry-run` 比 `service.json`。
- **执行链**：执行驱动（worktree／clone、落地 `orca/<group>`、解冲突 run、N 路并行落地）、handoff 投递与续跑（含交接停止＋未知用量的 `recovered` 出路，spec `2026-10-14-handoff-stop-unknown-usage-design.md`）、single-call 预估链、N1 澄清→拆分→确认、loop 方案层、合入方案（`local`／`push-target`／`push-branch`／`github-pr`）、花费上限、Results、Activity。
- **估算**：确定性修复＋一次自动重试＋指令 v2（spec `2026-10-17-estimate-usable-answer-design.md`；台账 `.superpowers/sdd/2026-10-17-estimate-usable-answer/`）。`~/.orca/profile.json` 已是 `instructionVersion: "2"`。
- **agent kind**：claude、codex、omp；三种 skill 注入（claude `--plugin-dir`、codex `codexSkillsDir` 每 phase 临时链、omp `ompSkillsDir` 的 `<skills>` 清单，**OMP 永远 `--no-skills`／`--no-extensions`**）。single-call：claude `"v1"`、codex `"v1-soft"`（输出上限事后核对、只在 soft 估算模式接受）、omp 按目录行（方案 A＋按目录上限预占）。
- **ccloop 目录缓存**：`$CCLOOP_CACHE_DIR`（缺省 `~/.cache/ccloop`），键含二进制与配置 stamp、30 分钟、版本号也缓存；codex single call 在**每个安装键一对复用的私有 `HOME`／`CODEX_HOME`**（`<cache>/codex-home/<sha256>/`，链 `auth.json`／`config.toml`、从不删正规凭据，挪成 `.displaced-<ms>`）。模型清单 API 与 web datalist。
- **错误码**：ccloop 进程失败答 424 `ccloop-failed:<码>[: 细节]`（例外：`apply-agent-update` 仍 500）；「组在执行」单一判定（`src/control/executionPending.ts`），执行中 `start` 答 409 `group-execution-pending`。`set-task-loop` 在组 `running`／`review`／暂停时也能改**未开始**的任务。omp clarify／split 的上限拒绝不自动重试，人点 group 重试时按冻结的 `agentSlot.selection` 重算上限。web 统一经 `web/src/ccloopCodes.ts` 解释码（兜底文案不说「ccloop」）。
- **纠正 ⇒ debug task**（会话 `3d44b2fb`／`f3a75a90`，spec `2026-10-18-correction-debug-task-design.md`）：纠正开独立 debug group、复现优先检查、落地带关闭记录、「已关闭」＝目标 ref 的树里有关闭行、只限人的记录／人工关闭／撤回 verb、Decisions 页里的纠正列表。**付费端到端与推送类合入方案的关闭都没验过**。
- **Decisions 页撤回**：撤回自己的审阅／未关闭的纠正（§3.00）；撤回记录在 `reviews.jsonl` 的 `withdrawn` 行与 `~/.orca/correction-withdrawals.jsonl`。
- 控制库：**schema 20、单向**，真实 `~/.orca` 已迁到 20（2026-10-25 会话 `ffec7b28` 的 scheduled 装库，备份 `~/.orca/backups/pre-schema20-20261025-023827/`；19、18 的备份见 §3，15 的备份 `~/.orca/backups/schema15-cutover-1792586473769/`，14 的见 §3.01）（切换与回退：`2026-10-12-live-service-cutover.md`）。Linux systemd 用户服务跑通过一次（两仓全量没在 Linux 跑过；`2026-10-12-followup-acceptance.md`）。

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

**没在真 agent 下验过**：依赖、崩溃恢复、strict 组、真 codex 下的 handoff 与冲突、真 claude 的 single-call 估算、混 kind、带 skills 的 verifier／多任务、OMP 带 skills 的真 provider 跑、正式 owner 登录后的 Results／Memory、`push-*`／`github-pr` 合入。
**Codex 只支持 `phase-end`＋`soft`：任何地方不许宣称 strict token 封顶**；软 token 预算也不能说成严格金钱上限。

### 3.3 仍然成立的结论与残余（来自已压缩的各轮；全文在所列台账）

- ⚠️ **R7 已生效**：真实 profile 下 omp 与 claude-1M 的导入**真跑付费估算**；`framingTokenOverhead`＝12000（人裁），`contextWindowTokens` 仍 null（改它会让所有 kind 都真跑估算，归人）。
- **排队估算的 `withdrawn` 终态已实施**（会话 `3d229487`，§3.000 第 6 条；spec `2026-10-17-estimate-usable-answer-design.md` 末尾 Correction 节）。停在开跑前（stopped pre-start）的组的排队估算已改为「挂起」（会话 `9ec98639`，spec `2026-10-21-estimate-parking-design.md`）。
- **Codex single call 残余**（spec `2026-10-15-every-agent-requirement-chain-design.md` **§11 优先于正文**）：refresh token 经软链轮换未验；keyring 存凭据时 fail closed；worker 的 `ccloop-agent-catalog:` 日志无生产 sink；一行提示的框架开销工具报 **10109–11590 token**（OMP 约 2047）；`notify=[]` 是否真挡住人的 notify 程序未量。
- **OMP**：omp 18.10.1 对 `127.0.0.1` 也走 `HTTP_PROXY`、启动时探测本地 ollama（fake 上游要吃掉意外请求）；**不把任何本机选择器设为默认**；一次验收是 pilot 不是可靠性。
- **谱系与用量**：`lineageWorkUsage()`（`src/control/usageSettlement.ts`）是谱系求和唯一规则；work 剩余为 null 只在三层上限都缺时出现；spawn 前中止 ⇒ `neverStarted` 记 0，目录行不可解析 ⇒ 用量 null。
- **Rule 17 事故遗留**：会话 `4de777f4` Task 7 往真 `~/.cache/ccloop/agent-catalog/` 写过路径，该删的只剩两项（§4.1）。**人用真面板时跑门**会让 Rule 17 守卫在文件级报红（面板写 `~/.orca/control/panel`），挑人不用面板时跑；门脚本的 `~/.cache/ccloop` 比对会被运行中的面板服务改写（服务按设计用真缓存）。
- ⚠️ `ORCA_CCLOOP_BIN` **不能**指 `node_modules/ccloop/dist/cli.js`（npm 包不带 `tests/fixtures`）⇒ 指一份 build 过的 ccloop `clone --local`。`taskResultPaired` 两条硬编码 `/private/tmp/…`，**不设变量也红**，是固定环境红。
- **repin 的做法**：只在装了真实 `node_modules` 的工作树里 `node scripts/pin-ccloop.mjs <40 位 sha>`（它会 `npm install`；**别在软链 `node_modules` 的树或主仓跑**），且只在人推了 ccloop 之后；必须用 npm 10 跑（原来实测的是 nvm Node 22.13.1 的 npm 10.9.2；2026-11-07 起 nvm default 22.23.4 带 npm 10.9.9，它下面锁文件是否同样只动 root 与 ccloop **未实测**，会话 `b5e3c5a8`）——npm 11 会重写锁文件里与本 pin 无关的 `peer` 标记，锁检查因此红；repin 门要拿那个 sha 的 ccloop build 作 `ORCA_CCLOOP_BIN` 跑 `verify:scheduler` 与真 ccloop 特性文件（JSON reporter 证明 passed 不是 skipped；会话 `3d229487` 的做法：`tests/scheduler`＋`grep -rl ORCA_CCLOOP_BIN tests` 的全部文件，再带 fake 表、`ORCA_CONTROL_VERIFY=1` 跑 `ccloopProtocol.integration`＋`webCcloopSmoke`）；全新 clone 跑门先 `npm run build --workspace web`。`ORCA_CCLOOP_BIN` **别指姊妹仓工作树的 `dist`**（不等于 pin，真 ccloop 文件会假红）。
- **Codex 隔离的付费教训**（P1／P1b，会话 `a852f96a`）：MCP 名单必须在**同一套隔离**下列（在真 `~/.codex` 下列出的名字给隔离配置下关闭项会让 codex 配置加载失败、零请求）；codex 的 `error` item 当诊断、不当失败；按已装 codex 的 `features list` 过滤要关的 flag。
- known-reds 名单只加了 `codexAdapter` outer watchdog；`verifySavedResult`「r1 command interruption…」已查清并在 ccloop 修掉（会话 `9ec98639`：macOS 对已退出未回收的进程组 `kill()` 回 EPERM）。
- **仓库外由 agent 经人授权改过的**（Rule 17 记录）：`~/.orca/agents.json`（备份 `~/.orca/backups/agents.json.bak.20261017`；claude／codex 保留 nvm 稳定路径，不用 cmux 临时 shim）、新建 `~/.orca/projects.json`（0600）、`~/.orca/profile.json`（备份 `profile.json.bak-20261017-v1`）；ccmem 的 `core.hooksPath` 已 unset；三仓 Qoder `post-commit`／`post-checkout` 钩子已备份后删除。
- 本机：`/opt/homebrew/bin/node` 坏（缺 libsimdjson）；nvm default 是 22.23.4（有 fts5；2026-11-07 起，会话 `b5e3c5a8` 现测；旧终端里 22.13.1 仍在 PATH 首位）；`/usr/local/bin/node` 是 24.13.0（正式服务用它）。真 Codex 只用 `gpt-6-luna`（`gpt-6-sol` 无额度），每次付费先问人。

### 3.4 最近一次可引的门（**历史观测，引用前现测**）

- **最近一次全量门＝debug 分支 Task 15 的全新 clone 门**（会话 `f3a75a90`，2026-10-19，观测提交＝分支 rebase 前的 `05a191c2`，`ORCA_CCLOOP_BIN`＝`/private/tmp/ccb6-qswQ/ccloop`，即旧 pin `02cbacc` 的 build）：旧 `npm run verify` exit=0，全量 4273 过／33 跳过／0 红，`~/.orca` 哈希不变。**按人裁（`CLAUDE.md` Rule 18），下一次全量门在人说打 tag 之前**，用新的 `ORCA_RELEASE_TAG=<tag> npm run verify`。
- 会话 `3d229487` 合入后在 main 上的 `npm test`（以 `origin/main` 为基，选中 529 文件）：根 3583 过／34 跳过／0 红、web 1152/1152（`ORCA_CCLOOP_BIN`＝ccloop `af4ad33` 的 build）。
- 之后各轮只跑相关测试。会话 `3831d12f` 最大的一次是 decisions-importance 分支 rebase 后的 `npm test`（新的按改动选测试，选中 411 个根文件＋132 个 web 文件）：根 3703 过／31 跳过、web 1142 过、typecheck 与 web tsc 都 0（台账同目录）。
- 会话 `8b1469ea` 合入前的 `npm test`（对 pin `76b098b` 的 build；台账 R2／MERGE 行）：repin 后选中 478 文件，根 4508 过／0 红／37 跳过；最后一支（#86＋UI）选中 539 文件，根 3526 过／35 跳过、web 1195/1195、rc 0。
- 会话 `9ec98639` 各线合入前的 `npm test`（各自台账行有数）：最大一次是失败原因分支顶端（对 pin `71d650c` 的 build），选中 540 文件，根 3553 过／35 跳过、web 1182/1182、rc 0；`schedulerBridge`「success」在负载 10–14 下单跑 3×9/9（机器全天没空闲过）。
- 会话 `b37f7ce9` 合并前的 `npm test`（三条线 rebase 到 main 之后的流程分支顶端，`ORCA_CCLOOP_BIN`＝ccloop `fbd3512` 的 build）：选中 734 文件，根 5374 过／37 跳过／0 红、web 1255，rc 0；其后两笔修复（无改动的效果步、宽松读 effect）各跑一次 `npm test`，最后一次根 5378 过／37 跳过、web 1255，rc 0。
- 会话 `0e13a9b7` 合并前的 `npm test`（流程缺口分支 rebase 到 main 之后；计划台账「Task 11: npm test at rebased」行）：选中 683 文件，根 4816 过／35 跳过、web 1335，rc 0；随后 `--ff-only` 合入并装上。
- 会话 `a98b77d2`（2026-10-26／27）小缺口批合入前的门：根 578 文件 1 红（`startForm` ECONNRESET）、web 159 文件 1 红（`memoryLayout` scroll 时序），都是 `known-load-flakes.md` 已登记形状，单文件各 3/3 绿（负载 14–17）；typecheck、web build、`--ws check` 0。同轮的三条真红（`schedules` 跨 realm、`command.test` 字面量、`projectSwitcher` 时序）已修，见 §3 新节。
- 更早的门都已被取代；flake 判别在 `known-load-flakes.md`。

---

## 四、⛔ 下一件事（按顺序）

### 4.0 2026-11-07 当前接手顺序（人已同意；旧 §4.1／§4.2 是历史清单）

1. **先收本轮配对**：§3 最新一节的 V10 在本地 ccloop 构建已通，安全提交／快进后仍须远端有新 ccloop 提交才可用 `npm run pin-ccloop` repin，再核 `verify:ccloop-pin` 和正式 pin 的配对判据；不要拿 `ORCA_CCLOOP_BIN` 本地覆盖冒充 pin。资金和会计守卫保持严格。
2. **测试者 #145/#160（先议保护边界）**：未估算却可确认默认无限额度仍在，`unestimatedDefault.test.ts` 目前明确钉住该行为。建议让有明确 `human` 上限的用户继续确认，`complex-1m-default` 的无限额必须先应用估算或由人明确接受默认成本；自动确认不得默许无限额。此建议与旧默认行为及既有判据相冲突，先请人定交互和迁移边界。
3. **#174/#173 成本**：判官 200k 只限名义 grant，soft provider 可以单次超出，固定开销和用量波动仍未校准；别把 v3 提示当成 ±30% 实测。#159 三适配器的 execute 解码仍不一致，保留严格坏 final 拒绝同时另立设计。
4. **#179/#167/#168 与体验**：#179 completion 的 summary 已修，CLI next-step 与 Web 入口未做；#167 agent 在 CLI 无法给导入组设总额，#168 拆分可能生成对当前基线不可满足的 npm test，按现场复核后分开处理。#191/#192 成本与延迟排在正确性和支出边界之后。
5. **全量和真 provider**：人本次要求之后再做；若做全量，`TMPDIR=/tmp npm test`，付费每次单独授权。自然额度耗尽时再真验 quota-probe。push 归人。

### 4.1 人做的（agent 不提醒、不代做）

- **push**：本会话的 ccloop main 与 Orca main 都经人**临时授权**由 agent 推过；人 2026-10-26 又自行 push 过一批（含 repin 与 O9 harness）。之后轮次里 handoff 的收尾提交可能在本地领先，push 仍归人，远端一律以 `ls-remote` 现测（本文明文不写当前哈希）。
- **审与裁**：见 §八 第一条（会话 `ffec7b28` 的清单；ccloop P1–P7、M9 已由人确认）。
- 已办（会话 `ffec7b28`，人授权）：`~/.orca/control/flow-attachments` 的 5 个测试残留已删；`~/.cache/ccloop/agent-catalog` 只删了能归到 0e13a9b7 沙箱时段的两条缓存行（`codex-home/` 与其余行保留）。
- `~/.syncskill/config.json` 的 `runskills`、`aifusion` 本地源仍指已搬走的路径（人的文件未动）；ccmem embedding 账号无额度；想开「纠正写回 ccmem」用面板 flag `--ccmem-corrections`。

### 4.2 agent 的活（会话 `ffec7b28` 收尾时的建议顺序）

> 会话 `a98b77d2` 已把 §3 新节的面板小缺口批做完（合入、装上、清完、人已推）；下表是剩余顺序。

1. ~~接着做在飞的 Orca 分支~~ **已全部合入**：live-transcript、dir-requirements、scheduled 三条都在 main 并已装（scheduled = schema 20）。后续分支仍按同一流程：计划 → 变异 → 全量门禁 → 独立审阅 → rebase → ff → build＋web build＋panel restart；schema 动之前先备份。
2. ~~H7（多目录项目）~~ **已合并并装上**（O1–O9，见 §3；schema 仍 20）。剩付费验收见第 5 条。
3. ~~实时转录 Orca 侧的 `operatorNote` 生产方~~ **已做**：spec 实时转录 §2（`live-transcript-design.md:28`）人裁「放在 web 运行页里。orca cli 现阶段不用做」，`web/src/FlowRunPage.tsx` 发 `{command:"note"}`；判据 `tests/flow/operatorNote.test.ts`。
4. ~~登记未修~~ **本轮已清**：Orca F1–F6（计划 `docs/superpowers/plans/2026-10-26-registered-fixes.md`）与 ccloop 的 OMP empty-stop、perf L7（ccloop 计划 `2026-10-26-omp-empty-stop-and-perf-l7.md`）都已修并过门；接受的残余见各计划文末。
5. ~~O9 claude 一段~~ **已过**（会话 `7753e97d`，见 §3）。
6. ~~repin~~ **已做两次**（会话 `3cd8fb02`，现 pin `e25381f`）。
7. ~~#62~~ **已实施、审阅、合入、装上**（会话 `3cd8fb02`）；import 环已拆、m5 已补判据（会话 `e236bbe4`）。下一件可选：**flow call 的用量未知结算**——人裁「之后再看」，先写设计：flow 运行页加同一个「结算后重试」，结算后让 flow 父组与池重算。设计前提（会话 `e236bbe4` 现核）：flow 池恒为有限整数（`src/flow/kernel.ts:234`：启动参数 → 设置 → 模板 → `DEFAULT_TOKENS_PER_RUN`），与组／任务默认的 soft 不限 token 模式（人说的「无限 token 模式」）不同；flow 要不要也默认 soft，是这份设计要人定的。
8. ~~测试者反馈轮~~ **已做完、合入、装上**（会话 `a9f9d6de`）；其后续三件（主题删减、settle-usage 走 CLI、Radix Select 试样）会话 `3ea8a21e` 已做（§3 最新一节）。~~人看 Radix Select 试样后定全量换还是删分支~~ **已全量换、合入、装上**（会话 `b999cc81` 做、`65b4d067` 合入）。`correctionCoarseDebug` 挂住与测试者反馈第三轮**已做**（会话 `4ed8eb65`）；需求页筛选、标签残余、25 万来源、flow 结算设计**已做**（会话 `663fb68e`）；overview (a)＋对比、flow 结算、soft 模式单次调用**已做**（会话 `43913afc`）。任务准备命令／检查要存在／阶梯只重试能修的 **Part A、B、C 都已合入并装上（会话 `af2ceee1`、`e2ad4802`）**；A4、F7/F9/F10/F12、flow 设置被删的缺陷、**failover 已做、合入、装上（会话 `e2ad4802`）**。下一件候选（按序，会话 `86352010` 收尾时）：⓪ ~~人推 ccloop 后 repin~~ **已做**（会话 `86352010` 收尾）；剩 soft loop 的 O19（要准备 saved-result 世界的根、fixture 加 `settle:"none"`）与一次真探针（要真的额度用完）；① 最后 dogfood 的 D1–D5（不重试 `blocked_waiting_human`、开跑后放宽 `targetPaths` 的路、被卡原因进 CLI、skill 补「卡住／审拆分」指引、拆分找钉旧行为的测试），然后 D6、D9、D10、D17、D19、D21；② failover 单次调用与 flow 调用改派（failover spec §4、D5）；③ 测试者 issue 剩余（#144 余项、#157 skill 黄金路径、#159 统一解码、#125 Orca 半边）；④ UI 排版与项目设置位置（人裁 #70，先出设计给人看）。
9. 付费验收（每次先问人）：同前（debug 计划端到端等）；H7 多仓端到端 codex（`o9-codex-7`）、omp（`o9-omp-5`）、claude（`o9-claude-2`）都已过。

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

> 会话 `a3b2a7a7` 删去已了结的条目：历轮「人已裁」长段（结论都已落进 §三／§五 或对应 spec／台账，人回复过的裁定不再待人）、已删除的 Qoder 钩子（会话 `026d10e3` 经人授权备份后删除）、已做的面板／profile／名单／分支删除。

- **2026-11-07 这轮待人／外部状态**：
  1. **push 归人**：Orca 本地 main 的本轮功能、repin 与 handoff 提交，ccmem 本地 main 的滚动 handoff 提交；ccloop 本轮代码和 handoff 已依临时授权推到 origin main。远端以 `ls-remote` 现核，不信这里的陈述。ccloop 的 prunable 测试 worktree 仍归人按本轮给出的命令处理；本轮未替人 prune。
  2. **最终审核（均可撤回，已按人在本轮的授权执行）**：D1–D5、agent 可设全局 `agentTopUpCap`（按组求和）、F13 前台 socket 失败即退出 78、#172 blocked 不占槽／resume 点名、#190 保留完整需求、#198 README 误报、自动 ladder 在无重试额度时跳过，以及 CLI D9 执行状态补字。设计和验证路径在 §三最新一节，边界 #169／#173／#174 留在 §四。
  3. **只能等真实外部事件**：额度用完时的真 `quota-probe` 验收没有自然触发；本轮没有为制造 quota 失败而烧额度。第三方 provider 的 `structuredOutput:"prompt"` 仍缺真实对应 provider。UI #70 的完整排版／项目设置方案仍需人的设计审定。
- ~~会话 `3cfc2e73` 待人~~ **会话 `86352010` 已了结**（三仓人已推；分支人已删；审阅项、三件待定人答「都同意按你的建议走」并已实施，见 §三 最新一节）。
- ~~会话 `e2ad4802` 待人~~ **会话 `3cfc2e73` 已了结**（三仓已推；failover 偏离「同意」；retry-task 权限、F5、F6 人已定并已实施）。原文：
  1. 做：**push ccloop main**（本地含 `fix(setup): the verdict is taken at the shell's exit…`＋plan 跟进；agent 的 push 被 Tier 0 闸门拦，没重试）；推完下一位 agent repin（§4.2 ⓪）。Orca main 的 push 也归人。
  2. 审：failover 的偏离——没加 ccloop 新 cause（复用 `quota`＋`detail`）、休息不建表（从已存 run 推）、顺序放 orchestration settings 而不是 agent 偏好、`quotaWait` 里的安装不换、计划文件点名的 agent 也算手选不换（D2）。As built `docs/superpowers/plans/2026-11-05-quota-failover.md`。**failover 已经在 7777 上默认开**（D1）：有多于一个安装时，quota 失败的任务会被 orca-auto 换安装重试；不想要就 `orca orchestration set --max-running-groups <n> --failover-off`。
  3. 定：`retry-task` 是 `any` actor，新加的 `agent` 字段让 agent token 也能给任务换安装（并把它标成 `task` 来源、从此不再被 failover 换）——要不要只许人用（审阅 Minor）。
  4. 定：F5（转录走 CLI/socket：推翻实时转录 spec ruling 3「v1 has no CLI reader」与判据 T5/T13；建议只开只读 `orca run transcript`，派出去的 run 仍拒）；F6（`orca login` 非 TTY：CLI v2 §15.3 有意要终端；建议加 `--password-stdin` 只给隔离面板测试用，或维持现状）。
- ~~会话 `af2ceee1` 待人~~ **会话 `e2ad4802` 已了结**：ccloop 人已推、Part C 已 repin 合入、Orca main 已装、`/private/tmp/orca-af2ceee1/` 已删、46 条 `Ruling:` 人回「其他都同意」（A4 改为抽公共函数、署名改为按实际模型）。原文：
  1. 做：**push ccloop main**（本地已含 task-setup 系列，门 2492/2492；agent 的 push 被 Tier 0 闸门拦，人授权也拦）；推完后下一位 agent 做 C0 repin、合 Part C（见 §4.2 ⓪）。
  2. 做：**装 Orca main 进 7777**（`npm run build`、`npm run build --workspace web`、`launchctl kickstart -k gui/$(id -u)/dev.orca.panel`；本会话自动模式拒了 restart；无 schema 变更）。Orca main 的 push 也归人。
  3. 审：计划台账里全部 `Ruling:`（约 40 条，含：setup 只跑一次、agent 自己装新依赖；阶梯不再把「重复失败」当跳过条件；不加 features 键、靠 ccloop 严格契约拒绝；setup 时长计入 attempt；集成检查 setup 失败算 errored；验证未收集时阶梯最多等 10 分钟；拆分提示版本仍为 3；`-w .`／父目录／`npm run env` 不拒）。
  4. 清（可选）：本会话留在 `/private/tmp/orca-af2ceee1/` 的 mutation clone（`mut-*`、`mutB-*`，子 agent 删除被拒，按「不替被拒者执行」未删）、两个 dogfood 根、gate clone；Part C worktree `wtC` 要留到合入。
- ~~会话 `43913afc` 待人~~ **人已回复**（会话 `af2ceee1` 开头：soft D1–D6 同意、D4 不做；#117、池子缺口、loop run 跨仓「其他都同意」；codex 额度已恢复；「看」那三处等真数据）；~~failover D1–D6 仍待人~~ 人已定（会话 `e2ad4802`：「其他同意」＋改 provider 并重试的修订，spec §8）、已实施；原文：
  1. 审：soft 模式 D1–D6（spec `2026-11-03-soft-mode-approximate-usage-design.md` §3、§7：无下界记 0 并继续、需求调用跟组走不按 grant 收、花费上限照算、已停住的不自动放行（未做）、不做事后替换、完整答案照用）；flow 结算 As built §9（池子缺口只记名、没有判据）；#117 不改颜色（红是对的，soft 模式消掉成因）。
  2. 定：failover D1–D6（spec `2026-11-03-quota-failover-design.md` §6，建议：默认开、人手选的不换、无重置时间 15 分钟翻倍封顶 8 h、按安装全局、flow 也换、顺序放在 agent 偏好里）。
  3. 给：codex 澄清失败的机器和报错原文（本机真实库里没有 codex 尝试）。
  4. 看（可选）：标签「正在保存」、flow 运行页的结算按钮、需求页「至少」提示，都只在 jsdom 里测过。
- ~~会话 `663fb68e` 待人~~ **人已回复**（会话 `43913afc` 开头：7 条同意、迁移按建议、overview (a)、flow D1 (a)、round 3 三条同意）；测试者数据（25 万差的那部分）与 ccmem §6.2 会话号的原文如下，前者仍可选，后者已改：
  1. 审：替人定的 7 条在台账；round 3 的重点也还没回（#111 换成观测列表且只用 fake 测过、标签改完即存、迁移事故与「只对服务生效」，人已看到清单，未表态）。
  2. 定：overview 怎么减（findings §4，建议先让 clarify 不带 `structure`）；flow 是否也默认 soft（flow 设计 §6 D1，建议保持有限）。
  3. 看真面板（可选）：需求筛选、标签 chip、转录自动打开、看板空状态，都没在真数据上看过。
  4. 测试者数据（可选，定 25 万差的那部分）：在测试者机器上只读跑下面两条，只输出大小和用途，不含内容：
     `find ~/.orca/control -path '*.overview/*' -name overview.json -exec wc -c {} +`
     `sqlite3 -readonly <控制库，如 ~/.orca/control/panel/control.sqlite> "SELECT json_extract(r.body,'$.purpose'), length(CAST(json_extract(s.body,'$.work.prompt') AS BLOB)) FROM runs r LEFT JOIN execution_snapshots s ON s.hash=json_extract(r.body,'$.drive.envelopeHash') WHERE r.id LIKE 'run-3e770d4e%'"`（查询在本机备份库副本上验过；控制库路径未在测试者机器上核）。
  5. ccmem handoff §6.2 的会话号没更新（仍写 `4ed8eb65`）：会话 `663fb68e` 里那次 Edit 被自动模式检查器跳过且提示不要重试；内容仍准确（本仓无改动，入口指向 Orca §3 最新一节），下一轮顺手改。
- ~~会话 `4ed8eb65` 待人~~ **人已回复用量摘录**（`orca_archived_files/run-3e770d4e-usage-excerpt.json`）与 push；审与看真面板并入上条。
- ~~会话 `65b4d067` 待人~~ **人已回复**（会话 `4ed8eb65`）；原文：
  1. **push Orca**：本会话合入的 Radix 系列与 handoff 提交都只在本地 main；ccloop、ccmem 本会话只各多一笔 handoff 提交（主题行 `docs(handoff): Orca session 65b4d067 pointer …`），也归人推；syncskill 未动。以 `ls-remote` 现测为准。
  2. **看真面板**（可选）：Radix 下拉已装进 7777 的真面板；有不满意的地方，告诉下一位 agent 改哪里。
  3. 测试者数据（可选，人在问）：#99 那组 `SELECT id,result FROM commands WHERE id LIKE 'orca-auto-confirm-unlimited-%'` 与当时组 `status`；拆分 run 的 `…/single-call/call-*/events.jsonl`。
- ~~会话 `b999cc81` 待人做／待人看／待人审~~ **人已全部回复**（会话 `65b4d067` 开头）：`fix/test-affected-web-css` 人已合入、推送；Radix「同意，合入」（已合入、装上）；替人定的五处「同意」；push 只剩 Orca（见上条）；测试者数据挪到上条 3。
- ~~会话 `3ea8a21e` 待人看／待人定~~ **人已全部回复**（会话 `b999cc81`）：Radix 全量换（已在分支做完，见上条 2）；收据与主题回落按建议（收据已修、回落不加映射）；三仓 push 人已做；测试者数据仍在问（上条 5）。
- ~~会话 `a9f9d6de` 待人审／待人给~~ **人已全部回复**（会话 `3ea8a21e` 开头）：主题留七个、其余删（已做）；可逆项同意，原生 select 改为试 Radix（试样待看）、terminal 删；settle-usage schema「同意」（已做）；push 人已做；测试者数据去问。
- ~~会话 `e236bbe4` 待人看／待人定~~ **人已全部回复**（测试者反馈轮台账）：控制器三条裁定「同意」；轮次编号按链上位置；主题「都不太满意」⇒ 整体重做；codex 拆分自测的结果就是测试者 #105／#107。
- **会话 `ffec7b28` 待人审／待人做**（原委在该会话台账）：
  1. 审控制器裁定：已完成的 run 不给 skip/defer；转录 C2（窗口 4 MiB）、C3（展开前只脱敏头部＋4096）、赋值名大小写不敏感、超大行展开显示解码文本；计划库放控制库而不是文件；dir 需求 D3 窄碰撞规则；R2 D7（自动确认即开跑）、D11（估算超额时非 token 维度上限随之增长）、M5（修复迁移后的旧不限 token 草稿组会被自动确认开跑）；H7 W1–W15。
  2. 人做：~~`branch -D feat/tester-round2-server`／`branch -D feat/scheduled`~~ **不必了**——2026-10-26 查 `branch --list` 只剩 `main`、`worktree list` 只剩主仓，没有可删的分支；`/private/tmp/orca-ffec7b28/` 的清理（人 2026-10-26 已授权，`ccloop-fe985b0` 是当前钉住的测试用 bin 要留；`ccloop-cache*` 是测试缓存）、`/private/tmp/orca-0e13a9b7/`、`/private/tmp/orca-b37f7ce9/`。
  3. ~~`~/.codex/config.toml` 里 agent 跑出来的 trust 条目要不要清~~ **已按人裁清（2026-10-26）**：本轮 7 条已删，备份 `.bak-o9-20261026`、`.bak-o9-20261026b`，见 §3 副作用条。
- **会话 `9ec98639` 的控制器裁定待人审**（人说「执行完在最后阶段报给我审核」）：台账 `.superpowers/sdd/2026-10-21-session-9ec98639/progress.md` 每条线的「Criteria changed」与决定；偏离已有裁定的三处——L2 是叠栈的 debug 组而非组内任务、系统 debug 不经估算、自动审阅员是完整 run 而非单次调用；ccmem 那笔超出人裁的 SIGTERM 修复（ccmem handoff §1.000）。人审后删本条。
- **付费**（每一次先问）：§4.2 第 5 条（O9 只剩 claude 一段，等 2026-10-27 09:00 额度＋人点头）。
- **ccmem embedding 账号无额度**。
- **`orca chain` 真钱活体验收**：要人提交 `.orca/chain.json` 选 model（不存在时开链被 `chain-config-missing` 拒）。
- **面板的真浏览器视觉验收**（深浅主题、几何、依赖图 SVG）——人没看过第二批以后。
- ~~ccloop 判据改写授权~~ **已结清（2026-09-29）**：ccloop #14 的 M3／M4 由 `docs/superpowers/plans/2026-09-29-backlog-hardening.md` Task 8（只加不改，ccloop `789c026`／`799b0c6`，判据 `records one contention when the re-read after an abandoned transfer meets the same $name lock`）与 Task 9（人授权四条具名改写，ccloop `2190b89`，`snapshotTree` 记 `"."`）处置，均已在 ccloop main。
- **ccloop 的 `setTimeout` 溢出防护**：要不要对别的客户端也设（未决）。
- **未审完的历史轮次裁定**（各台账 `Ruling:` 行，人回复后删）：面板项目过滤（`.superpowers/sdd/2026-10-06-panel-project-filtering/progress.md`）、Task control 刷新＋项目切换（会话 `08011394`）、syncskill 跟进（`9d95e6c8`）、面板 HTTP＋syncskill 补三件（`16ab00f2`）、UI 一轮改写的四条判据（`REWRITTEN … U1–U4`）、会话 `b39a5527` 的六条可逆决定（结清按保守额记组账、`recovered` 扣额排除出谱系等，原文在该会话台账）。
- **一揽子／历史决定**：「第二个 panel 不挂控制面」维不维持；裁决甲 `plan` 那一半未获指名授权；子系统 B 暂缓到有 `not_my_taste` 行（`~/.orca/corrections.jsonl` 2026-10-18 仍不存在）；`import-plan` 的上限按 agent 定的 task 数算。
- **归属行**：若干提交的 `Co-Authored-By` 写的是实施席自己的模型；两笔 trailer 格式小瑕疵——**都不 amend，由人决定**。
- **安全**：2026-09-17 一把 API key 明文进过 transcript ⇒ 建议轮换，只有人能确认。
- **人的数据**：`~/.Trash/orca-real-data-2026-09-27`、`~/.orca/backups/` 下的备份集、ccmem 的 `global.db.bak.*` 与 `com.ccmem.daemon.plist.bak.20261013` 留不留归人。
- `docs/handoff/handoff_ui.md`：UI 的活交接（§七＝当前 UI 状态与待人项）。

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

---

## 九、本目录其他文件

| 文件 | 是什么 | 状态 |
|---|---|---|
| `known-load-flakes.md` | 全部已登记的负载型 flake 与判别规则 | 现行，**看到红先查它** |
| `2026-10-12-oh-my-pi-acceptance.md` | OMP 隔离真任务验收的证据索引（成功与两次中间失败） | 证据索引，保留 |
| `2026-10-12-live-service-cutover.md` | 正式服务切换：备份清单、schema 升级、launchd、**回退步骤** | 证据索引，保留 |
| `2026-10-12-followup-acceptance.md` | ccmem 迁移备份修复、真 Codex strict wire、Linux VM、GitHub 验收的证据 | 证据索引，保留；其「尚未完成」一节以本文 §四 为准（ccmem 已 push、strict wire 已进 OMP 分支） |
| `2026-10-10-ccmem-local-integration.md` | ccmem 本地整合归档包的 SHA256 索引（唯一人可读的那份） | 证据索引，保留 |
| `2026-10-14-feedback-triage.md` | 外部反馈 `issue-20261008.md`（10-14 版）对照当时 main 的分诊、优先级 1–7 与不采纳理由 | 现行，§4.2 第 10 条要用 |
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
（评审员的承重主张自己复核）；UI 轮先读 `web/DESIGN.md`、跑 impeccable 检测器，可用 `frontend-design`、`playwright`（截图对比）；P0 修复先 `superpowers:test-driven-development`。skill 与 `CLAUDE.md` 冲突时 `CLAUDE.md` 优先。
