# 标签＋进度 ＋ 待办批量 一轮台账（会话 `2724716d`，2026-09-28 起，跨到 2026-09-29）

> 本文件只追加。更正另起一节，原文逐字保留（Rule 13）。
> spec：`docs/superpowers/specs/2026-09-28-labels-and-progress-design.md`（§8 优先）。
> 计划：`docs/superpowers/plans/2026-09-29-labels-and-progress.md`（A）、`2026-09-29-backlog-hardening.md`（B）、`2026-09-29-ccloop-git-dependency.md`（C）。
> memory tab 只写 spec：`docs/superpowers/specs/2026-09-29-memory-tab-design.md`，待人审。

## §1 人的授权（原话摘录）

- 「spec 通过。」
- 「授权改 ccloop tests/control/agentsControl.test.ts 那两处 toEqual => 授权。其他这次spec实现必要的判据修改我也授权。」
- 「#6、#3（先不做 m6）、#4、#7、#11、#12、#13、#15、#16。 => 做」
- 「#14，要你指名判据 => 同意修改判据」
- 「#1 用 git URL，#2 先写 spec。其他task按我们刚刚定的要做的list去做。」
- 「这一轮执行过程中如果有问题，先按你的建议执行（不要再找我）。执行完在最后阶段报给我审核。」
- 「这个session暂时不要考虑context大小。」
- ⚠️ 只限本会话，不延续。付费调用、推送、删数据、杀进程**不在授权内**，一律留给人。
- 下面的 `Ruling:` 行都是控制器替人做的决定，**人还没审**。

## §2 执行记录

### §2.1 开工（会话 `2724716d`，2026-09-29；当时 HEAD 主题行 `docs(plan): task-by-task implementation of labels and progress, …`）

- 执行方式：`superpowers:subagent-driven-development`，每个 Task 一个实施子代理＋一个审查子代理；本地提交直接落 `main`（沿用 ⑤ 那一轮人已认可的做法；开工时 `git status` 干净、没有别的 agent 在 main 上）。
- Ruling: 计划不等人审就执行 —— 人休息前说「spec 通过」「其他 task 按我们刚刚定的要做的 list 去做」「先按你的建议执行（不要再找我）」—— 若人不认可计划里某个取舍，按台账 Ruling 行回退。
- 计划 A Task 0：`lp-env.sh`（TMPDIR＝`/private/tmp/cl-vCRm`，HOME＝`/private/tmp/cl-h-zFxK`，四个 XDG 根在 HOME 下）、`lp-mutate.mjs`（锚点必须恰好出现一次）。L1 基线重测：`tsx $SCRATCH/plan-probe/hash.ts` ⇒ `{"planHash":"e38685e8b39330ab91ccbbc73c6bc60cb432e627e4811e1854b73bc13de27c5f","byteLength":2251}`，与起草时（Orca `084f15f`）相同。
- Ruling: 计划 A 的 Drafter findings F1–F18 按计划原文的处置执行（计划 A 文件头那张表），其中值得人看的：F1 web 端镜像词表＋webParity 运行时比对；F2 原始 payload 上限 64、16 个上限在 `apply` 里数（`labels-invalid:count:<n>`）；F6 有 run 但 ccloop 还没报时各字段为 null；F10 UI 文案用英文（「unknown」「(reported at phase end)」）而不是 spec 里的中文；F15 只有 port 返回了 `progress` 才写，缺失不写；F17 `labels-version-conflict` 409、`labels-invalid` 422。
- Ruling: 计划 B 标 SKIP 的四项（#4 run 目录里没有冻结选择、需设计；#11(d) 记录已过期；#13(b) 修法会改两条既有 Orca 判据、不在授权内；#13(d) 现有夹具量不了）与 Orca `ccloopPort.ts` 那条 ERRATUM 已随旧方法删除 —— 照计划 B 不做，登记给人。
- 预检（三份计划的文件交叠）：A 与 B 都碰 Orca `executionDriver.ts`（A：`collectInto`；B：`replenishStartWakes`／`pass`／`stepA2`，区域不同）与 ccloop `src/control/command.ts`（A：`collectionSchema`；B：`capabilityViewSchema`）；B 与 C 都碰 Orca `README.md`（B 第 2 行、C 第 398 行后）与 `package.json`（B 加 `description`；C 的依赖行是人做的一步）；A 与 C 都可能碰 `src/cli.ts`、`src/panel/server.ts` 行号。⇒ 顺序 A → B → C，每个 Task 开工现测行号。无冲突需要裁。

