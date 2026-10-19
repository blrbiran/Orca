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
- ⚠️ **验证性跑一律重定向到文件再整份读回**。`npm run verify` 是 `&&` 链，整套现在要二十分钟上下（历史观测：2026-10-10 后端全量工具报 1179.86 s；2026-10-12 根级全量门约 22 分钟）⇒ **放后台跑**，不要指望 Bash 的 600000 ms。
- ⚠️ 普通沙箱下全量会大面积红成 `spawnSync ps EPERM`／`listen EPERM`（2026-10-10、10-12 两次实测），那不是业务红；要用本机进程权限、私有 HOME/XDG/`CCMEM_DATA_ROOT`、短 `TMPDIR` 重跑，原失败日志照留。

---

## 三、当前状态（2026-10-18，会话 `a3b2a7a7` 整节重写）

> 本节于会话 `a3b2a7a7` 把七个历史会话小节（`808feb6a`、`b39a5527`、`02f047f6`、`026d10e3`、`a852f96a`、`4de777f4`、`d0843ec0`）压成下面三块：那些轮次的分支**都已由人合推、分支与工作树已删**（会话 `4de777f4`／`a3b2a7a7` 现核），过程原文在 git 历史里（§十）；每一条仍成立的结论都留在下面，出处指到 spec／台账。

### 3.000 会话 `f3a75a90`（2026-10-19 → 10-20）—— **先读这一节，再读 3.00、3.01、3.0**

> 本节整节替换了会话 `3d44b2fb` 的 §3.000：那一轮的分支已由本会话做完并合进 main（下面第 1 条），它「改变了前提的事实」与事故教训原样并入下面。

- **已合进 main（都是 `--ff-only`，未 push）**：
  1. **「纠正 ⇒ debug task」15 个任务全部完成**：首笔主题行 `feat(corrections): read a correction's target in one place`，末笔 `fix(corrections): keep Orca/ccloop work refs out of the close idempotence pickaxe`（共 38 笔，合入前 rebase 到 main）。spec `docs/superpowers/specs/2026-10-18-correction-debug-task-design.md`（§12 与文末「Correction (as built …)」节优先）；**唯一进度源** `.superpowers/sdd/2026-10-18-correction-debug-task/progress.md`（git-ignored，只在主仓；每任务的派席、评审、修复轮、`Ruling:`、延后 minor、事故、Task 15 变异表与门）。做成的：前置脚本、冻结 debug 输入、纯函数 debug 计划、verb `correction-debug-open`、debug run 复现优先检查（在 run 自己的工作区、移出调度轮、持久标记）、落地提交带关闭记录、「已关闭」＝目标 ref 的树里有关闭行（全仓一个判据，`correctionState.ts`）、`correction-record`／`correction-close`／`correction-withdraw`（只限人）、拒绝 pending 决定后自动开 debug group、**Web：Decisions 页里的纠正列表**（打开／重开／人工关闭／撤回、要检查命令时让人填、group 视图的 debug 标、复现状态）。
  2. **外部反馈 `orca_archived_files/issue-20261008.md`（10-19 版）第一批**：分诊全表 `.superpowers/sdd/2026-10-19-issue-convergence/triage.md`（对照当时代码逐条：马上做／要设计／可关闭，以及**测试者分析有误的几条**：#80 根因、#69/#71、#79 的「预留」）；进度 `progress.md` 同目录。已合：#72 服务 PATH 带上 agent 命令目录与 `#!/usr/bin/env` 解释器目录（主题行 `fix(service): put agent command and env-interpreter dirs on the service PATH (#72)`）；Orca 读 ccloop 输出改为整块解码（`fix(scheduler): decode ccloop's piped output once, not per chunk (#80)`）；W1 Requirements 页 #74／#75／#77／#78／#79／#73（四笔 `fix(web)`／`test(web)`，主题行带 issue 号）。
  3. **ccloop main**：#80 真根因修复 `fix(control): decode control stdin once over all bytes`（ccloop `control` 逐块解码 stdin，>64 KiB 中文 prompt 在块边界切开汉字 ⇒ hash 必然不一致、重试无效）。**Orca 的 ccloop pin 还没更新**——等人推 ccloop 后 repin（§3.3 repin 做法）。
