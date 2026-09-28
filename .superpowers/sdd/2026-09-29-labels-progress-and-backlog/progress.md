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