### §2.2 收尾（会话 `2724716d`，2026-09-29；三份计划的逐 Task 记录在各自 SDD 工作区 `.superpowers/sdd/2026-09-29-{labels-and-progress,backlog-hardening,ccloop-git-dependency}/progress.md`，本节只记总账）

**做成了什么**（按主题行 `git log --grep` 找）：
- 计划 A 标签＋进度：Orca 主题行从 `feat(control): one definition of task labels …` 到 `test(web): say which read picks up the other person's labels …`；ccloop `feat(control): collect answers the loop's progress, …` 与 `fix(control): collect reads loop-state.json once, …`。
- 计划 B 待办批量：ccloop `docs(codex): append a named erratum …` 到 `test(registry): let the zero-write snapshot see its scan root's own mtime`；Orca `fix(control): keep one group's failure from ending the driver's round …`、`fix(control): dispatch a work run only with the selection its confirmation froze`、`fix(control): require a strict claim's request-bound proof to bound tokens`、`feat(web): name the handoff capabilities …`、`docs: carry the slogan, …`、`fix(control): fail a replenish round with the error that ended its transaction`。
- 计划 C ccloop 走 git 依赖：ccloop `build: ship ccloop as a git dependency …`；Orca `feat(control): resolve the ccloop binary from the installed package …`、`feat(cli): the panel and orca agents default ORCA_CCLOOP_BIN …`、`fix(control): resolve the default ccloop to a realpath …`、`docs(plan): correct the human step …`。**`package.json` 的依赖行与 lock 是人的一步（计划 C Task 5 ＋ 文末更正节），没做。**
- memory tab 只写了 spec（`docs/superpowers/specs/2026-09-29-memory-tab-design.md`，Q1–Q7 待人裁）。

**没做、为什么**：
- #13(a)（claude model 带 `[1m]` 一律拒）：既有判据 ccloop `tests/agents/registry.test.ts:56-61`「accepts opaque models … including aliases with a [1m] suffix …」断言相反；改它要人指名（Rule 15(a)），本轮授权只覆盖 #14。
- #4（resume／sweep 支持 `--agents`）：run 目录里没有冻结的选择，要设计。
- #11(d)：记录已过期（port 早没有 `capabilities()`）。#13(b)：修法要改两条既有 Orca 判据（`assemblyHandoffGrace.test.ts`、`agentFreeze.test.ts:351-354`），不在授权内。#13(d)：现有夹具量不了。Orca `ccloopPort.ts` 那条 ERRATUM：已随旧方法删除。m6：按人裁不做。

**收尾门**（全新 clone；HOME＋四个 XDG 根改道；TMPDIR 短真目录；json reporter；原始输出在会话 scratchpad `gate2-out/`）：
- ccloop（内容＝主题行 `build: ship ccloop as a git dependency …`）：typecheck RC 0；1086 条、1085 过、1 红（`stopProof`）；`check-known-reds` RC 0；`check-tmp-leak` RC 0（剩 0）。
- Orca（内容＝主题行 `docs(plan): correct the human step …`，`ORCA_CCLOOP_BIN`＝上面那份 ccloop clone 的 build）：typecheck RC 0；全量 2152 条、2146 过、3 红、3 pending（`ccloopDefaultE2E` 开关未开，设计如此）；3 红＝`driverRecovery`、`handoffE2E` H5、`controlShutdown`，都在已登记 flake 名单里，单文件各重跑 3/3 绿；`progressE2E` 是 passed 不是 skipped；web check 32 文件／164 条；`verify:panel` 15 PASS；`verify:control` 887 过 3 skip；真 `~/.orca` 前后 stat 相同。
- 🔴 **Orca `check-tmp-leak` RC 1**：剩 1 个空目录 `orca-tmp-*/orca-test-control-*`——某个测试文件的 `afterAll` 没跑（推测：flake 红的那一轮里有 worker 被中途杀掉）。**登记，没修，没重跑**；上一会话同一护栏在无红的一轮里剩 0。

**Ruling 汇总**：每条的「为什么／错了的代价」在各 SDD 工作区台账里，最终报告里逐条列给人。