- **门**（会话 `f3a75a90`）：Task 15 在**分支 rebase 前**的 `05a191c2` 上：变异 212 条里 209 红（3 条绿＝多余的去重／被前置守卫遮住，登记为台账勘误、不改代码）；**全新 clone `npm run verify` exit=0**：全量 453 文件 4273 过／33 跳过（全是环境开关类，与上次 36 同族）、`verify:control` 2294／30 跳过、`~/.orca` 219 个文件哈希不变。之后的改动（终审 I-1 修复、#72、#80 Orca 侧、W1）**只跑相关目录＋typecheck**（数在两个台账）。
- ⚠️ **人裁（2026-10-19）：全量门只在发布特定版本之前跑；迭代、修复轮、甚至合进 main 之前都不跑全量**，只跑相关目录＋typecheck。理由与实测：`npm run verify` 约 62 分钟，其中整套实际跑了约 2.5 遍（`npm test` 707 s；`verify:control` 又跑 `tests/control` 1261 s；`verify:chain` 又整套跑一遍、2 worker、1611 s）。人同意「判据覆盖」换时间的取舍 ⇒ verify 链去重是 §4.2 的一件。
- **主树 `dist`、`web/dist` 已在合入后重新 build**；服务要人重启，**并重跑一次 `orca panel install`** 才会带上 #72 的 PATH（§4.1）。
- **人裁（本会话）**：必要的既有判据都可以改（**只对本会话**，每处在台账 `Ruling:` 写 file:line 旧→新）；执行中的问题先按控制器建议定、最后报人审 ⇒ **两轮控制器裁定等人审**（§八）。
- **改变了前提、下一位要知道的**（来自会话 `3d44b2fb`，仍成立）：① 计划原文用 `alreadyCommitted`（`git log --all`）判「已关闭」——会命中 group 分支，已全部换成目标 ref 判据；终审又发现人工关闭路径仍用它 ⇒ 现在排除 `refs/heads/orca/*`、`refs/orca/*`、`refs/ccloop/*`；② 没有原契约时检查命令是占位符 ⇒ 打开时可带 `checks`（与原契约**取并集**，mark 记来源）；③ 复现命令按 ccloop 跑检查的方式执行（`sh -lc`、继承环境）——**它以 Orca 身份、在 ccloop 沙箱外运行**（等人知情）；④ reconcile 后自动生成的 `git revert --no-edit <attemptSha>` 可能撤不干净（登记）；⑤ 控制库仍是 schema 14，**但合入后新建的 run 体带新字段、旧版 Orca 的 strict schema 读不了** ⇒ 回退前要先备份（§4.1）。
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

### 3.0 本会话 `a3b2a7a7`（2026-10-18）—— **先读这一节**

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

