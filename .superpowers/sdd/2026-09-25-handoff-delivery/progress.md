# SDD ledger — plan: docs/superpowers/plans/2026-09-25-handoff-delivery.md

> 归属：Orca 控制器会话 `e5f56bfe`（Claude Opus 5.5），2026-09-25。起点提交：主题行 `docs(spec,plan): fold the re-review and planning rulings into the handoff delivery spec; add its plan`（Orca `29fe36d`）；ccloop 起点 `a5dc529`。
> spec：`docs/superpowers/specs/2026-09-25-handoff-delivery-design.md`（§13.4 ＞ §13 ＞ §12 ＞ §11 ＞ 正文）。
> 本目录与计划 T10 的变异台账同一目录；**按 Rule 13 收尾不删**（superpowers skill 要求删 workspace，CLAUDE.md 优先）。入库一律单独 `git add -f`。

Ruling: 不开隔离 worktree，直接在 Orca／ccloop 的 main 上落本地提交 — 人 2026-09-25 点选「都同意，开始执行」，且历轮如此 — 若错：本地提交可由人 reset，不涉远端。
Ruling: 预检冲突扫描交一席子代理读整份计划并产出表格，控制器只读表 — 计划 5576 行，整份读入会把控制器上下文推向 Rule 6 上限 — 若错：子代理漏掉的冲突只能由逐 Task 评审兜住。
人裁（2026-09-25，原话要点）：本会话尽量把全部 Task 做完、暂不考虑上下文大小；执行中有问题不找人、先按控制器建议执行，最后统一报人审核；完成后更新 Orca／ccloop／ccmem 三份 handoff（ccloop／ccmem 的 Orca 章节不许无限增长、不写死 HEAD），另在对话里给 ≤10 行 executive summary（不落文件）。
⇒ Rule 6 的会话上限本会话按人裁放开（检查点照记越线）；全部 `Ruling:` 行即控制器替人做的决定，收尾时逐条报人。

## 预检扫描（`preflight-scan.md`，扫描席只读；21 条：2C／11I／8M）与控制器裁定