- **CLI**：`orca validate／plan／correct／metrics／panel／compact-reviews／level／checkpoint write／resume／gate／chain／control／mcp serve／user`（`src/cli.ts` 的 `USAGE`）；全局 `orca` shim（跑 `dist/`，pull 后先 `npm run build`；新 pin 后主仓先 `npm ci`）。**`orca run` 已退役**，跑一轮只走面板／控制路径。
- **面板服务**：`orca panel install|uninstall|start|stop|restart|status|logs`；整站登录（owner／member、CSRF）；`<stateDir>/control.sock` 给 agent（`orca control get|send`、`orca mcp serve`、`skills/orca-control/`）。重装服务只记录当前 shell 里具名的 `ORCA_*`，先 `--dry-run` 比 `service.json`。
- **执行链**：执行驱动（worktree／clone、落地 `orca/<group>`、解冲突 run、N 路并行落地）、handoff 投递与续跑（含交接停止＋未知用量的 `recovered` 出路，spec `2026-10-14-handoff-stop-unknown-usage-design.md`）、single-call 预估链、N1 澄清→拆分→确认、loop 方案层、合入方案（`local`／`push-target`／`push-branch`／`github-pr`）、花费上限、Results、Activity。
- **估算**：确定性修复＋一次自动重试＋指令 v2（spec `2026-10-17-estimate-usable-answer-design.md`；台账 `.superpowers/sdd/2026-10-17-estimate-usable-answer/`）。`~/.orca/profile.json` 已是 `instructionVersion: "2"`。
- **agent kind**：claude、codex、omp；三种 skill 注入（claude `--plugin-dir`、codex `codexSkillsDir` 每 phase 临时链、omp `ompSkillsDir` 的 `<skills>` 清单，**OMP 永远 `--no-skills`／`--no-extensions`**）。single-call：claude `"v1"`、codex `"v1-soft"`（输出上限事后核对、只在 soft 估算模式接受）、omp 按目录行（方案 A＋按目录上限预占）。
- **ccloop 目录缓存**：`$CCLOOP_CACHE_DIR`（缺省 `~/.cache/ccloop`），键含二进制与配置 stamp、30 分钟、版本号也缓存；codex single call 在**每个安装键一对复用的私有 `HOME`／`CODEX_HOME`**（`<cache>/codex-home/<sha256>/`，链 `auth.json`／`config.toml`、从不删正规凭据，挪成 `.displaced-<ms>`）。模型清单 API 与 web datalist。
- **错误码**：ccloop 进程失败答 424 `ccloop-failed:<码>[: 细节]`（例外：`apply-agent-update` 仍 500）；「组在执行」单一判定（`src/control/executionPending.ts`），执行中 `start` 答 409 `group-execution-pending`。`set-task-loop` 在组 `running`／`review`／暂停时也能改**未开始**的任务。omp clarify／split 的上限拒绝不自动重试，人点 group 重试时按冻结的 `agentSlot.selection` 重算上限。web 统一经 `web/src/ccloopCodes.ts` 解释码（兜底文案不说「ccloop」）。
- **纠正 ⇒ debug task**（会话 `3d44b2fb`／`f3a75a90`，spec `2026-10-18-correction-debug-task-design.md`）：纠正开独立 debug group、复现优先检查、落地带关闭记录、「已关闭」＝目标 ref 的树里有关闭行、只限人的记录／人工关闭／撤回 verb、Decisions 页里的纠正列表。**付费端到端与推送类合入方案的关闭都没验过**。
- **Decisions 页撤回**：撤回自己的审阅／未关闭的纠正（§3.00）；撤回记录在 `reviews.jsonl` 的 `withdrawn` 行与 `~/.orca/correction-withdrawals.jsonl`。
- 控制库：**schema 14、单向**，真实 `~/.orca` 已迁到 14（2026-10-18，人重启服务前备份，见 §3.01）（切换与回退：`2026-10-12-live-service-cutover.md`）。Linux systemd 用户服务跑通过一次（两仓全量没在 Linux 跑过；`2026-10-12-followup-acceptance.md`）。

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
- ⚠️ **排队估算的已知缺口，修法人已裁、未实施**：提案确认或被新估算取代后 `claimEstimate` 不复查、照样真跑；组已开跑时 wake 永远重投、估算永停 `queued` 且占着 grant。人裁：新增终态 `withdrawn`（`group-started`／`proposal-confirmed`／`superseded`），释放 grant、不重试，**所有排队估算一起管**，领取时用代码查；要另起 spec 更正节（`2026-10-17-estimate-usable-answer-design.md` §4.3）。
- **Codex single call 残余**（spec `2026-10-15-every-agent-requirement-chain-design.md` **§11 优先于正文**）：refresh token 经软链轮换未验；keyring 存凭据时 fail closed；worker 的 `ccloop-agent-catalog:` 日志无生产 sink；一行提示的框架开销工具报 **10109–11590 token**（OMP 约 2047）；`notify=[]` 是否真挡住人的 notify 程序未量。
- **OMP**：omp 18.10.1 对 `127.0.0.1` 也走 `HTTP_PROXY`、启动时探测本地 ollama（fake 上游要吃掉意外请求）；**不把任何本机选择器设为默认**；一次验收是 pilot 不是可靠性。
- **谱系与用量**：`lineageWorkUsage()`（`src/control/usageSettlement.ts`）是谱系求和唯一规则；work 剩余为 null 只在三层上限都缺时出现；spawn 前中止 ⇒ `neverStarted` 记 0，目录行不可解析 ⇒ 用量 null。
- **Rule 17 事故遗留**：会话 `4de777f4` Task 7 往真 `~/.cache/ccloop/agent-catalog/` 写过路径，该删的只剩两项（§4.1）。**人用真面板时跑门**会让 Rule 17 守卫在文件级报红（面板写 `~/.orca/control/panel`），挑人不用面板时跑；门脚本的 `~/.cache/ccloop` 比对会被运行中的面板服务改写（服务按设计用真缓存）。
- ⚠️ `ORCA_CCLOOP_BIN` **不能**指 `node_modules/ccloop/dist/cli.js`（npm 包不带 `tests/fixtures`）⇒ 指一份 build 过的 ccloop `clone --local`。`taskResultPaired` 两条硬编码 `/private/tmp/…`，**不设变量也红**，是固定环境红。
- **repin 的做法**：只在装了真实 `node_modules` 的工作树里 `node scripts/pin-ccloop.mjs <40 位 sha>`（它会 `npm install`；**别在软链 `node_modules` 的树或主仓跑**），且只在人推了 ccloop 之后；repin 门要拿那个 sha 的 ccloop build 作 `ORCA_CCLOOP_BIN` 跑 `verify:scheduler` 与真 ccloop 特性文件（JSON reporter 证明 passed 不是 skipped）；全新 clone 跑门先 `npm run build --workspace web`。
- **Codex 隔离的付费教训**（P1／P1b，会话 `a852f96a`）：MCP 名单必须在**同一套隔离**下列（在真 `~/.codex` 下列出的名字给隔离配置下关闭项会让 codex 配置加载失败、零请求）；codex 的 `error` item 当诊断、不当失败；按已装 codex 的 `features list` 过滤要关的 flag。
- known-reds 名单只加了 `codexAdapter` outer watchdog；`verifySavedResult`「r1 command interruption…」**不加**（断言形状、疑真竞态，下次红先按 `systematic-debugging` 在 clone 里查）。
- **仓库外由 agent 经人授权改过的**（Rule 17 记录）：`~/.orca/agents.json`（备份 `~/.orca/backups/agents.json.bak.20261017`；claude／codex 保留 nvm 稳定路径，不用 cmux 临时 shim）、新建 `~/.orca/projects.json`（0600）、`~/.orca/profile.json`（备份 `profile.json.bak-20261017-v1`）；ccmem 的 `core.hooksPath` 已 unset；三仓 Qoder `post-commit`／`post-checkout` 钩子已备份后删除。
- 本机：`/opt/homebrew/bin/node` 坏（缺 libsimdjson）；nvm Node 22.13.1 在 PATH 首位；`/usr/local/bin/node` 是 24.13.0（正式服务用它）。真 Codex 只用 `gpt-6-luna`（`gpt-6-sol` 无额度），每次付费先问人。

### 3.4 最近一次可引的门（**历史观测，引用前现测**）

- **最新＝debug 分支 Task 15 的全新 clone 门**（会话 `f3a75a90`，2026-10-19，观测提交＝分支 rebase 前的 `05a191c2`，`ORCA_CCLOOP_BIN`＝`/private/tmp/ccb6-qswQ/ccloop`，即 pin `02cbacc` 的 build）：`npm run verify` exit=0，全量 4273 过／33 跳过／0 红，`~/.orca` 哈希不变。之后合进 main 的改动只跑了相关目录（§3.000）。**按人裁，下一次全量门在发布特定版本之前。**
- 更早的门（估算一轮终审 `d0843ec0`、repin、round-b、OMP 分支等）都已被取代；flake 判别在 `known-load-flakes.md`。

---

## 四、⛔ 下一件事（按顺序）

### 4.1 人做的（agent 不提醒、不代做）

- **面板服务**：主树 `dist`／`web/dist` 已在会话 `f3a75a90` 合入后重新 build。人要做：① 先备份 `~/.orca/control`（合入后新建的 run 体旧版读不了，回退要靠它；做法同 `2026-10-12-live-service-cutover.md` §撤销）；② **重跑 `orca panel install`**（#72：只有 install 会把 agent 命令目录与 bun 所在目录写进服务 PATH，`restart` 只重放已记录的配置；先 `--dry-run` 比 `service.json`）；③ 重启服务。服务跑的是主树 `dist/cli.js`（`~/.orca/panel/run.sh`）。
- **push**：人统一择时推三仓，agent **不提醒**、不给 push 命令。合入 main（`--ff-only`）、删已合并分支、删干净 worktree，agent 在三仓里都可以自己做（人 2026-10-18 会话 `1710772d` 对齐）。ccloop 的 #80 修复人已推（2026-10-20），下一轮 agent 先 repin（§4.2 第 1 条）。
- **删**（人做；会话 `a3b2a7a7` 2026-10-18 现核、`f3a75a90` 补）：
  - `~/.cache/ccloop/agent-catalog/` **整个目录不能删**（在用）；只删两项：`agent-catalog/769de7de3225c97b1234142ba6835ab7aaecfd0d77e371c662ca57bf9607b532.json` 与目录 `agent-catalog/codex-home/bf5335273626c4675a00cca1a384456ab917ed8333815b54b89e45b57670b993`（内含指向 `~/.codex/{auth.json,config.toml}` 的软链，`rm -rf` 只删链）。
  - `/private/tmp`：`mutp-swWu`、`acc-xpI0`、`mut-*` ×10、`org6-nP1k`／`org7-3oVo`／`org8-ulmF`（⚠️ `org7`／`org8` 下各有一个跑了两天以上的 `orca panel` 测试进程，2026-10-19 现测 pid 18023、44796，**先停进程再删目录**）、空目录 `cc-r-*`、`cc-t-*`、`cc-gate3/4/5-*`。`ccb6-qswQ`（pin 的 ccloop build）留到 repin 门与 codex 估算补跑之后。
  - 会话 `f3a75a90` 的 scratchpad（`/private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/f3a75a90-7f8d-43e1-9c2e-57ce16352d98/`）里有 4 个 clone（`logs/task-15/{mut-clone,gate-clone,gate2-clone}`、`w1-mut`、`ccloop-80-clone`），删前先 `unlink` 其中的 `node_modules`／`web/node_modules`／`web/dist` 软链。
  - `$TMPDIR` 下 ccmem 测试遗留 `ccmem-*`（修复前留下的）：`find "$TMPDIR" -maxdepth 1 -name 'ccmem-*' -mmin +60 -exec rm -rf {} +`。