Ruling: [C1] D-C7′(α) 无 Task 实现 ⇒ 并入 T2：ccloop `handoff.ts` 对 `events.jsonl` 里 `type:"handoff_interrupted"` 点名的阶段（该 attempt）不列 missing，配判据＋删它自己的变异；T9 Step 1 构建核对加一项查它 — 人裁 D-C7′(α) 必须有落点，否则 T9 deadline 例必红 — 若错：T2 多一处改动，T2 评审兜底。
Ruling: [C2] handoffE2E 条数以 T9 实际落地数为准，T9 报告写明，T10 派发时把该数传给判定器 — 计划两处自相矛盾，实物是唯一可信源 — 若错：判定器一次失配，T10 评审发现。
Ruling: [I1] 计划正文里按旧裁定写的句子（「待裁」「--no-t2」「行数」、T6-M9 锚点 COUNT(*) 等）一律以 §0.1 末段「裁定」为准：T2 门已开、不要 `--no-t2`、spawn 键 MAX、D-C7′=(α)；各 Task 派发写明 — 裁定已由人／控制器定，旧句只是没改干净 — 若错：无（仅文字）。
Ruling: [I2] T10 FLAKE 名单 ＝ spec §9.1 登记的（controlShutdown SIGTERM、executionDriverE2E、driverSettle）∪ 计划 §0 新观测的（driverRecovery、driverLanding 两条）；任何一条红都须单文件重跑绿才算 — 两份名单都有实测依据 — 若错：放过一条真回归的概率靠单文件重跑挡住。
Ruling: [I3] T10 的 REWRITTEN 按全名核全部被改写判据：Orca 三条（D21、stopIntent 那条、web controlPanel 那条）＋ ccloop C6 那条（在 ccloop 侧跑） — Rule 12 — 若错：无。
Ruling: [I4] T10 对 progress.md 只追加不新建 — Rule 13 — 若错：无。
Ruling: [I5] §13.2 I-5「剩余为 0 由面板剔除」落在 T8：`continuable` 额外要求该 run 的 work 剩余 grant 各维 >0，配判据 — 控制器自己在 §13.2 定的，必须有落点 — 若错：一个维度用尽的前任在面板上不可选，人要走别的路。
Ruling: [I6][I7][I8] T4 必须为 `usage-unsettled` 支、D-LANDED、D-STOPINSPECT 各加判据；计划预言「不会红」的变异（T4-M4、M11、M13、M15、M18）要么补判据使其见红，要么在变异台账写明等价的理由（T7-M2、M7a 同） — Rule 9「判据在被看到打红之前不是判据」— 若错：多几条判据。
Ruling: [I9] 计划 L3972、L5485 的管道过滤改为重定向到文件再整份读回 — Global Constraints／Rule 14 — 若错：无。
Ruling: [I10] T6 起的 E2E 用控制器在 T1/T2 落地后新 clone＋build 的 ccloop（含 C1–C7＋C-3），路径随派发给出 — ORCA_CCLOOP_BIN 在 T9 Step 1 之前就要用 — 若错：无。
Ruling: [I11] 逐字重复的逻辑块：`readExistingResumeBundle` 与 `exportResumeBundle`、`persistCanonicalCheckpoint` 与 `persistImmutableCheckpoint` 抽共享 helper，不逐字复制；T9 的 world/boot/die 与 T4/T5/T9 的测试辅助抽到共享夹具文件 — 评审准则把逐字重复算 Important — 若错：多一次小重构。
Ruling: [Minor] §4 的 8 条随对应 Task 派发；§11 I6「stop 落在失败 attempt 之后」fake codex 表达不出 ⇒ 登记为缺口，不立判据 — 构造不出的场景写判据只会是空绿 — 若错：该路径未被证明。
Task 1: dispatched (implementer sonnet; ccloop BASE a5dc529)
Task 1: minor (deferred): handoffEnteredPhases.test.ts:277-284 只经公开行为断言 missing，不单测未导出的 enteredPhaseFiles（评审认为可接受）
Task 1: complete (ccloop commits a5dc529..3d0fc5c, review clean; implementer 165,995 tok 工具报数)
Task 2: dispatched (implementer sonnet; ccloop BASE 3d0fc5c; 含 D-C7′(α)，预检 C1)
Ruling: T3（Orca 仓）在 T2（ccloop 仓）评审期间并行派发 — 两仓无共享文件，T3 不依赖 C-3；skill 的「不并行」是为防同一工作树冲突 — 若错：T2 修复轮若波及 Orca 需要协调，可能性低。
Task 3: dispatched (implementer sonnet; Orca BASE 29fe36d; 带预检 I11 共享 helper、M3)
Task 2: review 1 — Important(plan-mandated)：如实登记没写进提取点注释、报告误称已写 ⇒ fix round 1 续派原实施席
Task 2: minor (deferred): handoff.ts:251 引文用直撇号 D-C7' 而非 D-C7′（U+2032）
Task 2: minor (deferred): observedTurnUsage 内部各守卫（!record、!integer）与 observedTokensOf 的 value>0 未各自配变异
Task 2: fix round 1/5 (1 addressed, 0 open; ccloop commits 8a76c98..acc9b4b)
Task 2: complete (ccloop commits 3d0fc5c..acc9b4b, review clean after 1 fix round)
ccloop build for T6+: scratchpad/ccloop-acc9b4b (C1–C7＋C-3＋D-C7′)
Task 3: implementer DONE 09aac91; concerns: I11 helper narrower; M3/M10 deferred to T4/T5 criteria
Task 3: minor (deferred): exportResumeBundle 抽共享 helper 后 hash 校验先于 missing/snapshot 校验 ⇒ 同时不完整且 hash 不符时错误码由 resume-predecessor-unrecoverable 变 checkpoint-hash-mismatch（都拒；终审判是否恢复原序）
Task 3: minor (deferred): handoffStop.test.ts:560 最后一条断言恒真（existsSync 首次写入即成立）；应比文件仍是第一份 canonicalBytes
Task 3: minor (deferred): restartable 续跑支的身份不符拒绝（stopIntent.ts:677）与 C1 的 ADOPTABLE_STATES 守卫（:768）无独占红证 ⇒ 进 T10 变异表
Task 3: minor (deferred): 报告 RED 分项计数写错（总数对）
Ruling: [T3 ⚠️] C-5 路径下「active 且请求已 settle」的 run 在 deriveStopState 里按「未解决」计（不让组到 handoff-complete）；T4 实现并配判据钉 stop 状态 — Web §6.2「矛盾组合即 recovery blocker」，让组显示 complete 会放行 resume — 若错：组多停在 unresolved，人要 recovery-retry。
Task 3: complete (Orca commits 29fe36d..09aac91, review clean; 4 minor deferred)
Task 4: dispatched (implementer opus; Orca BASE 09aac91)
Ruling: [T4 BLOCKED] 改写 T3 本会话新增的 handoffStop.test.ts > "a run that finished settles its request on its own (spec §11 C1)" > "marks only the request settled-recoverable…"：setup 置 run active=0（恢复 settleCompletedRunRequestInTransaction 的前提：run 已经 E 结算），断言一字不改 — 该判据是本片 T3 新加、未发布，原 setup 构造的正是 C-5 裁定判为未解决的矛盾态 — 若错：C1 在 active=1 下的行为无判据（按裁定那本就是矛盾态）。
Task 4: implementer DONE 38180fc; 28 mutations 27 red; M22 (D-VIEW current&&) defers to T5 criterion 1; implementer context ~314k near Rule 6 per-task 330k (工具未给确数)
Task 4: review 1 — Needs fixes: 2 Important（均 plan-mandated）
Ruling: [T4-I1] D-LANDED 扩展：blockedAt ∈ {D,R} 且 landedCommit 为空时，C-5 之前先 findLanding(target, base, tip, attemptSha)，命中即按 D-LANDED（不收口、请求保持开着）— §3「整落或整留」原则；landOnTip 在 CAS 成功后清理抛错会留下未记录的落地 — 若错：多一次 git 探测，无行为风险。
Ruling: [T4-I2] 补判据：settleHandoffCheckpoint 的 unresolved-requests、missing、snapshot-missing、usage-unsettled 的 pending 与 unknown.handoff 两部分、ack.requestId 守卫、inspectUnderStop 的 stopped 支；各配删它自己的变异见红。顺延到 T10 变异表（记名）：checkpoint-id-conflict、checkpoint-usage-high-water、deliverAndCollect 的 draining 早退、restartRun 的 cleanupError — 前者是可恢复性的承重判定，后者是防御性守卫 — 若错：四个守卫到 T10 才有红证。
Ruling: T4 修复轮改派新实施席（opus）而非续派原席 — 原席自报上下文约 314k，接近 Rule 6 每 Task 330k — 若错：新席重建上下文多花 token。
Task 4: minor (deferred): D-SNAP 对所有 terminal 任务分配都不比 amount；D-VIEW 对非当前 run 完全不比 grant（可收紧为只对有 handoff 谱系的任务）
Task 4: minor (deferred): outcome-unknown 之后 countUnknownUnderStop 每轮仍写 inspectUnknown+1（无界写）
Task 4: minor (deferred): inspectUnderStop 未查 stop-proof generation；未投递即过宽限的请求 outcome-unknown 后不再投递；终态到达时 double collect；closeBlocked 的 run.drive! 无守卫；stepH 对 settled-* 带开请求的 default 未测；import 顺序
Task 4: fix round 1 dispatched (fresh implementer opus)
Ruling: [T4 fix1 concern] findLanding 探测本身失败 ⇒ 按 D-LANDED（不收口、请求开着）— 保守侧：宁可让人处理，不冒重复落地 — 若错：repository-path 被 block 的 run 在 stop 下不会被 park，组停在 handoff-pending 直到人修仓库。
Task 4: fix round 1/5 (2 addressed, 0 open; commits 38180fc..a70ce4e; fresh opus implementer)
Task 4: complete (Orca commits 09aac91..a70ce4e, review clean after 1 fix round)
（检查点提交 fe56e3d 落在 T4 与 T5 之间：本会话上下文越 T1，人裁放开上限，照记）
Task 5: dispatched (implementer opus; Orca BASE fe56e3d; 须见红 T4-M22、T3-M3；核 continuation 领取是否二次预留)
Task 5: implementer DONE 98e9976; T4-M22、T3-M3 见红；预留守恒（createStartingRun 不碰 reserved），T5-M13 证；concern: cleanupPredecessor 抛错时 cleanupError 未记
Task 5: review 1 — Needs fixes: 1 Important (plan-mandated) 前任清理失败卡住续跑且前任无记录
Ruling: [T5-I1] cleanupPredecessor try/catch：失败记前任 cleanupError（cleanedUp:false），A2 继续 — spec §7 残留入 run body ＋ driverHandoff.ts:87-89 本片既定约定（Rule 7 取已有约定）— 若错：残留仍可见，只是续跑不再因清理失败停。
Task 5: minor (deferred): withinGrant 可能产出 0（ccloop 要求正数）⇒ B 处报 schema 错而非 A2 具名 block；continuationOf 前任行缺失时报泛化错；D21 标题「before any provider attempt」措辞；:48 以 withinGrant 自身作 oracle；复用 bundle 路径不复核 artifact 文件（ccloop 侧会查）
Task 5: fix round 1 dispatched (resume original implementer)
Task 5: fix round 1/5 (1 addressed, 0 open; commits 98e9976..6da37e0)
Task 5: complete (Orca commits fe56e3d..6da37e0, review clean after 1 fix round)
Task 6: dispatched (implementer opus; Orca BASE 6da37e0)
Ruling: [T6] 接受 brief 之外的 D-SPAWNKEY 判据（预置 spawn-2 断言 spawnSeq=3）— 否则 MAX→COUNT 变异无判据可红（Rule 9）— 若错：多一条判据。
Task 6: implementer DONE 0551961; M1–M14 red, M15 equivalent; LIKE 下划线通配登记
Task 6: minor (deferred): 旧记录回退 `?? [record.otherTaskId]` 无判据（改 `?? []` 存活）
Task 6: minor (deferred, 需登记): recovery-retry 在 R 绕过 N2 ⇒ 人工重试可致同组两个解冲突同时在跑（§13.2 Minor d 只登了多花钱）
Task 6: minor (deferred, 需登记): N2 放大「卡死的 reconciling（pid 复用被判活）」的影响：压住整组兄弟落地
Task 6: minor (deferred): spawn 键 LIKE 的 `_` 通配（UUID 不含，误配只会序号偏高）；N2 守卫在 findLanding 之前
Task 6: complete (Orca commits 6da37e0..0551961, review clean)
Task 7: dispatched (implementer sonnet; Orca BASE 0551961)
Task 7: implementer DONE 5ed2b04; 副本里 git merge 被 Tier 0 闸门拦，改为重新 clone（未绕过）
Task 7: complete (Orca commits 0551961..5ed2b04, review clean)
Task 8: dispatched (implementer sonnet; Orca BASE 5ed2b04; 带 I5 continuable 剩余 grant>0、D-RESUME-SHUTDOWN、预检 T8 minors)
Task 8: implementer DONE 946a840; ⚠️ 流程越界：为取 TDD RED 在主树用 Edit 临时撤 4 个实现文件再还原（违反「主树不许做实验」）；提交后工作树干净，评审席核对提交内容完整
Task 8: minor (deferred): runContinuable.test.ts 三条 handedOff 判据在调用前断言 recoverable（夹具自写、被测函数不读）为恒真
Task 8: minor (registered): Resume 按钮的 handoffActive 条件无独占变异（shutdown 组出口本就是登记缺口）
Task 8: complete (Orca commits 5ed2b04..946a840, review clean)
Task 9: dispatched (implementer opus; Orca BASE 946a840)
Task 9: implementer DONE 0614dd5; handoffE2E=12 条；concern: deadline E2E 未见红（D-C7′ 撤掉时）；H2 选择断言改为排序后比（本 Task 新判据）
Task 9: review 1 — Needs fixes: 2 Important（deadline 判据未见红；usage 断言可空绿）
Ruling: [T9] deadline 判据：跑变异 A（ccloop 副本删 D-C7′ 分支重 build）与 B（关 usageBeforeDelay 或删 fake-codex 相应行）并记红点；usage 断言收窄到被中止阶段（run.unknown.work===false 且中止阶段后有非空事件）；并入 Minor 1：断言 handoff_interrupted 或在 delayMs 之前 settle — Rule 9 — 若错：多两条变异跑。
Task 9: minor (deferred): G 依赖 30s 实时窗，负载下可能 flake；报告 8949 vs 实测 8948 字节（sha 同）；ccloopWorld 注释称「unchanged」但多了 scripted/show/tip
Task 9: fix round 1 dispatched (resume original implementer)
Task 9: fix round 1/5 (2 addressed, 0 open; commits 0614dd5..3351438)
Task 9: complete (Orca commits 946a840..3351438, review clean after 1 fix round)
Task 10: dispatched (implementer sonnet; Orca BASE 3351438)
Task 10: interim hand-back (forced) — gates running in background; checker in scratchpad/t10/check-handoff.py; 六条顺延变异全部不红（真缺口）
Ruling: [T10] 六条顺延守卫变异（stopIntent restartable 续跑身份守卫、C1 ADOPTABLE_STATES 守卫、checkpoint-id-conflict、checkpoint-usage-high-water、deliverAndCollect draining 早退、restartRun cleanupError）先在 mutations.md 登记为开放缺口；T10 收口后另派 T10b 只加判据补红证，再重跑受影响的门，然后终审 — Rule 9；门在跑时不改工作树 — 若错：多一轮门。
Task 10: 判定器 `check-handoff.py`（scratchpad only，不入库，sha256 `143fe4023fb6d93312fa5e4ce6516f331e982fae5459c525504a5770f076e857`）——EXPECTED_* 全部从实物重数（grep `it(`/`it.each(` 计数 ＋ 本轮全量 vitest json 交叉核对），与 brief 表格的差异：`driverHandoff.test.ts` 14→28（T4 初版 +5、T4 fix round1 +9）；`driverContinuation.test.ts` 5→10（T5 初版 +4、T5 fix round1 +1）；`driverReconcileN.test.ts` 4→5（T6 D-SPAWNKEY +1）；`runContinuable.test.ts` 4→5（T8 preflight I-5 +1）；ccloop `handoffEnteredPhases.test.ts` 6→7（T2 D-C7′(α) +1）；新文件（brief 未列）`driverHandoffSnapshot.test.ts`=1（T4 fix round1）。`reconcileParity.test.ts` 不变（5）。`handoffE2E.test.ts` 按控制器裁定固定 12（无 `--no-t2`）。FLAKE 名单＝controlShutdown SIGTERM（按 fullName 精确匹配）∪ executionDriverE2E／driverSettle／driverRecovery／driverLanding 四份文件（按文件后缀匹配，文件内任意判据红都算），覆盖 spec §9.1 三项与计划 §0 新观测两项之并集。
Task 10: 判定器红证两次，均 RC=1：(a) 喂 `scratchpad/planner/base/orca-full2.json` ＋ 合成空 web json ＋ `scratchpad/planner/base/ccloop-full.json` ⇒ 10 条 Orca 新文件行、1 条 web 新文件行、4 条 ccloop 新文件行、3 条 rewritten-missing（D21、handoffStop、web controlPanel）；stopIntent 与 ccloop 那条改写判据恰好已在这两份历史快照里以同名存在（非本轮新加的行为，快照本身较新），非判定器缺陷，已在报告记录原因。(b) 把本轮真实全量 json 里 `driverHandoff.test.ts` 一条断言改成 failed ⇒ `orca unexpected failures=[...]` 精确点名该条。
Task 10: 六处顺延变异（T3-DEFER-1／2：`stopIntent.ts:680`／`:770`；T4-DEFER-1..4：`driverHandoff.ts` 的 checkpoint-id-conflict／checkpoint-usage-high-water／draining 早退／restartRun cleanupError），`git clone --local` 副本（已删）里逐条实测：基线 86/86 绿，六条全部 applied=True、restored=True（sha256 核对相等）、跑对应测试文件后 **red=[]（RC=0）**——按控制器裁定登记为 open gap（见 mutations.md 对应节的结构性原因），本任务未加判据。副本还原：`git diff`／`git diff --cached` 均 0 字节，clone 已 `/bin/rm -rf` 删除。
Task 10: 全套门（env `scratchpad/env2/env.sh`，逐段单跑）：typecheck RC0；web-build RC0；root vitest json 1839 条 1838 过 1 败（唯一失败 `driverRecovery.test.ts` 已登记 flake，单文件重跑 8/8 绿，`scratchpad/t10/gates/rerun-driverRecovery.log`）；web vitest json 78/78 RC0；verify:control RC0；verify:web-control RC0；verify:web-control:consumer RC0；verify:scheduler RC0；verify:chain RC1（唯一失败同一条 `driverRecovery` 判据，同一已登记 flake，同一次单文件重跑已覆盖，不算新失败）；verify:panel RC0（15/15）；`--ws check` RC0（17 文件 78 条）；check-claude-md-lines RC0；check-hooks-path RC0；`ledger validate .decisions` RC2（历史 `downgraded to tier 0` 条目，属 RC∈{0,2} 允许范围，与本轮改动无关）。ccloop：`ECC_GATEGUARD=off DISABLE_OMC=1` 下 typecheck RC0、build RC0、vitest json 843 条 842 过 1 败（`stopProof.test.ts` 的 `quiet execution proof` 判据，ccloop 已知红名单第 13 项之一）、`check-known-reds.mjs` RC0（"known reds in roster: 13; failed: 1 (known); unexpected: 0"）。`check-handoff.py` 用本轮全量 json（root/web/ccloop）＋ `--flake-rerun-ok` 跑：**OK，RC0**。
Task 10: complete (Orca commit, subject `docs(sdd): record the handoff delivery mutation battery and gates`, see `git log`；`mutations.md` 新建，237 行；`progress.md` 仅追加，未改动任何既有行)。
Task 10: complete (Orca commit dfdc676; checker scratchpad/t10/check-handoff.py RC 0 with --flake-rerun-ok; chain/test 的红 = driverRecovery 已登记 flake，单文件重跑绿)
（现测 ls-remote：Orca 远端 3351438、ccloop 远端 acc9b4b ⇒ 人在会话中推过；T1–T9 已发布）
Task 10b: dispatched (implementer opus; Orca BASE dfdc676; 只加判据补六条开放缺口)
Task 10b: complete (Orca commits dfdc676..16b4aff; 6/6 gaps red; tests-only) — Ruling: T10b 只加测试，其评审并入终审 — 若错：终审兜底。
Task 10b: minor (deferred): T3-DEFER-1 守卫拒绝后，驱动环通用 catch 以 step E 重 block，下一轮 blockedReason 被覆盖为 control-terminal-pending（仍 fail closed，原因失真）
Final review: dispatched (opus; Orca 29fe36d..HEAD, ccloop a5dc529..acc9b4b)
Final review: 2C/1I/9M（final-review.md；探针 scratchpad/fr/）
Ruling: [FR-C1] continuableRun 追加 work.currentRunId===runId 且 work.status==="held"（与 assertPredecessor 对齐）；顺修 T8 runContinuable 恒真断言 — 面板无出口 — 若错：无。
Ruling: [FR-C2] 驱动环通用 catch 对已 blocked 的 run 保留原 blockedAt/blockedReason（不改写为 E），瞬时错误另记；配 probe4/5/6 形状的判据 — 否则组永卡 handoff-pending、recovery-retry 可把未落地 run 写成 landed、违反 §3 — 若错：瞬时错误信息只在另一字段。
Ruling: [FR-I1] 冻结的 budget-estimate run 请求无消费方（上游既有）⇒ 登记进 handoff，本轮不修 — 超出本片范围（spec §2）— 若错：人对含在飞预估的组发 stop 会永停。
Ruling: [FR-minor] T9 的 G 并入 FLAKE 名单；T6 两条与 M9「组永久停住」写进 handoff 登记；ccloop protocol.ts/types.ts 注释把推测写成事实 ⇒ 已发布，登记不改 — 若错：无。
Final fix wave: dispatched (opus; Orca BASE 9b9ecd3)
Final fix wave: DONE 9f803ff, 0794bf2, 0e149fd; full 1851/1851; checker（更新副本 scratchpad/ffix/check-handoff.py）RC 0
Ruling: [FR-C2 偏离] 接受 blockedReason = "<原因> | then: <最新错误>"（原因作前缀保留，路由按前缀）而非字面保留 — 字面保留会打红未授权改写的 T3-DEFER-1 判据；schema 不变 — 若错：原因字段变长，含一段瞬时错误。
Final fix wave: 新 flake 候选 web/tests controlCommandRecovery "drops the id when the lookup returns the command's retained result"（单跑 3/3 绿）⇒ 登记
Final fix wave: scoped re-review dispatched
Final fix wave: scoped re-review — all addressed, no new breakage ⇒ round complete