- **ccmem embedding 账号无额度**（`429 You have no credits remaining`）⇒ 语义检索不可用，充值或换 key。
- 不确定归属：`/Users/biran/.codex/worktrees/feedback-followup-20261011/Orca`（Codex 建的 detached worktree）。

### 4.2 agent 的活（**人定的下一轮顺序，2026-10-20**）

1. **repin ccloop（不跑全量）**：ccloop main 上已有 #80 修复（`fix(control): decode control stdin once over all bytes`，固定 sha `d5772fbf75d246e20e3ccf9bbbca8e99cb9bc1a6`，**人已于 2026-10-20 推上远端**，会话 `f3a75a90` 现测 `ls-remote` 相等；之后 ccloop 只多了 handoff 提交，pin 用这笔或 `ls-remote` 现测的那笔都行）。在装了真实 `node_modules` 的工作树里 `node scripts/pin-ccloop.mjs <40 位 sha>`（§3.3 repin 做法），只跑 `verify:ccloop-pin`、`tests/scheduler`、真 ccloop 特性文件＋typecheck（人裁不跑全量）。旧的 `/private/tmp/ccb6-qswQ` build 换成新 sha 的 build。
2. **两件小的**：
   - **W2**：说明已写好 `.superpowers/sdd/2026-10-19-issue-convergence/w2-brief.md`（#47 常驻操作栏、#56 Overview 原因码说人话、#57 快捷键 `r`、#72 Agent 设置页 `{{code}}`、#70 模型不在目录里的提示、#15／#58 README 与继承说明）；照 W1 的流程（实现席＋评审＋只跑相关目录）。
   - **verify 链去重**（人已同意「覆盖换时间」）：把 `ORCA_CONTROL_VERIFY=1` 并进 `npm test`、删 `verify:control` 那一遍；`verify:chain` 的第二遍整套（chain 变量，`scripts/verify-chain.mjs`，review I5）换成只跑会读 chain 变量的测试或一条静态检查（每个 spawn 子进程的测试都 `isolateChainEnv()`）——先 brainstorming 定判据，再改。
3. **ccloop 那半：agent 在结果里报 `decisions[]` 与 `debug`**（`choseInstead`、`reproTests`、`reproCommand`、`reproduction`）——在 ccloop 仓走 brainstorming；做完解「控制 run 写决定」计划的 Task 12（对真输出的契约测试）。Orca 侧读法已在 `src/control/reportedDecisions.ts`。
4. **测试拆分**（本会话与人讨论的结论，人裁见 §3.000）：日常／修复轮／合入 main 只跑相关目录＋typecheck，全量门只在发布特定版本之前——把它落成可执行的东西（例如按改动文件选测试的脚本、`npm` 脚本分层、计划模板里不再写全量门），与第 2 条的去重一起设计。
5. 之后（未排序，人再定）：ccloop Codex 阶段隔离（计划在 ccloop main，Task 4 Step 6 停止点要人点名改判据）；排队估算 `withdrawn` 终态（§3.3，人已裁）；issue 分诊表里「要设计」的几条（#32、#76、#65、#55）。
   **设计轮**（先 brainstorming；有前提 spec 要先定时与人商量顺序）：
   - **group／task 执行时允许改必要的测试文件**（人原话：「orca 执行 group / task 时是都要允许改必要的 test 文件。否则很多改法都太受限了，或者只是一种workaround。」）：先量清楚测试文件今天在哪一层被拦（写集、denylist、ccloop 校验；控制路径写出写集即 `blockRun`，`src/control/executionDriver.ts` 里搜 `blockRun`），再划「允许改测试」与「不能靠改弱测试过关」的界线。
   - **group 之间的串并联图**（人原话：「当前orca 的具体 group 中可以看到 task 之间的串并联关系图。但是 group 也应该有这样一个图去看并且可以人为调整/ai agent 动态调整group（包括普通group和 debug group）之间的串并联、先后关系。」）：控制派活真正开始替人定先后时，再把「隐含依赖」「落地顺序」两类决定记进账本（决定 spec §3.2）。
   - **纠正只写「仓库＋一句话」、由 debug agent 自己定位**：人说「可以，但是我更希望你早点把 decisions 接好」⇒ 排在第 3 条之后。
   - **裸 run 目标的「纠正」按钮**（debug spec §12.3 延后项）。
   **路线图未落地**（`goal.md` 里仅剩的中期／远期项，会话 `f3a75a90` 现测 `litellm`／`a2a` 在 `src`、`web/src` 0 命中）：纠正写回 ccmem 给人自己的会话看（`src/memory/adapter.ts` 的 `recordCorrection` 仍是 `false`；需要 ccmem 外部引用 tag `orca:correction:<id>`＋幂等导入＋信任度，今天 `ccmem import` 无去重、`external` 信任 0.3；只写回**已关闭、未撤回**的纠正）；LiteLLM 接入；A2A（远期只读）。**不能宣称记忆写回已闭环。**
6. **欠着的付费验收**（每一次先问人）：debug 计划的端到端一次（spec §8）；codex `gpt-6-luna` 估算一次（10-22 额度恢复后，命令：`scripts/live-driver-acceptance.ts --scenario estimate --estimate-only --instruction-version 2 --codex /Users/biran/.nvm/versions/node/v22.13.1/bin/codex --model gpt-6-luna`，不设 `CCLOOP_CACHE_DIR`）；ccmem Codex Stop 钩子；ccmem 对照的 codex 一项；OMP skills 真 provider 验收；GitHub 私有库合入验收（`blrbiran/orca-integration-smoke-20261012`，push 要人；运行 `gh` 前清掉失效的 `GH_TOKEN`／`GITHUB_TOKEN`）。
7. **登记的小项与延后反馈**：`recoveryRetry` 探测在闸门外、计划卡对「stopped 无 intent」组的编辑入口（都人裁不修）；m2 三处日志调用点、`peerFailureLog.test.ts:22`、`executionPending` 的 kind 过滤、A8 六处日志无判据；`profiledService` 候选 flake；两个 debug／issue 台账里的 `minor (deferred)` 行。
8. **挂在姊妹仓的**：ccloop B4 与 `ClaudePhaseAborted` 历史交错（未证成）；ccmem T13。按各仓规则，先报再动。

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
- `npm run verify`（发版门，spec `2026-10-20-test-scope-and-release-gate-design.md`）串：`check-release-gate`（无 `ORCA_RELEASE_TAG` 即 exit 2）、typecheck、build、`check-gate-env`、`verify-suite`（整套只跑一遍，带 `ORCA_CONTROL_VERIFY=1` 与 chain 两变量）、台账校验、`CLAUDE.md` 行数、hooksPath、web build、`verify:ccloop-pin`、`verify:panel`、`--ws check`。`verify:control`／`verify:scheduler`／`verify:chain` 仍可按名单跑，已不在链里。日常 `npm test`＝按改动选测试（`scripts/test-affected.mjs`），整套是 `npm run test:all`。另有 `verify:saved-result`。
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
- **Tier 0 闸门**：`.claude/settings.json` 的 PreToolUse `orca gate --hook claude-code`＋`permissions.deny`，拦 push、非 fast-forward 合入 main、强制删分支（`-D`／`-d -f`／删 main）、强制删 worktree／`prune`、`gh` 对外写；`merge --ff-only`、`branch -d`、不带 force 的 `worktree remove` 放行（2026-10-18）。改 deny 列表要同步 `src/gate/settings.ts`，`tests/gate/settings.test.ts` 钉着它的 sha256。已知放行：写成脚本再执行、`python3 -c`、git alias、`-c core.hooksPath=`、`--no-verify`、`ExitWorktree`、`rm -rf` worktree 目录、`git -C <path> push`；已知过度拦：main 上 `git branch -f`、`merge --abort`、`rebase --continue`。威胁模型是合作型 agent 的失手，不是对抗。
- **关键环境变量**：`ORCA_CCLOOP_BIN`（本地覆盖）、`ORCA_AGENTS_TABLE`、`ORCA_SYNCSKILL_BIN`、`ORCA_CCMEM_BIN`、`ORCA_CORRECTIONS_DIR`（都是绝对路径，空＝未配置）。

---

## 八、什么在等人（awaitingHuman）

> 会话 `a3b2a7a7` 删去已了结的条目：历轮「人已裁」长段（结论都已落进 §三／§五 或对应 spec／台账，人回复过的裁定不再待人）、已删除的 Qoder 钩子（会话 `026d10e3` 经人授权备份后删除）、已做的面板／profile／名单／分支删除。

- **ccloop 计划 Task 4 Step 6**：预言变红的 `tests/control/codexSkillsFailureWorker.test.ts`（夹具 wrapper 要转发非 `exec` 调用）与语义已变的 `tests/runtime/codex/extraEnv.test.ts`「sets CODEX_HOME from the installation's configDir…」——改要人逐条点名（人在会话 `1710772d` 给过「本 session 中必要的 test 都允许改」，**只对那个会话有效**）。
- **会话 `3d44b2fb`＋`f3a75a90` 的控制器裁定待审**：台账 `.superpowers/sdd/2026-10-18-correction-debug-task/progress.md` 的全部 `Ruling:` 行（59 条：预检 C1–C30 的处置、每个任务的设计选择、既有判据改动的 file:line、终审两条修复、Task 15 的三条绿变异勘误）与 `.superpowers/sdd/2026-10-19-issue-convergence/progress.md`（#72 的 PATH 规则、`tests/service/config.test.ts:41` 加 `readTable` 夹具、`budgetI18n.test.tsx:73,105` 改成短格式）。需要人特别知情的：复现命令以 Orca 身份在 ccloop 沙箱外跑、继承服务的全部环境（含令牌）；reconcile 后生成的 revert 可能撤不干净；`checks` 取并集（人想删掉坏的原检查目前没有入口）；推送类合入方案判「已关闭」看的是上次 fetch 的远端 ref；POST /api/corrections 答 409（行已存、审阅标记失败）时不会自动开 debug group（可在纠正列表里开）；#73 ccloop 的 stderr 到不了 web（服务端只留错误码）。人审后删本条。
- **付费**（每一次先问）：§4.2 第 7 条；debug 计划的端到端一次（spec §8）。
- **ccmem embedding 账号无额度**。
- **`orca chain` 真钱活体验收**：要人提交 `.orca/chain.json` 选 model（不存在时开链被 `chain-config-missing` 拒）。
- **面板的真浏览器视觉验收**（深浅主题、几何、依赖图 SVG）——人没看过第二批以后。
- **ccloop 判据改写授权**：ccloop 里仍有改既有判据才能修的（M3／M4 等，ccloop 人裁 88 要逐条点名）；ccloop 要不要对别的客户端设 `setTimeout` 溢出防护。
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
（评审员的承重主张自己复核）。skill 与 `CLAUDE.md` 冲突时 `CLAUDE.md` 优先。
